/**
 * Solana Integration Layer
 *
 * Uses a locally-generated session Keypair stored in localStorage.
 * All transactions are auto-signed — no wallet popups during gameplay.
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import idlJSON from "./gameframework.json";
import { txPending, txConfirmed, txError } from "./txlog";

// ===== CONSTANTS =====
const PROGRAM_ID = new PublicKey("9noA6NrVVSLjacxEnu2FqNAxPa7bqNVsRnUV12FXf7Tc");
const BASE_RPC_URL = "https://api.devnet.solana.com";
const ER_RPC_URL = "https://devnet-as.magicblock.app/";
const ER_WS_URL = "wss://devnet-as.magicblock.app/";
const USE_MAGICBLOCK = true;
const SESSION_KEY = "blockrooms_session_keypair";
const ER_DELEGATION_KEY = "blockrooms_er_delegated";

const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

const PLAYER_STATE_SEED = "player_state";
const PLAYER_STATS_SEED = "player_stats";
const ZONE_STATE_SEED = "zone_state";
const ROOM_STATE_SEED = "room_state";
const BET_STATE_SEED = "bet_state";
const GAME_SESSION_SEED = "game_session";
const GAME_CONFIG_SEED = "game_config";
const ENEMY_STATE_SEED = "enemy_state";

function normalizeProgramError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isBlockhashTransientError(error: unknown): boolean {
  const msg = normalizeProgramError(error).toLowerCase();
  return (
    msg.includes("blockhash not found") ||
    msg.includes("block height exceeded") ||
    msg.includes("transaction expired")
  );
}

async function withBlockhashRetry<T>(
  run: () => Promise<T>,
  retries = 1
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= retries || !isBlockhashTransientError(error)) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export function toFriendlyProgramError(error: unknown): string {
  const msg = normalizeProgramError(error);
  if (msg.includes("ConstraintSeeds") && msg.includes("account: game_config")) {
    return "Game config PDA mismatch on this deployment. Re-initialize game config for this program on devnet.";
  }
  if (msg.includes("NoActiveBet")) {
    return "You need to place a bet before entering a room or shooting.";
  }
  if (msg.includes("BetAlreadyActive")) {
    return "A bet is already active. Resolve it by shooting the next enemy.";
  }
  if (isBlockhashTransientError(error)) {
    return "Network blockhash expired. Please retry the action.";
  }
  if (msg.includes("insufficient funds for fee")) {
    return "Not enough SOL for transaction fees.";
  }
  return msg;
}

// ===== SESSION KEYPAIR =====

/** Hardcoded devnet session keypair — fund this address on devnet:
 *  9rRQmg7qb97NSAkNwH6u8ypf9nU2n7gkMeU8T8M3ZFtr
 */
const HARDCODED_SECRET = new Uint8Array([30,7,99,195,225,5,249,88,245,223,62,7,180,117,168,14,182,126,9,45,125,45,44,114,178,177,20,231,156,103,193,152,131,134,142,42,201,192,225,91,81,187,231,197,180,93,0,230,221,153,68,255,218,59,9,154,226,198,116,104,90,219,25,23]);

export function getSessionKeypair(): Keypair {
  return Keypair.fromSecretKey(HARDCODED_SECRET);
}

/** Clear the stored session keypair (for "new wallet") */
export function clearSessionKeypair(): void {
  localStorage.removeItem(SESSION_KEY);
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`${ER_DELEGATION_KEY}:`)) {
      localStorage.removeItem(k);
    }
  }
}

// ===== CONNECTION / PROVIDER / PROGRAM =====

let _baseConnection: Connection | null = null;
let _erConnection: Connection | null = null;

export function getBaseConnection(): Connection {
  if (!_baseConnection) {
    _baseConnection = new Connection(BASE_RPC_URL, "confirmed");
  }
  return _baseConnection;
}

export function getErConnection(): Connection {
  if (!_erConnection) {
    _erConnection = new Connection(ER_RPC_URL, {
      commitment: "confirmed",
      wsEndpoint: ER_WS_URL,
    });
  }
  return _erConnection;
}

export function getConnection(): Connection {
  return USE_MAGICBLOCK ? getErConnection() : getBaseConnection();
}

/** Simple wallet wrapper so AnchorProvider can sign with our Keypair */
class SessionWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: any) {
    tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    return txs.map((tx) => {
      tx.partialSign(this.payer);
      return tx;
    });
  }
}

type Network = "base" | "er";

async function sendMethodTx(
  keypair: Keypair,
  network: Network,
  buildMethod: () => any
): Promise<string> {
  if (network === "er") {
    return withBlockhashRetry(async () => {
      const tx = await buildMethod().transaction();
      const connection = getErConnection();
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("processed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 5,
      });
      // Fire-and-forget confirmation; do not block UX on router finalization.
      void connection
        .confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "processed"
        )
        .catch(() => {});
      return signature;
    });
  }

  return withBlockhashRetry(async () => buildMethod().rpc());
}

function getDelegationCacheKey(player: PublicKey): string {
  return `${ER_DELEGATION_KEY}:${ER_RPC_URL}:${player.toBase58()}`;
}

function zoneIndexFromPlayerState(playerState: any): number {
  if (playerState?.currentZone?.red !== undefined) return 0;
  if (playerState?.currentZone?.blue !== undefined) return 1;
  return 2;
}

function isIgnorableDelegationError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("already in use") ||
    lower.includes("already delegated") ||
    lower.includes("already initialized") ||
    lower.includes("instruction modified data of an account it does not own")
  );
}

export function getProvider(
  keypair: Keypair,
  network: Network = USE_MAGICBLOCK ? "er" : "base"
): AnchorProvider {
  const connection = network === "er" ? getErConnection() : getBaseConnection();
  const wallet = new SessionWallet(keypair);
  const opts =
    network === "er"
      ? {
          commitment: "processed" as const,
          preflightCommitment: "processed" as const,
          skipPreflight: true,
          maxRetries: 5,
        }
      : { commitment: "confirmed" as const };
  return new AnchorProvider(connection, wallet as any, opts);
}

export function getProgram(
  keypair: Keypair,
  network: Network = USE_MAGICBLOCK ? "er" : "base"
): Program {
  const provider = getProvider(keypair, network);
  const idl = { ...idlJSON } as any;
  idl.address = PROGRAM_ID.toString();
  return new Program(idl, provider);
}

async function fetchAccountWithFallback(
  keypair: Keypair,
  accountName: string,
  pda: PublicKey
) {
  const networks: Network[] = USE_MAGICBLOCK ? ["er", "base"] : ["base"];
  for (const network of networks) {
    try {
      const program = getProgram(keypair, network);
      return await (program.account as any)[accountName].fetch(pda);
    } catch {
      // try next network
    }
  }
  return null;
}

async function ensureGameplayDelegated(keypair: Keypair): Promise<void> {
  if (!USE_MAGICBLOCK) return;

  const cacheKey = getDelegationCacheKey(keypair.publicKey);
  if (localStorage.getItem(cacheKey) === "1") return;

  const [playerStatePDA] = getPlayerStatePDA(keypair.publicKey);
  const [playerStatsPDA] = getPlayerStatsPDA(keypair.publicKey);
  const [gameSessionPDA] = getGameSessionPDA(keypair.publicKey);

  const playerState = await fetchAccountWithFallback(
    keypair,
    "playerState",
    playerStatePDA
  );
  if (!playerState?.gameActive) return;

  const zoneIndex = zoneIndexFromPlayerState(playerState);
  const [zoneStatePDA] = getZoneStatePDA(keypair.publicKey, zoneIndex);
  const baseProgram = getProgram(keypair, "base");

  const delegatePda = async (
    methodName: string,
    pda: PublicKey,
    args: any[] = []
  ): Promise<void> => {
    const accountInfo = await getBaseConnection().getAccountInfo(pda, "confirmed");
    if (!accountInfo) return;
    // If the owner is already changed away from this program, treat as delegated.
    if (!accountInfo.owner.equals(PROGRAM_ID)) return;

    try {
      await withBlockhashRetry(() =>
        (baseProgram.methods as any)[methodName](...args)
          .accounts({
            payer: keypair.publicKey,
            pda,
          })
          .rpc()
      );
    } catch (e) {
      const msg = normalizeProgramError(e);
      if (!isIgnorableDelegationError(msg)) throw e;
    }
  };

  await delegatePda("delegatePlayer", playerStatePDA);
  await delegatePda("delegatePlayerStats", playerStatsPDA);
  await delegatePda("delegateZoneState", zoneStatePDA, [zoneIndex]);
  await delegatePda("delegateGameSession", gameSessionPDA);

  localStorage.setItem(cacheKey, "1");
}

/** Undelegate a single account via ER. Returns true if successful. */
async function undelegateAccount(
  keypair: Keypair,
  methodName: string,
  extraAccounts: Record<string, PublicKey>,
  label: string,
  args: any[] = []
): Promise<boolean> {
  const id = txPending(`Undelegate ${label}`);
  try {
    const program = getProgram(keypair, "er");
    const tx = await sendMethodTx(
      keypair,
      "er",
      () =>
        (program.methods as any)[methodName](...args)
          .accounts({
            payer: keypair.publicKey,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
            ...extraAccounts,
          })
    );
    txConfirmed(id, tx);
    console.log(`[Solana] ${label} undelegated`);
    return true;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    return false;
  }
}

/**
 * Check accounts needed for startGame and undelegate any that are still
 * owned by the MagicBlock delegation program.
 */
async function ensureAllUndelegated(keypair: Keypair): Promise<void> {
  const conn = getBaseConnection();

  // Only player_state and game_session are needed for startGame
  const accounts = [
    { pda: getPlayerStatePDA(keypair.publicKey)[0], method: "undelegatePlayer", label: "Player State", args: [] as any[] },
    { pda: getGameSessionPDA(keypair.publicKey)[0], method: "undelegateGameSession", label: "Game Session", args: [] as any[] },
    { pda: getPlayerStatsPDA(keypair.publicKey)[0], method: "undelegatePlayerStats", label: "Player Stats", args: [] as any[] },
  ];

  let undelegated = false;
  for (const acct of accounts) {
    try {
      const info = await conn.getAccountInfo(acct.pda, "confirmed");
      if (info && info.owner.equals(DELEGATION_PROGRAM_ID)) {
        console.log(`[Solana] ${acct.label} still delegated — undelegating...`);
        await undelegateAccount(keypair, acct.method, {}, acct.label, acct.args);
        undelegated = true;
      }
    } catch (e) {
      console.warn(`[Solana] Failed to check/undelegate ${acct.label}:`, e);
    }
  }

  // Zone state undelegation is optional — skip if it doesn't exist
  try {
    let zoneIndex = 0;
    const ps = await fetchAccountWithFallback(keypair, "playerState", accounts[0].pda);
    if (ps) zoneIndex = zoneIndexFromPlayerState(ps);
    const [zoneStatePDA] = getZoneStatePDA(keypair.publicKey, zoneIndex);
    const zoneInfo = await conn.getAccountInfo(zoneStatePDA, "confirmed");
    if (zoneInfo && zoneInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
      console.log("[Solana] Zone State still delegated — undelegating...");
      await undelegateAccount(keypair, "undelegateZoneState", {}, "Zone State", [zoneIndex]);
      undelegated = true;
    }
  } catch { /* zone state not critical for startGame */ }

  if (undelegated) {
    const cacheKey = getDelegationCacheKey(keypair.publicKey);
    localStorage.removeItem(cacheKey);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

// ===== PDA HELPERS =====

export function getPlayerStatePDA(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLAYER_STATE_SEED), player.toBuffer()],
    PROGRAM_ID
  );
}

export function getPlayerStatsPDA(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLAYER_STATS_SEED), player.toBuffer()],
    PROGRAM_ID
  );
}

export function getZoneStatePDA(player: PublicKey, zone: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ZONE_STATE_SEED), player.toBuffer(), Buffer.from([zone])],
    PROGRAM_ID
  );
}

export function getGameSessionPDA(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GAME_SESSION_SEED), player.toBuffer()],
    PROGRAM_ID
  );
}

export function getGameConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(GAME_CONFIG_SEED)], PROGRAM_ID);
}

export function getBetStatePDA(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BET_STATE_SEED), player.toBuffer()],
    PROGRAM_ID
  );
}

export function getRoomStatePDA(
  player: PublicKey,
  zone: number,
  roomNumber: number
): [PublicKey, number] {
  const roomLe = Buffer.alloc(4);
  roomLe.writeUInt32LE(roomNumber, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ROOM_STATE_SEED), player.toBuffer(), Buffer.from([zone]), roomLe],
    PROGRAM_ID
  );
}

export function getEnemyStatePDA(player: PublicKey, enemyId: number): [PublicKey, number] {
  const enemyLe = Buffer.alloc(8);
  enemyLe.writeBigUInt64LE(BigInt(enemyId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ENEMY_STATE_SEED), player.toBuffer(), enemyLe],
    PROGRAM_ID
  );
}

// ===== AIRDROP =====

export async function ensureFunded(keypair: Keypair): Promise<boolean> {
  const connection = getBaseConnection();
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("[Solana] Low balance, requesting airdrop...");
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      console.log("[Solana] Airdrop confirmed");
      return true;
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("429")) {
        console.warn(
          "[Solana] Airdrop rate-limited. Fund manually at https://faucet.solana.com — address:",
          keypair.publicKey.toBase58()
        );
      } else {
        console.error("[Solana] Airdrop failed:", e);
      }
      return false;
    }
  }
  return true;
}

// ===== ACCOUNT FETCHERS =====

export async function fetchPlayerState(keypair: Keypair) {
  const [pda] = getPlayerStatePDA(keypair.publicKey);
  return fetchAccountWithFallback(keypair, "playerState", pda);
}

export async function fetchPlayerStats(keypair: Keypair) {
  const [pda] = getPlayerStatsPDA(keypair.publicKey);
  return fetchAccountWithFallback(keypair, "playerStats", pda);
}

export async function fetchGameSession(keypair: Keypair) {
  const [pda] = getGameSessionPDA(keypair.publicKey);
  return fetchAccountWithFallback(keypair, "gameSession", pda);
}

export async function fetchZoneState(keypair: Keypair, zone: number) {
  const [pda] = getZoneStatePDA(keypair.publicKey, zone);
  return fetchAccountWithFallback(keypair, "zoneState", pda);
}

export async function fetchGameConfig(keypair: Keypair) {
  const [pda] = getGameConfigPDA();
  const program = getProgram(keypair, "base");
  try {
    return await (program.account as any).gameConfig.fetch(pda);
  } catch {
    return null;
  }
}

export async function fetchBetState(keypair: Keypair) {
  const [pda] = getBetStatePDA(keypair.publicKey);
  return fetchAccountWithFallback(keypair, "betState", pda);
}

// ===== INSTRUCTIONS (all wired to txlog) =====

export async function callInitializeConfig(keypair: Keypair): Promise<string> {
  const id = txPending("Initialize Config");
  try {
    const program = getProgram(keypair, "base");
    const tx = await withBlockhashRetry<string>(() =>
      (program.methods as any)
        .initializeConfig()
        .accounts({ authority: keypair.publicKey })
        .rpc()
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function ensureGameConfigInitialized(keypair: Keypair): Promise<boolean> {
  const config = await fetchGameConfig(keypair);
  if (config) return true;

  try {
    await callInitializeConfig(keypair);
  } catch (e) {
    const msg = normalizeProgramError(e);
    if (!msg.includes("already in use")) {
      console.warn("[Solana] initialize_config failed:", msg);
    }
  }

  return (await fetchGameConfig(keypair)) !== null;
}

export async function callInitializePlayer(keypair: Keypair): Promise<string> {
  const id = txPending("Initialize Player");
  try {
    const program = getProgram(keypair, "base");
    const tx = await withBlockhashRetry<string>(() =>
      (program.methods as any)
        .initializePlayer()
        .accounts({ player: keypair.publicKey })
        .rpc()
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callInitializeZone(
  keypair: Keypair,
  zone: { red: {} } | { blue: {} } | { green: {} }
): Promise<string> {
  const zoneName = "red" in zone ? "Red" : "blue" in zone ? "Blue" : "Green";
  const id = txPending(`Init Zone (${zoneName})`);
  try {
    const program = getProgram(keypair, "base");
    const zoneIndex = "red" in zone ? 0 : "blue" in zone ? 1 : 2;
    const [zoneStatePDA] = getZoneStatePDA(keypair.publicKey, zoneIndex);
    const tx = await withBlockhashRetry<string>(() =>
      (program.methods as any)
        .initializeZone(zone)
        .accounts({ zoneState: zoneStatePDA, player: keypair.publicKey })
        .rpc()
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callStartGame(keypair: Keypair): Promise<string> {
  await ensureAllUndelegated(keypair);

  const id = txPending("Start Game");
  try {
    const program = getProgram(keypair, "base");
    const tx = await withBlockhashRetry<string>(() =>
      (program.methods as any)
        .startGame()
        .accounts({ player: keypair.publicKey })
        .rpc()
    );

    await ensureGameplayDelegated(keypair);

    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callPlaceBet(
  keypair: Keypair,
  amount: number,
  prediction: boolean
): Promise<string> {
  const side = prediction ? "real" : "fake";
  const id = txPending(`Place Bet (${amount} on ${side})`);
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const playerState = await fetchPlayerState(keypair);
    const zoneIndex = playerState?.currentZone?.red !== undefined
      ? 0
      : playerState?.currentZone?.blue !== undefined
      ? 1
      : 2;
    const [playerStatePDA] = getPlayerStatePDA(keypair.publicKey);
    const [betStatePDA] = getBetStatePDA(keypair.publicKey);
    const [zoneStatePDA] = getZoneStatePDA(keypair.publicKey, zoneIndex);

    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .placeBet(new BN(amount), prediction)
          .accounts({
            playerState: playerStatePDA,
            betState: betStatePDA,
            zoneState: zoneStatePDA,
            player: keypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callEnterRoom(
  keypair: Keypair,
  zone: { red: {} } | { blue: {} } | { green: {} },
  roomNumber: number
): Promise<string> {
  const id = txPending(`Enter Room #${roomNumber}`);
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const zoneIndex = "red" in zone ? 0 : "blue" in zone ? 1 : 2;
    const [playerStatePDA] = getPlayerStatePDA(keypair.publicKey);
    const [betStatePDA] = getBetStatePDA(keypair.publicKey);
    const [roomStatePDA] = getRoomStatePDA(keypair.publicKey, zoneIndex, roomNumber);
    const [gameConfigPDA] = getGameConfigPDA();
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .enterRoom(zone, roomNumber)
          .accounts({
            playerState: playerStatePDA,
            betState: betStatePDA,
            roomState: roomStatePDA,
            gameConfig: gameConfigPDA,
            player: keypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callMovePlayer(
  keypair: Keypair,
  xDelta: number,
  yDelta: number,
  targetGrid?: { x: number; y: number }
): Promise<string> {
  const action = targetGrid
    ? `Move to (${targetGrid.x}, ${targetGrid.y})`
    : `Move (${xDelta}, ${yDelta})`;
  const id = txPending(action);
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .movePlayer(xDelta, yDelta)
          .accounts({ player: keypair.publicKey })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callShootEnemy(keypair: Keypair, enemyId: number): Promise<string> {
  const id = txPending("Shoot Enemy");
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const playerState = await fetchPlayerState(keypair);
    const zoneIndex = playerState?.currentZone?.red !== undefined
      ? 0
      : playerState?.currentZone?.blue !== undefined
      ? 1
      : 2;
    const [playerStatePDA] = getPlayerStatePDA(keypair.publicKey);
    const [playerStatsPDA] = getPlayerStatsPDA(keypair.publicKey);
    const [betStatePDA] = getBetStatePDA(keypair.publicKey);
    const [zoneStatePDA] = getZoneStatePDA(keypair.publicKey, zoneIndex);
    const [gameSessionPDA] = getGameSessionPDA(keypair.publicKey);
    const [enemyStatePDA] = getEnemyStatePDA(keypair.publicKey, enemyId);
    const [gameConfigPDA] = getGameConfigPDA();
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .shootEnemy(new BN(enemyId))
          .accounts({
            playerState: playerStatePDA,
            playerStats: playerStatsPDA,
            betState: betStatePDA,
            zoneState: zoneStatePDA,
            gameSession: gameSessionPDA,
            enemyState: enemyStatePDA,
            gameConfig: gameConfigPDA,
            player: keypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callTakeDamage(keypair: Keypair, damage: number): Promise<string> {
  const id = txPending(`Take Damage (${damage})`);
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .takeDamage(damage)
          .accounts({ player: keypair.publicKey })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callBuyFood(keypair: Keypair): Promise<string> {
  const id = txPending("Buy Food");
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .buyFood()
          .accounts({ player: keypair.publicKey })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callEndGame(keypair: Keypair): Promise<string> {
  const id = txPending("End Game");
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .endGame()
          .accounts({ player: keypair.publicKey })
    );
    txConfirmed(id, tx);

    // Undelegate all accounts so next startGame can work on base chain
    try {
      await ensureAllUndelegated(keypair);
    } catch (e) {
      console.warn("[Solana] Post-endGame undelegate failed:", e);
    }

    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

export async function callChangeZone(
  keypair: Keypair,
  newZone: { red: {} } | { blue: {} } | { green: {} }
): Promise<string> {
  const zoneName = "red" in newZone ? "Red" : "blue" in newZone ? "Blue" : "Green";
  const id = txPending(`Change Zone (${zoneName})`);
  try {
    await ensureGameplayDelegated(keypair);
    const network: Network = USE_MAGICBLOCK ? "er" : "base";
    const program = getProgram(keypair, network);
    const playerState = await fetchPlayerState(keypair);
    const currentZoneIndex = playerState?.currentZone?.red !== undefined
      ? 0
      : playerState?.currentZone?.blue !== undefined
      ? 1
      : 2;
    const targetZoneIndex = "red" in newZone ? 0 : "blue" in newZone ? 1 : 2;
    const [currentZonePDA] = getZoneStatePDA(keypair.publicKey, currentZoneIndex);
    const [targetZonePDA] = getZoneStatePDA(keypair.publicKey, targetZoneIndex);
    const tx = await sendMethodTx(
      keypair,
      network,
      () =>
        (program.methods as any)
          .changeZone(newZone)
          .accounts({
            currentZoneState: currentZonePDA,
            targetZoneState: targetZonePDA,
            player: keypair.publicKey,
          })
    );
    txConfirmed(id, tx);
    return tx;
  } catch (e: any) {
    txError(id, e.message?.slice(0, 80) || "failed");
    throw e;
  }
}

// Re-export BN for convenience
export { BN };
