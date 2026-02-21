const params = new URLSearchParams(location.search);
const ROOM = (params.get('room')||'').trim().toUpperCase();
const TOKEN = (params.get('token')||'').trim();

function escapeHtml(str){
  return String(str==null?"":str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

if(!ROOM || !TOKEN){
  alert('Hiányzik a room vagy token. Menj vissza és csatlakozz újra.');
  location.href = 'intro.html';
}

const roomCodeEl = document.getElementById('roomCode');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const copyHint = document.getElementById('copyHint');
const sendInviteBtn = document.getElementById('sendInviteBtn');
const sendHint = document.getElementById('sendHint');
const sendErr = document.getElementById('sendErr');
const inviteModal = document.getElementById('inviteModal');
const inviteEmails = document.getElementById('inviteEmails');
const inviteCancelBtn = document.getElementById('inviteCancelBtn');
const inviteSendBtn = document.getElementById('inviteSendBtn');
const inviteModalErr = document.getElementById('inviteModalErr');

const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const readyBtn = document.getElementById('readyBtn');
const startBtn = document.getElementById('startBtn');
const hint2 = document.getElementById('hint2');

roomCodeEl.textContent = ROOM;
const inviteLink = `${location.origin}/join.html?room=${encodeURIComponent(ROOM)}`;
function showModal(show){
  if(!inviteModal) return;
  inviteModal.style.display = show ? 'flex' : 'none';
}
function setElVisible(el, vis){
  if(!el) return;
  el.style.display = vis ? 'block' : 'none';
}
function normalizeEmails(raw){
  const parts = String(raw||'')
    .split(/[,\n\r\t\s]+/g)
    .map(s=>s.trim())
    .filter(Boolean);
  // basic validate
  const emails = parts.filter(e => /.+@.+\..+/.test(e));
  return Array.from(new Set(emails)); // unique
}

// OPEN modal
if(sendInviteBtn){
  sendInviteBtn.addEventListener('click', ()=>{
    if(inviteEmails) inviteEmails.value = '';
    if(inviteModalErr) inviteModalErr.style.display='none';
    showModal(true);
    setElVisible(sendErr,false);
    setElVisible(sendHint,false);
  });
}
if(inviteCancelBtn){
  inviteCancelBtn.addEventListener('click', ()=> showModal(false));
}
// click outside closes
if(inviteModal){
  inviteModal.addEventListener('click', (e)=>{
    if(e.target === inviteModal) showModal(false);
  });
}

if(inviteSendBtn){
  inviteSendBtn.addEventListener('click', async ()=>{
    try{
      setElVisible(inviteModalErr,false);
      const emails = normalizeEmails(inviteEmails ? inviteEmails.value : '');
      if(!emails.length){
        if(inviteModalErr){
          inviteModalErr.textContent = 'Adj meg legalább 1 érvényes e-mail címet.';
          setElVisible(inviteModalErr,true);
        }
        return;
      }
      inviteSendBtn.disabled = true;
      const resp = await fetch('/api/send-invite', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ room: ROOM, token: TOKEN, emails })
      });
      const data = await resp.json().catch(()=>({}));
      inviteSendBtn.disabled = false;

      if(!resp.ok || data.error){
        const msg = data && data.error ? data.error : 'Nem sikerült elküldeni a meghívót.';
        if(inviteModalErr){
          inviteModalErr.textContent = msg;
          setElVisible(inviteModalErr,true);
        }
        return;
      }

      showModal(false);
      if(sendHint){
        sendHint.style.display='block';
        setTimeout(()=>{ sendHint.style.display='none'; }, 1400);
      }
    }catch(err){
      console.error(err);
      if(inviteModalErr){
        inviteModalErr.textContent = 'Hiba történt küldés közben.';
        setElVisible(inviteModalErr,true);
      }
      if(inviteSendBtn) inviteSendBtn.disabled=false;
    }
  });
}


// Meghívó link másolása gomb
if(copyInviteBtn){
  copyInviteBtn.addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(inviteLink);
      if(copyHint){
        copyHint.style.display = 'block';
        setTimeout(()=>{ copyHint.style.display='none'; }, 1200);
      }
    }catch(e){
      // fallback: prompt
      window.prompt("Másold ki a meghívó linket:", inviteLink);
    }
  });
}
let lobby = null;
let socket = null;

function myPlayer(){
  if(!lobby || !lobby.players) return null;
  // token alapján a szerver oldalon az index fix, de a lobby snapshot nem küldi tokeneket.
  // Itt egyszerűen: a READY gombot nem személyre szabjuk, csak küldjük a szervernek.
  return null;
}

function charName(key){
  const map = {
    VETERAN:'Veterán', LOGISTIC:'Logisztikus', STRATEGIST:'Stratéga', PROFILER:'Profilozó', NEMESIS:'Nemezis vadász', DAREDEVIL:'Vakmerő'
  };
  return map[key] || key || '—';
}

function render(){
  if(!lobby){
    statusEl.textContent = 'Kapcsolódás…';
    return;
  }
  statusEl.textContent = (lobby.phase==='LOBBY') ? 'LOBBY' : (lobby.phase==='IN_GAME' ? 'JÁTÉK INDUL…' : lobby.phase);

  const list = (lobby.players||[]);
  playersEl.innerHTML = list.map(p=>{
    const isOnline = !!p.connected;
    const badge = p.ready ? 'ready' : (isOnline ? 'notready' : 'offline');
    const badgeTxt = p.ready ? 'READY' : (isOnline ? 'NOT READY' : 'OFFLINE');
    const col = (typeof THEME_COLORS==='object' && THEME_COLORS[p.characterKey]) ? THEME_COLORS[p.characterKey] : '#f8bd01';
    return `
      <div class="playerRow" style="margin:8px 0;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:12px; height:12px; border-radius:999px; background:${col};"></div>
          <div>
            <div style="font-weight:900;">${escapeHtml(p.name||p.id)} ${p.isHost ? '<span class="mini">(host)</span>' : ''}</div>
            <div class="mini">${escapeHtml(charName(p.characterKey))}</div>
          </div>
        </div>
        <div class="badge ${badge}">${badgeTxt}</div>
      </div>
    `;
  }).join('');

  const readyCount = list.filter(p=>p && p.ready).length;
  hint2.textContent = `READY: ${readyCount}/${list.length} (min. 2 ready kell a start-hoz)`;
}

function connect(){
  if(typeof io !== 'function'){
    alert('socket.io kliens hiányzik');
    return;
  }
  socket = io({ query: { room: ROOM, token: TOKEN } });

  socket.on('connect', ()=>{
    statusEl.textContent = 'Kapcsolódva';
  });

  socket.on('lobby', (snap)=>{
    lobby = snap;
    render();
    if(lobby && lobby.phase==='IN_GAME'){
      // Késleltetve, hogy a játékos lássa a váltást
      setTimeout(()=>{
        location.href = `game.html?room=${encodeURIComponent(ROOM)}&token=${encodeURIComponent(TOKEN)}`;
      }, 350);
    }
  });

  socket.on('serverMsg', (t)=>{
    if(typeof toast==='function') toast(String(t));
  });

  socket.on('connect_error', ()=>{
    statusEl.textContent = 'Kapcsolati hiba';
  });
}

readyBtn.onclick = ()=>{
  if(!socket) return;
  socket.emit('lobbyAction', { type:'TOGGLE_READY' });
};
startBtn.onclick = ()=>{
  if(!socket) return;
  socket.emit('lobbyAction', { type:'START_GAME' });
};

render();
connect();
