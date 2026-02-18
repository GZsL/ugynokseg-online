// Setup flow: names -> character picks -> saveState -> game.html
const MAX_PLAYERS = 4;

const CHARACTERS = [
  { key:"VETERAN", name:"Veterán", img:"assets/characters/veteran.png" },
  { key:"LOGISTIC", name:"Logisztikus", img:"assets/characters/logisztikus.png" },
  { key:"STRATEGIST", name:"Stratéga", img:"assets/characters/stratega.png" },
  { key:"PROFILER", name:"Profilozó", img:"assets/characters/profilozo.png" },
  { key:"NEMESIS", name:"Nemezis vadász", img:"assets/characters/nemezisvadasz.png" },
  { key:"DAREDEVIL", name:"Vakmerő", img:"assets/characters/vakmero.png" },
];

let screen = "names";
let names = ["Ügynök 1","Ügynök 2"];
let picks = {}; // playerIndex -> characterKey
let activePicker = 0;

const elNames = document.getElementById("names");
const addBtn = document.getElementById("addPlayer");
const toChars = document.getElementById("toChars");

const charsPanel = document.getElementById("charsPanel");
const who = document.getElementById("who");
const grid = document.getElementById("charGrid");
const backNames = document.getElementById("backNames");
const startGame = document.getElementById("startGame");

function renderNames(){
  elNames.innerHTML = "";
  names.forEach((n, i)=>{
    const row = document.createElement("div");
    row.className="nameRow";
    const inp = document.createElement("input");
    inp.type="text";
    inp.value=n;
    inp.addEventListener("input", ()=>{ names[i]=inp.value; });
    const del = document.createElement("button");
    del.className="btn btn-outline smallBtn";
    del.textContent="Törlés";
    del.disabled = names.length<=2;
    del.onclick = ()=>{ 
      names.splice(i,1);
      // re-pack picks
      const np = {};
      Object.keys(picks).forEach(k=>{
        const idx=parseInt(k,10);
        if(idx<i) np[idx]=picks[idx];
        if(idx>i) np[idx-1]=picks[idx];
      });
      picks=np;
      renderNames();
    };
    row.appendChild(inp);
    row.appendChild(del);
    elNames.appendChild(row);
  });

  addBtn.disabled = names.length>=MAX_PLAYERS;
}

function renderChars(){
  if(activePicker>=0){
    who.textContent = `Most választ: ${names[activePicker]} (${activePicker+1}/${names.length})`;
  }else{
    who.textContent = "Kész! Mindenki választott.";
  }
  grid.innerHTML = "";
  CHARACTERS.forEach(ch=>{
    const card=document.createElement("div");
    card.className="charCard";
    const imgWrap=document.createElement("div");
    imgWrap.className="charImg";
    const img=document.createElement("img");
    img.src=ch.img;
    img.alt=ch.name;
    imgWrap.appendChild(img);

    const btn=document.createElement("button");
    btn.className="btn pickBtn";
    const color = THEME_COLORS[ch.key] || "#f8bd01";
    btn.style.background = color;
    btn.style.color = "#111";
    btn.textContent="Választom";

    // disable if character already picked by someone else
    const taken = Object.values(picks);
    const isTaken = activePicker<0 ? taken.includes(ch.key) : (taken.includes(ch.key) && picks[activePicker] !== ch.key);
    if(isTaken){
      btn.disabled = true;
      btn.textContent = "Foglalt";
      btn.style.opacity = "0.35";
      btn.style.cursor = "not-allowed";
    }

    btn.onclick=()=>{
      picks[activePicker]=ch.key;
      // next player who hasn't picked
      const next = (()=>{ for(let i=0;i<names.length;i++){ if(picks[i]==null) return i; } return null; })();
      if(next==null){
        who.textContent = "Kész! Mindenki választott.";
        activePicker = -1;
      }else{
        activePicker = next;
      }
      renderChars();
    };

    card.appendChild(imgWrap);
    card.appendChild(btn);
    grid.appendChild(card);
  });
}

function showNames(){
  screen="names";
  charsPanel.classList.add("hidden");
  renderNames();
}
function showChars(){
  screen="chars";
  charsPanel.classList.remove("hidden");
  // ensure activePicker is first unpicked
  const next = (()=>{ for(let i=0;i<names.length;i++){ if(picks[i]==null) return i; } return 0; })();
  activePicker = next;
  renderChars();
}

addBtn.onclick=()=>{
  if(names.length>=MAX_PLAYERS) return;
  names.push(`Ügynök ${names.length+1}`);
  renderNames();
};
toChars.onclick=()=> showChars();
backNames.onclick=()=> showNames();

startGame.onclick=async ()=>{
  // require all picked
  for(let i=0;i<names.length;i++){
    if(!picks[i]){ alert("Még nem választott mindenki karaktert."); return; }
  }
  const configs = names.map((name,i)=>({ name, characterKey: picks[i] }));

  // Create room on server
  try{
    const res = await fetch('/api/create-room', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ configs })
    });
    const data = await res.json();
    if(!res.ok || !data || !data.room){
      alert((data && data.error) ? data.error : 'Nem sikerült a szobát létrehozni.');
      return;
    }

    const room = data.room;

    // Show join links (player index based)
    const panel = document.querySelector('.panel');
    if(panel){
      const links = configs.map((c,i)=>{
        const url = `${location.origin}/game.html?room=${encodeURIComponent(room)}&player=${i}`;
        return `<div style="margin:8px 0;"><div style="font-weight:900; color:#111;">${i+1}. ${c.name}</div><input type="text" value="${url}" style="width:100%; padding:10px 12px; border-radius:12px; border:0;" onclick="this.select()" readonly></div>`;
      }).join('');

      panel.innerHTML = `
        <h1 class="h1">Szoba létrehozva</h1>
        <p class="hint">Szobakód: <b>${room}</b>. Oszd meg a linkeket a játékosokkal (mindegyik link egy konkrét játékost jelent).</p>
        ${links}
        <div class="row" style="margin-top:16px;">
          <a class="btn btn-theme" href="game.html?room=${encodeURIComponent(room)}&player=0">Belépek (Játékos 1)</a>
        </div>
      `;
    }

  }catch(e){
    console.error(e);
    alert('Hiba a szerver elérésekor.');
  }
};

showNames();
