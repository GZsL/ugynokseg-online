const express = require("express");
const http = require("http");
const crypto = require("crypto");
const cors = require("cors");
const { Server } = require("socket.io");

const { attachSocketGuards } = require("./socket-guard");
// If you have a separate engine module, keep using it as before.
// This file intentionally doesn't assume specific engine event names.
// Your existing per-event handlers will continue to work, but now guarded.

const app = express();
const server = http.createServer(app);

// CORS for HTTP
const corsOriginsRaw = process.env.CORS_ORIGINS || "";
const corsOrigins = corsOriginsRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  corsOrigins.length
    ? cors({ origin: corsOrigins, credentials: true })
    : cors()
);

app.use(express.json());
app.use(express.static("public"));

const io = new Server(server, {
  cors: corsOrigins.length ? { origin: corsOrigins, credentials: true } : undefined,
});

const PORT = process.env.PORT || 3000;

/* ===============================
   ROOM STORAGE
=================================*/
const rooms = new Map();

/*
room structure (minimal):

{
  code,
  createdAt,
  hostToken,
  players: Map(token -> { name, connected }),
  phase: "LOBBY" | "GAME",
  // optional:
  gameState / state / engineState ...
}
*/

function generateRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

function now() {
  return Date.now();
}

function pickNewHost(room) {
  if (!room?.players?.size) return null;
  // Prefer connected player
  for (const [token, p] of room.players.entries()) {
    if (p && p.connected) return token;
  }
  // Otherwise first player
  for (const [token] of room.players.entries()) return token;
  return null;
}

/* ===============================
   CLEANUP (TTL)
=================================*/
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 6 * 60 * 60 * 1000); // 6h default
const ROOM_CLEANUP_INTERVAL_MS = Number(process.env.ROOM_CLEANUP_INTERVAL_MS || 5 * 60 * 1000); // 5m default

setInterval(() => {
  const t = now();
  for (const [code, room] of rooms.entries()) {
    const age = t - (room.createdAt || t);
    const hasConnected =
      room.players && room.players.size
        ? Array.from(room.players.values()).some((p) => p && p.connected)
        : false;

    if (age > ROOM_TTL_MS && !hasConnected) {
      rooms.delete(code);
    }
  }
}, ROOM_CLEANUP_INTERVAL_MS).unref?.();

/* ===============================
   HEALTHCHECK
=================================*/
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    rooms: rooms.size,
    env: process.env.NODE_ENV || "dev",
  });
});

/* ===============================
   API
=================================*/
app.post("/api/create-room", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Missing name" });

  const code = generateRoomCode();
  const token = generateToken();

  const room = {
    code,
    createdAt: now(),
    hostToken: token,
    players: new Map(),
    phase: "LOBBY",
  };

  room.players.set(token, { name, connected: false }); // connected once socket joins
  rooms.set(code, room);

  res.json({
    room: code,
    token,
    lobbyUrl: `/lobby.html?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`,
  });
});

app.post("/api/join-room", (req, res) => {
  const code = String(req.body?.room || "").trim().toUpperCase();
  const name = String(req.body?.name || "").trim();

  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (!name) return res.status(400).json({ error: "Missing name" });

  const token = generateToken();
  room.players.set(token, { name, connected: false });

  res.json({
    room: code,
    token,
    lobbyUrl: `/lobby.html?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`,
  });
});

/* ===============================
   SOCKET GUARDS (anti-cheat baseline)
=================================*/
attachSocketGuards(io, rooms, {
  // allowlist can be extended here if you have non-turn UI events
  maxPayloadBytes: 50_000,
});

/* ===============================
   SOCKET LOGIC
=================================*/
io.on("connection", (socket) => {
  socket.on("join-room", ({ roomCode, token }) => {
    const code = String(roomCode || "").trim().toUpperCase();
    const tkn = String(token || "").trim();

    const room = rooms.get(code);
    if (!room) return socket.emit("errorMessage", { error: "ROOM_NOT_FOUND" });

    const player = room.players.get(tkn);
    if (!player) return socket.emit("errorMessage", { error: "INVALID_TOKEN" });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = tkn;

    // mark connected
    player.connected = true;

    // host migration in lobby if needed
    if (room.phase === "LOBBY") {
      const hostPlayer = room.players.get(room.hostToken);
      if (!hostPlayer || hostPlayer.connected === false) {
        const newHost = pickNewHost(room);
        if (newHost) room.hostToken = newHost;
      }
    }

    // broadcast basic lobby snapshot
    io.to(code).emit("lobbyUpdate", {
      room: code,
      hostToken: room.hostToken,
      players: Array.from(room.players.entries()).map(([pt, p]) => ({
        token: pt,
        name: p?.name || "Player",
        connected: !!p?.connected,
      })),
      phase: room.phase,
    });
  });

  socket.on("requestSnapshot", () => {
    const code = socket.data?.roomCode;
    const token = socket.data?.token;
    if (!code || !token) return;

    const room = rooms.get(code);
    if (!room) return;

    // send a conservative snapshot; if you already have a better snapshot builder, use it here
    socket.emit("snapshot", {
      room: code,
      hostToken: room.hostToken,
      players: Array.from(room.players.entries()).map(([pt, p]) => ({
        token: pt,
        name: p?.name || "Player",
        connected: !!p?.connected,
      })),
      phase: room.phase,
      // optional engine state (if present)
      state: room.gameState || room.state || room.engineState || null,
    });
  });

  socket.on("disconnect", () => {
    const code = socket.data?.roomCode;
    const token = socket.data?.token;
    if (!code || !token) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.get(token);
    if (player) player.connected = false;

    // host migration in lobby (and safe for game too)
    const hostPlayer = room.players.get(room.hostToken);
    if (!hostPlayer || hostPlayer.connected === false) {
      const newHost = pickNewHost(room);
      if (newHost) room.hostToken = newHost;
    }

    io.to(code).emit("lobbyUpdate", {
      room: code,
      hostToken: room.hostToken,
      players: Array.from(room.players.entries()).map(([pt, p]) => ({
        token: pt,
        name: p?.name || "Player",
        connected: !!p?.connected,
      })),
      phase: room.phase,
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
