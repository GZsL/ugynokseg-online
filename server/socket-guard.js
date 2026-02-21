/**
 * Socket event guard for internet-ready multiplayer.
 *
 * What it does:
 * - After a client joins a room (via "join-room"), we bind socket.data.roomCode and socket.data.token.
 * - For every subsequent inbound event (except allowlisted), we verify:
 *    - room exists
 *    - token belongs to a player in that room
 *    - player is marked connected
 * - Optionally enforces "turn ownership" if the room exposes a current-turn token in common fields.
 *
 * This is intentionally defensive: it won't crash if state shape differs.
 */

const DEFAULT_ALLOWLIST = new Set([
  "join-room",
  "requestSnapshot",
  "ping",
  "disconnect",
  "connect_error",
]);

function inferCurrentTurnToken(room) {
  const s = room?.gameState || room?.state || room?.engineState || room?.game || null;
  if (!s || typeof s !== "object") return null;

  // Common patterns across engines:
  //  - s.currentPlayerToken
  //  - s.turn?.token / s.turnToken
  //  - s.activePlayerToken
  //  - s.currentPlayer?.token
  return (
    s.currentPlayerToken ||
    s.activePlayerToken ||
    s.turnToken ||
    s?.turn?.token ||
    s?.currentPlayer?.token ||
    null
  );
}

function attachSocketGuards(io, rooms, opts = {}) {
  const allowlist = opts.allowlist instanceof Set ? opts.allowlist : DEFAULT_ALLOWLIST;

  io.use((socket, next) => {
    // Per-socket packet middleware
    socket.use((packet, packetNext) => {
      try {
        const [eventName, payload] = packet || [];
        if (!eventName) return packetNext();

        if (allowlist.has(eventName)) return packetNext();

        const roomCode = socket.data?.roomCode;
        const token = socket.data?.token;

        if (!roomCode || !token) {
          return packetNext(new Error("NOT_JOINED"));
        }

        const room = rooms.get(roomCode);
        if (!room) return packetNext(new Error("ROOM_NOT_FOUND"));

        const player = room.players?.get ? room.players.get(token) : null;
        if (!player) return packetNext(new Error("INVALID_TOKEN"));

        // If your code uses connected markers, enforce them.
        if (player.connected === false) return packetNext(new Error("PLAYER_NOT_CONNECTED"));

        // Optional: turn enforcement for action-like events.
        // If your engine exposes the current player's token, we can block obvious cheating.
        const currentTurnToken = inferCurrentTurnToken(room);
        if (currentTurnToken && token !== currentTurnToken) {
          // allow some non-action UI events if you want by adding them to allowlist in opts
          return packetNext(new Error("NOT_YOUR_TURN"));
        }

        // Basic payload sanity (avoid huge payloads)
        if (payload && typeof payload === "object") {
          const jsonSize = Buffer.byteLength(JSON.stringify(payload), "utf8");
          const maxBytes = opts.maxPayloadBytes ?? 50_000;
          if (jsonSize > maxBytes) return packetNext(new Error("PAYLOAD_TOO_LARGE"));
        }

        return packetNext();
      } catch (e) {
        return packetNext(new Error("GUARD_ERROR"));
      }
    });

    next();
  });
}

module.exports = { attachSocketGuards };
