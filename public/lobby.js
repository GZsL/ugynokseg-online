const params = new URLSearchParams(location.search);
let ROOM = (params.get('room')||'').trim().toUpperCase();
let TOKEN = (params.get('token')||'').trim();

try{
  if(!ROOM || !TOKEN){
    const saved = JSON.parse(localStorage.getItem('ugynokseg_session')||'null');
    if(saved && saved.room && saved.token){
      ROOM = String(saved.room).trim().toUpperCase();
      TOKEN = String(saved.token).trim();
      const u = new URL(location.href);
      u.searchParams.set('room', ROOM);
      u.searchParams.set('token', TOKEN);
      history.replaceState({}, '', u.toString());
    }
  }
}catch(e){}

function escapeHtml(str){
  return String(str==null?"":str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

if(!ROOM || !TOKEN){
  alert('Hiányzik a room vagy token.');
  location.href = 'intro.html';
} else {
  try{
    localStorage.setItem('ugynokseg_session',
      JSON.stringify({ room: ROOM, token: TOKEN, ts: Date.now() })
    );
  }catch(e){}
}

const roomCodeEl = document.getElementById('roomCode');
const copyInviteBtn = document.getElementById('copyInvite');
const inviteLinkEl = document.getElementById('inviteLink');
const playersEl = document.getElementById('players');
const readyBtn = document.getElementById('readyBtn');
const startBtn = document.getElementById('startBtn');
const inviteEmailInput = document.getElementById('inviteEmail');
const sendInviteBtn = document.getElementById('sendInvite');

if(roomCodeEl) roomCodeEl.textContent = ROOM;
if(inviteLinkEl) inviteLinkEl.value =
  `${location.origin}/join.html?room=${encodeURIComponent(ROOM)}`;

copyInviteBtn?.addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(
      `${location.origin}/join.html?room=${encodeURIComponent(ROOM)}`
    );
    copyInviteBtn.textContent = 'Másolva!';
    setTimeout(()=> copyInviteBtn.textContent = 'Link másolása', 900);
  }catch{
    alert('Nem sikerült másolni.');
  }
});

let currentSnapshot = null;

function renderLobby(snapshot){
  if(!snapshot) return;
  currentSnapshot = snapshot;

  const arr = snapshot.players || [];

  if(playersEl){
    playersEl.innerHTML = arr.map(p=>{
      const st = p.ready ? 'READY' : 'NOT READY';
      const dot = p.connected ? '🟢' : '⚪';
      const host = p.isHost ? ' (HOST)' : '';
      return `<div class="playerRow">
        <div class="playerName">${dot} ${escapeHtml(p.name)}${host}</div>
        <div class="playerMeta">${escapeHtml(p.characterKey || '')}</div>
        <div class="playerReady ${p.ready?'on':'off'}">${st}</div>
      </div>`;
    }).join('');
  }

  // saját játékos
  const me = arr.find(p => p.token === TOKEN);

  const readyCount = arr.filter(p=>p.ready).length;

  if(startBtn){
    if(me && me.isHost){
      startBtn.disabled = !(readyCount >= 2);
    } else {
      startBtn.disabled = true;
    }
  }
}

const socket = io({
  query: { room: ROOM, token: TOKEN }
});

socket.on('serverMsg', (txt)=>{
  console.log('[serverMsg]', txt);
  if(txt && txt.includes('Érvénytelen token')){
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
});

socket.on('lobby', renderLobby);

readyBtn?.addEventListener('click', ()=>{
  socket.emit('lobbyAction', { type:'TOGGLE_READY' });
});

startBtn?.addEventListener('click', ()=>{
  socket.emit('lobbyAction', { type:'START_GAME' });
});

socket.on('state', ()=>{
  location.href =
    `game.html?room=${encodeURIComponent(ROOM)}&token=${encodeURIComponent(TOKEN)}`;
});

sendInviteBtn?.addEventListener('click', async ()=>{
  const raw = (inviteEmailInput?.value || '').trim();
  if(!raw){ alert('Adj meg e-mail címet.'); return; }

  const emails = raw.split(',').map(s=>s.trim()).filter(Boolean);

  const res = await fetch('/api/send-invite', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ room: ROOM, token: TOKEN, emails })
  });

  if(res.status === 401){
    location.href =
      `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }

  const data = await res.json().catch(()=>null);

  if(res.status === 403){
    alert('Csak a host küldhet meghívót.');
    return;
  }

  if(!res.ok || !data){
    alert((data && data.error) || 'Nem sikerült meghívót küldeni.');
    return;
  }

  alert('Meghívó elküldve.');
});