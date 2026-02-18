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

function loadState(){
  try{ return JSON.parse(localStorage.getItem("gameState")||"null"); }catch(e){ return null; }
}
function saveState(state){
  localStorage.setItem("gameState", JSON.stringify(state));
}
function clearState(){
  localStorage.removeItem("gameState");
}
