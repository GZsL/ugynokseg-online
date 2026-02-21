const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const Engine = require('./engine-core');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// ✅ AUTH API
app.use('/api/auth', require('./auth.routes'));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const COOKIE_NAME = 'ugynokseg_token';

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Lejárt / érvénytelen bejelentkezés.' });
  }
}

app.get('/', (req, res) => res.redirect('/intro.html'));

// ---- In-memory room store ----
const rooms = new Map();

function escapeHtml(str){
  return String(str==null?"":str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function uid(prefix='t'){
  return prefix + '_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
}

function makeRoomCode(len = 4){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for(let i=0;i<len;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}

function createLobbyRoom({ hostName, hostCharacterKey, maxPlayers=4, isPublic=false, password=null }){
  let code;
  do{ code = makeRoomCode(4); }while(rooms.has(code));

  const hostToken = uid('tok');
  const room = {
    phase: 'LOBBY',
    createdAt: Date.now(),
    options: {
      maxPlayers: Math.min(4, Math.max(2, parseInt(String(maxPlayers||4),10) || 4)),
      isPublic: !!isPublic,
      password: password ? String(password) : null
    },
    players: [
      {
        id: 'p1',
        name: String(hostName||'Host').trim() || 'Host',
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

function joinLobbyRoom({ roomCode, name, characterKey, password=null }){
  const r = rooms.get(roomCode);
  if(!r) return { error: 'Szoba nem található.' };
  if(r.phase !== 'LOBBY') return { error: 'Ez a szoba már elindult.' };

  if(r.options.password){
    if(String(password||'') !== String(r.options.password)) return { error: 'Hibás jelszó.' };
  }

  if((r.players||[]).length >= (r.options.maxPlayers||4)){
    return { error: 'A szoba megtelt.' };
  }

  const token = uid('tok');
  const id = 'p' + String((r.players||[]).length + 1);
  r.players.push({
    id,
    name: String(name||('Ügynök ' + id.slice(1))).trim() || ('Ügynök ' + id.slice(1)),
    characterKey,
    token,
    ready: false,
    isHost: false,
    connected: false
  });

  return { code: roomCode, token };
}

function startGame(roomCode){
  const r = rooms.get(roomCode);
  if(!r) return { error: 'Szoba nem található.' };
  if(r.phase !== 'LOBBY') return { error: 'A játék már fut.' };
  const players = r.players || [];
  if(players.length < 2) return { error: 'Minimum 2 játékos kell.' };
  const readyCount = players.filter(p=>p && p.ready).length;
  if(readyCount < 2) return { error: 'Minimum 2 játékos legyen READY.' };

  const configs = players.map(p=>({ name: p.name, characterKey: p.characterKey }));
  let state = Engine.createGame(configs);
  state = Engine.startTurn(state).next;

  r.state = state;
  r.phase = 'IN_GAME';
  return { ok:true };
}

// ✅ HOST: create lobby room (AUTH KELL)
app.post('/api/create-room-lobby', requireAuth, (req, res) => {
  try{
    const b = req.body || {};
    const name = String(b.name||'').trim();
    const characterKey = String(b.characterKey||'').trim();
    const maxPlayers = b.maxPlayers;
    const password = (b.password!=null && String(b.password).trim()) ? String(b.password).trim() : null;
    const isPublic = !!b.isPublic;

    if(!name) return res.status(400).json({ error: 'Adj meg nevet.' });
    if(!characterKey) return res.status(400).json({ error: 'Válassz karaktert.' });

    const created = createLobbyRoom({ hostName:name, hostCharacterKey:characterKey, maxPlayers, isPublic, password });
    return res.json({ room: created.code, token: created.token });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a szoba létrehozásakor.' });
  }
});

// ✅ JOIN: invited players can join without auth
app.post('/api/join-room', (req, res) => {
  try{
    const b = req.body || {};
    const room = String(b.room||'').trim().toUpperCase();
    const name = String(b.name||'').trim();
    const characterKey = String(b.characterKey||'').trim();
    const password = (b.password!=null && String(b.password).trim()) ? String(b.password).trim() : null;

    if(!room) return res.status(400).json({ error: 'Adj meg szoba kódot.' });
    if(!name) return res.status(400).json({ error: 'Adj meg nevet.' });
    if(!characterKey) return res.status(400).json({ error: 'Válassz karaktert.' });

    const out = joinLobbyRoom({ roomCode: room, name, characterKey, password });
    if(out && out.error){
      return res.status(400).json({ error: out.error });
    }

    return res.json({ room: room, token: out.token });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a csatlakozáskor.' });
  }
});

// ✅ INVITE EMAIL: AUTH KELL + host token is kell
app.post('/api/send-invite', requireAuth, async (req, res) => {
  try{
    const b = req.body || {};
    const room = String(b.room||'').trim().toUpperCase();
    const token = String(b.token||'').trim();
    const emails = Array.isArray(b.emails) ? b.emails.map(x=>String(x||'').trim()).filter(Boolean) : [];

    if(!room) return res.status(400).json({ error: 'Hiányzik a szobakód.' });
    if(!token) return res.status(400).json({ error: 'Hiányzik a token.' });
    if(!emails.length) return res.status(400).json({ error: 'Adj meg legalább 1 e-mail címet.' });

    const r = rooms.get(room);
    if(!r) return res.status(404).json({ error: 'Szoba nem található.' });

    const hostPlayer = (r.players||[]).find(p => p && p.token === token);
    if(!hostPlayer) return res.status(403).json({ error: 'Érvénytelen token ehhez a szobához.' });
    if(!hostPlayer.isHost) return res.status(403).json({ error: 'Csak a host küldhet meghívót.' });

    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SMTP_SECURE = String(process.env.SMTP_SECURE||'').toLowerCase()==='true';
    const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

    if(!SMTP_HOST || !SMTP_USER || !SMTP_PASS){
      return res.status(400).json({ error: 'E-mail küldés nincs beállítva (SMTP_* env hiányzik).' });
    }

    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https');
    const hostHeader = req.get('x-forwarded-host') || req.get('host');
    const base = `${proto}://${hostHeader}`;
    const joinLink = `${base}/join.html?room=${encodeURIComponent(room)}`;

    const subject = `Meghívó: Ügynökség – Szobakód: ${room}`;
    const text = `${hostPlayer.name} meghívót küldött.\n\nCsatlakozás: ${joinLink}\nSzobakód: ${room}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45">
        <p><b>${escapeHtml(hostPlayer.name)}</b> meghívót küldött.</p>
        <p><a href="${joinLink}">${joinLink}</a></p>
        <p><b>Szobakód:</b> ${escapeHtml(room)}</p>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const results = [];
    for(const to of emails){
      if(!/^.+@.+\..+$/.test(to)){
        results.push({ to, ok:false, error:'invalid_email' });
        continue;
      }
      try{
        const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
        results.push({ to, ok:true, messageId: info && info.messageId ? info.messageId : null });
      }catch(err){
        results.push({ to, ok:false, error:'send_failed' });
      }
    }

    return res.json({ ok:true, results });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba e-mail küldés közben.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET','POST'] } });

function lobbySnapshot(roomCode){
  const r = rooms.get(roomCode);
  if(!r) return null;
  return {
    room: roomCode,
    phase: r.phase,
    options: { maxPlayers: r.options.maxPlayers, isPublic: r.options.isPublic, hasPassword: !!r.options.password },
    players: (r.players||[]).map(p=>({
      id: p.id,
      name: p.name,
      characterKey: p.characterKey,
      ready: !!p.ready,
      isHost: !!p.isHost,
      connected: !!p.connected
    }))
  };
}

function stateForPlayer(state, meIndex){
  const s = JSON.parse(JSON.stringify(state));
  if(Array.isArray(s.mixedDeck)) s.mixedDeckCount = s.mixedDeck.length;
  if(Array.isArray(s.itemDeck)) s.itemDeckCount = s.itemDeck.length;
  if(Array.isArray(s.skillDeck)) s.skillDeckCount = s.skillDeck.length;
  delete s.mixedDeck; delete s.itemDeck; delete s.skillDeck;

  const players = s.players || [];
  players.forEach((p, idx)=>{
    if(!p) return;
    if(idx !== meIndex){
      const handCount = Array.isArray(p.tableCards) ? p.tableCards.length : 0;
      p.tableCards = [];
      p.handCount = handCount;
    }
  });

  s._meIndex = meIndex;
  return s;
}

async function broadcastStatePerPlayer(roomCode){
  const r = rooms.get(roomCode);
  if(!r || !r.state) return;
  const sockets = await io.in(roomCode).fetchSockets();
  for(const sock of sockets){
    const idx = sock.data && typeof sock.data.playerIndex === 'number' ? sock.data.playerIndex : 0;
    sock.emit('state', stateForPlayer(r.state, idx));
  }
}

io.on('connection', (socket) => {
  const { room, token } = socket.handshake.query || {};
  const roomCode = String(room || '').trim().toUpperCase();
  const r = rooms.get(roomCode);

  if(!roomCode || !r){
    socket.emit('serverMsg', 'Szoba nem található.');
    socket.disconnect(true);
    return;
  }

  const tok = String(token||'');
  const playerIndex = (r.players||[]).findIndex(p=>p && p.token===tok);
  if(playerIndex < 0){
    socket.emit('serverMsg', 'Érvénytelen token ehhez a szobához.');
    socket.disconnect(true);
    return;
  }

  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.playerIndex = playerIndex;

  if(r.players && r.players[playerIndex]) r.players[playerIndex].connected = true;

  if(r.phase === 'LOBBY'){
    io.to(roomCode).emit('lobby', lobbySnapshot(roomCode));
  }else if(r.phase === 'IN_GAME' && r.state){
    socket.emit('state', stateForPlayer(r.state, playerIndex));
  }

  socket.on('lobbyAction', async (msg) => {
    const type = msg && msg.type ? String(msg.type) : '';
    const p = (r.players||[])[playerIndex];
    if(!p) return;

    if(type === 'TOGGLE_READY'){
      p.ready = !p.ready;
      io.to(roomCode).emit('lobby', lobbySnapshot(roomCode));
    }
    if(type === 'START_GAME'){
      if(!p.isHost){
        socket.emit('serverMsg', 'Csak a host indíthatja a játékot.');
        return;
      }
      const out = startGame(roomCode);
      if(out && out.error){
        socket.emit('serverMsg', out.error);
        return;
      }
      io.to(roomCode).emit('lobby', lobbySnapshot(roomCode));
      await broadcastStatePerPlayer(roomCode);
    }
  });

  socket.on('disconnect', () => {
    if(r.players && r.players[playerIndex]){
      r.players[playerIndex].connected = false;
      io.to(roomCode).emit('lobby', lobbySnapshot(roomCode));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on :${PORT}`));