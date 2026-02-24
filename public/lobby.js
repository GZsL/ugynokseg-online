
// ====== LOBBY.JS (EMAIL VALIDATION FIXED) ======

const socket = io();

const qs = new URLSearchParams(location.search);
const roomCode = (qs.get("room") || "").toUpperCase();
const token = qs.get("token");

if (!roomCode || !token) {
  alert("Hiányzó room vagy token.");
  location.href = "/";
}

socket.emit("room:join", { roomCode, token });

const readyBtn = document.getElementById("btnReady");
const startBtn = document.getElementById("btnStart");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const chatBox = document.getElementById("chatBox");
const inviteBtn = document.getElementById("btnInviteSend");
const inviteTextarea = document.getElementById("inviteEmails");
const inviteError = document.getElementById("inviteError");

readyBtn?.addEventListener("click", () => {
  socket.emit("lobbyAction", { type: "TOGGLE_READY" });
});

startBtn?.addEventListener("click", () => {
  socket.emit("lobbyAction", { type: "START" });
});

chatSend?.addEventListener("click", () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat", { message: msg });
  chatInput.value = "";
});

socket.on("chat:update", (messages) => {
  chatBox.innerHTML = "";
  messages.forEach(m => {
    const div = document.createElement("div");
    div.textContent = `${m.from}: ${m.text}`;
    chatBox.appendChild(div);
  });
  chatBox.scrollTop = chatBox.scrollHeight;
});

// ===== EMAIL FIX =====
inviteBtn?.addEventListener("click", async () => {
  inviteError.textContent = "";

  const raw = inviteTextarea.value || "";

  const emails = raw
    .split(/[\n,;]/)
    .map(e => e.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    inviteError.textContent = "Adj meg legalább egy e-mail címet.";
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validEmails = emails.filter(e => emailRegex.test(e));

  if (validEmails.length === 0) {
    inviteError.textContent = "Adj meg érvényes e-mail címet.";
    return;
  }

  try {
    const res = await fetch("/api/send-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode,
        emails: validEmails
      })
    });

    const data = await res.json();

    if (!res.ok) {
      inviteError.textContent = data.error || "Hiba a küldéskor.";
      return;
    }

    alert("Meghívó elküldve.");
    inviteTextarea.value = "";
  } catch (e) {
    inviteError.textContent = "Szerver hiba a küldéskor.";
  }
});
