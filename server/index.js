const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./engine-core');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

/**
 * ✅ AUTH ROUTES (register/login/leaderboard)
 * A server/routes/auth.js-ben legyenek:
 *  - POST /register
 *  - POST /login
 *  - GET  /leaderboard
 */
try {
  app.use('/api/auth', require('./routes/auth'));
} catch (e) {
  console.warn('[WARN] ./routes/auth betöltése nem sikerült. Ellenőrizd: server/routes/auth.js', e && e.message ? e.message : e);
}

// ✅ Ha a kliens /api/leaderboard-ot hív, irányítsuk át az auth leaderboardra
app.get('/api/leaderboard', (req, res) => {
  // ugyanazt adja, mint /api/auth/leaderboard
  req.url = '/leaderboard';
  return require('./routes/auth')(req, res);
});

// Default entry
app.get('/', (req, res) => {
  res.redirect('/intro.html');
});

// ---- In-memory room store (LAN / MVP) ----
/**
 * Room shape:
 * {
 *   phase: 'LOBBY'|'IN_GAME'|'FINISHED',
 *   createdAt:number,
 *   options:{ maxPlayers:number, isPublic:boolean, password?:string|null },
 *   players: Array<{ id:string, name:string, characterKey:string, token:string, ready:boolean, isHost:boolean, connected:boolean }>,
 *   state: any|null
 * }
 */
/** @type {Map<string, any>} */
const rooms = new Map();

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeRoomCode(len = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function uid(prefix = 't') {
  return prefix + '_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
}

function createLobbyRoom({ hostName, hostCharacterKey, maxPlayers = 4, isPublic = false, password = null }) {
  let code;
  do { code = makeRoomCode(4); } while (rooms.has(code));

  const hostToken = uid('tok');
  const room = {
    phase: 'LOBBY',
    createdAt: Date.now(),
    options: {
      maxPlayers: Math.min(4, Math.max(2, parseInt(String(maxPlayers || 4), 10) || 4)),
      isPublic: !!isPublic,
      password: password ? String(password) : null // MVP: plain; later hash
    },
    players: [
      {
        id: 'p1',
        name: String(hostName || 'Host').trim() || 'Host',
        characterKey: hostCharacterKey,
        token: hostToken,
        ready: true,
        isHost: true,
        connected: false
      }
    ],
    state: null
  };

  rooms.set(code, room);
  return { code, token: hostToken };
}

function joinLobbyRoom({ roomCode, name, characterKey, password = null }) {
  const r = rooms.get(roomCode);
  if (!r) return { error: 'Szoba nem található.' };
  if (r.phase !== 'LOBBY') return { error: 'Ez a szoba már elindult.' };

  if (r.options.password) {
    if (String(password || '') !== String(r.options.password)) return { error: 'Hibás jelszó.' };
  }

  if ((r.players || []).length >= (r.options.maxPlayers || 4)) {
    return { error: 'A szoba megtelt.' };
  }

  const token = uid('tok');
  const id = 'p' + String((r.players || []).length + 1);
  r.players.push({
    id,
    name: String(name || ('Ügynök ' + id.slice(1))).trim() || ('Ügynök ' + id.slice(1)),
    characterKey,
    token,
    ready: false,
    isHost: false,
    connected: false
  });

  // Return roomCode too so API callers never accidentally use undefined.
  return { code: roomCode, token };
}

function startGame(roomCode) {
  const r = rooms.get(roomCode);
  if (!r) return { error: 'Szoba nem található.' };
  if (r.phase !== 'LOBBY') return { error: 'A játék már fut.' };
  const players = r.players || [];
  if (players.length < 2) return { error: 'Minimum 2 játékos kell.' };
  const readyCount = players.filter(p => p && p.ready).length;
  if (readyCount < 2) return { error: 'Minimum 2 játékos legyen READY.' };

  const configs = players.map(p => ({ name: p.name, characterKey: p.characterKey }));
  let state = Engine.createGame(configs);
  state = Engine.startTurn(state).next;

  r.state = state;
  r.phase = 'IN_GAME';
  return { ok: true };
}

// LEGACY: Create a new room from Setup page (starts game immediately)
app.post('/api/create-room', (req, res) => {
  try {
    const configs = (req.body && req.body.configs) ? req.body.configs : null;
    if (!Array.isArray(configs) || configs.length < 2 || configs.length > 4) {
      return res.status(400).json({ error: '2–4 játékos szükséges.' });
    }
    for (const c of configs) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) {
        return res.status(400).json({ error: 'Minden játékosnak legyen neve.' });
      }
      if (!c.characterKey) {
        return res.status(400).json({ error: 'Minden játékosnak válassz karaktert.' });
      }
    }
    // Create a lobby room, auto-fill players, then start game.
    const host = configs[0];
    const created = createLobbyRoom({
      hostName: host.name.trim(),
      hostCharacterKey: host.characterKey,
      maxPlayers: configs.length,
      isPublic: false,
      password: null
    });

    const r = rooms.get(created.code);
    // Add the remaining players as auto-joined "LAN seats"
    for (let i = 1; i < configs.length; i++) {
      joinLobbyRoom({ roomCode: created.code, name: configs[i].name.trim(), characterKey: configs[i].characterKey, password: null });
      // mark them ready (legacy setup assumes all present)
      const pl = r.players[i];
      if (pl) pl.ready = true;
    }
    startGame(created.code);

    return res.json({ room: created.code });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a szoba létrehozásakor.' });
  }
});

// NEW: create lobby room (token-based)
app.post('/api/create-room-lobby', (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const characterKey = String(b.characterKey || '').trim();
    const maxPlayers = b.maxPlayers;
    const password = (b.password != null && String(b.password).trim()) ? String(b.password).trim() : null;
    const isPublic = !!b.isPublic;

    if (!name) return res.status(400).json({ error: 'Adj meg nevet.' });
    if (!characterKey) return res.status(400).json({ error: 'Válassz karaktert.' });

    const created = createLobbyRoom({ hostName: name, hostCharacterKey: characterKey, maxPlayers, isPublic, password });
    const inviteLink = `/join.html?room=${created.code}`;
    return res.json({ room: created.code, token: created.token, inviteLink });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a szoba létrehozásakor.' });
  }
});

// NEW: join lobby room
app.post('/api/join-room', (req, res) => {
  try {
    const b = req.body || {};
    const room = String(b.room || '').trim().toUpperCase();
    const name = String(b.name || '').trim();
    const characterKey = String(b.characterKey || '').trim();
    const password = (b.password != null && String(b.password).trim()) ? String(b.password).trim() : null;

    if (!room) return res.status(400).json({ error: 'Adj meg szoba kódot.' });
    if (!name) return res.status(400).json({ error: 'Adj meg nevet.' });
    if (!characterKey) return res.status(400).json({ error: 'Válassz karaktert.' });

    const out = joinLobbyRoom({ roomCode: room, name, characterKey, password });
    if (out && out.error) {
      return res.status(out.status || 400).json({ error: out.error });
    }

    return res.json({
      room: room,
      token: out.token,
      lobbyUrl: `/lobby.html?room=${encodeURIComponent(room)}&token=${encodeURIComponent(out.token)}`
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a csatlakozáskor.' });
  }
});

// NEW: send invite email(s) (host only)
app.post('/api/send-invite', async (req, res) => {
  try {
    const b = req.body || {};
    const room = String(b.room || '').trim().toUpperCase();
    const token = String(b.token || '').trim();
    const emails = Array.isArray(b.emails) ? b.emails.map(x => String(x || '').trim()).filter(Boolean) : [];

    if (!room) return res.status(400).json({ error: 'Hiányzik a szobakód.' });
    if (!token) return res.status(400).json({ error: 'Hiányzik a token.' });
    if (!emails.length) return res.status(400).json({ error: 'Adj meg legalább 1 e-mail címet.' });

    const r = rooms.get(room);
    if (!r) return res.status(404).json({ error: 'Szoba nem található.' });

    const hostPlayer = (r.players || []).find(p => p && p.token === token);
    if (!hostPlayer) return res.status(403).json({ error: 'Érvénytelen token ehhez a szobához.' });
    if (!hostPlayer.isHost) return res.status(403).json({ error: 'Csak a host küldhet meghívót.' });

    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
    const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return res.status(400).json({
        error: 'E-mail küldés nincs beállítva a szerveren (SMTP_HOST/SMTP_USER/SMTP_PASS env hiányzik).'
      });
    }

    // Build absolute join link (Render + proxies safe)
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https');
    const hostHeader = req.get('x-forwarded-host') || req.get('host');
    const base = `${proto}://${hostHeader}`;
    const joinLink = `${base}/join.html?room=${encodeURIComponent(room)}`;

    const subject = `Meghívó: Ügynökség – Szobakód: ${room}`;
    const text = `${hostPlayer.name} meghívót küldött az ÜGYNÖKSÉGHEZ!\n\nKattints a linkre, válassz karaktert és indulhat a nyomozás:\n${joinLink}\n\nSzobakód: ${room}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif; line-height:1.45;">
        <p><b>${escapeHtml(hostPlayer.name)}</b> meghívót küldött az <b>ÜGYNÖKSÉGHEZ</b>!</p>
        <p>Kattints a linkre, válassz karaktert és indulhat a nyomozás:</p>
        <p><a href="${joinLink}">${joinLink}</a></p>
        <p><b>Szobakód:</b> ${escapeHtml(room)}</p>
        <p style="opacity:.75; font-size:12px;">Ha nem te vártad ezt a levelet, nyugodtan hagyd figyelmen kívül.</p>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const results = [];
    for (const to of emails) {
      if (!/^.+@.+\..+$/.test(to)) {
        results.push({ to, ok: false, error: 'invalid_email' });
        continue;
      }
      try {
        const info = await transporter.sendMail({
          from: SMTP_FROM,
          to,
          subject,
          text,
          html
        });
        results.push({ to, ok: true, messageId: info && info.messageId ? info.messageId : null });
      } catch (err) {
        console.error('sendMail error', to, err && err.message ? err.message : err);
        results.push({ to, ok: false, error: 'send_failed' });
      }
    }

    return res.json({ ok: true, results });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba e-mail küldés közben.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

function getRoom(code) {
  const r = rooms.get(code);
  return r ? r.state : null;
}
function setRoomState(code, state) {
  const r = rooms.get(code);
  if (!r) return;
  r.state = state;
}

function broadcastState(code) {
  // Broadcast per-player privacy-safe state
  const r = rooms.get(code);
  if (!r || !r.state) return;
  broadcastStatePerPlayer(code);
}

function lobbySnapshot(roomCode) {
  const r = rooms.get(roomCode);
  if (!r) return null;
  return {
    room: roomCode,
    phase: r.phase,
    options: { maxPlayers: r.options.maxPlayers, isPublic: r.options.isPublic, hasPassword: !!r.options.password },
    players: (r.players || []).map(p => ({
      id: p.id,
      name: p.name,
      characterKey: p.characterKey,
      ready: !!p.ready,
      isHost: !!p.isHost,
      connected: !!p.connected
    }))
  };
}

function stateForPlayer(state, meIndex) {
  // Privacy MVP: hide other players' tableCards and raw deck arrays
  const s = JSON.parse(JSON.stringify(state));

  // Optional: profiler peek needs top 2 mixed cards (only for profiler who can peek)
  try {
    const me = (state.players || [])[meIndex];
    const canPeek = !!(me && me.characterKey === 'PROFILER' && me.flags && me.flags.profilerPeekAvailable && !me.flags.profilerPeekUsed);
    if (canPeek && Array.isArray(state.mixedDeck) && state.mixedDeck.length >= 2) {
      s.mixedDeckTop2 = [state.mixedDeck[0], state.mixedDeck[1]];
    }
  } catch (e) { /* ignore */ }

  // Remove full decks; keep counts
  if (Array.isArray(s.mixedDeck)) s.mixedDeckCount = s.mixedDeck.length;
  if (Array.isArray(s.itemDeck)) s.itemDeckCount = s.itemDeck.length;
  if (Array.isArray(s.skillDeck)) s.skillDeckCount = s.skillDeck.length;
  delete s.mixedDeck;
  delete s.itemDeck;
  delete s.skillDeck;

  const players = s.players || [];
  players.forEach((p, idx) => {
    if (!p) return;
    if (idx !== meIndex) {
      // Hide exact cards; keep counts
      const handCount = Array.isArray(p.tableCards) ? p.tableCards.length : 0;
      p.tableCards = [];
      p.handCount = handCount;
      // Fixed items: keep minimal public info
      if (Array.isArray(p.fixedItems)) {
        p.fixedItems = p.fixedItems.map(it => it ? ({ kind: 'item', name: it.name, rarity: it.rarity, fixed: true, permanent: true }) : it);
      }
    }
  });

  s._meIndex = meIndex;
  s._meId = players[meIndex] ? players[meIndex].id : null;
  return s;
}

async function broadcastStatePerPlayer(roomCode) {
  const r = rooms.get(roomCode);
  if (!r || !r.state) return;
  const sockets = await io.in(roomCode).fetchSockets();
  for (const sock of sockets) {
    const idx = sock.data && typeof sock.data.playerIndex === 'number' ? sock.data.playerIndex : 0;
    sock.emit('state', stateForPlayer(r.state, idx));
  }
}

function isActionAllowed(state, playerIndex, type) {
  if (!state || !state.players) return false;

  // During elimination pause, only the eliminated player may ACK
  if (state.turn && state.turn.phase === 'ELIMINATION_PAUSE') {
    if (type !== 'ACK_ELIMINATION') return false;
    const last = state._lastEliminated;
    const p = state.players[playerIndex];
    return !!(last && p && p.id === last.id);
  }

  // Game over: no actions
  if (state.turn && state.turn.phase === 'GAME_OVER') return false;

  // Normal: only current player can act
  return playerIndex === (state.currentPlayerIndex || 0);
}

function applyAction(state, type, payload) {
  payload = payload || {};
  switch (type) {
    case 'PRE_DRAW':
      return Engine.doPreDraw(state);
    case 'ROLL':
      return Engine.doRollAndDraw(state);
    case 'ATTEMPT_CASE':
      return Engine.attemptCase(state, payload);
    case 'PROFILER_PEEK':
      return Engine.profilerPeek(state, { keep: payload.keep });
    case 'PASS':
      return Engine.beginPassToEndTurn(state);
    case 'END_TURN':
      return Engine.endTurn(state, Array.isArray(payload.discardIds) ? payload.discardIds : []);
    case 'ACK_ELIMINATION':
      return Engine.ackElimination(state);
    default:
      return { next: state, log: 'Ismeretlen akció.' };
  }
}

io.on('connection', (socket) => {
  const { room, token, player } = socket.handshake.query || {};
  const roomCode = String(room || '').trim().toUpperCase();

  if (!roomCode || !rooms.has(roomCode)) {
    socket.emit('serverMsg', 'Szoba nem található.');
    socket.disconnect(true);
    return;
  }

  const r = rooms.get(roomCode);
  if (!r) {
    socket.emit('serverMsg', 'Szoba nem található.');
    socket.disconnect(true);
    return;
  }

  // Token path (new)
  let playerIndex = -1;
  if (token) {
    const tok = String(token);
    playerIndex = (r.players || []).findIndex(p => p && p.token === tok);
    if (playerIndex < 0) {
      socket.emit('serverMsg', 'Érvénytelen token ehhez a szobához.');
      socket.disconnect(true);
      return;
    }
  } else {
    // Legacy path (player index)
    playerIndex = Math.max(0, parseInt(String(player || '0'), 10) || 0);
    if (r.phase !== 'IN_GAME' || !r.state || !r.state.players || playerIndex >= r.state.players.length) {
      socket.emit('serverMsg', 'Érvénytelen játékos index ehhez a szobához.');
      socket.disconnect(true);
      return;
    }
  }

  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.playerIndex = playerIndex;

  // mark connected
  if (r.players && r.players[playerIndex]) r.players[playerIndex].connected = true;

  // Send initial payload depending on phase
  if (r.phase === 'LOBBY') {
    socket.emit('lobby', lobbySnapshot(roomCode));
    io.to(roomCode).emit('lobby', lobbySnapshot(roomCode));
  } else if (r.phase === 'IN_GAME' && r.state) {
    socket.emit('state', stateForPlayer(r.state, playerIndex));
  }

  // --- CHAT (ephemeral): announce join (no persistence) ---
  try {
    if (r.players && r.players[playerIndex]) {
      const was = !!r.players[playerIndex]._wasConnected;
      r.players[playerIndex]._wasConnected = true;
      if (!was) {
        const nm = r.players[playerIndex].name || `Játékos ${playerIndex + 1}`;
        io.to(roomCode).emit('chat', { type: 'system', text: `${nm} csatlakozott.`, ts: Date.now() });
      }
    }
  } catch (e) { /* ignore */ }

  socket.on('action', (msg) => {
    try {
      const code = socket.data.roomCode;
      const idx = socket.data.playerIndex;
      const s0 = getRoom(code);
      if (!s0) return;

      const type = msg && msg.type ? String(msg.type) : '';
      const payload = msg && msg.payload ? msg.payload : {};

      if (!isActionAllowed(s0, idx, type)) {
        socket.emit('serverMsg', 'Most nem te vagy soron.');
        return;
      }

      const res = applyAction(s0, type, payload);
      let next = res && res.next ? res.next : s0;

      // ✅ Online: ugyanúgy fusson le az auto-capture, mint offline-ban
      if (Engine && typeof Engine.captureIfPossible === "function") {
        next = Engine.captureIfPossible(next);
      }

      setRoomState(code, next);

      if (res && res.log) {
        io.to(code).emit('serverMsg', res.log);
      }
      broadcastState(code);

    } catch (e) {
      console.error(e);
      socket.emit('serverMsg', 'Szerver hiba az akció feldolgozásakor.');
    }
  });

  socket.on('lobbyAction', async (msg) => {
    try {
      const code = socket.data.roomCode;
      const idx = socket.data.playerIndex;
      const r2 = rooms.get(code);
      if (!r2 || r2.phase !== 'LOBBY') return;
      const p = (r2.players || [])[idx];
      if (!p) return;

      const type = msg && msg.type ? String(msg.type) : '';
      if (type === 'TOGGLE_READY') {
        p.ready = !p.ready;
        io.to(code).emit('lobby', lobbySnapshot(code));
      }
      if (type === 'START_GAME') {
        if (!p.isHost) {
          socket.emit('serverMsg', 'Csak a host indíthatja a játékot.');
          return;
        }
        const out = startGame(code);
        if (out && out.error) {
          socket.emit('serverMsg', out.error);
          return;
        }
        io.to(code).emit('lobby', lobbySnapshot(code));
        await broadcastStatePerPlayer(code);
      }
    } catch (e) {
      console.error(e);
      socket.emit('serverMsg', 'Szerver hiba a lobby akciónál.');
    }
  });

  // --- CHAT (ephemeral): room chat messages ---
  socket.on('chat', (msg) => {
    try {
      const code = socket.data.roomCode;
      const idx = socket.data.playerIndex;
      if (!code) return;
      const r = rooms.get(code);
      if (!r) return;

      const text = String((msg && msg.text) ? msg.text : '').trim();
      if (!text) return;
      const safe = text.slice(0, 200);

      const p = (r.players || [])[idx] || {};
      const name = String(p.name || `Játékos ${idx + 1}`);

      io.to(code).emit('chat', { type: 'user', name, playerIndex: idx, text: safe, ts: Date.now() });
    } catch (e) {
      // ignore
    }
  });

  socket.on('disconnect', () => {
    try {
      const code = socket.data.roomCode;
      const idx = socket.data.playerIndex;
      const r3 = rooms.get(code);
      if (r3 && r3.players && r3.players[idx]) {
        r3.players[idx].connected = false;
        r3.players[idx]._wasConnected = false;
        try {
          const nm = r3.players[idx].name || `Játékos ${idx + 1}`;
          io.to(code).emit('chat', { type: 'system', text: `${nm} kilépett.`, ts: Date.now() });
        } catch (e) { /* ignore */ }
        io.to(code).emit('lobby', lobbySnapshot(code));
      }
    } catch (e) {
      // ignore
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LAN server running: http://localhost:${PORT}`);
});