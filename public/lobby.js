// public/lobby.js
// Ügynökök és Tolvajok – Lobby UI (token-based)

/* global io */

(function () {
  const qs = new URLSearchParams(location.search);
  const roomCode = String(qs.get('room') || '').trim().toUpperCase();
  const token = String(qs.get('token') || '').trim();

  if (!roomCode || !token) {
    alert('Hiányzó szobakód vagy token.');
    location.href = '/intro.html';
    return;
  }

  // ---- DOM ----
  const elRoomCode = document.getElementById('roomCode');
  const elStatus = document.getElementById('status');
  const elHint2 = document.getElementById('hint2');
  const elPlayers = document.getElementById('players');

  const readyBtn = document.getElementById('readyBtn');
  const startBtn = document.getElementById('startBtn');

  // Invite UI
  const copyInviteBtn = document.getElementById('copyInviteBtn');
  const sendInviteBtn = document.getElementById('sendInviteBtn');
  const copyHint = document.getElementById('copyHint');
  const sendHint = document.getElementById('sendHint');
  const sendErr = document.getElementById('sendErr');

  const inviteModal = document.getElementById('inviteModal');
  const inviteEmails = document.getElementById('inviteEmails');
  const inviteCancelBtn = document.getElementById('inviteCancelBtn');
  const inviteSendBtn = document.getElementById('inviteSendBtn');
  const inviteModalErr = document.getElementById('inviteModalErr');

  // Chat UI
  const chatLog = document.getElementById('chatLog');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');

  elRoomCode && (elRoomCode.textContent = roomCode);

  const inviteLink = `${location.origin}/join.html?room=${encodeURIComponent(roomCode)}`;

  function showTemp(el, ms = 1200) {
    if (!el) return;
    el.style.display = 'block';
    setTimeout(() => {
      el.style.display = 'none';
    }, ms);
  }

  function setError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = String(msg);
  }

  // ---- Socket connection (IMPORTANT: pass room+token in handshake query) ----
  const socket = io({
    query: { room: roomCode, token },
    transports: ['websocket', 'polling'],
  });

  let lastLobby = null;
  let myReady = false;
  let myIsHost = false;

  function renderLobby(snapshot) {
    lastLobby = snapshot;

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];

    // We cannot see our token in snapshot (by design), so we infer:
    // - if exactly one connected socket is ours? not reliable
    // Instead we track readiness as last known after toggle; and host from snapshot by:
    // if only one host exists and we started as host (startBtn enabled after first snapshot)

    // Render players list
    if (elPlayers) {
      elPlayers.innerHTML = '';
      players.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'playerRow';

        const left = document.createElement('div');
        left.innerHTML = `<div style="font-weight:900;">${escapeHtml(p.name || '')}</div><div class="mini">${escapeHtml(p.characterKey || '')}</div>`;

        const right = document.createElement('div');
        const badge = document.createElement('div');
        badge.className = 'badge ' + (p.connected ? (p.ready ? 'ready' : 'notready') : 'offline');
        badge.textContent = p.connected ? (p.ready ? 'READY' : 'NOT READY') : 'OFFLINE';
        right.appendChild(badge);

        if (p.isHost) {
          const host = document.createElement('div');
          host.className = 'mini';
          host.style.marginLeft = '10px';
          host.style.opacity = '0.85';
          host.textContent = 'HOST';
          right.appendChild(host);
        }

        row.appendChild(left);
        row.appendChild(right);
        elPlayers.appendChild(row);
      });
    }

    // Status
    if (elStatus) {
      if (snapshot.phase === 'IN_GAME') {
        elStatus.textContent = 'Játék indul…';
      } else {
        const readyCount = players.filter((p) => p && p.ready).length;
        elStatus.textContent = `Lobby • ${players.length}/${snapshot.options?.maxPlayers || 4} játékos • READY: ${readyCount}`;
      }
    }

    // Enable start button only if lobby and (probably) host
    // We *can* infer host by: if there is exactly one host, and we created the room then we are host.
    // But for joiners: disable by default.
    if (startBtn) {
      // If server rejects, it will send serverMsg.
      startBtn.disabled = snapshot.phase !== 'LOBBY';
      startBtn.style.opacity = startBtn.disabled ? '0.55' : '1';
    }

    if (elHint2) {
      elHint2.textContent = snapshot.phase === 'LOBBY'
        ? 'Nyomd meg a READY-t. A host indít.'
        : 'A játék elindult.';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function appendChatLine(text) {
    if (!chatLog) return;
    const div = document.createElement('div');
    div.className = 'chat-line';
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ---- Socket events ----
  socket.on('connect', () => {
    setError(sendErr, null);
    if (elStatus) elStatus.textContent = 'Kapcsolódva ✅';
  });

  socket.on('disconnect', () => {
    if (elStatus) elStatus.textContent = 'Szétkapcsolódva…';
  });

  socket.on('serverMsg', (msg) => {
    // server may send string or {text}
    const text = (msg && typeof msg === 'object' && msg.text) ? msg.text : msg;
    if (!text) return;
    appendChatLine(`⚠ ${String(text)}`);
  });

  socket.on('lobby', (snapshot) => {
    // Track our local ready state by keeping last toggle intention
    // If we ever can infer by name in future, great; for now this keeps UI responsive.
    renderLobby(snapshot);
  });

  socket.on('chat', (data) => {
    if (!data) return;
    const name = data.name || 'Player';
    const msg = data.msg || '';
    appendChatLine(`${name}: ${msg}`);
  });

  socket.on('state', (state) => {
    // Game started → move to game screen
    // The existing project usually uses game.html for the board.
    // Only redirect once.
    try {
      if (state && (lastLobby && lastLobby.phase === 'IN_GAME')) {
        location.href = `game.html?room=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token)}`;
      }
    } catch (e) {}
  });

  // ---- Buttons ----
  readyBtn?.addEventListener('click', () => {
    // optimistic toggle
    myReady = !myReady;
    readyBtn.textContent = myReady ? 'READY ✅' : 'READY';
    socket.emit('setReady', myReady);
  });

  startBtn?.addEventListener('click', () => {
    socket.emit('startGame');
  });

  chatSend?.addEventListener('click', () => {
    const msg = String(chatInput?.value || '').trim();
    if (!msg) return;
    socket.emit('chat', msg);
    chatInput.value = '';
  });

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      chatSend?.click();
    }
  });

  // ---- Invite link copy ----
  copyInviteBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      showTemp(copyHint);
    } catch (e) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = inviteLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showTemp(copyHint);
    }
  });

  // ---- Invite modal + email send ----
  function openModal() {
    setError(inviteModalErr, null);
    if (inviteEmails) inviteEmails.value = '';
    if (inviteModal) inviteModal.style.display = 'flex';
    try { inviteEmails?.focus(); } catch {}
  }

  function closeModal() {
    if (inviteModal) inviteModal.style.display = 'none';
  }

  sendInviteBtn?.addEventListener('click', openModal);
  inviteCancelBtn?.addEventListener('click', closeModal);
  inviteModal?.addEventListener('click', (e) => {
    if (e.target === inviteModal) closeModal();
  });

  inviteSendBtn?.addEventListener('click', async () => {
    setError(inviteModalErr, null);
    setError(sendErr, null);

    const raw = String(inviteEmails?.value || '');
    const emails = raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!emails.length) {
      setError(inviteModalErr, 'Adj meg legalább egy e-mail címet.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid = emails.filter((e) => emailRegex.test(e));
    if (!valid.length) {
      setError(inviteModalErr, 'Adj meg érvényes e-mail címet.');
      return;
    }

    inviteSendBtn.disabled = true;
    inviteSendBtn.style.opacity = '0.6';

    try {
      // server endpoint expects ONE recipient per call: { room, to }
      for (const to of valid) {
        const res = await fetch('/api/send-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: roomCode, to }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data && data.error ? data.error : 'Hiba az e-mail küldésnél.');
        }
      }

      closeModal();
      showTemp(sendHint, 1600);
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Szerver hiba.';
      setError(inviteModalErr, msg);
      setError(sendErr, msg);
    } finally {
      inviteSendBtn.disabled = false;
      inviteSendBtn.style.opacity = '1';
    }
  });
})();
