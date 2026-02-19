/* =============================
   ÜGYNÖKÖK — game.js (ONLINE FIX)
   - Player-perspective UI: always show PLAYER_INDEX as "me"
   - Actions are enabled only if it's my turn
   - Online actions go through socket.io
   ============================= */

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

/* --------- Load initial state (offline fallback) --------- */
let state = (typeof loadState === "function") ? loadState() : null;

/* ================= Online (LAN/Render) sync ================= */
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const TOKEN = params.get('token') || '';
let PLAYER_INDEX = Math.max(0, parseInt(params.get('player') || '0', 10) || 0);
const IS_ONLINE = !!ROOM;

let socket = null;
function sendAction(type, payload){
  if(!socket) return;
  socket.emit('action', { type, payload: payload || {} });
}

function attachSocket(){
  if(!IS_ONLINE) return;
  if(typeof io === 'function'){
    const query = TOKEN ? { room: ROOM, token: TOKEN } : { room: ROOM, player: String(PLAYER_INDEX) };
    socket = io({ query });

    socket.on('state', (s) => {
      state = s;
      // Token-based mode: server tells us who we are.
      if(state && typeof state._meIndex === 'number') PLAYER_INDEX = state._meIndex;
      try{ if(typeof saveState==="function") saveState(state); }catch(e){}
      render();
    });

    socket.on('serverMsg', (t) => {
      if(typeof toast === "function") toast(String(t));
      // keep a last status too
      ui.statusMsg = String(t || "");
    });

    socket.on('connect_error', (err) => {
      console.warn("socket connect_error:", err);
      if(typeof toast === "function") toast("Kapcsolati hiba (socket). Nézd meg a szoba kódot és a token-t.");
    });

  } else {
    if(typeof toast === "function"){
      toast('Hiányzik a socket.io kliens. Online módban a game.html-nek be kell húznia: /socket.io/socket.io.js');
    }
  }
}
/* ============================================================ */


/* --------- Minimal placeholder if nothing loaded yet --------- */
if(!state || !state.players){
  if(window.Engine && window.Engine.createGame){
    state = window.Engine.createGame([{name:"Ügynök 1", characterKey:"DAREDEVIL"}]);
    if(window.Engine.startTurn) state = window.Engine.startTurn(state).next;
  }else{
    state = {
      players:[{id:"p1", name:"Ügynök 1", characterKey:"DAREDEVIL", agentLevel:11, tableCards:[], fixedItems:[], solvedCases:[], capturedThieves:[]}],
      currentPlayerIndex:0,
      mixedDeck:[], itemDeck:[], skillDeck:[], discard:[],
      turn:{phase:"AWAIT_DRAW", diceFaces:[], investigationsLeft:0, skillPlaysLeft:0}
    };
  }
}

function deckCount(which){
  if(!state) return 0;
  if(which==='mixed') return (state.mixedDeckCount ?? (state.mixedDeck ? state.mixedDeck.length : 0)) || 0;
  if(which==='item') return (state.itemDeckCount ?? (state.itemDeck ? state.itemDeck.length : 0)) || 0;
  if(which==='skill') return (state.skillDeckCount ?? (state.skillDeck ? state.skillDeck.length : 0)) || 0;
  return 0;
}

/* --------- UI state (selection / discard) --------- */
const ui = {
  selectedCaseId: null,
  selectedPartnerId: null,
  usedItemIds: new Set(),
  usedSkillIds: new Set(),
  discardIds: new Set(),
  statusMsg: "",
  _winShown: false,
  _kickShownId: null
};

function setStatus(msg){
  ui.statusMsg = msg || "";
}

function resetUseSelections(){
  ui.usedItemIds.clear();
  ui.usedSkillIds.clear();
}
function resetDiscardSelections(){
  ui.discardIds.clear();
}

/* --------- Perspective helpers --------- */
function me(){
  const players = state.players || [];
  return players[Math.min(PLAYER_INDEX, Math.max(0, players.length-1))];
}
function turnIndex(){
  return (state && typeof state.currentPlayerIndex==="number") ? state.currentPlayerIndex : 0;
}
function isMyTurn(){
  return PLAYER_INDEX === turnIndex();
}
function canActNow(){
  // offline: always allow
  if(!IS_ONLINE) return true;
  // online: only if my turn
  return isMyTurn();
}

function commit(next){
  state = next;
  if(window.Engine && typeof window.Engine.captureIfPossible === "function"){
    state = window.Engine.captureIfPossible(state);
  }
  try{ if(typeof saveState==="function") saveState(state); }catch(e){}
  render();
}

/* --------- Theme --------- */
function applyTheme(){
  const p = me();
  const palette = (typeof THEME_COLORS !== "undefined" ? THEME_COLORS : (window.THEME_COLORS||{}));
  const hex = palette[p?.characterKey] || "#f8bd01";
  if(typeof setThemeColor === "function") setThemeColor(hex);
}

/* --------- Header --------- */
function renderHeader(){
  const p = me();
  const hdr = document.getElementById("hdr");
  if(!hdr || !p) return;

  const palette = (typeof THEME_COLORS !== "undefined" ? THEME_COLORS : (window.THEME_COLORS||{}));
  const theme = palette[p.characterKey] || "#f8bd01";

  const turnBadge = IS_ONLINE
    ? `<div style="position:absolute; top:14px; right:18px; font-weight:900; font-size:12px; opacity:.85;">
         ${isMyTurn() ? "TE VAGY SORON" : `AKTUÁLIS: Ügynök ${turnIndex()+1}`}
       </div>`
    : ``;

  hdr.innerHTML = `
    <div style="display:flex; gap:24px; height:100%; position:relative;">
      ${turnBadge}
      <div style="width:310px; display:flex; align-items:stretch; justify-content:flex-start;">
        <div style="width:310px; height:100%; border-radius:0; overflow:hidden; background:#111;">
          <img src="${PROFILE_IMAGE_MAP[p.characterKey] || `assets/characters/${String(p.characterKey||"").toLowerCase()}.png`}"
               style="width:100%; height:100%; object-fit:contain; display:block; background:#111;" />
        </div>
      </div>

      <div class="charBar" id="charBar"
           style="position:absolute; left:310px; width:750px; height:50px; background:${theme};
                  border-radius:0; display:flex; align-items:center; pointer-events:none;">
        <div style="padding-left:20px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:#fff;">
          ${(p.characterName||p.characterKey||"").toUpperCase()}
        </div>
      </div>

      <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; padding-top:30px; position:relative;">
        <div>
          <div id="agentName" style="font-size:34px; font-weight:900; text-transform:uppercase; margin-top:0;">
            ${String(p.name||"").toUpperCase()}
          </div>
          <div style="color:rgba(255,255,255,.7); margin-top:65px; font-size:14px; line-height:1.2;">
            ${p.advantage||""}
          </div>
          <div style="color:rgba(255,255,255,.6); margin-top:6px; font-size:14px; line-height:1.2;">
            ${p.disadvantage||""}
          </div>
          ${(p.characterKey==="NEMESIS" && p.nemesisThiefName)
            ? `<div style="color:rgba(255,255,255,.85); margin-top:10px; font-size:14px; line-height:1.2;">
                 <b>Nemezis tolvaj:</b> ${p.nemesisThiefName}
               </div>` : ""}
          ${(p.fixedItems && p.fixedItems.length)
            ? `<div style="color:rgba(255,255,255,.85); margin-top:10px; font-size:13px; line-height:1.2;">
                 <b>Fix tárgyak:</b> ${(p.fixedItems||[]).map(it=>it.name).join(", ")}
               </div>` : ""}
        </div>

        <div style="display:flex; justify-content:flex-end; gap:20px; margin-top:auto; margin-bottom:30px; margin-right:100px;">
          ${[
            ["Megoldott ügyek", (p.solvedCases||[]).length],
            ["Elfogott tolvajok", (p.capturedThieves||[]).length],
            ["Fix tárgyak", (p.fixedItems||[]).length],
          ].map(([t,v])=>`
            <div style="width:180px; height:96px; background:var(--theme-color); color:#fff; border-radius:12px; padding:10px 12px; box-sizing:border-box;">
              <div style="font-size:18px; color:rgba(255,255,255,.65); font-weight:700; display:flex; align-items:center; justify-content:space-between;">
                <span>${t}</span>${t==="Fix tárgyak" ? `<button class="helpBtn" id="helpBtn" title="Segítség">?</button>` : ``}
              </div>
              <div style="font-size:45px; font-weight:900;">${v}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div id="levelCircleWrap" style="position:absolute;">
        <div id="levelCircle"
             style="width:144px; height:144px; border-radius:50%; background:var(--theme-color);
                    display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:48px;">
          ${p.agentLevel!=null ? p.agentLevel : (p.level||11)}
        </div>
      </div>
    </div>
  `;

  const hb = document.getElementById('helpBtn');
  if(hb){ hb.onclick = ()=>showHelpModal(); }

  requestAnimationFrame(() => {
    const agent = document.getElementById('agentName');
    const bar = document.getElementById('charBar');
    const circleWrap = document.getElementById('levelCircleWrap');
    const circle = document.getElementById('levelCircle');

    if(agent && bar){
      bar.style.top = (agent.offsetTop + agent.offsetHeight) + 'px';
    }
    if(bar && circleWrap && circle){
      const size = circle.offsetWidth || 144;
      const parent = bar.offsetParent || bar.parentElement;
      const barRect = bar.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const left = (barRect.right - parentRect.left) - (size/2);
      const top  = (barRect.top + barRect.height/2 - parentRect.top) - (size/2);
      circleWrap.style.left = left + 'px';
      circleWrap.style.top  = top + 'px';
      circleWrap.style.transform = '';
    }
  });
}

/* --------- Decks --------- */
function renderDecks(){
  const mixed = document.getElementById("deckMixed");
  const items = document.getElementById("deckItem");
  const p = me();
  if(!p) return;

  const phase = state.turn?.phase || null;
  const profilerReady = (p.characterKey==="PROFILER"
    && p.flags && p.flags.profilerPeekAvailable && !p.flags.profilerPeekUsed
    && (phase==="AWAIT_ROLL" || phase==="AFTER_ROLL"));

  const drawDisabled = !canActNow();

  if(mixed){
    mixed.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
          <div style="font-weight:900; line-height:1;">VEGYES PAKLI</div>
          <div style="font-size:14px; font-weight:400; color:#ffffff; line-height:1.1; margin-top:2px;">(ügy + tolvaj + képesség)</div>
          <div style="margin-top:20px; display:flex; gap:12px; align-items:center;">
            <button class="btn btn-theme" id="draw3" ${drawDisabled ? "disabled" : ""}>HÚZÁS (+3 LAP)</button>
            ${profilerReady ? `<button class="btn btn-outline" id="profilerPeekBtn" ${drawDisabled ? "disabled" : ""}>BETEKINTÉS</button>` : ``}
          </div>
        </div>
        <div style="font-size:68px; font-weight:900; color:var(--theme-color); line-height:1; margin-top:0;">
          ${deckCount('mixed')}
        </div>
      </div>
    `;

    const d = mixed.querySelector("#draw3");
    if(d){
      d.onclick = ()=>{
        if(!canActNow()) return;
        if(IS_ONLINE){ sendAction('PRE_DRAW'); resetUseSelections(); return; }
        const r = window.Engine.doPreDraw(state);
        commit(r.next);
      };
    }

    const peekBtn = mixed.querySelector('#profilerPeekBtn');
    if(peekBtn){
      peekBtn.onclick = ()=>{
        if(!canActNow()) return;
        showProfilerPeekModal();
      };
    }
  }

  if(items){
    items.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
          <div style="font-weight:900; line-height:1;">TÁRGY PAKLI</div>
          <div style="font-size:14px; font-weight:400; color:#ffffff; line-height:1.1; margin-top:2px;">(tárgy kártyák)</div>
        </div>
        <div style="font-size:68px; font-weight:900; color:var(--theme-color); line-height:1; margin-top:0;">
          ${deckCount('item')}
        </div>
      </div>
    `;
  }
}

/* --------- Roll --------- */
function renderRoll(){
  const roll = document.getElementById("roll");
  if(!roll) return;

  const faces = Array.isArray(state.turn?.diceFaces) ? state.turn.diceFaces : [];
  const faceToImg = {
    "nyomozás":"assets/dice/nyomozas.png",
    "tárgy":"assets/dice/targy.png",
    "képesség":"assets/dice/kepesseg.png"
  };

  const counts = { nyomozás:0, képesség:0 };
  for(const f of faces){
    if(f==="nyomozás") counts.nyomozás++;
    if(f==="képesség") counts.képesség++;
  }

  const rollDisabled = !canActNow();

  roll.innerHTML = `
    <div style="display:flex; align-items:center; height:100%; gap:16px;">
      <div style="display:flex; align-items:center; gap:10px; flex:0 0 auto;">
        <button class="btn btn-theme" style="height:44px; width:140px;" id="rollBtn" ${rollDisabled ? "disabled" : ""}>DOBÁS</button>
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

  const btn = roll.querySelector("#rollBtn");
  if(btn){
    btn.onclick = ()=>{
      if(!canActNow()) return;
      if(IS_ONLINE){ sendAction('ROLL'); resetUseSelections(); return; }
      const r = window.Engine.doRollAndDraw(state);
      commit(r.next);
    };
  }

  const hb = roll.querySelector("#helpBtnRoll");
  if(hb){ hb.onclick = ()=>showHelpModal(); }
}

/* --------- Case panel --------- */
function renderCase(){
  const box = document.getElementById("case");
  if(!box) return;

  const p = me();
  if(!p) return;

  const cases = (p.tableCards||[]).filter(c=>c.kind==="case");
  if(!ui.selectedCaseId && cases.length) ui.selectedCaseId = cases[0].id;

  const selected = cases.find(c=>c.id===ui.selectedCaseId) || null;
  const reqItems = selected?.requiredItems || [];
  const reqItemsTxt = reqItems.length ? reqItems.join(", ") : "—";
  const reqLevel = selected ? (selected.requiredAgentLevel!=null ? selected.requiredAgentLevel : "—") : "—";
  const onFail = selected ? (selected.onFailDelta!=null ? selected.onFailDelta : 0) : 0;
  const onSucc = selected ? (selected.onSuccessDelta!=null ? selected.onSuccessDelta : 0) : 0;

  const palette = (typeof THEME_COLORS !== "undefined" ? THEME_COLORS : (window.THEME_COLORS||{}));
  const themeHex = palette[p.characterKey] || "#f8bd01";

  const phase = state.turn?.phase;
  const canAttempt = (!!selected && phase==="AFTER_ROLL" && (state.turn?.investigationsLeft||0)>0 && canActNow());
  const canPartner = (!!selected && (state.players||[]).length>1 && !p.partnerCallUsed);

  if(p.partnerCallUsed) ui.selectedPartnerId = null;

  const selectedPartner = ui.selectedPartnerId ? (state.players||[]).find(x=>x && x.id===ui.selectedPartnerId) : null;
  const hasPartner = !!selectedPartner;

  box.innerHTML = `
    <div style="font-weight:900; letter-spacing:.06em; text-transform:uppercase; margin-bottom:12px;">KIVÁLASZTOTT ÜGY</div>
    <div style="background:#fff; border-radius:12px; padding:14px; box-sizing:border-box; display:flex; flex-direction:column; justify-content:space-between; flex:1;">
      <div>
        <div style="font-weight:900; margin-bottom:10px; color:var(--theme-color);">${selected ? (selected.title||"Ügy") : "—"}</div>
        <div style="font-size:12px; color:#333; line-height:1.35;">
          ${selected ? (selected.funnyDesc||selected.desc||"(nincs leírás)") : "Válassz egy ügyet az ÜGYEK oszlopból."}
        </div>

        <div style="margin-top:10px; font-size:11px; color:#111; font-weight:900;">KÖVETELMÉNYEK</div>
        <div style="margin-top:8px; display:flex; gap:10px; font-size:11px;">
          <div style="flex:1; background:#f2f2f2; border-radius:10px; padding:8px;">
            <div style="font-weight:900; color:#111;">ÜGYNÖKSZINT</div>
            <div style="margin-top:4px; color:#333;">${reqLevel}</div>
          </div>
          <div style="flex:1; background:#f2f2f2; border-radius:10px; padding:8px;">
            <div style="font-weight:900; color:#111;">TÁRGYAK</div>
            <div style="margin-top:4px; color:#333;">${reqItemsTxt}</div>
          </div>
        </div>

        <div style="margin-top:10px; display:flex; gap:10px; font-size:11px;">
          <div style="flex:1; background:#f2f2f2; border-radius:10px; padding:8px;">
            <div style="font-weight:900; color:#111;">SIKER</div>
            <div style="margin-top:4px; color:#333;">+${onSucc} pont</div>
          </div>
          <div style="flex:1; background:#f2f2f2; border-radius:10px; padding:8px;">
            <div style="font-weight:900; color:#111;">BUKÁS</div>
            <div style="margin-top:4px; color:#333;">${onFail} pont</div>
          </div>
        </div>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; margin:10px 0 6px 0; font-size:11px; font-weight:900; color:#111;">
          <div>TOLVAJ</div><div>ÁLLAPOT</div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#333;">
          <div style="opacity:.55;">${selected ? "Ismeretlen" : "—"}</div>
          <div style="opacity:.55;">${selected ? "még nem derült ki" : ""}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:flex-end;">
        <div style="font-weight:900; color:var(--theme-color);">
          ${selected ? `${(p.agentLevel!=null?p.agentLevel:(p.level||0))}/${reqLevel}` : ""}
        </div>

        <div class="solveButtonsWrapper" style="display:flex; justify-content:flex-end; align-items:center; gap:10px;">
          <button class="btn" id="partnerBtn"
            style="height:40px; padding:0 16px; background:${hexToRgba(themeHex,0.75)}; color:#fff; border:1px solid rgba(255,255,255,.20);
                   ${canPartner ? "" : "opacity:.45; pointer-events:none;"}">TÁRS</button>

          <button class="btn btn-theme" id="solveBtn"
            style="height:40px; padding:0 16px; ${canAttempt ? "" : "opacity:.6; pointer-events:none;"}">MEGOLDOM</button>
        </div>
      </div>

      <div id="partnerLine" style="margin-top:8px; font-size:13px; font-weight:800; color:#111; min-height:18px; line-height:18px;">
        ${hasPartner ? `Társ: ${escapeHtml(selectedPartner.name)} <span id="clearPartner" style="margin-left:8px; opacity:.8; cursor:pointer;">×</span>`
                     : `<span style="visibility:hidden;">Társ: —</span>`}
      </div>
    </div>
  `;

  const solveBtn = box.querySelector("#solveBtn");
  if(solveBtn){
    solveBtn.onclick = ()=>{
      if(!selected) return;

      const payload = {
        caseId: selected.id,
        usedItemIds: Array.from(ui.usedItemIds),
        usedSkillIds: Array.from(ui.usedSkillIds),
        partnerId: hasPartner ? ui.selectedPartnerId : null,
      };

      if(IS_ONLINE){ sendAction('ATTEMPT_CASE', payload); return; }

      const r = window.Engine.attemptCase(state, payload);
      commit(r.next);

      resetUseSelections();
      const stillCases = (me().tableCards||[]).filter(c=>c.kind==="case");
      if(stillCases.length){
        if(!stillCases.find(c=>c.id===ui.selectedCaseId)) ui.selectedCaseId = stillCases[0].id;
      } else ui.selectedCaseId = null;
    };
  }

  const partnerBtn = box.querySelector("#partnerBtn");
  if(partnerBtn){
    partnerBtn.onclick = ()=>{
      if(!selected) return;
      showPartnerModal();
    };
  }

  const clr = box.querySelector("#clearPartner");
  if(clr){
    clr.onclick = ()=>{
      ui.selectedPartnerId = null;
      render();
    };
  }
}

/* --------- Columns (me.tableCards) --------- */
function renderColumns(){
  const p = me();
  if(!p) return;

  const cards = (p.tableCards||[]);
  const by = (k)=>cards.filter(c=>c.kind===k);
  const isDiscarding = state.turn?.phase === "DISCARDING";

  const colCases = document.getElementById("colCases");
  const colThieves = document.getElementById("colThieves");
  const colItems = document.getElementById("colItems");
  const colSkills = document.getElementById("colSkills");

  const renderList = (el, title, items, fmt, emptyHtml, headerColor)=>{
    if(!el) return;
    el.innerHTML = `
      <div style="padding:12px 12px 10px 12px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:${headerColor||'inherit'};">${title}</div>
      <div style="padding:0 12px 12px 12px; display:flex; flex-direction:column; gap:8px;">
        ${items.length ? items.map(fmt).join("") : emptyHtml}
      </div>
    `;
  };

  const cardSelected = (kind, id)=>{
    if(isDiscarding) return ui.discardIds.has(id);
    if(kind==="case") return ui.selectedCaseId===id;
    if(kind==="item") return ui.usedItemIds.has(id);
    if(kind==="skill") return ui.usedSkillIds.has(id);
    return false;
  };

  const clickableClass = (kind)=> (isDiscarding ? "discardable" : (kind==="thief" ? "" : "clickable"));

  renderList(colCases, "ÜGYEK", by("case"), (c)=>`
    <div class="miniCard ${clickableClass("case")} ${cardSelected("case",c.id) ? "selected":""}" data-kind="case" data-id="${c.id}" style="background:#fff; color:#111;">
      <div style="font-weight:900; font-size:12px;">${escapeHtml(c.title||"Ügy")}</div>
    </div>
  `, `<div class="miniCard" style="background:#fff; color:#111; opacity:.65;">(üres)</div>`);

  renderList(colThieves, "TOLVAJOK", by("thief"), (c)=>`
    <div class="miniCard ${isDiscarding ? "discardable":""} ${cardSelected("thief",c.id) ? "selected":""}"
      data-kind="thief" data-id="${c.id}" style="background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.25);">
      <div style="font-weight:900; font-size:12px;">${escapeHtml(c.thiefName||c.title||"Tolvaj")}</div>
    </div>
  `, `<div class="miniCard" style="background:rgba(255,255,255,.08); color:#fff; border:1px solid rgba(255,255,255,.2); opacity:.65;">(üres)</div>`, "#282828");

  const fixedItems = (p.fixedItems||[]).map(x=>Object.assign({_fixed:true}, x));
  const allItems = fixedItems.concat(by("item"));

  renderList(colItems, "TÁRGYAK", allItems, (c)=> c._fixed ? `
    <div class="miniCard" data-kind="fixedItem" data-id="${c.id}" style="background:rgba(255,255,255,.16); color:#fff; border:1px solid rgba(255,255,255,.28);">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-weight:900; font-size:12px;">${escapeHtml(c.name||"Tárgy")}</div>
        <div style="font-weight:900; font-size:10px; opacity:.95;">FIX</div>
      </div>
      ${c.rarity ? `<div style="font-size:11px; opacity:.85; margin-top:4px;">${escapeHtml(c.rarity)}</div>`:""}
    </div>
  ` : `
    <div class="miniCard ${clickableClass("item")} ${cardSelected("item",c.id) ? "selected":""}"
      data-kind="item" data-id="${c.id}" style="background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.25);">
      <div style="font-weight:900; font-size:12px;">${escapeHtml(c.name||c.title||"Tárgy")}</div>
      ${c.rarity ? `<div style="font-size:11px; opacity:.85; margin-top:4px;">${escapeHtml(c.rarity)}</div>`:""}
    </div>
  `, `<div class="miniCard" style="background:rgba(255,255,255,.08); color:#fff; border:1px solid rgba(255,255,255,.2); opacity:.65;">(üres)</div>`, "#282828");

  renderList(colSkills, "KÉPESSÉGEK", by("skill"), (c)=>`
    <div class="miniCard ${clickableClass("skill")} ${cardSelected("skill",c.id) ? "selected":""}"
      data-kind="skill" data-id="${c.id}" style="background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.25); display:flex; justify-content:space-between; align-items:center;">
      <div style="font-weight:900; font-size:12px;">${escapeHtml(c.name||c.title||"Képesség")}</div>
      <div style="font-weight:900;">${c.bonus!=null ? `+${c.bonus}` : ""}</div>
    </div>
  `, `<div class="miniCard" style="background:rgba(255,255,255,.08); color:#fff; border:1px solid rgba(255,255,255,.2); opacity:.65;">(üres)</div>`, "#282828");

  document.querySelectorAll(".miniCard.clickable, .miniCard.discardable").forEach(el=>{
    el.onclick = ()=>{
      const kind = el.getAttribute("data-kind");
      const id = el.getAttribute("data-id");

      if(isDiscarding){
        if(ui.discardIds.has(id)) ui.discardIds.delete(id);
        else ui.discardIds.add(id);
        render();
        return;
      }

      if(kind==="case"){
        ui.selectedCaseId = id;
        ui.selectedPartnerId = null;
        resetUseSelections();
        render();
        return;
      }
      if(kind==="item"){
        if(ui.usedItemIds.has(id)) ui.usedItemIds.delete(id);
        else ui.usedItemIds.add(id);
        render();
        return;
      }
      if(kind==="skill"){
        if(ui.usedSkillIds.has(id)) ui.usedSkillIds.delete(id);
        else ui.usedSkillIds.add(id);
        render();
        return;
      }
    };
  });

  const hl = document.getElementById("handLimit");
  if(hl){
    const lim = (p.handLimit!=null ? p.handLimit : 5);
    const need = Math.max(0, (p.tableCards||[]).length - lim);
    const extra = (state.turn?.phase==="DISCARDING") ? ` — dobj el: ${need} (kijelölve: ${ui.discardIds.size})` : "";
    hl.textContent = `Kézlimit: ${(p.tableCards||[]).length} / ${lim}${extra}`;
  }
}

/* --------- Solved (me) --------- */
function renderSolved(){
  const box = document.getElementById("solved");
  if(!box) return;

  const p = me();
  if(!p) return;

  const solved = (p.solvedCases||[]);
  const captured = new Set((p.capturedThieves||[]).map(t=>t.thiefName));
  const rows = solved.slice(-8).reverse();

  box.innerHTML = `
    <div style="font-weight:900; letter-spacing:.06em; text-transform:uppercase; margin-bottom:12px;">MEGOLDOTT ÜGYEK</div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${rows.length ? rows.map((c)=>{
        const isCap = !!(c.thiefName && captured.has(c.thiefName));
        const bg = isCap ? "var(--theme-color)" : "#fff";
        const titleColor = isCap ? "#fff" : "#282828";
        const thiefColor = isCap ? "#fff" : "#111";
        return `
          <div style="height:34px; border-radius:10px; background:${bg}; display:flex; align-items:center; justify-content:space-between; padding:0 14px; font-weight:900; font-size:12px;">
            <div style="color:${titleColor};">${escapeHtml(c.title||"Ügy")}</div>
            <div style="color:${thiefColor};">${c.thiefName ? escapeHtml(c.thiefName) : "ELFOGÁSRA VÁRÓ TOLVAJ"}</div>
          </div>
        `;
      }).join("") : ``}
    </div>
  `;
}

/* --------- Other players bar --------- */
function renderPlayersBar(){
  const wrap = document.getElementById("playersBar");
  if(!wrap) return;

  const players = state.players || [];
  const myIdx = PLAYER_INDEX;

  const others = players.map((pl,i)=>({pl,i}))
    .filter(x => x.i !== myIdx)
    .slice(0,3);

  wrap.innerHTML = others.map(({pl,i})=>{
    const solved = (pl.solvedCases || []);
    const capturedSet = new Set((pl.capturedThieves || []).map(t=>t.thiefName));
    const solvedCount = solved.length;
    const capturedCount = (pl.capturedThieves || []).length;

    const wanted = [];
    for(const c of solved){
      if(!c || !c.thiefName) continue;
      if(!capturedSet.has(c.thiefName)) wanted.push(c.thiefName);
    }
    const uniqWanted = Array.from(new Set(wanted)).slice(0, 6);

    const elimClass = pl.eliminated ? " eliminated" : "";
    return `
      <div class="playerMiniCard${elimClass}" style="background:var(--panel);">
        ${pl.eliminated ? `<div class="pmcElimTag">KIESETT</div>` : ``}
        <div class="pmcTop">
          <div>
            <div class="pmcName">${escapeHtml(pl.name || ("Ügynök "+(i+1)))}</div>
            <div class="pmcChar">${escapeHtml(pl.characterName || pl.characterKey || "")}</div>
          </div>
          <div class="pmcLevel">${Number.isFinite(pl.agentLevel) ? pl.agentLevel : ""}</div>
        </div>

        <div class="pmcStats">
          <div>MEGOLDOTT ÜGYEK: <b>${solvedCount}</b></div>
          <div>ELFOGOTT TOLVAJOK: <b>${capturedCount}</b></div>
        </div>

        <div class="pmcWantedTitle">KÖRÖZÉSI LISTA</div>
        <div class="pmcPills">
          ${uniqWanted.map(n=>`<span class="pmcPill">${escapeHtml(n)}</span>`).join("")}
        </div>
      </div>
    `;
  }).join("");
}

/* --------- Help modal --------- */
function getHelpText(){
  const phase = state?.turn?.phase || "";
  if(IS_ONLINE && !isMyTurn()) return "Most nem te vagy soron. Várd meg a körödet.";
  if(phase==="AWAIT_DRAW") return "Következő lépés: HÚZÁS (+3 lap).";
  if(phase==="AWAIT_ROLL") return "Következő lépés: DOBÁS.";
  if(phase==="AFTER_ROLL") return "Következő lépés: válassz ügyet, jelölj ki tárgyakat/képességeket és MEGOLDOM, vagy PASSZ.";
  if(phase==="DISCARDING") return "Következő lépés: jelöld ki a szükséges számú lapot eldobásra, majd ELDOBÁS.";
  if(phase==="GAME_OVER") return "A játék véget ért.";
  return "Következő lépés: nézd meg a gombokat (HÚZÁS / DOBÁS / MEGOLDOM / PASSZ).";
}

function showHelpModal(){
  const modal = document.getElementById("helpModal");
  const textEl = document.getElementById("helpModalText");
  if(!modal || !textEl) return;

  const base = getHelpText();
  const extra = (ui.statusMsg || "").trim();
  textEl.style.whiteSpace = "pre-line";
  textEl.textContent = extra ? `${base}\n\n${extra}` : base;

  const card = modal.querySelector(".winModalCard");
  if(card){
    card.style.background = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || "var(--theme-color)";
  }
  modal.style.display = "flex";
}
function hideHelpModal(){
  const modal = document.getElementById("helpModal");
  if(modal) modal.style.display = "none";
}

/* --------- Partner modal --------- */
function showPartnerModal(){
  const p = me();
  if(!p || p.partnerCallUsed) return;

  const others = (state.players||[]).filter(x=>x && x.id!==p.id && !x.eliminated);
  if(!others.length) return;

  const modal = document.getElementById("partnerModal");
  const list = document.getElementById("partnerModalList");
  if(!modal || !list) return;

  list.innerHTML = others.map(op=>`<button class="btn btn-inverse partnerChoice" data-pid="${op.id}" style="min-width:220px;">${escapeHtml(op.name||op.id)}</button>`).join("");
  modal.style.display = "flex";

  const cancel = document.getElementById("partnerCancel");
  if(cancel) cancel.onclick = ()=>{ modal.style.display = "none"; };

  list.querySelectorAll("[data-pid]").forEach(btn=>{
    btn.onclick = (e)=>{
      const pid = e.currentTarget.getAttribute("data-pid");
      ui.selectedPartnerId = pid;
      modal.style.display = "none";
      render();
    };
  });

  const card = modal.querySelector(".winModalCard");
  if(card) card.onclick = (e)=>e.stopPropagation();
  modal.onclick = ()=>{ modal.style.display="none"; };
}

/* --------- Profiler peek --------- */
function cardLabelForProfiler(c){
  if(!c) return "—";
  if(c.kind==="case") return `ÜGY: ${c.title||""}`.trim();
  if(c.kind==="thief") return `TOLVAJ: ${c.thiefName||""}`.trim();
  if(c.kind==="skill") {
    const b = (typeof c.bonus==="number") ? c.bonus : 0;
    const bonusTxt = b ? ` (+${b})` : ``;
    return `KÉPESSÉG: ${c.name||""}${bonusTxt}`.trim();
  }
  return String(c.kind||"?");
}

function showProfilerPeekModal(){
  const p = me();
  const phase = state?.turn?.phase;
  const ok = (p && p.characterKey==="PROFILER" && p.flags && p.flags.profilerPeekAvailable && !p.flags.profilerPeekUsed
    && (phase==="AWAIT_ROLL" || phase==="AFTER_ROLL"));
  if(!ok) return;
  const top2 = state && state.mixedDeckTop2;
  if(!(top2 && Array.isArray(top2) && top2.length>=2)) return;

  const modal = document.getElementById('profilerModal');
  const textEl = document.getElementById('profilerModalText');
  const k1 = document.getElementById('profilerKeep1');
  const k2 = document.getElementById('profilerKeep2');
  const cancel = document.getElementById('profilerCancel');
  if(!modal || !textEl || !k1 || !k2 || !cancel) return;

  const a = top2[0];
  const b = top2[1];

  textEl.innerHTML =
    `A vegyes pakli tetején ez a 2 lap van:<br><br>`+
    `<b>1)</b> ${escapeHtml(cardLabelForProfiler(a))}<br>`+
    `<b>2)</b> ${escapeHtml(cardLabelForProfiler(b))}<br><br>`+
    `Válaszd ki, melyik maradjon <b>felül</b>. A másik <b>alulra</b> kerül.`;

  const close = ()=>{ modal.style.display = 'none'; };
  cancel.onclick = close;
  modal.onclick = (e)=>{ if(e && e.target===modal) close(); };
  const cardEl = modal.querySelector('.winModalCard');
  if(cardEl) cardEl.onclick = (e)=>e.stopPropagation();

  k1.onclick = ()=>{
    if(!canActNow()) return;
    if(IS_ONLINE){ sendAction('PROFILER_PEEK', { keep: 1 }); close(); return; }
    const r = window.Engine.profilerPeek(state, {keep:1});
    close();
    if(r && r.next) commit(r.next);
  };
  k2.onclick = ()=>{
    if(!canActNow()) return;
    if(IS_ONLINE){ sendAction('PROFILER_PEEK', { keep: 2 }); close(); return; }
    const r = window.Engine.profilerPeek(state, {keep:2});
    close();
    if(r && r.next) commit(r.next);
  };

  modal.style.display = 'flex';
}

/* --------- Win / kick modals (unchanged behaviour) --------- */
function showWinModal(playerName){
  const modal = document.getElementById("winModal");
  const nameEl = document.getElementById("winModalName");
  if(!modal || !nameEl) return;
  nameEl.textContent = playerName ? `(${playerName})` : "";
  const card = modal.querySelector(".winModalCard");
  if(card){
    const col = (state?.winner?.color) ? state.winner.color : (getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || "var(--theme-color)");
    card.style.background = col;
  }
  modal.style.display = "flex";
}
function hideWinModal(){
  const modal = document.getElementById("winModal");
  if(modal) modal.style.display = "none";
}

function showKickModal(playerName){
  const modal = document.getElementById("kickModal");
  const nameEl = document.getElementById("kickModalName");
  if(!modal || !nameEl) return;
  nameEl.textContent = playerName ? `(${playerName})` : "";
  const card = document.getElementById("kickModalCard") || modal.querySelector(".winModalCard");
  if(card){
    const col = (state?._lastEliminated?.color) ? state._lastEliminated.color : (getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || "var(--theme-color)");
    card.style.background = col;
  }
  modal.style.display = "flex";
}
function hideKickModal(){
  const modal = document.getElementById("kickModal");
  if(modal) modal.style.display = "none";
}

function checkWinCondition(){
  try{
    if(state?.turn?.phase==="GAME_OVER" && state.winner && !ui._winShown){
      ui._winShown = true;
      showWinModal(state.winner.name || "");
    }
  }catch(e){}
}

function checkEliminationCondition(){
  try{
    if(!state || !state._lastEliminated) return;
    if(ui._kickShownId === state._lastEliminated.id) return;
    ui._kickShownId = state._lastEliminated.id;
    showKickModal(state._lastEliminated.name || "");
  }catch(e){}
}

/* --------- Main render --------- */
function render(){
  applyTheme();
  renderHeader();
  renderDecks();
  renderRoll();
  renderCase();
  renderColumns();
  renderSolved();
  renderPlayersBar();

  // PASSZ + ELDOBÁS
  const passBtn = document.getElementById("passBtn");
  const discardBtn = document.getElementById("discardBtn");

  if(passBtn){
    passBtn.disabled = IS_ONLINE ? !canActNow() : false;
    passBtn.onclick = ()=>{
      if(IS_ONLINE){
        if(!canActNow()) return;
        sendAction('PASS');
        return;
      }
      const res = window.Engine.beginPassToEndTurn(state);
      commit(res.next);
      if(res.log) setStatus(res.log);
    };
  }

  if(discardBtn){
    discardBtn.disabled = IS_ONLINE ? !canActNow() : false;
    discardBtn.onclick = ()=>{
      if(!state.turn || state.turn.phase!=="DISCARDING"){
        setStatus("Előbb PASSZ, majd jelöld ki az eldobandó lapokat.");
        return;
      }

      const p = me();
      const lim = (p.handLimit!=null ? p.handLimit : 5);
      const need = Math.max(0, (p.tableCards||[]).length - lim);

      if(ui.discardIds.size !== need){
        setStatus(`Pontosan ${need} lapot jelölj ki eldobásra. (Most: ${ui.discardIds.size})`);
        return;
      }

      if(IS_ONLINE){
        if(!canActNow()) return;
        sendAction('END_TURN', { discardIds: Array.from(ui.discardIds) });
        resetDiscardSelections();
        resetUseSelections();
        ui.selectedCaseId = null;
        ui.selectedPartnerId = null;
        return;
      }

      const res = window.Engine.endTurn(state, Array.from(ui.discardIds));
      resetDiscardSelections();
      resetUseSelections();
      ui.selectedCaseId = null;
      ui.selectedPartnerId = null;
      commit(res.next);
      if(res.log) setStatus(res.log);
    };
  }

  checkWinCondition();
  checkEliminationCondition();
}

/* --------- Boot --------- */
attachSocket();
render();

document.addEventListener("DOMContentLoaded", ()=>{
  const ok = document.getElementById("winModalOk");
  if(ok) ok.onclick = hideWinModal;

  const ok2 = document.getElementById("kickModalOk");
  if(ok2) ok2.onclick = ()=>{
    hideKickModal();
    if(IS_ONLINE){ sendAction('ACK_ELIMINATION'); return; }
    if(window.Engine && typeof window.Engine.ackElimination==="function"){
      const r = window.Engine.ackElimination(state);
      if(r && r.next){
        resetDiscardSelections();
        resetUseSelections();
        ui.selectedCaseId = null;
        ui.selectedPartnerId = null;
        commit(r.next);
        if(r.log) setStatus(r.log);
      }
    }
  };

  const ok3 = document.getElementById("helpModalOk");
  if(ok3) ok3.onclick = hideHelpModal;
});
