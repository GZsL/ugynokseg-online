const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const Engine = require("./engine-core");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "ugynokseg_token";

// Static
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));

// Auth routes
app.use("/api/auth", require("./auth.routes"));

// Default entry
app.get("/", (req, res) => {
  res.redirect("/intro.html");
});

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Login szükséges." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Érvénytelen token." });
  }
}

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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeRoomCode(len = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function uid(prefix = "t") {
  return prefix + "_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function createLobbyRoom({ hostName, hostCharacterKey, maxPlayers = 4, isPublic = false, password = null }) {
  let code;
  do {
    code = makeRoomCode(4);
  } while (rooms.has(code));

  const hostToken = uid("tok");
  const room = {
    phase: "LOBBY",
    createdAt: Date.now(),
    options: {
      maxPlayers: Math.min(4, Math.max(2, parseInt(String(maxPlayers || 4), 10) || 4)),
      isPublic: !!isPublic,
      password: password ? String(password) : null, // MVP: plain; later hash
    },
    players: [
      {
        id: "p1",
        name: String(hostName || "Host").trim() || "Host",
        characterKey: hostCharacterKey,
        token: hostToken,
        ready: true,
        isHost: true,
        connected: false,
      },
    ],
    state: null,
  };

  rooms.set(code, room);
  return { code, token: hostToken, room };
}

function findPlayerByToken(room, token) {
  if (!room || !token) return null;
  return room.players.find((p) => p.token === token) || null;
}

function canJoinRoom(room, password) {
  if (!room) return { ok: false, error: "Szoba nem létezik." };
  if (room.options.password) {
    if (String(password || "") !== String(room.options.password)) return { ok: false, error: "Hibás jelszó." };
  }
  if (room.players.length >= room.options.maxPlayers) return { ok: false, error: "Tele a szoba." };
  return { ok: true };
}

/**
 * ✅ HOST: szoba létrehozása csak belépett usernek
 * body: { name, characterKey, maxPlayers, password }
 * return: { room: code, token }
 */
app.post("/api/create-room-lobby", requireAuth, (req, res) => {
  try {
    const { name, characterKey, maxPlayers, password } = req.body || {};

    if (!name || !characterKey) {
      return res.status(400).json({ error: "Hiányzó adat." });
    }

    // Host név: ha üres, használjuk a bejelentkezett user nevét
    const hostName = String(name || "").trim() || String(req.user?.name || "Host");

    const created = createLobbyRoom({
      hostName,
      hostCharacterKey: characterKey,
      maxPlayers: maxPlayers,
      isPublic: false,
      password: password || null,
    });

    return res.json({ room: created.code, token: created.token });
  } catch (e) {
    console.error("create-room-lobby error:", e);
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

/**
 * ✅ JOIN: meghívottként is lehessen játszani (login nélkül is)
 * body: { room, name, characterKey, password }
 * return: { room, token }
 */
app.post("/api/join-room-lobby", (req, res) => {
  try {
    const { room: code, name, characterKey, password } = req.body || {};
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return res.status(404).json({ error: "Szoba nem létezik." });

    const check = canJoinRoom(room, password);
    if (!check.ok) return res.status(400).json({ error: check.error });

    if (!name || !characterKey) return res.status(400).json({ error: "Hiányzó adat." });

    const token = uid("tok");
    const id = "p" + (room.players.length + 1);

    room.players.push({
      id,
      name: String(name).trim(),
      characterKey,
      token,
      ready: true,
      isHost: false,
      connected: false,
    });

    return res.json({ room: String(code).toUpperCase(), token });
  } catch (e) {
    console.error("join-room-lobby error:", e);
    return res.status(500).json({ error: "Szerver hiba." });
  }
});

// ---- Socket.io ----
const server = http.createServer(app);
const io = new Server(server);

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ room: code, token }) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) {
      socket.emit("errorMsg", "Szoba nem létezik.");
      return;
    }

    const player = findPlayerByToken(room, token);
    if (!player) {
      socket.emit("errorMsg", "Érvénytelen token.");
      return;
    }

    player.connected = true;
    socket.join(String(code).toUpperCase());
    socket.data.room = String(code).toUpperCase();
    socket.data.token = token;

    io.to(String(code).toUpperCase()).emit("roomUpdate", room);
  });

  socket.on("leaveRoom", () => {
    const code = socket.data.room;
    const token = socket.data.token;
    if (!code || !token) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = findPlayerByToken(room, token);
    if (player) player.connected = false;

    socket.leave(code);
    io.to(code).emit("roomUpdate", room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const token = socket.data.token;
    if (!code || !token) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = findPlayerByToken(room, token);
    if (player) player.connected = false;

    io.to(code).emit("roomUpdate", room);
  });

  // (a többi Engine-alapú evented maradjon, ha van – itt nem bántottam)
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));