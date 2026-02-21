(async function(){
  const msg = document.getElementById('msg');
  const p = document.getElementById('p');

  function show(x){
    if(msg) msg.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2);
  }

  async function post(url, body){
    const r = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify(body||{})
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw j;
    return j;
  }

  const form = document.getElementById('f');
  const page = location.pathname.split('/').pop();

  if(page === 'verify.html'){
    const token = new URLSearchParams(location.search).get('token');
    try{
      await post('/api/auth/verify', { token });
      if(p) p.textContent = 'Sikeres megerősítés. Most már beléphetsz.';
    }catch(e){
      if(p) p.textContent = 'Hiba a megerősítésnél.';
      show(e);
    }
    return;
  }

  if(page === 'reset.html'){
    const token = new URLSearchParams(location.search).get('token');
    form?.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const fd = new FormData(form);
      try{
        await post('/api/auth/reset', { token, newPassword: fd.get('newPassword') });
        show('Kész. Most már beléphetsz.');
      }catch(e){ show(e); }
    });
    return;
  }

  form?.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const fd = new FormData(form);
    try{
      if(page === 'login.html'){
        const out = await post('/api/auth/login', { email: fd.get('email'), password: fd.get('password') });
        show(out);
        setTimeout(()=>location.href='intro.html', 600);
      } else if(page === 'register.html'){
        const out = await post('/api/auth/register', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') });
        show(out.emailSent ? 'Regisztráció kész. Nézd meg az emailed a megerősítő linkért.' : 'Regisztráció kész. (APP_URL nincs beállítva, ezért nem ment email.)');
      } else if(page === 'forgot.html'){
        const out = await post('/api/auth/forgot', { email: fd.get('email') });
        show('Ha létezik a fiók, küldtünk emailt a visszaállításhoz.');
      }
    }catch(e){ show(e); }
  });
})();
