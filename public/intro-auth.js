// Intro auth modal handler (styled inputs + safe API calls)
(function () {
  const modal = document.getElementById("authModal");
  if (!modal) return;

  const tabLogin = document.getElementById("authTabLogin");
  const tabRegister = document.getElementById("authTabRegister");
  const closeBtn = document.getElementById("authCloseBtn");

  const boxLogin = document.getElementById("authBoxLogin");
  const boxRegister = document.getElementById("authBoxRegister");
  const boxForgot = document.getElementById("authBoxForgot");

  const msg = document.getElementById("authMsg");
  const whoami = document.getElementById("authWhoami");

  const btnHost = document.getElementById("btnHost") || document.querySelector('[data-action="host"]');

  function showModal(mode) {
    modal.classList.add("open");
    select(mode || "login");
    msg.textContent = "";
    msg.classList.remove("error", "ok");
  }

  function hideModal() {
    modal.classList.remove("open");
  }

  function select(mode) {
    tabLogin.classList.toggle("active", mode === "login");
    tabRegister.classList.toggle("active", mode === "register");

    boxLogin.style.display = mode === "login" ? "block" : "none";
    boxRegister.style.display = mode === "register" ? "block" : "none";
    boxForgot.style.display = mode === "forgot" ? "block" : "none";
  }

  tabLogin?.addEventListener("click", () => select("login"));
  tabRegister?.addEventListener("click", () => select("register"));
  closeBtn?.addEventListener("click", hideModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });

  // expose for other pages
  window.openAuthModal = showModal;

  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body || {})
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      throw new Error(data?.error || `Hiba (${res.status})`);
    }
    return data;
  }

  function setMsg(text, kind) {
    msg.textContent = text || "";
    msg.classList.remove("error", "ok");
    if (kind) msg.classList.add(kind);
  }

  async function refreshMe() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json();
      if (res.ok && data?.ok) {
        whoami.textContent = `Belépve: ${data.user?.name || data.user?.email || data.user?.id}`;
        document.documentElement.dataset.authed = "1";
        return true;
      }
    } catch {}
    whoami.textContent = "Vendég mód";
    document.documentElement.dataset.authed = "0";
    return false;
  }

  // login
  document.getElementById("authLoginBtn")?.addEventListener("click", async () => {
    const email = document.getElementById("authLoginEmail")?.value || "";
    const password = document.getElementById("authLoginPassword")?.value || "";
    setMsg("Beléptetés…");
    try {
      await api("/api/auth/login", { email, password });
      await refreshMe();
      setMsg("Sikeres belépés.", "ok");
      setTimeout(hideModal, 450);
    } catch (err) {
      setMsg(err.message || "Hiba", "error");
    }
  });

  // register
  document.getElementById("authRegisterBtn")?.addEventListener("click", async () => {
    const name = document.getElementById("authRegName")?.value || "";
    const email = document.getElementById("authRegEmail")?.value || "";
    const password = document.getElementById("authRegPassword")?.value || "";
    setMsg("Regisztráció…");
    try {
      const r = await api("/api/auth/register", { name, email, password });
      await refreshMe();
      if (r?.mailOk === false) {
        setMsg("Fiók létrehozva. Email küldés nem sikerült (SMTP).", "ok");
      } else {
        setMsg("Fiók létrehozva. Nézd meg a leveleid a megerősítéshez.", "ok");
      }
      // keep modal open so user sees message
    } catch (err) {
      setMsg(err.message || "Hiba", "error");
    }
  });

  // forgot
  document.getElementById("authForgotLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    setMsg("");
    select("forgot");
  });

  document.getElementById("authForgotBtn")?.addEventListener("click", async () => {
    const email = document.getElementById("authForgotEmail")?.value || "";
    setMsg("Küldés…");
    try {
      await api("/api/auth/forgot", { email });
      setMsg("Ha létezik a fiók, elküldtük a visszaállító linket.", "ok");
    } catch (err) {
      setMsg(err.message || "Hiba", "error");
    }
  });

  // host gate
  btnHost?.addEventListener("click", async (e) => {
    const authed = await refreshMe();
    if (!authed) {
      e.preventDefault();
      showModal("login");
    }
  });

  refreshMe();

  // verified param
  const params = new URLSearchParams(location.search);
  if (params.get("verified") === "1") {
    showModal("login");
    setMsg("Email megerősítve, most be tudsz lépni.", "ok");
  }
})();
