// public/lobby.js (TELJES)

const params = new URLSearchParams(location.search);
let ROOM = (params.get("room") || "").trim().toUpperCase();
let TOKEN = (params.get("token") || "").trim();

// Persist last valid room/token so refresh/new tab doesn't break the lobby
try {
  if (!ROOM || !TOKEN) {
    const saved = JSON.parse(localStorage.getItem("ugynokseg_session") || "null");
    if (saved && saved.room && saved.token) {
      ROOM = String(saved.room).trim().toUpperCase();
      TOKEN = String(saved.token).trim();
      const u = new URL(location.href);
      u.searchParams.set("room", ROOM);
      u.searchParams.set("token", TOKEN);
      history.replaceState({}, "", u.toString());
    }
  }
} catch {}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function redirectToLogin() {
  const next = location.pathname + location.search;
  location.href = `/login.html?next=${encodeURIComponent(next)}`;
}

if (!ROOM || !TOKEN) {
  alert("Hiányzik a room vagy token. Menj vissza és csatlakozz újra.");
  location.href = "intro.html";
} else {
  try {
    localStorage.setItem(
      "ugynokseg_session",
      JSON.stringify({ room: ROOM, token: TOKEN, ts: Date.now() })
    );
  } catch {}
}

// ---- DOM ----
const roomCodeEl = document.getElementById("roomCode");
const statusEl = document.getElementById("status");
const hint2El = document.getElementById("hint2");

const playersEl = document.getElementById("players");
const readyBtn = document.getElementById("readyBtn");
const startBtn = document.getElementById("startBtn");

const copyInviteBtn = document.getElementById("copyInviteBtn");
const sendInviteBtn = document.getElementById("sendInviteBtn");
const copyHint = document.getElementById("copyHint");
const sendHint = document.getElementById("sendHint");
const sendErr = document.getElementById("sendErr");

// Modal
const inviteModal = document.getElementById("inviteModal");
const inviteEmails = document.getElementById("inviteEmails");
const inviteCancelBtn = document.getElementById("inviteCancelBtn");
const inviteSendBtn = document.getElementById("inviteSendBtn");
const inviteModalErr = document.getElementById("inviteModalErr");

if (roomCodeEl) roomCodeEl.textContent = ROOM;

function show(el) {
  if (!el) return;
  el.style.display = "";
}
function hide(el) {
  if (!el) return;
  el.style.display = "none";
}
function setText(el, txt) {
  if (!el) return;
  el.textContent = txt;
}
function setErr(txt) {
  if (!sendErr) return;
  if (!txt) {
    hide(sendErr);
    sendErr.textContent = "";
  } else {
    sendErr.textContent = txt;
    show(sendErr);
  }
}
function setModalErr(txt) {
  if (!inviteModalErr) return;
  if (!txt) {
    hide(inviteModalErr);
    inviteModalErr.textContent = "";
  } else {
    inviteModalErr.textContent = txt;
    show(inviteModalErr);
  }
}

function getInviteLink() {
  return `${location.origin}/join.html?room=${encodeURIComponent(ROOM)}`;
}

// ---- Copy invite ----
async function copyToClipboard(text) {
  // Modern clipboard (secure context)
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  // Fallback: hidden textarea + execCommand
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    document.body.removeChild(ta);
    return false;
  }
}

copyInviteBtn?.addEventListener("click", async () => {
  try {
    const link = getInviteLink();
    const ok = await copyToClipboard(link);
    if (!ok) {
      // last resort fallback
      prompt("Másold ki manuálisan:", link);
      return;
    }
    hide(sendErr);
    show(copyHint);
    setTimeout(() => hide(copyHint), 900);
  } catch {
    prompt("Másold ki manuálisan:", getInviteLink());
  }
});

// ---- Invite modal ----
function openInviteModal() {
  setModalErr("");
  if (inviteEmails) inviteEmails.value = "";
  show(inviteModal);
  inviteEmails?.focus();
}
function closeInviteModal() {
  hide(inviteModal);
  setModalErr("");
}

sendInviteBtn?.addEventListener("click", () => {
  openInviteModal();
});

inviteCancelBtn?.addEventListener("click", () => {
  closeInviteModal();
});

// Close modal on overlay click (outside card)
inviteModal?.addEventListener("click", (e) => {
  if (e.target === inviteModal) closeInviteModal();
});

// ---- Render lobby ----
function renderLobby(snapshot) {
  if (!snapshot) return;

  if (roomCodeEl) roomCodeEl.textContent = snapshot.room || ROOM;

  const arr = snapshot.players || [];
  if (playersEl) {
    playersEl.innerHTML = arr
      .map((p) => {
        const st = p.ready ? "READY" : "NOT READY";
        const dot = p.connected ? "🟢" : "⚪";
        const host = p.isHost ? " (HOST)" : "";
        return `<div class="playerRow">
          <div class="playerName">${dot} ${escapeHtml(p.name)}${host}</div>
          <div class="playerMeta">${escapeHtml(p.characterKey || "")}</div>
          <div class="playerReady ${p.ready ? "on" : "off"}">${st}</div>
        </div>`;
      })
      .join("");
  }

  // UI only: start button when >=2 ready (server still validates host)
  const readyCount = arr.filter((p) => p && p.ready).length;
  if (startBtn) startBtn.disabled = !(readyCount >= 2);
}

// ---- Socket ----
const socket = io({
  query: { room: ROOM, token: TOKEN },
});

socket.on("connect", () => {
  setText(statusEl, "Kapcsolódva");
  if (hint2El) hint2El.textContent = "";
});

socket.on("disconnect", () => {
  setText(statusEl, "Szétkapcsolva…");
});

socket.on("serverMsg", (txt) => {
  // Ha invalid token, ne hagyjuk a usert beragadni
  if (txt && String(txt).toLowerCase().includes("érvénytelen token")) {
    alert("Érvénytelen token ehhez a szobához. Jelentkezz be újra.");
    redirectToLogin();
    return;
  }
  if (txt) console.log("[serverMsg]", txt);
});

socket.on("lobby", (snapshot) => {
  renderLobby(snapshot);
});

readyBtn?.addEventListener("click", () => {
  socket.emit("lobbyAction", { type: "TOGGLE_READY" });
});

startBtn?.addEventListener("click", () => {
  socket.emit("lobbyAction", { type: "START_GAME" });
});

socket.on("state", () => {
  location.href = `game.html?room=${encodeURIComponent(ROOM)}&token=${encodeURIComponent(
    TOKEN
  )}`;
});

// ---- Send invite ----
function parseEmails(raw) {
  return String(raw || "")
    .split(/[\n,;\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

inviteSendBtn?.addEventListener("click", async () => {
  setModalErr("");
  setErr("");

  const emails = parseEmails(inviteEmails?.value || "");
  if (!emails.length) {
    setModalErr("Adj meg legalább 1 e-mail címet.");
    return;
  }

  inviteSendBtn.disabled = true;
  inviteSendBtn.textContent = "KÜLDÉS…";

  try {
    const res = await fetch("/api/send-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // ✅ fontos: auth cookie menjen
      body: JSON.stringify({ room: ROOM, token: TOKEN, emails }),
    });

    if (res.status === 401) {
      closeInviteModal();
      redirectToLogin();
      return;
    }

    const data = await res.json().catch(() => null);

    if (res.status === 403) {
      setModalErr("Csak a host küldhet meghívót (vagy rossz a host token).");
      return;
    }

    if (!res.ok) {
      setModalErr((data && data.error) || "Nem sikerült meghívót küldeni.");
      return;
    }

    // success
    closeInviteModal();
    show(sendHint);
    setTimeout(() => hide(sendHint), 1000);
  } catch (e) {
    setModalErr("Hálózati hiba. Próbáld újra.");
  } finally {
    inviteSendBtn.disabled = false;
    inviteSendBtn.textContent = "KÜLDÉS";
  }
});