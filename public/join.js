const CHARACTERS = [
  { key:"VETERAN", name:"Veterán", img:"assets/characters/veteran.png" },
  { key:"LOGISTIC", name:"Logisztikus", img:"assets/characters/logisztikus.png" },
  { key:"STRATEGIST", name:"Stratéga", img:"assets/characters/stratega.png" },
  { key:"PROFILER", name:"Profilozó", img:"assets/characters/profilozo.png" },
  { key:"NEMESIS", name:"Nemezis vadász", img:"assets/characters/nemezisvadasz.png" },
  { key:"DAREDEVIL", name:"Vakmerő", img:"assets/characters/vakmero.png" },
];

let picked = "VETERAN";

function renderChars(){
  const grid = document.getElementById('charGrid');
  if(!grid) return;
  grid.innerHTML = "";

  CHARACTERS.forEach(ch=>{
    const card = document.createElement('div');
    card.className = 'charCard' + (picked===ch.key ? ' picked' : '');

    const imgWrap = document.createElement('div');
    imgWrap.className = 'charImg';
    const img = document.createElement('img');
    img.src = ch.img;
    img.alt = ch.name;
    imgWrap.appendChild(img);

    const btn = document.createElement('button');
    btn.className = 'btn pickBtn';
    const color = (typeof THEME_COLORS==='object' && THEME_COLORS[ch.key]) ? THEME_COLORS[ch.key] : '#f8bd01';
    btn.style.background = color;
    btn.style.color = '#111';
    btn.textContent = (picked===ch.key) ? 'Kiválasztva' : 'Választom';
    btn.onclick = ()=>{ picked = ch.key; renderChars(); };

    card.appendChild(imgWrap);
    card.appendChild(btn);
    grid.appendChild(card);
  });
}

async function doJoin(){
  const room = (document.getElementById('room')?.value || '').trim().toUpperCase();
  const name = (document.getElementById('name')?.value || '').trim();
  const password = (document.getElementById('password')?.value || '').trim();
  if(!room){ alert('Add meg a szoba kódot.'); return; }
  if(!name){ alert('Adj meg nevet.'); return; }
  if(!picked){ alert('Válassz karaktert.'); return; }

  const res = await fetch('/api/join-room', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ room, name, characterKey: picked, password: password || null })
  });
  const data = await res.json().catch(()=>null);
  if(!res.ok || !data || !data.token){
    alert((data && data.error) ? data.error : 'Nem sikerült csatlakozni.');
    return;
  }

  // Persist session so refresh/back won't lose the token
  try{
    if(typeof saveSession === 'function'){
      saveSession(room, data.token, { name, characterKey: picked, role: 'player' });
    }
  }catch(e){}

  location.href = `lobby.html?room=${encodeURIComponent(room)}&token=${encodeURIComponent(data.token)}`;
}

// Prefill room from query (?room=ABCD)
try{
  const params = new URLSearchParams(location.search);
  const qRoom = (params.get('room')||'').trim().toUpperCase();
  if(qRoom) document.getElementById('room').value = qRoom;
}catch(e){}

document.getElementById('join')?.addEventListener('click', ()=>{
  doJoin().catch(e=>{ console.error(e); alert('Hiba a szerver elérésekor.'); });
});

renderChars();
