document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "/host.html";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || "Hiba");

    location.href = next;
  });
});