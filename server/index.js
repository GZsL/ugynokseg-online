const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./engine-core');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Root -> setup oldal
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'setup.html'));
});


// ---------------- ROOM STORE ----------------
const rooms = new Map();

function makeRoomCode(len = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function createRoom(configs) {
  let code;
  do { code = makeRoomCode(); } while (rooms.has(code));

  let state = Engine.createGame(configs);
  state = Engine.startTurn(state).next;

  rooms.set(code, { state, createdAt: Date.now() });
  return code;
}


// ---------------- CREATE ROOM API ----------------
app.post('/api/create-room', (req, res) => {
  try {
    const configs = req.body?.configs;

    if (!Array.isArray(configs) || configs.length < 2 || configs.length > 4) {
      return res.status(400).json({ error: '2–4 játékos szükséges.' });
    }

    for (const c of configs) {
      if (!c?.name?.trim()) {
        return res.status(400).json({ error: 'Minden játékosnak legyen neve.' });
      }
      if (!c.characterKey) {
        return res.status(400).json({ error: 'Minden játékosnak válassz karaktert.' });
      }
    }

    const room = createRoom(
      configs.map(c => ({
        name: c.name.trim(),
        characterKey: c.characterKey
      }))
    );

    res.json({ room });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Szerver hiba.' });
  }
});


// ---------------- SOCKET SERVER ----------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true }
});

function getRoom(code) {
  return rooms.get(code)?.state || null;
}

function setRoomState(code, state) {
  const r = rooms.get(code);
  if (r) r.state = state;
}

function broadcastState(code) {
  const state = getRoom(code);
  if (state) {
    io.to(code).emit('state', state);
  }
}

function isActionAllowed(state, playerIndex) {
  if (!state?.players) return false;
  if (state.turn?.phase === 'GAME_OVER') return false;
  return playerIndex === state.currentPlayerIndex;
}


// ---------------- CONNECTION ----------------
io.on('connection', (socket) => {

  const q = socket.handshake.query || {};
  const roomCode = String(q.room || '').trim().toUpperCase();
  const playerIndex = parseInt(q.player, 10);

  if (!roomCode || !rooms.has(roomCode)) {
    socket.emit('serverMsg', 'Szoba nem található.');
    return socket.disconnect(true);
  }

  const state = getRoom(roomCode);

  if (
    isNaN(playerIndex) ||
    playerIndex < 0 ||
    playerIndex >= state.players.length
  ) {
    socket.emit('serverMsg', 'Érvénytelen játékos index.');
    return socket.disconnect(true);
  }

  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.playerIndex = playerIndex;

  socket.emit('state', state);


  socket.on('action', (msg) => {
    try {
      const code = socket.data.roomCode;
      const idx = socket.data.playerIndex;
      const current = getRoom(code);
      if (!current) return;

      if (!isActionAllowed(current, idx)) {
        return socket.emit('serverMsg', 'Nem te vagy soron.');
      }

      const type = msg?.type;
      const payload = msg?.payload || {};

      let result;

      switch (type) {
        case 'PRE_DRAW':
          result = Engine.doPreDraw(current);
          break;
        case 'ROLL':
          result = Engine.doRollAndDraw(current);
          break;
        case 'ATTEMPT_CASE':
          result = Engine.attemptCase(current, payload);
          break;
        case 'PASS':
          result = Engine.beginPassToEndTurn(current);
          break;
        case 'END_TURN':
          result = Engine.endTurn(current, payload.discardIds || []);
          break;
        default:
          return;
      }

      const next = result?.next || current;

      setRoomState(code, next);

      if (result?.log) {
        io.to(code).emit('serverMsg', result.log);
      }

      broadcastState(code);

    } catch (err) {
      console.error(err);
      socket.emit('serverMsg', 'Szerver hiba.');
    }
  });
});


// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

