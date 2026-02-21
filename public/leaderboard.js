async function loadLeaderboard() {
  const res = await fetch("/api/auth/leaderboard");
  const data = await res.json();

  const container = document.getElementById("leaderboard");

  container.innerHTML = "";

  data.forEach((player, index) => {
    const row = document.createElement("div");
    row.innerText = `${index + 1}. ${player.name} - ${player.elo}`;
    container.appendChild(row);
  });
}

loadLeaderboard();