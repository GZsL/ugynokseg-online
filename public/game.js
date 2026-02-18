const PROFILE_IMAGE_MAP = {
  LOGISTIC: "assets/profile/profile_image_logisztikus.png",
  NEMESIS: "assets/profile/profile_image_nemezisvadasz.png",
  PROFILER: "assets/profile/profile_image_profilozo.png",
  STRATEGIST: "assets/profile/profile_image_stratega.png",
  DAREDEVIL: "assets/profile/profile_image_vakmero.png",
  VETERAN: "assets/profile/profile_image_veteran.png"
};

function hexToRgba(hex, alpha){
  if(!hex) return `rgba(0,0,0,${alpha})`;
  let h = String(hex).trim();
  if(h[0]==="#") h=h.slice(1);
  if(h.length===3) h = h.split("").map(ch=>ch+ch).join("");
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}


function escapeHtml(str){
  return String(str==null?"":str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

let state = null;

// ================= Online (LAN) sync =================
const QS = new URLSearchParams(window.location.search);
const ROOM_CODE = QS.get("room") || "";
const PLAYER_INDEX = parseInt(QS.get("player") || "0", 10) || 0;


const VIEW_INDEX = IS_ONLINE ? PLAYER_INDEX : (state.currentPlayerIndex || 0);
function isMyTurn(){
  return !IS_ONLINE || VIEW_INDEX === (state.currentPlayerIndex || 0);
}

let socket = null;
let isOnline = !!ROOM_CODE;

function sendAction(type, payload){
  if(!socket) return;
  socket.emit("action", { type, payload: payload || {} });
}

function connectOnline(){
  if(!isOnline) return;
  socket = io({ query: { room: ROOM_CODE, player: String(PLAYER_INDEX) } });
  socket.on("state", (nextState)=>{
    state = nextState;
    render();
  });
  socket.on("serverMsg", (msg)=>{
    if(msg) setStatus(String(msg));
    render();
  });
}

connectOnline();

// UI state (selection / discard). Kept separate from game state.
const ui = {
  selectedCaseId: null,
  selectedPartnerId: null,
  partnerModalOpen: false,
  usedItemIds: new Set(),
  usedSkillIds: new Set(),
  discardIds: new Set(),
};

ui.statusMsg = "";

function setStatus(msg){
  ui.statusMsg = msg || "";
  // NOTE: Status messages are considered "help/feedback" text.
  // They should NOT auto-appear on the UI; only show them when the user
  // explicitly asks for help (via the ? icon).
}



function commit(next){
  state = next;
  render();
}

function resetUseSelections(){
  ui.usedItemIds.clear();
  ui.usedSkillIds.clear();
}

function resetDiscardSelections(){
  ui.discardIds.clear();
}
function activePlayer(){
  const idx = (IS_ONLINE ? VIEW_INDEX : (state.currentPlayerIndex || 0));
  return (state.players||[])[idx] || (state.players||[])[0];
}

function applyTheme(){
  const p = activePlayer();
  const palette = (typeof THEME_COLORS !== "undefined" ? THEME_COLORS : (window.THEME_COLORS||{}));
  const hex = palette[p.characterKey] || "#f8bd01";
  setThemeColor(hex);
}

function renderHeader(){
  const p = activePlayer();
  const hdr = document.getElementById("hdr");
  if(!hdr) return;
  const theme = THEME_COLORS[p.characterKey] || "#f8bd01";
  hdr.innerHTML = `
    <div style="display:flex; gap:24px; height:100%; position:relative;">
      <div style="width:310px; display:flex; align-items:stretch; justify-content:flex-start;">
        <div style="width:310px; height:100%; border-radius:0; overflow:hidden; background:#111;">
          <img src="${PROFILE_IMAGE_MAP[p.characterKey] || `assets/characters/${String(p.characterKey||p.characterName||"").toLowerCase()}.png`}" style="width:100%; height:100%; object-fit:contain; display:block; background:#111;" />
        </div>
      </div>
      <!-- Character color bar layer (separate) -->
      <div class="charBar" id="charBar" style="position:absolute; left:310px; width:750px; height:50px; background:${theme}; border-radius:0; display:flex; align-items:center; pointer-events:none;">
        <div style="padding-left:20px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:#fff;">${(p.characterName||p.characterKey||"").toUpperCase()}</div>
      </div>

      <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; padding-top:30px; position:relative;">
        <div>
          <div id="agentName" style="font-size:34px; font-weight:900; text-transform:uppercase; margin-top:0;">${String(p.name||"").toUpperCase()}</div>
          <div style="color:rgba(255,255,255,.7); margin-top:65px; font-size:14px; line-height:1.2;">${p.advantage||""}</div>
          <div style="color:rgba(255,255,255,.6); margin-top:6px; font-size:14px; line-height:1.2;">${p.disadvantage||""}</div>
          ${(p.characterKey==="NEMESIS" && p.nemesisThiefName) ? `<div style="color:rgba(255,255,255,.85); margin-top:10px; font-size:14px; line-height:1.2;"><b>Nemezis tolvaj:</b> ${p.nemesisThiefName}</div>` : ""}
          ${(p.fixedItems && p.fixedItems.length) ? `<div style="color:rgba(255,255,255,.85); margin-top:10px; font-size:13px; line-height:1.2;"><b>Fix tárgyak:</b> ${(p.fixedItems||[]).map(it=>it.name).join(", ")}</div>` : ""}
        </div>
        <div style="display:flex; justify-content:flex-end; gap:20px; margin-top:auto; margin-bottom:30px; margin-right:100px;">
          ${[
            ["Megoldott ügyek", (p.solvedCases||[]).length],
            ["Elfogott tolvajok", (p.capturedThieves||[]).length],
            ["Fix tárgyak", (p.fixedItems||[]).length],
          ].map(([t,v])=>`
            <div style="width:180px; height:96px; background:var(--theme-color); color:#fff; border-radius:12px; padding:10px 12px; box-sizing:border-box;">
              <div style="font-size:18px; color:rgba(255,255,255,.65); font-weight:700; display:flex; align-items:center; justify-content:space-between;"><span>${t}</span>${t==="Fix tárgyak" ? `<button class="helpBtn" id="helpBtn" title="Segítség">?</button>` : ``}</div>
              <div style="font-size:45px; font-weight:900;">${v}</div>
            </div>
          `).join("")}
        </div>
      </div>
      <div id="levelCircleWrap" style="position:absolute;">  <div id="levelCircle" style="width:144px; height:144px; border-radius:50%; background:var(--theme-color); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:48px;">    ${p.agentLevel!=null ? p.agentLevel : (p.level||11)}  </div></div>
    </div>
  `;
  const hb = document.getElementById('helpBtn');
  if(hb){ hb.onclick = ()=>showHelpModal(); }


  // Align the character color bar so its TOP edge matches the bottom of the agent name.
  requestAnimationFrame(() => {
    const agent = document.getElementById('agentName');
    const bar = document.getElementById('charBar');
    const circleWrap = document.getElementById('levelCircleWrap');
    const circle = document.getElementById('levelCircle');
    if(agent && bar){
      // Bar top edge matches bottom of agent name
      bar.style.top = (agent.offsetTop + agent.offsetHeight) + 'px';
    }
    // Align circle:
    // - X centerline (vertical centerline) to the RIGHT edge of the character color bar
    // - Y centerline (horizontal centerline) to the CENTER of the character color bar
    if(bar && circleWrap && circle){
      const size = circle.offsetWidth || 144;

      // Compute positions in the same coordinate space (relative to the bar's offsetParent)
      const parent = bar.offsetParent || bar.parentElement;
      const barRect = bar.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();

      const left = (barRect.right - parentRect.left) - (size/2);                 // center X at bar's right edge
      const top  = (barRect.top + barRect.height/2 - parentRect.top) - (size/2); // center Y at bar's center

      circleWrap.style.left = left + 'px';
      circleWrap.style.top  = top + 'px';
      circleWrap.style.transform = ''; // ensure no leftover translateY interferes
    }
});
}

function renderDecks(){
  const mixed = document.getElementById("deckMixed");
  const items = document.getElementById("deckItem");
  const p = activePlayer();
  if(mixed){
    const phase = state.turn && state.turn.phase ? state.turn.phase : null;
    const profilerReady = (p && p.characterKey==="PROFILER" && p.flags && p.flags.profilerPeekAvailable && !p.flags.profilerPeekUsed && (phase==="AWAIT_ROLL" || phase==="AFTER_ROLL"));
    mixed.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
          <div style="font-weight:900; line-height:1;">VEGYES PAKLI</div>
          <div style="font-size:14px; font-weight:400; color:#ffffff; line-height:1.1; margin-top:2px;">(ügy + tolvaj + képesség)</div>
          <div style="margin-top:20px; display:flex; gap:12px; align-items:center;">
            <button class="btn btn-theme" id="draw3">HÚZÁS (+3 LAP)</button>
            ${profilerReady ? `<button class="btn btn-outline" id="profilerPeekBtn">BETEKINTÉS</button>` : ``}
          </div>
        </div>
        <div style="font-size:68px; font-weight:900; color:var(--theme-color); line-height:1; margin-top:0;">${(state.mixedDeck?.length ?? 0) || 39}</div>
      </div>`;
    mixed.querySelector("#draw3").onclick = ()=>{
      sendAction("PRE_DRAW");
};

    const peekBtn = mixed.querySelector('#profilerPeekBtn');
    if(peekBtn){
      peekBtn.onclick = ()=>showProfilerPeekModal();
    }
  }
  if(items){
    items.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
          <div style="font-weight:900; line-height:1;">TÁRGY PAKLI</div>
          <div style="font-size:14px; font-weight:400; color:#ffffff; line-height:1.1; margin-top:2px;">(tárgy kártyák)</div>
        </div>
        <div style="font-size:68px; font-weight:900; color:var(--theme-color); line-height:1; margin-top:0;">${(state.itemDeck?.length ?? 0) || 24}</div>
      </div>`;
  }
}

function renderRoll(){
  const roll = document.getElementById("roll");
  if(!roll) return;

  const faces = (state.turn && Array.isArray(state.turn.diceFaces)) ? state.turn.diceFaces : [];
  const faceToImg = {
    "nyomozás":"assets/dice/nyomozas.png",
    "tárgy":"assets/dice/targy.png",
    "képesség":"assets/dice/kepesseg.png"
  };

  // Summary counts (layout: right side)
  const counts = { nyomozás:0, képesség:0 };
  for(const f of faces){
    if(f==="nyomozás") counts.nyomozás++;
    if(f==="képesség") counts.képesség++;
  }

  roll.innerHTML = `
    <div style="display:flex; align-items:center; height:100%; gap:16px;">
      <div style="display:flex; align-items:center; gap:10px; flex:0 0 auto;">
        <button class="btn btn-theme" style="height:44px; width:140px;" id="rollBtn">DOBÁS</button>
        <button class="helpBtn" id="helpBtnRoll" title="Segítség">?</button>
      </div>

      <div style="flex:1 1 auto; display:flex; justify-content:center;">
        <div style="display:flex; gap:8px;" id="diceRow">
          ${Array.from({length:6}).map((_,i)=>{
            const f = faces[i];
            const img = f ? faceToImg[f] : null;
            return `<div class="die" data-i="${i}" style="width:50px;height:50px;background:#fff;border-radius:8px;border:1px solid rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center;">
              ${img ? `<img src="${img}" alt="${f}" style="width:28px;height:28px;object-fit:contain;">` : `<span style="font-weight:900;color:#111;">?</span>`}
            </div>`;
          }).join("")}
        </div>
      </div>

      <div style="flex:0 0 auto; text-align:right; font-weight:800; letter-spacing:.02em; line-height:1.2;">
        <div>NYOMOZÁS: ${counts.nyomozás}</div>
        <div>KÉPESSÉG: ${counts.képesség}</div>
      </div>
    </div>
  `;

  roll.querySelector("#rollBtn").onclick = ()=>{
    sendAction('ROLL'); resetUseSelections();
      }
    }
  };
});

document.addEventListener("DOMContentLoaded", ()=>{
  const ok3 = document.getElementById("helpModalOk");
  if(ok3) ok3.onclick = hideHelpModal;
});