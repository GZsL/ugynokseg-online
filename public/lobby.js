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
const statusEl = document.getElementById('status');
const playersEl = document.getElementById('players');
const readyBtn = document.getElementById('readyBtn');
const startBtn = document.getElementById('startBtn');
const hint2 = document.getElementById('hint2');

roomCodeEl.textContent = ROOM;
const inviteLink = `${location.origin}/join.html?room=${encodeURIComponent(ROOM)}`;


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
