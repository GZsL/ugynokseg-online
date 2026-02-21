// ✅ Host oldal: csak belépett felhasználónak
(async function requireLoginForHostPage() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "include" });
    const j = await r.json().catch(() => ({ user: null }));

    if (!j.user) {
      location.href = "/login.html?next=/host.html";
      return;
    }

    // opcionális: auto kitöltjük a nevet, ha üres
    const nameInput = document.getElementById("name");
    if (nameInput && !nameInput.value) {
      nameInput.value = j.user.name || "";
    }
  } catch (e) {
    location.href = "/login.html?next=/host.html";
  }
})();

const CHARACTERS = [
  { key: "VETERAN", name: "Veterán", img: "assets/characters/veteran.png" },
  { key: "LOGISTIC", name: "Logisztikus", img: "assets/characters/logisztikus.png" },
  { key: "STRATEGIST", name: "Stratéga", img: "assets/characters/stratega.png" },
  { key: "PROFILER", name: "Profilozó", img: "assets/characters/profilozo.png" },
  { key: "NEMESIS", name: "Nemezis vadász", img: "assets/characters/nemezisvadasz.png" },
  { key: "DAREDEVIL", name: "Vakmerő", img: "assets/characters/vakmero.png" },
];

let picked = "VETERAN";

function renderChars() {
  const grid = document.getElementById("charGrid");
  if (!grid) return;
  grid.innerHTML = "";

  CHARACTERS.forEach((ch) => {
    const card = document.createElement("div");
    card.className = "charCard" + (picked === ch.key ? " picked" : "");

    const imgWrap = document.createElement("div");
    imgWrap.className = "charImg";
    const img = document.createElement("img");
    img.src = ch.img;
    img.alt = ch.name;
    imgWrap.appendChild(img);

    const btn = document.createElement("button");
    btn.className = "btn pickBtn";
    const color =
      typeof THEME_COLORS === "object" && THEME_COLORS[ch.key]
        ? THEME_COLORS[ch.key]
        : "#f8bd01";

    btn.style.background = color;
    btn.style.color = "#111";
    btn.textContent = picked === ch.key ? "Kiválasztva" : "Választom";
    btn.onclick = () => {
      picked = ch.key;
      renderChars();
    };

    card.appendChild(imgWrap);
    card.appendChild(btn);
    grid.appendChild(card);
  });
}

async function createRoom() {
  const name = (document.getElementById("name")?.value || "").trim();
  const maxPlayers = document.getElementById("maxPlayers")?.value || "4";
  const password = (document.getElementById("password")?.value || "").trim();

  if (!name) {
    alert("Adj meg nevet.");
    return;
  }
  if (!picked) {
    alert("Válassz karaktert.");
    return;
  }

  const res = await fetch("/api/create-room-lobby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name,
      characterKey: picked,
      maxPlayers: parseInt(maxPlayers, 10),
      password: password || null,
    }),
  });

  // ✅ ha nincs login / invalid token: dobjuk loginra
  if (res.status === 401) {
    location.href = "/login.html?next=/host.html";
    return;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.room || !data.token) {
    const msg = (data && data.error) ? data.error : "Nem sikerült szobát létrehozni.";
    alert(msg);
    return;
  }

  location.href = `lobby.html?room=${encodeURIComponent(data.room)}&token=${encodeURIComponent(
    data.token
  )}`;
}

document.getElementById("create")?.addEventListener("click", () => {
  createRoom().catch((e) => {
    console.error(e);
    alert("Hiba a szerver elérésekor.");
  });
});

renderChars();