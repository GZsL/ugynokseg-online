document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "/host.html";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert((data && data.error) ? data.error : "Hiba történt");
      return;
    }

    localStorage.setItem("user", JSON.stringify(data.user));
    window.location.href = next;
  });
});