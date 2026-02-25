/**
 * BlockRooms - Comprehensive ER Integration Test
 * Tests ALL gameplay functions on MagicBlock Ephemeral Rollups.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Gameframework } from "../target/types/gameframework";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { expect } from "chai";

const GAME_CONFIG_SEED = "game_config";
const PLAYER_STATE_SEED = "player_state";
const PLAYER_STATS_SEED = "player_stats";
const ZONE_STATE_SEED = "zone_state";
const GAME_SESSION_SEED = "game_session";

function getPDA(programId: PublicKey, seeds: (Buffer | Uint8Array)[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/** Send raw tx to ER with manual confirmation */
async function sendAndConfirmER(
  connection: anchor.web3.Connection,
  tx: anchor.web3.Transaction,
): Promise<string> {
  const rawTx = tx.serialize();
  const txHash = await connection.sendRawTransaction(rawTx, { skipPreflight: true });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const confirmation = await connection.confirmTransaction(
    { signature: txHash, blockhash, lastValidBlockHeight }, "confirmed"
  );
  if (confirmation.value.err) {
    const txInfo = await connection.getTransaction(txHash, {
      commitment: "confirmed", maxSupportedTransactionVersion: 0,
    });
    const logs = txInfo?.meta?.logMessages || [];
    throw new Error(`ER TX failed: ${JSON.stringify(confirmation.value.err)}\nLogs:\n${logs.join("\n")}`);
  }
  return txHash;
}

describe("BlockRooms - Full ER Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerER = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
      { wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/" },
    ),
    anchor.Wallet.local(),
  );

  const program = anchor.workspace.Gameframework as Program<Gameframework>;
  const freshPlayer = anchor.web3.Keypair.generate();
  const player = freshPlayer.publicKey;

  const [gameConfigPDA] = getPDA(program.programId, [Buffer.from(GAME_CONFIG_SEED)]);
  const [playerStatePDA] = getPDA(program.programId, [Buffer.from(PLAYER_STATE_SEED), player.toBuffer()]);
  const [playerStatsPDA] = getPDA(program.programId, [Buffer.from(PLAYER_STATS_SEED), player.toBuffer()]);
  const [redZonePDA] = getPDA(program.programId, [Buffer.from(ZONE_STATE_SEED), player.toBuffer(), Buffer.from([0])]);
  const [blueZonePDA] = getPDA(program.programId, [Buffer.from(ZONE_STATE_SEED), player.toBuffer(), Buffer.from([1])]);
  const [gameSessionPDA] = getPDA(program.programId, [Buffer.from(GAME_SESSION_SEED), player.toBuffer()]);

  console.log("\n=== BlockRooms Full ER Test ===");
  console.log("Program:", program.programId.toString());
  console.log("Player:", player.toString());
  console.log("==============================\n");

  /** Send base layer tx signed by freshPlayer */
  async function sendBase(tx: anchor.web3.Transaction): Promise<string> {
    tx.feePayer = freshPlayer.publicKey;
    const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(freshPlayer);
    const rawTx = tx.serialize();
    const txHash = await provider.connection.sendRawTransaction(rawTx, { skipPreflight: true });
    await provider.connection.confirmTransaction(
      { signature: txHash, blockhash, lastValidBlockHeight }, "confirmed"
    );
    return txHash;
  }

  /** Send ER tx signed by freshPlayer */
  async function sendER(tx: anchor.web3.Transaction): Promise<string> {
    tx.feePayer = freshPlayer.publicKey;
    tx.recentBlockhash = (await providerER.connection.getLatestBlockhash()).blockhash;
    tx.sign(freshPlayer);
    return await sendAndConfirmER(providerER.connection, tx);
  }

  /** Delegate a PDA to ER */
  async function delegatePDA(methodName: string, pda: PublicKey, args?: any[]): Promise<string> {
    let builder = args?.length
      ? (program.methods as any)[methodName](...args)
      : (program.methods as any)[methodName]();
    let tx = await builder.accounts({ payer: player, pda }).transaction();
    return await sendBase(tx);
  }

  before(async function () {
    try {
      await providerER.connection.getVersion();
    } catch (e) {
      console.log("ER not available, skipping");
      this.skip();
    }
    const airdropSig = await provider.connection.requestAirdrop(player, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig);
    console.log("Player funded: 2 SOL\n");
  });

  // ========================================
  // PHASE 1: Base Layer Setup
  // ========================================

  it("1. Init config (base)", async () => {
    try { await program.account.gameConfig.fetch(gameConfigPDA); console.log("  exists"); return; } catch {}
    await sendBase(await program.methods.initializeConfig().accounts({ authority: player }).transaction());
    console.log("  done");
  });

  it("2. Init player (base)", async () => {
    await sendBase(await program.methods.initializePlayer().accounts({ player }).transaction());
    const ps = await program.account.playerState.fetch(playerStatePDA);
    expect(ps.player.toString()).to.equal(player.toString());
    console.log("  done");
  });

  it("3. Init Red zone (base)", async () => {
    await sendBase(await program.methods.initializeZone({ red: {} }).accounts({ zoneState: redZonePDA, player }).transaction());
    console.log("  done");
  });

  it("4. Init Blue zone (base)", async () => {
    await sendBase(await program.methods.initializeZone({ blue: {} }).accounts({ zoneState: blueZonePDA, player }).transaction());
    console.log("  done");
  });

  it("5. Start game (base)", async () => {
    await sendBase(await program.methods.startGame().accounts({ player }).transaction());
    const ps = await program.account.playerState.fetch(playerStatePDA);
    expect(ps.gameActive).to.equal(true);
    console.log(`  Health: ${ps.health}, XP: ${ps.xp}`);
  });

  // ========================================
  // PHASE 2: Delegate ALL writable accounts
  // ========================================

  it("6. Delegate all accounts", async () => {
    const start = Date.now();
    await delegatePDA("delegatePlayer", playerStatePDA);
    await delegatePDA("delegatePlayerStats", playerStatsPDA);
    await delegatePDA("delegateZoneState", redZonePDA, [0]);
    await delegatePDA("delegateZoneState", blueZonePDA, [1]);
    await delegatePDA("delegateGameSession", gameSessionPDA);
    console.log(`  5 accounts delegated (${Date.now() - start}ms)`);
  });

  // ========================================
  // PHASE 3: Test ALL gameplay on ER
  // ========================================

  it("7. enter_room on ER", async () => {
    const start = Date.now();
    const tx = await program.methods.enterRoom({ red: {} }, 1)
      .accounts({ zoneState: redZonePDA, player }).transaction();
    const txHash = await sendER(tx);
    console.log(`  ${Date.now() - start}ms txHash: ${txHash.slice(0, 20)}...`);
  });

  it("8. shoot_enemy on ER", async () => {
    const start = Date.now();
    const tx = await program.methods.shootEnemy(new anchor.BN(Date.now().toString()))
      .accounts({ zoneState: redZonePDA, player }).transaction();
    const txHash = await sendER(tx);
    console.log(`  ${Date.now() - start}ms txHash: ${txHash.slice(0, 20)}...`);
  });

  it("9. take_damage on ER", async () => {
    const start = Date.now();
    const tx = await program.methods.takeDamage(10)
      .accounts({ player }).transaction();
    const txHash = await sendER(tx);
    console.log(`  ${Date.now() - start}ms txHash: ${txHash.slice(0, 20)}...`);
  });

  it("10. buy_food on ER", async () => {
    const start = Date.now();
    const tx = await program.methods.buyFood()
      .accounts({ player }).transaction();
    const txHash = await sendER(tx);
    console.log(`  ${Date.now() - start}ms txHash: ${txHash.slice(0, 20)}...`);
  });

  it("11. Multiple shoot cycles on ER", async () => {
    const start = Date.now();
    let cycles = 0;
    // Run multiple shoot cycles to clear zone
    for (let i = 0; i < 5; i++) {
      try {
        const shootTx = await program.methods.shootEnemy(new anchor.BN((Date.now() + i).toString()))
          .accounts({ zoneState: redZonePDA, player }).transaction();
        await sendER(shootTx);
        cycles++;
      } catch (e) {
        // Zone might be complete
        break;
      }
    }
    console.log(`  ${cycles} cycles completed (${Date.now() - start}ms)`);
  });

  it("12. change_zone on ER (Red -> Blue)", async () => {
    const start = Date.now();

    // First check if red zone is complete, if not complete it
    const erProgram = new anchor.Program(program.idl, providerER);
    let zs = await erProgram.account.zoneState.fetch(redZonePDA);
    while (zs.remainingRealEnemies > 0) {
      const shootTx = await program.methods.shootEnemy(new anchor.BN(Date.now().toString()))
        .accounts({ zoneState: redZonePDA, player }).transaction();
      await sendER(shootTx);
      zs = await erProgram.account.zoneState.fetch(redZonePDA);
    }

    const tx = await program.methods.changeZone({ blue: {} })
      .accounts({
        currentZoneState: redZonePDA,
        targetZoneState: blueZonePDA,
        player,
      }).transaction();
    const txHash = await sendER(tx);
    console.log(`  ${Date.now() - start}ms txHash: ${txHash.slice(0, 20)}...`);

    const ps = await erProgram.account.playerState.fetch(playerStatePDA);
    expect(ps.currentZone.blue).to.not.be.undefined;
    console.log("  Zone changed to Blue");
  });

  it("13. end_game on ER", async () => {
    const start = Date.now();
    const tx = await program.methods.endGame()
      .accounts({ player }).transaction();
    const txHash = await sendER(tx);
    console.log(`  ${Date.now() - start}ms txHash: ${txHash.slice(0, 20)}...`);

    const erProgram = new anchor.Program(program.idl, providerER);
    const ps = await erProgram.account.playerState.fetch(playerStatePDA);
    expect(ps.gameActive).to.equal(false);
    const stats = await erProgram.account.playerStats.fetch(playerStatsPDA);
    console.log(`  Game ended. Hive: ${stats.hiveBalance}, Games completed: ${stats.gamesCompleted}`);
  });

  // ========================================
  // PHASE 4: Commit & Undelegate
  // ========================================

  it("14. Commit from ER", async () => {
    const start = Date.now();
    let tx = await program.methods.commitPlayer()
      .accounts({ payer: freshPlayer.publicKey }).transaction();
    tx.feePayer = freshPlayer.publicKey;
    tx.recentBlockhash = (await providerER.connection.getLatestBlockhash()).blockhash;
    tx.sign(freshPlayer);
    const txHash = await sendAndConfirmER(providerER.connection, tx);
    const txCommitSgn = await GetCommitmentSignature(txHash, providerER.connection);
    console.log(`  ${Date.now() - start}ms Commit confirmed: ${txCommitSgn.slice(0, 20)}...`);
  });

  it("15. Undelegate from ER", async () => {
    const start = Date.now();
    let tx = await program.methods.undelegatePlayer()
      .accounts({ payer: freshPlayer.publicKey }).transaction();
    tx.feePayer = freshPlayer.publicKey;
    tx.recentBlockhash = (await providerER.connection.getLatestBlockhash()).blockhash;
    tx.sign(freshPlayer);
    const txHash = await sendAndConfirmER(providerER.connection, tx);
    console.log(`  ${Date.now() - start}ms Undelegate done`);

    // Verify state persisted on base layer
    const ps = await program.account.playerState.fetch(playerStatePDA);
    expect(ps.gameActive).to.equal(false);
    console.log("\n=== ALL FUNCTIONS VERIFIED ON ER ===");
    console.log("  enter_room     ✅");
    console.log("  shoot_enemy    ✅");
    console.log("  take_damage    ✅");
    console.log("  buy_food       ✅");
    console.log("  change_zone    ✅");
    console.log("  end_game       ✅");
    console.log("  commit         ✅");
    console.log("  undelegate     ✅");
    console.log("====================================\n");
  });
});
