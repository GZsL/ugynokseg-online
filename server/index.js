const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./engine-core');
const nodemailer = require('nodemailer');
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

app.use("/api/auth", require("./auth.routes"));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "ugynokseg_token";

function requireAuth(req, res, next){
  const token = req.cookies[COOKIE_NAME];
  if(!token){
    return res.status(401).json({ error: "Login szükséges." });
  }

  try{
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  }catch(e){
    console.error("JWT verify error:", e.message);
    return res.status(401).json({ error: "Érvénytelen token." });
  }
}

/* =============================
   ROOM LOBBY (LOGIN REQUIRED)
============================= */

app.post("/api/create-room-lobby", requireAuth, (req, res)=>{
  const { name, characterKey, maxPlayers, password } = req.body;

  if(!name || !characterKey){
    return res.status(400).json({ error: "Hiányzó adat." });
  }

  const roomCode = Math.random().toString(36).substring(2,7).toUpperCase();
  const token = Math.random().toString(36).substring(2);

  // itt marad a te engine logikád

  res.json({
    room: roomCode,
    token
  });
});

server.listen(PORT, ()=>{
  console.log("Server running on port", PORT);
});