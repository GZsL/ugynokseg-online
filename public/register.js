document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("registerForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || "Hiba");

    alert("Sikeres regisztráció!");
    location.href = "/login.html";
  });
});