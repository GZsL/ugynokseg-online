# Ügynökség – LAN online teszt (Socket.IO)

## 1) Indítás
1. Telepíts Node.js 18+.
2. Ebben a mappában futtasd:

```bash
npm install
npm run dev
```

3. Nyisd meg böngészőben:
- `http://localhost:3000/setup.html`

## 2) Szoba létrehozás
- Add meg a játékosokat + karaktereket, majd **Játék indítása**.
- A rendszer kiír egy **szobakódot** és **külön linket** minden játékoshoz.

> Fontos: minden játékos a saját linkjével lépjen be (player index). Így a szerver tudja, ki van soron.

## 3) LAN használat
Ha másik gépről is el akarjátok érni a szervert a helyi hálón:
- nézd meg a host gép IP-jét (pl. `192.168.0.25`)
- a linket cseréld erre:
  `http://192.168.0.25:3000/setup.html`

## Megjegyzés
Ez egy "smoke test" online alap: a körlogika a szerveren fut, a kliensek csak akciót küldenek.
