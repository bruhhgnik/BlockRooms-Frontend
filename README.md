# BlockRooms: Backrooms-Inspired FPS On-Chain

## Contents

- [Our Stack](#our-stack)
- [Game Logic](#game-logic)

# Our Stack

> A high-level breakdown of the technologies powering **BlockRooms** — from 3D graphics and frontend architecture to fully on-chain gameplay mechanics.

---

## Frontend Stack

- **Blender** – for modeling and exporting `.gltf` assets used in our 3D game environment.
- **React** – component-based UI library for structuring our game frontend.
- **Vite** – the dev server and build tool powering the React app.
- **Three.js** (via [`@react-three/fiber`](https://docs.pmnd.rs/react-three-fiber)) – for real-time 3D rendering in WebGL.
- **PointerLockControls** – to enable mouse-look and FPS-style movement.
- **Zustand** – lightweight and scalable state manager to handle in-game data like player state, room transitions, HUD, etc.

---

## On-Chain Game Logic (Solana + MagicBlock)

The logic of the game lives entirely on-chain, built on **Solana** with **MagicBlock Ephemeral Rollups** for real-time gameplay:

- **Solana** – high-throughput L1 blockchain. All game state (players, rooms, scores) is stored on-chain via PDAs.
- **Anchor** – Solana smart contract framework used for the game program.
- **MagicBlock Ephemeral Rollups** – delegates game accounts to an ephemeral rollup for low-latency, gasless gameplay transactions during active sessions.
- **@solana/web3.js** – TypeScript SDK for building and sending Solana transactions from the frontend.
- **@coral-xyz/anchor** – client-side Anchor SDK for typed program interaction.

**Program ID:** `9noA6NrVVSLjacxEnu2FqNAxPa7bqNVsRnUV12FXf7Tc` (devnet)

---

## Relevant Links

- [Solana Docs](https://solana.com/docs)
- [Anchor Docs](https://www.anchor-lang.com/)
- [MagicBlock Docs](https://docs.magicblock.gg/)

# Game Logic

This section outlines the core gameplay loop, progression mechanics, and XP logic of **BlockRooms**. It's built to reflect both **on-chain** and **frontend** behavior.

---

## Overview

- **Genre**: On-chain, zone-based shooter with progression and XP mechanics.
- **Map Structure**: 3 zones — Red (8 rooms), Blue (8 rooms), Green (4 rooms)
- **Objective**: Locate and eliminate the *real enemy* in each zone to unlock the next.

---

## Game Loop Summary

```
Connect Wallet → Initialize Player → Start Game → Spawn in Red Zone →
→ Choose Room → Read Enemy Positions → Shoot →
→ If Real Enemy: Gain XP & Unlock Next Zone
→ If Fake Enemy: Lose XP → Continue Searching
→ Repeat for all 3 zones until exit
```

---

## Game Loop Step-by-Step

### 1. Connect Wallet
- A session keypair is used to sign all transactions automatically — no wallet popups during gameplay.

### 2. Initialize Player
- Player account is created **on-chain** via the `initialize_player` instruction.
- Player spawns with:
  - `Health = 100`
  - `XP = 200`

### 3. Start Game
- Calls `start_game` on the base Solana devnet.
- Game accounts are delegated to MagicBlock's Ephemeral Rollup for real-time gameplay.

### 4. Explore Red Zone
- **Total Rooms**: 8 (Red Zone)
- Player can only enter **one room at a time**.
- In each room:
  - **4 positions** are shown by the frontend where enemies may appear.
  - These positions are **predefined** in the frontend.
  - However, the **frontend does not know** which is real or fake.
  - This info is derived from **on-chain** state.

### 5. Real vs. Fake Enemies
- Across all 8 rooms:
  - Only **one** hides the **real enemy**.
  - Its identity is **hidden from the frontend** and **stored on-chain**.

---

## Shooting Logic

| Enemy Type     | Action | XP Impact             | Zone Impact                             |
|----------------|--------|------------------------|------------------------------------------|
| Fake Enemy     | Hit    | `-1 × current_health`  | Stay in current zone, keep searching     |
| Real Enemy     | Hit    | `+5 × current_health`  | Unlock next zone                         |

---

## XP Formula

- **On Miss (fake):**
  `XP -= 1 × Health`

- **On Hit (real):**
  `XP += 5 × Health`

---

## Zone Progression

```
Red Zone (8 rooms)
→ Real enemy defeated
→ Blue Zone (8 rooms)
→ Real enemy defeated
→ Green Zone (4 rooms)
→ Game Completed
```

- Once the real enemy in a zone is defeated:
  - The next zone is unlocked
  - Health and XP are retained
- If **Health = 0**, player may be prevented from progressing.

---

## On-Chain vs. Frontend Responsibilities

| Layer         | Responsibility                                              |
|---------------|-------------------------------------------------------------|
| **Frontend**  | Renders rooms, enemy visuals, manages input                 |
| **On-Chain**  | Chooses real enemy, calculates XP, controls state           |
| **Anchor**    | Stores health, XP, room state, and logs events via PDAs     |
| **MagicBlock**| Handles real-time gameplay via ephemeral rollup delegation   |

---

## Session End Conditions

- Player defeats the real enemy in the **Green Zone**.
- The system records:
  - Final XP
  - Time taken
  - Shots fired

---

## Zone Difficulty Scaling

> The above loop repeats across zones, but XP values change to increase challenge.

### Blue Zone (8 Rooms)

- **Fake Enemy Shot**: `-1.5 × Health`
- **Real Enemy Shot**: `+10 × Health`
- **Total Positions**: `8 × 4 = 32`

### Green Zone (4 Rooms)

- **Fake Enemy Shot**: `-4 × Health`
- **Real Enemy Shot**: `+15 × Health`
- **Total Positions**: `4 × 4 = 16`

---

## Controls

- **WASD / Arrow Keys** – Move
- **Mouse** – Look around
- **Click** – Shoot
- **Q** – Exit to main menu
