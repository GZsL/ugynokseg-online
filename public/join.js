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

    const img = document.createElement('img');
    img.src = ch.img;
    img.alt = ch.name;
    img.draggable = false;

    const name = document.createElement('div');
    name.className = 'charName';
    name.textContent = ch.name;

    card.appendChild(img);
    card.appendChild(name);

    card.addEventListener('click', ()=>{
      picked = ch.key;
      renderChars();
    });

    grid.appendChild(card);
  });
}

async function joinRoom(){
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

  // ✅ PERSIST room+token (refresh/new tab miatt)
  try{
    localStorage.setItem('ugynokseg_session', JSON.stringify({ room: room, token: data.token, ts: Date.now() }));
  }catch(e){}

  location.href = `lobby.html?room=${encodeURIComponent(room)}&token=${encodeURIComponent(data.token)}`;
}

// Prefill room from query (?room=ABCD)
try{
  const params = new URLSearchParams(location.search);
  const qroom = (params.get('room')||'').trim().toUpperCase();
  if(qroom){
    const el = document.getElementById('room');
    if(el) el.value = qroom;
  }
}catch(e){}

document.getElementById('join')?.addEventListener('click', ()=>{
  joinRoom().catch(e=>{ console.error(e); alert('Hiba a szerver elérésekor.'); });
});

renderChars();