# Sabouteur Vanguard

Lightweight recreation of the Saboteur board game built on Three.js with first-person exploration, hidden roles, and proximity chat.

## Features

- **1st-person mine** built with procedural board tiles rendered via Three.js + PointerLock controls.
- **Card-driven tunnel building** following the original rules (path cards, rockfalls, break/repair tools, hidden goals).
- **Multiplayer lobby** powered by Socket.IO with live player pose sync, suspicion scoring, and chat feed.
- **WebRTC proximity chat** with per-player attenuation; toggles automatically when peers move closer/farther.
- **Saboteur Insights visualization** panel animates tunnel completion, deck depletion, collapsed tiles, and suspicion meters.
- **Victory detection** for both teams (gold discovered vs. deck exhausted) with HUD banners/log entries.

## Repository layout

```
client/   Vite + Three.js front-end (TypeScript)
server/   Node/Express + Socket.IO backend (multiplayer + rules engine)
```

## Prerequisites

- Node.js 18+ (tested with 20.x)
- Modern browser with WebGL2 + getUserMedia (Chrome, Edge, Firefox). Microphone access required for proximity chat.

## Local development

Install both projects once:

```bash
cd client && npm install
cd ../server && npm install
```

Run the realtime server (port 4173 by default):

```bash
cd server
npm run dev
```

Start the Vite dev server (port 5173 by default) in a second terminal:

```bash
cd client
npm run dev
```

Set `VITE_SERVER_URL` in `client/.env` if the backend is running on another host or port (defaults to `http://localhost:4173`).

## Production build & self-hosting

1. Build the client bundle:

   ```bash
   cd client
   npm run build
   ```

2. Serve the backend (build includes Three.js assets in `client/dist` for static hosting elsewhere if desired):

   ```bash
   cd server
   npm start
   ```

3. Reverse-proxy the client bundle via any static host (Vercel, Netlify, S3) or plug the dist folder into an Express static route. Update `VITE_SERVER_URL` to the public Socket.IO endpoint before rebuilding.

The server exposes `GET /health` for uptime checks and supports any number of self-hosted instances by changing `PORT` via environment variable.

## Gameplay overview

- Every client connects to the shared lobby and receives a hidden role (miner/saboteur) plus five cards.
- Use WASD to walk, mouse to look, and click a tile to play the selected card from your hand.
- HUD shows teammate suspicion, while the visualization canvas tracks deck size, tunnel completeness, and collapsed tiles.
- Click a teammate in the HUD list, then select a Break/Repair card to target them. Rockfall cards target a tile directly.
- Chat panel doubles as a backlog of system events, and WebRTC proximity chat adjusts voice volume with distance automatically (fallbacks gracefully if mic permissions are denied).

## Custom assets

Place your GLB/GLTF avatar model at `client/public/assets/models/dwarf.glb`. Any mesh works; the loader will fall back to the capsule placeholder if the file is missing.

## Future enhancements

- Expand the card set to the full board-game deck (maps, multiple rounds, reward gold counts).
- Integrate physics-based locomotion (Cannon-ES is already listed, ready for ragdolls).
- Add dedicated lobby/room management plus role reveal animations for presentation flair.
