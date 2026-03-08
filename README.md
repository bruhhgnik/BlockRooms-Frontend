# BlockRooms

**A Backrooms-inspired on-chain FPS built for the [MagicBlock Blitz 1 Hackathon](https://www.magicblock.gg/).**

> Explore eerie procedural rooms, find the real enemy hiding among decoys, and survive — all powered by fully on-chain game logic on Solana with MagicBlock Ephemeral Rollups.

**Live Demo**: [block-rooms-frontend.vercel.app](https://block-rooms-frontend.vercel.app)

**Smart Contract Repo**: [BlockRooms (Anchor Program)](https://github.com/Kepler22bee/BlockRooms)

---

## How It Works

BlockRooms is a zone-based FPS where the entire game state — player health, XP, enemy placement, and progression — lives on-chain. The frontend renders the 3D world but **does not know** which enemy is real. That secret is stored on-chain, making the game tamper-proof.

### Gameplay Loop

1. **Connect Wallet** — A session keypair handles signing so there are no wallet popups mid-game.
2. **Initialize Player** — On-chain account created with `Health = 100`, `XP = 200`.
3. **Start Game** — Game accounts are delegated to a MagicBlock Ephemeral Rollup for real-time, gasless gameplay.
4. **Explore & Shoot** — Navigate rooms, find enemy positions, and shoot. The on-chain program determines if you hit the real enemy or a decoy.
5. **Progress Through Zones** — Defeat the real enemy in each zone to unlock the next.

### Zones

| Zone  | Rooms | Fake Hit Penalty     | Real Hit Reward      |
|-------|-------|----------------------|----------------------|
| Red   | 8     | `-1 × Health`        | `+5 × Health`        |
| Blue  | 8     | `-1.5 × Health`      | `+10 × Health`       |
| Green | 4     | `-4 × Health`        | `+15 × Health`       |

Each room has 4 possible enemy positions. Only **one room per zone** contains the real enemy — the rest are decoys. Difficulty scales as you progress.

---

## Tech Stack

### Frontend
- **React + Vite** — Fast dev server and build tooling
- **Three.js** via `@react-three/fiber` — Real-time 3D WebGL rendering
- **Blender** — 3D models exported as `.gltf`
- **Zustand** — Lightweight state management for player state, rooms, and HUD
- **PointerLockControls** — FPS-style mouse-look and movement

### On-Chain (Solana + MagicBlock)
- **Solana** — All game state stored on-chain via PDAs
- **Anchor** — Smart contract framework for the game program
- **MagicBlock Ephemeral Rollups** — Delegates game accounts to an ephemeral rollup for low-latency, gasless transactions during gameplay
- **@solana/web3.js** + **@coral-xyz/anchor** — Frontend SDKs for on-chain interaction

**Program ID (Devnet):** `9noA6NrVVSLjacxEnu2FqNAxPa7bqNVsRnUV12FXf7Tc`

---

## Architecture

```
Frontend (React/Three.js)          On-Chain (Solana/Anchor)
┌─────────────────────┐           ┌─────────────────────────┐
│ 3D Room Rendering   │           │ Player PDA (HP, XP)     │
│ Enemy Visuals       │◄────────► │ Real Enemy Selection    │
│ Input Handling      │           │ XP Calculation          │
│ HUD / State (Zustand)│          │ Zone Progression Logic  │
└─────────────────────┘           └────────────┬────────────┘
                                               │
                                  ┌────────────▼────────────┐
                                  │ MagicBlock Ephemeral    │
                                  │ Rollup (gasless,        │
                                  │ real-time delegation)   │
                                  └─────────────────────────┘
```

The frontend **never knows** which enemy is real — it reads positions from the chain and renders them. When a player shoots, the on-chain program resolves the hit, updates XP, and controls zone progression.

---

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move |
| Mouse | Look around |
| Click | Shoot |
| Q | Exit to main menu |

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/bruhhgnik/BlockRooms-Frontend.git
cd BlockRooms-Frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

Make sure you have a Solana wallet (e.g. Phantom) connected to **Devnet**.

---

## Links

- [Solana Docs](https://solana.com/docs)
- [Anchor Docs](https://www.anchor-lang.com/)
- [MagicBlock Docs](https://docs.magicblock.gg/)

---

Built for **MagicBlock Blitz 1 Hackathon**
