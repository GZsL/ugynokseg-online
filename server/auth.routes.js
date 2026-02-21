const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");

const users = []; // ideiglenes memória tárolás (ha van DB-d, ide illeszd be)

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Hiányzó adatok" });
  }

  const existing = users.find(u => u.email === email);
  if (existing) {
    return res.status(400).json({ error: "Email már létezik" });
  }

  const hashed = await bcrypt.hash(password, 10);

  const newUser = {
    id: uuidv4(),
    name,
    email,
    password: hashed,
    elo: 1000
  };

  users.push(newUser);

  res.json({ success: true });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(400).json({ error: "Hibás email vagy jelszó" });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(400).json({ error: "Hibás email vagy jelszó" });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      elo: user.elo
    }
  });
});

router.get("/leaderboard", (req, res) => {
  const sorted = [...users].sort((a, b) => b.elo - a.elo);

  res.json(sorted.map(u => ({
    name: u.name,
    elo: u.elo
  })));
});

module.exports = router;