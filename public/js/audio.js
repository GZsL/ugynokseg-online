// Simple MP3 SFX manager with autoplay-policy unlock
window.AudioManager = (function(){
  const files = {
    dice:   '/assets/sfx/dice.mp3',
    draw:   '/assets/sfx/draw.mp3',
    pass:   '/assets/sfx/pass.mp3',
    success:'/assets/sfx/success.mp3',
    siren:  '/assets/sfx/siren.mp3',
    turn:   '/assets/sfx/turn.mp3'
    winner: '/assets/sfx/winner.mp3',
  };

  const bank = {};
  let unlocked = false;

  function _make(name){
    const a = new Audio(files[name]);
    a.preload = 'auto';
    a.volume = 0.75;
    return a;
  }

  function preload(){
    Object.keys(files).forEach(k=>{
      if(!bank[k]) bank[k] = _make(k);
    });
  }

  function unlock(){
    if(unlocked) return;
    unlocked = true;
    // attempt to play/pause a silent frame to satisfy policies
    try{
      preload();
      const a = bank.turn;
      a.volume = 0.0;
      a.currentTime = 0;
      const p = a.play();
      if(p && typeof p.then === 'function'){
        p.then(()=>{ a.pause(); a.currentTime = 0; a.volume = 0.75; }).catch(()=>{ a.pause(); a.volume = 0.75; });
      } else {
        a.pause(); a.volume = 0.75;
      }
    }catch(e){}
  }

  function play(name){
    try{
      if(!bank[name]) bank[name] = _make(name);
      const a = bank[name];
      // allow overlap by cloning if already playing
      const use = (a && !a.paused && a.currentTime > 0.02) ? _make(name) : a;
      use.currentTime = 0;
      use.play().catch(()=>{});
    }catch(e){}
  }

  // arm unlock on first user interaction
  window.addEventListener('pointerdown', unlock, { once:true, passive:true });
  window.addEventListener('keydown', unlock, { once:true });

  // eager preload (safe even if not unlocked)
  try{ preload(); }catch(e){}

  return { play, preload, unlock };
})();
