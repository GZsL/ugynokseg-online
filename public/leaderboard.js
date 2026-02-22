async function loadLeaderboard() {
  const statusPill = document.getElementById("statusPill");
  const loading = document.getElementById("loading");
  const errorBox = document.getElementById("errorBox");
  const tbl = document.getElementById("tbl");
  const tbody = document.getElementById("tbody");
  const limitSel = document.getElementById("limitSel");

  errorBox.style.display = "none";
  tbl.style.display = "none";
  loading.style.display = "block";
  statusPill.textContent = "Betöltés…";

  const limit = limitSel?.value || "50";

  try {
    const res = await fetch(`/api/leaderboard?limit=${encodeURIComponent(limit)}`, {
      credentials: "include"
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Nem sikerült betölteni a ranglistát.");
    }

    const items = data.items || [];
    tbody.innerHTML = "";

    items.forEach((it, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(it.displayName || it.userId || "")}</td>
        <td class="right">${it.wins ?? 0}</td>
        <td class="right">${it.losses ?? 0}</td>
        <td class="right">${it.draws ?? 0}</td>
        <td class="right">${it.games ?? 0}</td>
        <td class="right">${it.points ?? 0}</td>
      `;
      tbody.appendChild(tr);
    });

    loading.style.display = "none";
    tbl.style.display = "table";
    statusPill.textContent = `Kész • ${items.length} játékos`;

    if (items.length === 0) {
      statusPill.textContent = "Üres ranglista";
    }
  } catch (err) {
    loading.style.display = "none";
    errorBox.style.display = "block";
    errorBox.textContent = err?.message || String(err);
    statusPill.textContent = "Hiba";
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.getElementById("reloadBtn")?.addEventListener("click", loadLeaderboard);
document.getElementById("limitSel")?.addEventListener("change", loadLeaderboard);

loadLeaderboard();
