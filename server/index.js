// server/index.js
// Main server for Ügynökség (LAN / Online MVP)

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");

const Engine = require("./engine-core");
const pool = require("./db");
const roomStore = require("./room-store");
const redis = require("./redis");

// ----------------------------
// Boot checks (DB + Redis)
// ----------------------------
(async () => {
  // DB check
  try {
    await pool.query("SELECT 1");
    console.log("DB OK");
  } catch (err) {
    console.error("DB ERROR:", err);
  }

  // Redis check
  try {
    if (redis) {
      const pong = await redis.ping();
      console.log("REDIS PING:", pong);
    } else {
      console.log("REDIS: disabled");
    }
  } catch (e) {
    console.error("REDIS PING ERROR:", e);
  }
})();

// ----------------------------
// Express + Static
// ----------------------------
const app = express();
app.use(express.json({ limit: "1mb" }));

const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.redirect("/intro.html");
});

// ----------------------------
// Helpers
// ----------------------------
function makeRoomCode(len = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function uid(prefix = "t") {
  return prefix + "_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function safeTrim(v) {
  return String(v || "").trim();
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

async function getRoom(code) {
  return await roomStore.getRoom(code);
}

async function setRoom(code, room) {
  await roomStore.setRoom(code, room);
}

// ----------------------------
// Room ops (Lobby)
// ----------------------------
async function createLobbyRoom({ hostName, hostCharacterKey, maxPlayers = 4, isPublic = false, password = null }) {
  // Avoid collisions against existing rooms in Redis
  const existing = new Set(await roomStore.listRooms(500));

  let code;
  do {
    code = makeRoomCode(4);
  } while (existing.has(code));

  const hostToken = uid("tok");
  const room = {
    phase: "LOBBY",
    createdAt: Date.now(),
    options: {
      maxPlayers: clamp(parseInt(String(maxPlayers || 4), 10) || 4, 2, 4),
      isPublic: !!isPublic,
      password: password ? String(password) : null,
    },
    players: [
      {
        id: "p1",
        name: safeTrim(hostName) || "Host",
        characterKey: safeTrim(hostCharacterKey),
        token: hostToken,
        ready: true,
        isHost: true,
        connected: false,
      },
    ],
    state: null,
    chat: [],
  };

  await setRoom(code, room);
  return { code, token: hostToken };
}

async function joinLobbyRoom({ roomCode, name, characterKey, password = null }) {
  const r = await getRoom(roomCode);
  if (!r) return { error: "Szoba nem található." };
  if (r.phase !== "LOBBY") return { error: "Ez a szoba már elindult." };

  if (r.options && r.options.password) {
    if (String(password || "") !== String(r.options.password)) return { error: "Hibás jelszó." };
  }

  const players = Array.isArray(r.players) ? r.players : [];
  const maxP = (r.options && r.options.maxPlayers) ? r.options.maxPlayers : 4;
  if (players.length >= maxP) return { error: "A szoba megtelt." };

  const token = uid("tok");
  const id = "p" + String(players.length + 1);
  players.push({
    id,
    name: safeTrim(name) || `Ügynök ${id.slice(1)}`,
    characterKey: safeTrim(characterKey),
    token,
    ready: false,
    isHost: false,
    connected: false,
  });

  r.players = players;
  await setRoom(roomCode, r);

  return { code: roomCode, token };
}

async function startGame(roomCode) {
  const r = await getRoom(roomCode);
  if (!r) return { error: "Szoba nem található." };
  if (r.phase !== "LOBBY") return { error: "A játék már fut." };

  const players = Array.isArray(r.players) ? r.players : [];
  if (players.length < 2) return { error: "Minimum 2 játékos kell." };

  const readyCount = players.filter((p) => p && p.ready).length;
  if (readyCount < 2) return { error: "Minimum 2 játékos legyen READY." };

  const configs = players.map((p) => ({ name: p.name, characterKey: p.characterKey }));
  let state = Engine.createGame(configs);
  state = Engine.startTurn(state).next;

  r.state = state;
  r.phase = "IN_GAME";

  await setRoom(roomCode, r);
  return { ok: true };
}

// ----------------------------
// API: Lobby endpoints
// ----------------------------
app.post("/api/create-room-lobby", async (req, res) => {
  try {
    const b = req.body || {};
    const name = safeTrim(b.name);
    const characterKey = safeTrim(b.characterKey);
    const maxPlayers = b.maxPlayers;
    const password = (b.password != null && safeTrim(b.password)) ? safeTrim(b.password) : null;
    const isPublic = !!b.isPublic;

    if (!name) return res.status(400).json({ error: "Adj meg nevet." });
    if (!characterKey) return res.status(400).json({ error: "Válassz karaktert." });

    const created = await createLobbyRoom({ hostName: name, hostCharacterKey: characterKey, maxPlayers, isPublic, password });
    const inviteLink = `/join.html?room=${encodeURIComponent(created.code)}`;
    return res.json({ room: created.code, token: created.token, inviteLink });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Szerver hiba a szoba létrehozásakor." });
  }
});

app.post("/api/join-room", async (req, res) => {
  try {
    const b = req.body || {};
    const room = safeTrim(b.room).toUpperCase();
    const name = safeTrim(b.name);
    const characterKey = safeTrim(b.characterKey);
    const password = (b.password != null && safeTrim(b.password)) ? safeTrim(b.password) : null;

    if (!room) return res.status(400).json({ error: "Adj meg szoba kódot." });
    if (!name) return res.status(400).json({ error: "Adj meg nevet." });
    if (!characterKey) return res.status(400).json({ error: "Válassz karaktert." });

    const out = await joinLobbyRoom({ roomCode: room, name, characterKey, password });
    if (out && out.error) return res.status(400).json({ error: out.error });

    const code = out.code || room;
    return res.json({
      room: code,
      token: out.token,
      lobbyUrl: `/lobby.html?room=${encodeURIComponent(code)}&token=${encodeURIComponent(out.token)}`,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Szerver hiba a csatlakozáskor." });
  }
});

app.post("/api/start-game", async (req, res) => {
  try {
    const b = req.body || {};
    const room = safeTrim(b.room).toUpperCase();
    const token = safeTrim(b.token);

    if (!room) return res.status(400).json({ error: "Hiányzó room" });
    if (!token) return res.status(400).json({ error: "Hiányzó token" });

    const r = await getRoom(room);
    if (!r) return res.status(404).json({ error: "Szoba nem található." });
    const host = (r.players || []).find((p) => p && p.isHost);
    if (!host || host.token !== token) return res.status(403).json({ error: "Nincs jogosultság." });

    const out = await startGame(room);
    if (out && out.error) return res.status(400).json({ error: out.error });

    io.to(room).emit("room:update", await getRoom(room));
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Szerver hiba a start-game-nél." });
  }
});

// Email invite (optional)
app.post("/api/send-invite", async (req, res) => {
  try {
    const b = req.body || {};
    const to = safeTrim(b.to);
    const room = safeTrim(b.room).toUpperCase();
    const inviter = safeTrim(b.inviter);

    if (!to) return res.status(400).json({ error: "Adj meg email címet." });
    if (!room) return res.status(400).json({ error: "Hiányzó room" });

    const r = await getRoom(room);
    if (!r) return res.status(404).json({ error: "Szoba nem található." });

    const baseUrl = process.env.PUBLIC_BASE_URL || "";
    const inviteUrl = `${baseUrl}/join.html?room=${encodeURIComponent(room)}`;

    // If SMTP not configured, return the link (so UI can show it)
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
    const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
    const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "no-reply@ugynokseg";

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return res.json({ ok: true, skipped: true, inviteUrl });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const subject = "Meghívó – Ügynökség online";
    const text = `${inviter ? inviter + " meghívott egy játékba." : "Meghívót kaptál."}\n\nSzoba kód: ${room}\nCsatlakozás: ${inviteUrl}\n`;

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
    });

    return res.json({ ok: true, inviteUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Szerver hiba az email küldésnél." });
  }
});

// ----------------------------
// Socket.IO
// ----------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : true,
    credentials: true,
  },
});

function findPlayerByToken(room, token) {
  if (!room || !token) return null;
  const players = Array.isArray(room.players) ? room.players : [];
  return players.find((p) => p && p.token === token) || null;
}

function scrubRoomForClient(room, token) {
  if (!room) return null;
  const copy = JSON.parse(JSON.stringify(room));
  if (copy.options) copy.options.password = copy.options.password ? true : null;
  (copy.players || []).forEach((p) => {
    if (p && p.token !== token) delete p.token;
  });
  return copy;
}

io.on("connection", (socket) => {
  socket.on("room:join", async ({ roomCode, token }) => {
    try {
      const code = safeTrim(roomCode).toUpperCase();
      const tok = safeTrim(token);
      const room = await getRoom(code);
      if (!room) return socket.emit("room:error", { error: "Szoba nem található." });

      const p = findPlayerByToken(room, tok);
      if (!p) return socket.emit("room:error", { error: "Érvénytelen token." });

      p.connected = true;
      await setRoom(code, room);

      socket.data.roomCode = code;
      socket.data.token = tok;
      socket.join(code);

      socket.emit("room:update", scrubRoomForClient(room, tok));
      io.to(code).emit("room:update", scrubRoomForClient(await getRoom(code), tok));
    } catch (e) {
      console.error(e);
      socket.emit("room:error", { error: "Szerver hiba csatlakozáskor." });
    }
  });

  socket.on("room:ready", async ({ ready }) => {
    try {
      const code = socket.data.roomCode;
      const tok = socket.data.token;
      if (!code || !tok) return;

      const room = await getRoom(code);
      if (!room) return;
      const p = findPlayerByToken(room, tok);
      if (!p) return;

      p.ready = !!ready;
      await setRoom(code, room);

      io.to(code).emit("room:update", scrubRoomForClient(room, tok));
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("chat:send", async ({ message }) => {
    try {
      const code = socket.data.roomCode;
      const tok = socket.data.token;
      if (!code || !tok) return;

      const room = await getRoom(code);
      if (!room) return;
      const p = findPlayerByToken(room, tok);
      if (!p) return;

      const msg = safeTrim(message);
      if (!msg) return;

      room.chat = Array.isArray(room.chat) ? room.chat : [];
      room.chat.push({ t: Date.now(), from: p.name, text: msg });
      if (room.chat.length > 100) room.chat = room.chat.slice(room.chat.length - 100);

      await setRoom(code, room);
      io.to(code).emit("chat:update", room.chat);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on("disconnect", async () => {
    try {
      const code = socket.data.roomCode;
      const tok = socket.data.token;
      if (!code || !tok) return;

      const room = await getRoom(code);
      if (!room) return;
      const p = findPlayerByToken(room, tok);
      if (!p) return;
      p.connected = false;
      await setRoom(code, room);
      io.to(code).emit("room:update", scrubRoomForClient(room, tok));
    } catch (e) {
      console.error(e);
    }
  });
});

// ----------------------------
// Start
// ----------------------------
const PORT = Number(process.env.PORT || 10000);
server.listen(PORT, () => {
  console.log(`LAN server running: http://localhost:${PORT}`);
});
