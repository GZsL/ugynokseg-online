const THEME_COLORS = {
  NEMESIS: "#e7a9b4",
  DAREDEVIL: "#fed008",
  VETERAN: "#373536",
  PROFILER: "#2fa2a3",
  STRATEGIST: "#1c4429",
  LOGISTIC: "#cf3c4a",
};

function setThemeColor(hex){
  document.documentElement.style.setProperty("--theme-color", hex);
}

function _stateKey(){
  try{
    const params = new URLSearchParams(location.search);
    const room = (params.get('room')||'').toUpperCase();
    const token = (params.get('token')||'').trim();
    const player = (params.get('player')||'');
    if(room){
      // Online (token) mode: key by token to avoid mixing states between users.
      if(token) return `gameState_${room}_tok_${token}`;
      return `gameState_${room}_${player||'0'}`;
    }
  }catch(e){}
  return "gameState";
}
function loadState(){
  try{ return JSON.parse(localStorage.getItem(_stateKey())||"null"); }catch(e){ return null; }
}
function saveState(state){
  try{ localStorage.setItem(_stateKey(), JSON.stringify(state)); }catch(e){}
}
function clearState(){
  try{ localStorage.removeItem(_stateKey()); }catch(e){}
}

// ============================
// Session helpers (internet-ready)
// Store the last joined room + token so the user can refresh/resume.
// ============================

const __SESSION_KEY = 'ugn_session_v1';

function setSession(room, token){
  try{
    const r = String(room||'').trim().toUpperCase();
    const t = String(token||'').trim();
    if(!r || !t) return;
    localStorage.setItem(__SESSION_KEY, JSON.stringify({ room: r, token: t, ts: Date.now() }));
  }catch(e){}
}

function getSession(){
  try{
    const raw = localStorage.getItem(__SESSION_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    if(!s || !s.room || !s.token) return null;
    return { room: String(s.room).toUpperCase(), token: String(s.token), ts: s.ts || 0 };
  }catch(e){
    return null;
  }
}

function clearSession(){
  try{ localStorage.removeItem(__SESSION_KEY); }catch(e){}
}

function getRoomFromUrl(){
  try{ return (new URLSearchParams(location.search).get('room')||'').trim().toUpperCase(); }catch(e){ return ''; }
}

function getTokenFromUrl(){
  try{ return (new URLSearchParams(location.search).get('token')||'').trim(); }catch(e){ return ''; }
}

function ensureTokenInUrlOrRedirect(targetPage){
  // If room is in URL but token is missing, try to restore from session and redirect.
  try{
    const room = getRoomFromUrl();
    const token = getTokenFromUrl();
    if(!room || token) return false;
    const s = getSession();
    if(s && s.room === room && s.token){
      const to = targetPage || location.pathname.split('/').pop() || 'lobby.html';
      location.replace(`${to}?room=${encodeURIComponent(room)}&token=${encodeURIComponent(s.token)}`);
      return true;
    }
  }catch(e){}
  return false;
}



function toast(msg, ms=1800){
  try{
    msg = String(msg==null?"":msg);
    console.log("[toast]", msg);
    let el = document.getElementById("__toast");
    if(!el){
      el = document.createElement("div");
      el.id="__toast";
      el.style.position="fixed";
      el.style.left="20px";
      el.style.bottom="20px";
      el.style.zIndex="99999";
      el.style.maxWidth="60vw";
      el.style.padding="10px 12px";
      el.style.borderRadius="10px";
      el.style.background="rgba(0,0,0,.78)";
      el.style.color="#fff";
      el.style.fontWeight="700";
      el.style.fontSize="14px";
      el.style.boxShadow="0 8px 30px rgba(0,0,0,.35)";
      el.style.display="none";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display="block";
    clearTimeout(el.__t);
    el.__t = setTimeout(()=>{ el.style.display="none"; }, ms);
  }catch(e){
    try{ alert(msg); }catch(_){}
  }
}
