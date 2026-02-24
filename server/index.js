// server/index.js
// Ügynökök és Tolvajok - Online server (Render)
// Clean rebuild: Redis-backed room store + Socket.IO

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');

const Engine = require('./engine-core');
const pool = require('./db');
const roomStore = require('./room-store'); // uses Redis if REDIS_URL is set

// -------------------- Boot checks (DB + Redis) --------------------
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('DB OK');
  } catch (err) {
    console.error('DB ERROR:', err);
  }

  // room-store uses ./redis under the hood; ping via it if available
  try {
    const redis = require('./redis');
    if (redis) {
      const pong = await redis.ping();
      console.log('REDIS PING:', pong);
    } else {
      console.log('REDIS: disabled');
    }
  } catch (e) {
    console.error('REDIS PING ERROR:', e);
  }
})();

// -------------------- Express --------------------
const app = express();
app.use(express.json({ limit: '1mb' }));
// Static
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Root
app.get('/', (req, res) => res.redirect('/intro.html'));

// Simple DB smoke tests (optional)
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query(
      'INSERT INTO test_table (name) VALUES ($1) RETURNING *',
      ['render_test']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB insert failed' });
  }
});

app.get('/db-list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM test_table ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB select failed' });
  }
});

// -------------------- Helpers --------------------
function makeRoomCode(len = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function uid(prefix = 't') {
  return prefix + '_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
}

function lobbySnapshot(roomCode, r) {
  if (!r) return null;
  return {
    room: roomCode,
    phase: r.phase,
    options: {
      maxPlayers: r.options?.maxPlayers ?? 4,
      isPublic: !!r.options?.isPublic,
      hasPassword: !!r.options?.password,
    },
    players: (r.players || []).map((p) => ({
      id: p.id,
      name: p.name,
      characterKey: p.characterKey,
      ready: !!p.ready,
      isHost: !!p.isHost,
      connected: !!p.connected,
    })),
  };
}

// Game-state privacy filtering (keep as in your current MVP)
function stateForPlayer(state, meIndex) {
  const s = JSON.parse(JSON.stringify(state));

  // Optional: profiler peek needs top 2 mixed cards
  try {
    const me = (state.players || [])[meIndex];
    const canPeek = !!(
      me &&
      me.characterKey === 'PROFILER' &&
      me.flags &&
      me.flags.profilerPeekAvailable &&
      !me.flags.profilerPeekUsed
    );
    if (canPeek && Array.isArray(state.mixedDeck) && state.mixedDeck.length >= 2) {
      s.mixedDeckTop2 = [state.mixedDeck[0], state.mixedDeck[1]];
    }
  } catch (e) {
    /* ignore */
  }

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
      const handCount = Array.isArray(p.tableCards) ? p.tableCards.length : 0;
      p.tableCards = [];
      p.handCount = handCount;

      if (Array.isArray(p.fixedItems)) {
        p.fixedItems = p.fixedItems.map((it) =>
          it ? { kind: 'item', name: it.name, rarity: it.rarity, fixed: true, permanent: true } : it
        );
      }
    }
  });

  s._meIndex = meIndex;
  s._meId = players[meIndex] ? players[meIndex].id : null;
  return s;
}

function isActionAllowed(state, playerIndex, type) {
  if (!state || !state.players) return false;

  if (state.turn && state.turn.phase === 'ELIMINATION_PAUSE') {
    if (type !== 'ACK_ELIMINATION') return false;
    const last = state._lastEliminated;
    const p = state.players[playerIndex];
    return !!(last && p && p.id === last.id);
  }

  if (state.turn && state.turn.phase === 'GAME_OVER') return false;

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

// -------------------- Room (Redis-backed) operations --------------------
async function createLobbyRoom({ hostName, hostCharacterKey, maxPlayers = 4, isPublic = false, password = null }) {
  let code;
  do {
    code = makeRoomCode(4);
  } while (await roomStore.getRoom(code)); // simple existence check

  const hostToken = uid('tok');
  const room = {
    phase: 'LOBBY',
    createdAt: Date.now(),
    options: {
      maxPlayers: Math.min(4, Math.max(2, parseInt(String(maxPlayers || 4), 10) || 4)),
      isPublic: !!isPublic,
      password: password ? String(password) : null, // MVP: plain; later hash
    },
    players: [
      {
        id: 'p1',
        name: String(hostName || 'Host').trim() || 'Host',
        characterKey: hostCharacterKey,
        token: hostToken,
        ready: true,
        isHost: true,
        connected: false,
      },
    ],
    state: null,
  };

  await roomStore.setRoom(code, room);
  return { code, token: hostToken };
}

async function joinLobbyRoom({ roomCode, name, characterKey, password = null }) {
  const r = await roomStore.getRoom(roomCode);
  if (!r) return { error: 'Szoba nem található.', status: 404 };
  if (r.phase !== 'LOBBY') return { error: 'Ez a szoba már elindult.', status: 400 };

  if (r.options?.password) {
    if (String(password || '') !== String(r.options.password)) return { error: 'Hibás jelszó.', status: 401 };
  }

  if ((r.players || []).length >= (r.options?.maxPlayers || 4)) {
    return { error: 'A szoba megtelt.', status: 400 };
  }

  const token = uid('tok');
  const id = 'p' + String((r.players || []).length + 1);
  r.players.push({
    id,
    name: String(name || 'Ügynök ' + id.slice(1)).trim() || 'Ügynök ' + id.slice(1),
    characterKey,
    token,
    ready: false,
    isHost: false,
    connected: false,
  });

  await roomStore.setRoom(roomCode, r);
  return { code: roomCode, token };
}

async function startGame(roomCode) {
  const r = await roomStore.getRoom(roomCode);
  if (!r) return { error: 'Szoba nem található.', status: 404 };
  if (r.phase !== 'LOBBY') return { error: 'A játék már fut.', status: 400 };

  const players = r.players || [];
  if (players.length < 2) return { error: 'Minimum 2 játékos kell.', status: 400 };

  const readyCount = players.filter((p) => p && p.ready).length;
  if (readyCount < 2) return { error: 'Minimum 2 játékos legyen READY.', status: 400 };

  const configs = players.map((p) => ({ name: p.name, characterKey: p.characterKey }));
  let state = Engine.createGame(configs);
  state = Engine.startTurn(state).next;

  r.state = state;
  r.phase = 'IN_GAME';

  await roomStore.setRoom(roomCode, r);
  return { ok: true };
}

// -------------------- API routes (token-based lobby) --------------------
app.post('/api/create-room-lobby', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const characterKey = String(b.characterKey || '').trim();
    const maxPlayers = b.maxPlayers;
    const password = b.password != null && String(b.password).trim() ? String(b.password).trim() : null;
    const isPublic = !!b.isPublic;

    if (!name) return res.status(400).json({ error: 'Adj meg nevet.' });
    if (!characterKey) return res.status(400).json({ error: 'Válassz karaktert.' });

    const created = await createLobbyRoom({
      hostName: name,
      hostCharacterKey: characterKey,
      maxPlayers,
      isPublic,
      password,
    });

    const inviteLink = `/join.html?room=${encodeURIComponent(created.code)}`;
    return res.json({ room: created.code, token: created.token, inviteLink });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a szoba létrehozásakor.' });
  }
});

app.post('/api/join-room', async (req, res) => {
  try {
    const b = req.body || {};
    const room = String(b.room || '').trim().toUpperCase();
    const name = String(b.name || '').trim();
    const characterKey = String(b.characterKey || '').trim();
    const password = b.password != null && String(b.password).trim() ? String(b.password).trim() : null;

    if (!room) return res.status(400).json({ error: 'Adj meg szoba kódot.' });
    if (!name) return res.status(400).json({ error: 'Adj meg nevet.' });
    if (!characterKey) return res.status(400).json({ error: 'Válassz karaktert.' });

    const out = await joinLobbyRoom({ roomCode: room, name, characterKey, password });
    if (out && out.error) return res.status(out.status || 400).json({ error: out.error });

    const code = out.code || room;
    return res.json({
      room: code,
      token: out.token,
      lobbyUrl: `/lobby.html?room=${encodeURIComponent(code)}&token=${encodeURIComponent(out.token)}`,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a csatlakozáskor.' });
  }
});

// Email invite (optional)
app.post('/api/send-invite', async (req, res) => {
  try {
    const b = req.body || {};
    const roomCode = String(b.room || '').trim().toUpperCase();
    const to = String(b.to || '').trim();

    if (!roomCode) return res.status(400).json({ error: 'Hiányzó szobakód.' });
    if (!to || !to.includes('@')) return res.status(400).json({ error: 'Adj meg érvényes e-mail címet.' });

    const r = await roomStore.getRoom(roomCode);
    if (!r) return res.status(404).json({ error: 'Szoba nem található.' });

    // SMTP config from env (Render env vars)
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user;

    if (!host || !user || !pass || !from) {
      return res.status(500).json({ error: 'SMTP nincs beállítva (SMTP_HOST/USER/PASS/FROM).' });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user, pass },
    });

    const appUrl = process.env.APP_URL || '';
    const link = `${appUrl}/join.html?room=${encodeURIComponent(roomCode)}`;

    await transporter.sendMail({
      from,
      to,
      subject: `Meghívó: Ügynökök és Tolvajok (${roomCode})`,
      text: `Csatlakozz a szobához: ${link}`,
      html: `<p>Csatlakozz a szobához: <a href="${link}">${link}</a></p>`,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba az e-mail küldésnél.' });
  }
});

// -------------------- Socket.IO --------------------
const server = http.createServer(app);

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : { origin: true },
});

async function broadcastLobby(roomCode) {
  const r = await roomStore.getRoom(roomCode);
  if (!r) return;
  io.to(roomCode).emit('lobby', lobbySnapshot(roomCode, r));
}

async function broadcastStatePerPlayer(roomCode) {
  const r = await roomStore.getRoom(roomCode);
  if (!r || !r.state) return;

  const sockets = await io.in(roomCode).fetchSockets();
  for (const sock of sockets) {
    const idx = sock.data && typeof sock.data.playerIndex === 'number' ? sock.data.playerIndex : 0;
    sock.emit('state', stateForPlayer(r.state, idx));
  }
}

io.on('connection', (socket) => {
  (async () => {
    const { room, token, player } = socket.handshake.query || {};
    const roomCode = String(room || '').trim().toUpperCase();

    if (!roomCode) {
      socket.emit('serverMsg', 'Hiányzó szobakód.');
      socket.disconnect(true);
      return;
    }

    const r = await roomStore.getRoom(roomCode);
    if (!r) {
      socket.emit('serverMsg', 'Szoba nem található.');
      socket.disconnect(true);
      return;
    }

    // Token path (new)
    let playerIndex = -1;
    if (token) {
      const tok = String(token);
      playerIndex = (r.players || []).findIndex((p) => p && p.token === tok);
      if (playerIndex < 0) {
        socket.emit('serverMsg', 'Érvénytelen token ehhez a szobához.');
        socket.disconnect(true);
        return;
      }
    } else {
      // Legacy path (player index in query ?player=0)
      const idx = Number(player);
      if (!Number.isFinite(idx) || idx < 0 || idx >= (r.players || []).length) {
        socket.emit('serverMsg', 'Hiányzó/hibás player azonosító.');
        socket.disconnect(true);
        return;
      }
      playerIndex = idx;
    }

    socket.data.roomCode = roomCode;
    socket.data.playerIndex = playerIndex;

    // Mark connected
    r.players[playerIndex].connected = true;
    await roomStore.setRoom(roomCode, r);

    socket.join(roomCode);

    // Initial push
    socket.emit('lobby', lobbySnapshot(roomCode, r));
    if (r.state) socket.emit('state', stateForPlayer(r.state, playerIndex));

    // Notify others
    await broadcastLobby(roomCode);

    socket.on('joinLobby', async () => {
      await broadcastLobby(roomCode);
    });

    socket.on('setReady', async (ready) => {
      const rr = await roomStore.getRoom(roomCode);
      if (!rr) return;
      const p = rr.players?.[playerIndex];
      if (!p) return;

      if (rr.phase !== 'LOBBY') return;
      p.ready = !!ready;

      await roomStore.setRoom(roomCode, rr);
      await broadcastLobby(roomCode);
    });

    socket.on('startGame', async () => {
      const rr = await roomStore.getRoom(roomCode);
      if (!rr) return;
      const p = rr.players?.[playerIndex];
      if (!p || !p.isHost) {
        socket.emit('serverMsg', 'Csak a host indíthatja a játékot.');
        return;
      }

      const out = await startGame(roomCode);
      if (out && out.error) {
        socket.emit('serverMsg', out.error);
        return;
      }

      await broadcastLobby(roomCode);
      await broadcastStatePerPlayer(roomCode);
    });

  // UI compatibility: lobby.js uses a single 'lobbyAction' event.
  // Supported: { type: 'TOGGLE_READY' | 'START' | 'LEAVE', ready?: boolean }
  socket.on('lobbyAction', async (payload = {}) => {
    try {
      const type = String(payload.type || '').toUpperCase();

      if (type === 'TOGGLE_READY') {
        const room = await roomStore.getRoom(code);
        if (!room) return;
        const me = room.players && room.players[playerIndex];
        if (!me) return;

        const nextReady = (payload.ready === undefined) ? !me.ready : !!payload.ready;
        me.ready = nextReady;

        await roomStore.setRoom(code, room);
        broadcastLobby(code);
        return;
      }

      if (type === 'START') {
        // only host may start
        const room = await roomStore.getRoom(code);
        if (!room) return;
        const me = room.players && room.players[playerIndex];
        if (!me || !me.isHost) return;

        // reuse same logic as 'startGame' handler
        if (room.phase !== 'LOBBY') return;
        const players = room.players || [];
        if (players.length < 2) return socket.emit('serverMsg', { text: 'Minimum 2 játékos kell.' });
        const readyCount = players.filter(p => p && p.ready).length;
        if (readyCount < 2) return socket.emit('serverMsg', { text: 'Minimum 2 játékos legyen READY.' });

        const configs = players.map(p => ({ name: p.name, characterKey: p.characterKey }));
        let state = Engine.createGame(configs);
        state = Engine.startTurn(state).next;

        room.state = state;
        room.phase = 'IN_GAME';

        await roomStore.setRoom(code, room);
        broadcastLobby(code);
        return;
      }

      if (type === 'LEAVE') {
        socket.disconnect(true);
        return;
      }
    } catch (e) {
      console.error(e);
      socket.emit('serverMsg', { text: 'Szerver hiba.' });
    }
  });


    socket.on('action', async (type, payload) => {
      const rr = await roomStore.getRoom(roomCode);
      if (!rr || !rr.state) return;

      if (!isActionAllowed(rr.state, playerIndex, type)) {
        socket.emit('serverMsg', 'Nem te jössz / nem engedélyezett akció.');
        return;
      }

      const res = applyAction(rr.state, type, payload);
      let next = res && res.next ? res.next : rr.state;

      // Online: same as offline auto-capture, if exists
      if (Engine && typeof Engine.captureIfPossible === 'function') {
        next = Engine.captureIfPossible(next);
      }

      rr.state = next;
      await roomStore.setRoom(roomCode, rr);

      await broadcastStatePerPlayer(roomCode);
    });

    socket.on('chat', async (msg) => {
      const rr = await roomStore.getRoom(roomCode);
      if (!rr) return;
      const p = rr.players?.[playerIndex];
      const name = p ? p.name : 'Player';

      const clean = String(msg || '').slice(0, 400);
      io.to(roomCode).emit('chat', { name, msg: clean, t: Date.now() });
    });

    socket.on('disconnect', async () => {
      try {
        const rr = await roomStore.getRoom(roomCode);
        if (!rr) return;

        const p = rr.players?.[playerIndex];
        if (p) p.connected = false;

        await roomStore.setRoom(roomCode, rr);
        await broadcastLobby(roomCode);
      } catch (e) {
        console.error('disconnect handler error:', e);
      }
    });
  })().catch((e) => {
    console.error('socket connection error:', e);
    try {
      socket.emit('serverMsg', 'Szerver hiba.');
    } catch {}
    try {
      socket.disconnect(true);
    } catch {}
  });
});

// -------------------- Start --------------------
const PORT = Number(process.env.PORT || 10000);
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
