const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./engine-core');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// ---- In-memory room store (LAN test) ----
/** @type {Map<string, { state:any, createdAt:number }>} */
const rooms = new Map();

function makeRoomCode(len = 4){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for(let i=0;i<len;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}

function createRoom(configs){
  let code;
  do{ code = makeRoomCode(4); }while(rooms.has(code));

  let state = Engine.createGame(configs);
  state = Engine.startTurn(state).next;

  rooms.set(code, { state, createdAt: Date.now() });
  return code;
}

// Create a new room from Setup page
app.post('/api/create-room', (req, res) => {
  try{
    const configs = (req.body && req.body.configs) ? req.body.configs : null;
    if(!Array.isArray(configs) || configs.length < 2 || configs.length > 4){
      return res.status(400).json({ error: '2–4 játékos szükséges.' });
    }
    for(const c of configs){
      if(!c || typeof c.name !== 'string' || !c.name.trim()){
        return res.status(400).json({ error: 'Minden játékosnak legyen neve.' });
      }
      if(!c.characterKey){
        return res.status(400).json({ error: 'Minden játékosnak válassz karaktert.' });
      }
    }
    const room = createRoom(configs.map(c=>({ name: c.name.trim(), characterKey: c.characterKey })));
    return res.json({ room });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error: 'Szerver hiba a szoba létrehozásakor.' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET','POST'] }
});

function getRoom(code){
  const r = rooms.get(code);
  return r ? r.state : null;
}
function setRoomState(code, state){
  const r = rooms.get(code);
  if(!r) return;
  r.state = state;
}

function broadcastState(code){
  const state = getRoom(code);
  if(!state) return;
  io.to(code).emit('state', state);
}

function isActionAllowed(state, playerIndex, type){
  if(!state || !state.players) return false;

  // During elimination pause, only the eliminated player may ACK
  if(state.turn && state.turn.phase === 'ELIMINATION_PAUSE'){
    if(type !== 'ACK_ELIMINATION') return false;
    const last = state._lastEliminated;
    const p = state.players[playerIndex];
    return !!(last && p && p.id === last.id);
  }

  // Game over: no actions
  if(state.turn && state.turn.phase === 'GAME_OVER') return false;

  // Normal: only current player can act
  return playerIndex === (state.currentPlayerIndex || 0);
}

function applyAction(state, type, payload){
  payload = payload || {};
  switch(type){
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
  const { room, player } = socket.handshake.query || {};
  const roomCode = String(room || '').trim().toUpperCase();
  const playerIndex = Math.max(0, parseInt(String(player || '0'), 10) || 0);

  if(!roomCode || !rooms.has(roomCode)){
    socket.emit('serverMsg', 'Szoba nem található. Indíts új játékot a setup oldalon.');
    socket.disconnect(true);
    return;
  }

  const state = getRoom(roomCode);
  if(!state || !state.players || playerIndex >= state.players.length){
    socket.emit('serverMsg', 'Érvénytelen játékos index ehhez a szobához.');
    socket.disconnect(true);
    return;
  }

  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.playerIndex = playerIndex;

  // Send current state
  socket.emit('state', state);

  socket.on('action', (msg) => {
    try{
      const code = socket.data.roomCode;
      const idx = socket.data.playerIndex;
      const s0 = getRoom(code);
      if(!s0) return;

      const type = msg && msg.type ? String(msg.type) : '';
      const payload = msg && msg.payload ? msg.payload : {};

      if(!isActionAllowed(s0, idx, type)){
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

      if(res && res.log){
        io.to(code).emit('serverMsg', res.log);
      }
      broadcastState(code);

    }catch(e){
      console.error(e);
      socket.emit('serverMsg', 'Szerver hiba az akció feldolgozásakor.');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LAN server running: http://localhost:${PORT}`);
});
