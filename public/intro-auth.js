(async function(){
  const qs = (s)=>document.querySelector(s);
  const authStatus = qs('#authStatus');
  const authOpenBtn = qs('#authOpenBtn');
  const authLogoutBtn = qs('#authLogoutBtn');
  const authModal = qs('#authModal');
  const authCloseBtn = qs('#authCloseBtn');
  const tabLogin = qs('#tabLogin');
  const tabRegister = qs('#tabRegister');
  const loginForm = qs('#loginForm');
  const registerForm = qs('#registerForm');
  const forgotForm = qs('#forgotForm');
  const forgotBtn = qs('#forgotBtn');
  const backToLoginBtn = qs('#backToLoginBtn');
  const authMsg = qs('#authMsg');
  const hostLink = qs('#hostLink');

  function showMsg(t){ authMsg.textContent = t || ''; }

  function openModal(mode){
    authModal.style.display = 'flex';
    setMode(mode || 'login');
  }
  function closeModal(){ authModal.style.display = 'none'; showMsg(''); }

  function setMode(mode){
    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot = mode === 'forgot';

    tabLogin.className = 'btn ' + (isLogin ? 'btn-theme' : 'btn-outline');
    tabRegister.className = 'btn ' + (isRegister ? 'btn-theme' : 'btn-outline');

    loginForm.style.display = isLogin ? 'block' : 'none';
    registerForm.style.display = isRegister ? 'block' : 'none';
    forgotForm.style.display = isForgot ? 'block' : 'none';
  }

  async function getMe(){
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if(!r.ok) return null;
    return await r.json().catch(()=>null);
  }

  async function refreshMe(){
    const me = await getMe();
    if(me && me.user){
      authStatus.textContent = `Belépve: ${me.user.name || me.user.email}`;
      authOpenBtn.style.display = 'none';
      authLogoutBtn.style.display = 'inline-block';
      return true;
    } else {
      authStatus.textContent = 'Vendég mód (Hosthoz be kell lépni)';
      authOpenBtn.style.display = 'inline-block';
      authLogoutBtn.style.display = 'none';
      return false;
    }
  }

  // Intercept host link: require login
  if(hostLink){
    hostLink.addEventListener('click', async (e)=>{
      const ok = await refreshMe();
      if(!ok){
        e.preventDefault();
        openModal('login');
        showMsg('Szoba létrehozásához be kell jelentkezned.');
      }
    });
  }

  authOpenBtn && authOpenBtn.addEventListener('click', ()=>openModal('login'));
  authCloseBtn && authCloseBtn.addEventListener('click', closeModal);
  authModal && authModal.addEventListener('click', (e)=>{ if(e.target === authModal) closeModal(); });

  tabLogin && tabLogin.addEventListener('click', ()=>{ showMsg(''); setMode('login'); });
  tabRegister && tabRegister.addEventListener('click', ()=>{ showMsg(''); setMode('register'); });

  forgotBtn && forgotBtn.addEventListener('click', ()=>{ showMsg(''); setMode('forgot'); });
  backToLoginBtn && backToLoginBtn.addEventListener('click', ()=>{ showMsg(''); setMode('login'); });

  loginForm && loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    showMsg('Belépés…');
    const fd = new FormData(loginForm);
    const body = Object.fromEntries(fd.entries());
    const r = await fetch('/api/auth/login', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(()=>null);
    if(!r.ok){
      showMsg((data && (data.error || data.message)) || 'Hiba a belépésnél');
      return;
    }
    showMsg('Sikeres belépés.');
    await refreshMe();
    closeModal();
  });

  registerForm && registerForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    showMsg('Regisztráció…');
    const fd = new FormData(registerForm);
    const body = Object.fromEntries(fd.entries());
    const r = await fetch('/api/auth/register', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(()=>null);
    if(!r.ok){
      showMsg((data && (data.error || data.message)) || 'Hiba a regisztrációnál');
      return;
    }
    showMsg('Regisztráció kész. Nézd meg az emailed a megerősítő linkért.');
  });

  forgotForm && forgotForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    showMsg('Küldés…');
    const fd = new FormData(forgotForm);
    const body = Object.fromEntries(fd.entries());
    const r = await fetch('/api/auth/forgot', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(()=>null);
    if(!r.ok){
      showMsg((data && (data.error || data.message)) || 'Hiba');
      return;
    }
    showMsg('Ha létezik fiók, küldtünk reset linket emailben.');
    setMode('login');
  });

  authLogoutBtn && authLogoutBtn.addEventListener('click', async ()=>{
    await fetch('/api/auth/logout', { method:'POST', credentials:'include' }).catch(()=>{});
    await refreshMe();
  });

  // Open modal automatically if ?auth=1
  const params = new URLSearchParams(location.search);
  if(params.get('auth') === '1') openModal('login');

  await refreshMe();
})();
