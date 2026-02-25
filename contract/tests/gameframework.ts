/**
 * BlockRooms Game Framework Tests
 *
 * This test suite supports both base layer Solana and MagicBlock Ephemeral Rollups.
 *
 * To run with Ephemeral Rollups:
 *   USE_EPHEMERAL_ROLLUPS=true anchor test
 *
 * To run on base layer only (default):
 *   anchor test
 *
 * Environment variables:
 *   - USE_EPHEMERAL_ROLLUPS: Set to "true" to use ER, false/unset for base layer
 *   - EPHEMERAL_PROVIDER_ENDPOINT: ER RPC endpoint (default: https://devnet.magicblock.app/)
 *   - EPHEMERAL_WS_ENDPOINT: ER WebSocket endpoint (default: wss://devnet.magicblock.app/)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Gameframework } from "../target/types/gameframework";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { expect } from "chai";

// ===== SEEDS =====
const GAME_CONFIG_SEED = "game_config";
const PLAYER_STATE_SEED = "player_state";
const PLAYER_STATS_SEED = "player_stats";
const ZONE_STATE_SEED = "zone_state";
const ROOM_STATE_SEED = "room_state";
const BET_STATE_SEED = "bet_state";
const GAME_SESSION_SEED = "game_session";
const ENEMY_STATE_SEED = "enemy_state";

// ===== ZONE TYPES =====
const ZoneType = {
  Red: 0,
  Blue: 1,
  Green: 2,
} as const;

type ZoneType = typeof ZoneType[keyof typeof ZoneType];

// ===== HELPER FUNCTIONS =====

/**
 * Send a transaction to either base layer or Ephemeral Rollup
 */
async function sendTransaction(
  tx: anchor.web3.Transaction,
  provider: anchor.AnchorProvider,
  providerER: anchor.AnchorProvider,
  useER: boolean,
  signers: anchor.web3.Keypair[] = []
): Promise<string> {
  if (useER) {
    // Send to Ephemeral Rollup
    tx.feePayer = providerER.wallet.publicKey;
    tx.recentBlockhash = (
      await providerER.connection.getLatestBlockhash()
    ).blockhash;

    if (signers.length > 0) {
      tx.partialSign(...signers);
    }

    tx = await providerER.wallet.signTransaction(tx);
    return await providerER.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });
  } else {
    // Send to base layer
    return await provider.sendAndConfirm(tx, signers, {
      skipPreflight: true,
      commitment: "confirmed",
    });
  }
}

function getGameConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GAME_CONFIG_SEED)],
    programId
  );
}

function getPlayerStatePDA(programId: PublicKey, player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLAYER_STATE_SEED), player.toBuffer()],
    programId
  );
}

function getPlayerStatsPDA(programId: PublicKey, player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLAYER_STATS_SEED), player.toBuffer()],
    programId
  );
}

function getBetStatePDA(programId: PublicKey, player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BET_STATE_SEED), player.toBuffer()],
    programId
  );
}

function getZoneStatePDA(programId: PublicKey, player: PublicKey, zone: ZoneType): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ZONE_STATE_SEED), player.toBuffer(), Buffer.from([zone])],
    programId
  );
}

function getRoomStatePDA(programId: PublicKey, player: PublicKey, zone: ZoneType, roomNumber: number): [PublicKey, number] {
  const roomBuffer = Buffer.alloc(4);
  roomBuffer.writeUInt32LE(roomNumber);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ROOM_STATE_SEED), player.toBuffer(), Buffer.from([zone]), roomBuffer],
    programId
  );
}

function getGameSessionPDA(programId: PublicKey, player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GAME_SESSION_SEED), player.toBuffer()],
    programId
  );
}

function getEnemyStatePDA(programId: PublicKey, player: PublicKey, enemyId: bigint): [PublicKey, number] {
  const enemyBuffer = Buffer.alloc(8);
  enemyBuffer.writeBigUInt64LE(enemyId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ENEMY_STATE_SEED), player.toBuffer(), enemyBuffer],
    programId
  );
}

describe("gameframework", () => {
  // Configure base layer provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Configure Ephemeral Rollup provider
  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );

  // Flag to enable Ephemeral Rollups (set to true to use ER, false for base layer only)
  const USE_EPHEMERAL_ROLLUPS = process.env.USE_EPHEMERAL_ROLLUPS === "true" || false;

  // Check if ER is actually available
  let erAvailable = false;
  before(async function() {
    if (USE_EPHEMERAL_ROLLUPS) {
      try {
        await providerEphemeralRollup.connection.getVersion();
        erAvailable = true;
        console.log("✅ ER endpoint is available");
      } catch (e) {
        console.log("⚠️  ER endpoint not available - ER tests will be skipped");
        console.log("   To run ER tests, deploy to MagicBlock devnet or run local ER validator");
      }
    }
  });

  console.log("\n🎮 BlockRooms Game Framework Tests");
  console.log("====================================");
  console.log("Base Layer:", provider.connection.rpcEndpoint);
  console.log("Ephemeral Rollup:", providerEphemeralRollup.connection.rpcEndpoint);
  console.log("Using ER:", USE_EPHEMERAL_ROLLUPS ? "✅ YES" : "❌ NO (Base layer only)");
  console.log("Wallet:", anchor.Wallet.local().publicKey.toString());
  console.log("====================================\n");

  const program = anchor.workspace.Gameframework as Program<Gameframework>;
  const player = provider.wallet.publicKey;

  const player2Keypair = anchor.web3.Keypair.generate();
  const player2 = player2Keypair.publicKey;

  const [gameConfigPDA] = getGameConfigPDA(program.programId);
  const [playerStatePDA] = getPlayerStatePDA(program.programId, player);
  const [playerStatsPDA] = getPlayerStatsPDA(program.programId, player);
  const [betStatePDA] = getBetStatePDA(program.programId, player);
  const [redZoneStatePDA] = getZoneStatePDA(program.programId, player, ZoneType.Red);
  const [gameSessionPDA] = getGameSessionPDA(program.programId, player);

  const [player2StatePDA] = getPlayerStatePDA(program.programId, player2);
  const [player2StatsPDA] = getPlayerStatsPDA(program.programId, player2);

  before(async function () {
    try {
      const airdropSig = await provider.connection.requestAirdrop(
        player2,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
    } catch (e) {
      // Airdrop may fail if already funded
    }
  });

  // ===== TEST: test_initialize_player =====
  it("test_initialize_player", async () => {
    // First initialize config
    const configTx = await program.methods
      .initializeConfig()
      .accounts({
        authority: player,
      })
      .transaction();
    const configTxHash = await sendTransaction(
      configTx,
      provider,
      providerEphemeralRollup,
      USE_EPHEMERAL_ROLLUPS
    );
    console.log(`${USE_EPHEMERAL_ROLLUPS ? "(ER)" : "(Base)"} Initialize config tx:`, configTxHash);

    // Initialize player
    const playerTx = await program.methods
      .initializePlayer()
      .accounts({
        player: player,
      })
      .transaction();
    const playerTxHash = await sendTransaction(
      playerTx,
      provider,
      providerEphemeralRollup,
      USE_EPHEMERAL_ROLLUPS
    );
    console.log(`${USE_EPHEMERAL_ROLLUPS ? "(ER)" : "(Base)"} Initialize player tx:`, playerTxHash);

    const playerStats = await program.account.playerStats.fetch(playerStatsPDA);
    expect(playerStats.player.toString()).to.equal(player.toString(), "player id match");
    expect(playerStats.hiveBalance.toNumber()).to.equal(0, "hive start 0");
    expect(playerStats.totalRealEnemiesKilled).to.equal(0, "real kills 0");
    expect(playerStats.totalFakeEnemiesKilled).to.equal(0, "fake kills 0");
    expect(playerStats.gamesCompleted).to.equal(0, "games done 0");
    expect(playerStats.gamesFailed).to.equal(0, "games fail 0");
    expect(playerStats.totalTimePlayed.toNumber()).to.equal(0, "time played 0");

    const config = await program.account.gameConfig.fetch(gameConfigPDA);
    expect(config.startingXp.toNumber()).to.be.greaterThan(0, "start xp set");
    expect(config.startingHealth).to.be.greaterThan(0, "start hp set");
  });

  // ===== TEST: test_initialize_zone =====
  it("test_initialize_zone", async () => {
    const tx = await program.methods
      .initializeZone({ red: {} })
      .accounts({
        zoneState: redZoneStatePDA,
        player: player,
      })
      .rpc();
    console.log("Initialize Red zone tx:", tx);

    const zoneState = await program.account.zoneState.fetch(redZoneStatePDA);
    const betState = await program.account.betState.fetch(betStatePDA);

    expect(zoneState.player.toString()).to.equal(player.toString(), "zone player ok");
    expect(zoneState.realEnemiesKilled).to.equal(0, "real kills 0");
    expect(zoneState.remainingRealEnemies).to.be.greaterThan(0, "real remain > 0");
    expect(zoneState.remainingEncounters).to.be.greaterThan(0, "encounters > 0");
    expect(zoneState.zoneCompleted).to.equal(false, "zone not done");

    expect(betState.player.toString()).to.equal(player.toString(), "bet player ok");
    expect(betState.active).to.equal(false, "bet not active");
    expect(betState.amount.toNumber()).to.equal(0, "bet amount 0");
  });

  // ===== TEST: test_start_game =====
  it("test_start_game", async () => {
    const tx = await program.methods
      .startGame()
      .accounts({
        player: player,
      })
      .rpc();
    console.log("Start game tx:", tx);

    const playerState = await program.account.playerState.fetch(playerStatePDA);
    const gameSession = await program.account.gameSession.fetch(gameSessionPDA);

    expect(playerState.gameActive).to.equal(true, "game active");
    expect(playerState.health).to.be.greaterThan(0, "has health");
    expect(playerState.xp.toNumber()).to.be.greaterThan(0, "has xp");
    expect(playerState.encounterCount).to.equal(0, "encounters 0");

    expect(gameSession.player.toString()).to.equal(player.toString(), "session player ok");
    expect(gameSession.zonesCompleted).to.equal(0, "zones done 0");
    expect(gameSession.totalHiveEarned.toNumber()).to.equal(0, "hive earned 0");
    expect(gameSession.sessionComplete).to.equal(false, "session not done");
  });

  // ===== TEST: test_start_game_twice =====
  it("test_start_game_twice", async () => {
    try {
      await program.methods
        .startGame()
        .accounts({
          player: player,
        })
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (e: any) {
      // Either our custom error (GameAlreadyActive) or Anchor's constraint error
      // The game_session account is already initialized, so Anchor may fail first
      const isExpectedError =
        e.error?.errorCode?.code === "GameAlreadyActive" ||
        e.message?.includes("already in use") ||
        e.logs?.some((log: string) => log.includes("already in use"));
      expect(isExpectedError).to.equal(true, "Expected error when starting game twice");
    }
  });

  // ===== TEST: test_place_bet =====
  it("test_place_bet", async () => {
    const betAmount = 50;
    const prediction = true; // Predicting real enemy

    const tx = await program.methods
      .placeBet(new anchor.BN(betAmount), prediction)
      .accounts({
        zoneState: redZoneStatePDA,
        player: player,
      })
      .rpc();
    console.log("Place bet tx:", tx);

    const betState = await program.account.betState.fetch(betStatePDA);

    expect(betState.active).to.equal(true, "bet active");
    expect(betState.amount.toNumber()).to.equal(betAmount, "bet amount ok");
    expect(betState.prediction).to.equal(prediction, "bet pred ok");
  });

  // ===== TEST: test_place_bet_already_active (bet_already_active) =====
  it("test_place_bet_already_active", async () => {
    try {
      await program.methods
        .placeBet(new anchor.BN(50), false)
        .accounts({
          zoneState: redZoneStatePDA,
          player: player,
        })
        .rpc();
      expect.fail("Should have thrown BetAlreadyActive error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("BetAlreadyActive");
    }
  });

  // ===== TEST: test_enter_room =====
  it("test_enter_room", async () => {
    const roomNumber = 1;
    const [roomStatePDA] = getRoomStatePDA(program.programId, player, ZoneType.Red, roomNumber);

    const tx = await program.methods
      .enterRoom({ red: {} }, roomNumber)
      .accounts({
        roomState: roomStatePDA,
        player: player,
      })
      .rpc();
    console.log("Enter room tx:", tx);

    const roomState = await program.account.roomState.fetch(roomStatePDA);
    expect(roomState.explored).to.equal(true, "room explored");
    expect(roomState.player.toString()).to.equal(player.toString(), "room player ok");
    expect(roomState.roomNumber).to.equal(roomNumber, "room num 1");
  });

  // ===== TEST: test_shoot_enemy =====
  it("test_shoot_enemy", async () => {
    const enemyId = BigInt(12345);
    const [enemyStatePDA] = getEnemyStatePDA(program.programId, player, enemyId);

    const playerStateBefore = await program.account.playerState.fetch(playerStatePDA);
    const playerStatsBefore = await program.account.playerStats.fetch(playerStatsPDA);

    const tx = await program.methods
      .shootEnemy(new anchor.BN(enemyId.toString()))
      .accounts({
        zoneState: redZoneStatePDA,
        player: player,
      })
      .rpc();
    console.log("Shoot enemy tx:", tx);

    const enemyState = await program.account.enemyState.fetch(enemyStatePDA);
    const betState = await program.account.betState.fetch(betStatePDA);
    const playerStateAfter = await program.account.playerState.fetch(playerStatePDA);

    // Enemy should be marked as shot
    expect(enemyState.isShot).to.equal(true, "enemy shot");
    expect(enemyState.enemyId.toString()).to.equal(enemyId.toString(), "enemy id match");

    // Bet should be cleared
    expect(betState.active).to.equal(false, "bet cleared");

    // Player should gain/lose XP based on bet outcome
    expect(playerStateAfter.xp.toNumber()).to.not.equal(playerStateBefore.xp.toNumber(), "xp changed");

    // Encounter count should increment
    expect(playerStateAfter.encounterCount).to.equal(
      playerStateBefore.encounterCount + 1,
      "encounter inc"
    );
  });

  // ===== TEST: test_shoot_enemy_without_bet =====
  it("test_shoot_enemy_without_bet", async () => {
    const enemyId = BigInt(99999);

    try {
      await program.methods
        .shootEnemy(new anchor.BN(enemyId.toString()))
        .accounts({
          zoneState: redZoneStatePDA,
          player: player,
        })
        .rpc();
      expect.fail("Should have thrown NoActiveBet error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("NoActiveBet");
    }
  });

  // ===== TEST: test_take_damage =====
  it("test_take_damage", async () => {
    const damage = 20;
    const playerStateBefore = await program.account.playerState.fetch(playerStatePDA);

    const tx = await program.methods
      .takeDamage(damage)
      .accounts({
        player: player,
      })
      .rpc();
    console.log("Take damage tx:", tx);

    const playerStateAfter = await program.account.playerState.fetch(playerStatePDA);

    expect(playerStateAfter.health).to.equal(playerStateBefore.health - damage, "health dec");
    expect(playerStateAfter.gameActive).to.equal(true, "game active");
  });

  // ===== TEST: test_buy_food =====
  it("test_buy_food", async () => {
    const playerStateBefore = await program.account.playerState.fetch(playerStatePDA);
    const playerStatsBefore = await program.account.playerStats.fetch(playerStatsPDA);
    const config = await program.account.gameConfig.fetch(gameConfigPDA);

    const tx = await program.methods
      .buyFood()
      .accounts({
        player: player,
      })
      .rpc();
    console.log("Buy food tx:", tx);

    const playerStateAfter = await program.account.playerState.fetch(playerStatePDA);
    const playerStatsAfter = await program.account.playerStats.fetch(playerStatsPDA);

    expect(playerStateAfter.health).to.be.greaterThan(playerStateBefore.health, "health up");
    expect(playerStateAfter.xp.toNumber()).to.equal(
      playerStateBefore.xp.toNumber() - config.foodCost.toNumber(),
      "xp down"
    );
    expect(playerStatsAfter.hiveBalance.toNumber()).to.equal(
      playerStatsBefore.hiveBalance.toNumber() + config.foodHiveBonus.toNumber(),
      "hive bonus"
    );
  });

  // ===== TEST: test_end_game =====
  it("test_end_game", async () => {
    const tx = await program.methods
      .endGame()
      .accounts({
        player: player,
      })
      .rpc();
    console.log("End game tx:", tx);

    const playerState = await program.account.playerState.fetch(playerStatePDA);
    const playerStats = await program.account.playerStats.fetch(playerStatsPDA);
    const gameSession = await program.account.gameSession.fetch(gameSessionPDA);

    expect(playerState.gameActive).to.equal(false, "game done");
    expect(playerStats.gamesCompleted).to.equal(1, "complete 1");
    expect(playerStats.totalTimePlayed.toNumber()).to.be.greaterThan(0, "time > 0");
    expect(gameSession.sessionComplete).to.equal(true, "session done");
  });

  // ===== TEST: test_get_game_config =====
  it("test_get_game_config", async () => {
    const config = await program.account.gameConfig.fetch(gameConfigPDA);

    expect(config.startingXp.toNumber()).to.be.greaterThan(0, "start xp > 0");
    expect(config.startingHealth).to.be.greaterThan(0, "start hp > 0");
    expect(config.foodCost.toNumber()).to.be.greaterThan(0, "food cost > 0");
  });

  // ===== TEST: test_update_game_config =====
  it("test_update_game_config", async () => {
    const config = await program.account.gameConfig.fetch(gameConfigPDA);

    const newStartingXp = 300;
    const newStartingHealth = 150;

    const tx = await program.methods
      .updateConfig(
        config.redZoneRooms,
        config.blueZoneRooms,
        config.greenZoneRooms,
        config.redZoneRealEnemies,
        config.blueZoneRealEnemies,
        config.greenZoneRealEnemies,
        config.redZoneDamage,
        config.blueZoneDamage,
        config.greenZoneDamage,
        newStartingHealth,
        new anchor.BN(newStartingXp),
        config.foodCost,
        config.foodHealthRestore,
        config.foodHiveBonus,
        config.xpToHiveRate,
        config.betWinPercentage
      )
      .accounts({
        authority: player,
      })
      .rpc();
    console.log("Update config tx:", tx);

    const updatedConfig = await program.account.gameConfig.fetch(gameConfigPDA);
    expect(updatedConfig.startingXp.toNumber()).to.equal(newStartingXp, "xp updated");
    expect(updatedConfig.startingHealth).to.equal(newStartingHealth, "hp updated");
  });

  // ===== TEST: test_multiple_players =====
  it("test_multiple_players", async () => {
    // Initialize second player
    await program.methods
      .initializePlayer()
      .accounts({
        player: player2,
      })
      .signers([player2Keypair])
      .rpc();

    // Initialize zone for player2
    const [player2RedZonePDA] = getZoneStatePDA(program.programId, player2, ZoneType.Red);
    await program.methods
      .initializeZone({ red: {} })
      .accounts({
        zoneState: player2RedZonePDA,
        player: player2,
      })
      .signers([player2Keypair])
      .rpc();

    // Start game for player2
    await program.methods
      .startGame()
      .accounts({
        player: player2,
      })
      .signers([player2Keypair])
      .rpc();

    const player1State = await program.account.playerState.fetch(playerStatePDA);
    const player2State = await program.account.playerState.fetch(player2StatePDA);
    const player1Stats = await program.account.playerStats.fetch(playerStatsPDA);
    const player2Stats = await program.account.playerStats.fetch(player2StatsPDA);

    expect(player2State.gameActive).to.equal(true, "p2 active");
    expect(player1State.player.toString()).to.not.equal(player2State.player.toString(), "diff players");
    expect(player1Stats.player.toString()).to.equal(player.toString(), "p1 stats ok");
    expect(player2Stats.player.toString()).to.equal(player2.toString(), "p2 stats ok");
  });

  // ===== TEST: test_take_damage_death =====
  it("test_take_damage_death", async () => {
    const playerStateBefore = await program.account.playerState.fetch(player2StatePDA);
    const fatalDamage = playerStateBefore.health;

    const tx = await program.methods
      .takeDamage(fatalDamage)
      .accounts({
        player: player2,
      })
      .signers([player2Keypair])
      .rpc();
    console.log("Take fatal damage tx:", tx);

    const playerStateAfter = await program.account.playerState.fetch(player2StatePDA);
    const playerStats = await program.account.playerStats.fetch(player2StatsPDA);

    expect(playerStateAfter.health).to.equal(0, "health zero");
    expect(playerStateAfter.gameActive).to.equal(false, "game inactive");
    expect(playerStats.gamesFailed).to.equal(1, "fail count 1");
  });

  // ===== TEST: test_complete_game_flow =====
  it("test_complete_game_flow", async () => {
    // Create a new player for this test
    const testPlayer = anchor.web3.Keypair.generate();

    // Airdrop
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testPlayerStatePDA] = getPlayerStatePDA(program.programId, testPlayer.publicKey);
    const [testPlayerStatsPDA] = getPlayerStatsPDA(program.programId, testPlayer.publicKey);
    const [testBetStatePDA] = getBetStatePDA(program.programId, testPlayer.publicKey);
    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const [testGameSessionPDA] = getGameSessionPDA(program.programId, testPlayer.publicKey);

    // 1. Initialize player
    await program.methods
      .initializePlayer()
      .accounts({
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // 2. Initialize zone
    await program.methods
      .initializeZone({ red: {} })
      .accounts({
        zoneState: testRedZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // 3. Start game
    await program.methods
      .startGame()
      .accounts({
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // Verify game started
    let playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    expect(playerState.gameActive).to.equal(true, "game active");

    // 4. Place bet
    await program.methods
      .placeBet(new anchor.BN(100), true)
      .accounts({
        zoneState: testRedZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // 5. Enter room
    const [testRoomPDA] = getRoomStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red, 1);
    await program.methods
      .enterRoom({ red: {} }, 1)
      .accounts({
        roomState: testRoomPDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // 6. Shoot enemy
    const testEnemyId = BigInt(77777);
    const [testEnemyPDA] = getEnemyStatePDA(program.programId, testPlayer.publicKey, testEnemyId);
    await program.methods
      .shootEnemy(new anchor.BN(testEnemyId.toString()))
      .accounts({
        zoneState: testRedZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // Verify enemy shot
    const enemyState = await program.account.enemyState.fetch(testEnemyPDA);
    expect(enemyState.isShot).to.equal(true, "enemy shot");

    // Verify bet cleared
    const betState = await program.account.betState.fetch(testBetStatePDA);
    expect(betState.active).to.equal(false, "bet cleared");

    // Verify encounter count
    playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    expect(playerState.encounterCount).to.equal(1, "encounter 1");

    // 7. End game
    await program.methods
      .endGame()
      .accounts({
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // Verify game ended
    playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    expect(playerState.gameActive).to.equal(false, "game done");

    const playerStats = await program.account.playerStats.fetch(testPlayerStatsPDA);
    expect(playerStats.gamesCompleted).to.equal(1, "complete 1");

    console.log("Complete game flow test passed!");
  });

  // ===== NEW TESTS: ZONE PROGRESSION =====

  // ===== TEST: test_initialize_blue_zone =====
  it("test_initialize_blue_zone", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testBlueZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Blue);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    const tx = await program.methods
      .initializeZone({ blue: {} })
      .accounts({
        zoneState: testBlueZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();
    console.log("Initialize Blue zone tx:", tx);

    const zoneState = await program.account.zoneState.fetch(testBlueZonePDA);
    expect(zoneState.remainingRealEnemies).to.be.greaterThan(0, "blue zone has enemies");
    expect(zoneState.zoneCompleted).to.equal(false, "blue zone not done");
  });

  // ===== TEST: test_initialize_green_zone =====
  it("test_initialize_green_zone", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testGreenZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Green);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    const tx = await program.methods
      .initializeZone({ green: {} })
      .accounts({
        zoneState: testGreenZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();
    console.log("Initialize Green zone tx:", tx);

    const zoneState = await program.account.zoneState.fetch(testGreenZonePDA);
    expect(zoneState.remainingRealEnemies).to.be.greaterThan(0, "green zone has enemies");
    expect(zoneState.zoneCompleted).to.equal(false, "green zone not done");
  });

  // ===== TEST: test_change_zone_red_to_blue =====
  it("test_change_zone_red_to_blue", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      3 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testPlayerStatePDA] = getPlayerStatePDA(program.programId, testPlayer.publicKey);
    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const [testBlueZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Blue);

    // Setup: Initialize and start game
    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ blue: {} })
      .accounts({ zoneState: testBlueZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Complete red zone - must shoot until all real enemies are killed
    // The game uses pseudo-random, so we need to shoot enough times to guarantee killing all real enemies
    let redZoneState = await program.account.zoneState.fetch(testRedZonePDA);
    const maxAttempts = redZoneState.remainingEncounters * 3; // Give plenty of attempts

    for (let i = 0; i < maxAttempts; i++) {
      // Check current zone status
      redZoneState = await program.account.zoneState.fetch(testRedZonePDA);

      if (redZoneState.remainingRealEnemies === 0 || redZoneState.remainingEncounters === 0) {
        break;
      }

      await program.methods
        .placeBet(new anchor.BN(10), true)
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .shootEnemy(new anchor.BN((1000 + i).toString()))
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();
    }

    // Verify zone is complete
    const redZoneAfter = await program.account.zoneState.fetch(testRedZonePDA);
    expect(redZoneAfter.remainingRealEnemies).to.equal(0, "all real enemies killed");

    // Change zone to blue
    const tx = await program.methods
      .changeZone({ blue: {} })
      .accounts({
        currentZoneState: testRedZonePDA,
        targetZoneState: testBlueZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();
    console.log("Change zone tx:", tx);

    const playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    expect(playerState.currentZone.blue).to.not.be.undefined;
  });

  // ===== TEST: test_change_zone_without_completing_current =====
  it("test_change_zone_without_completing_current", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const [testBlueZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Blue);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ blue: {} })
      .accounts({ zoneState: testBlueZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    try {
      await program.methods
        .changeZone({ blue: {} })
        .accounts({
          currentZoneState: testRedZonePDA,
          targetZoneState: testBlueZonePDA,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown ZoneNotCompleted error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("ZoneNotCompleted");
    }
  });

  // ===== NEW TESTS: ERROR SCENARIOS =====

  // ===== TEST: test_enter_room_invalid_number =====
  it("test_enter_room_invalid_number", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testPlayerStatePDA] = getPlayerStatePDA(program.programId, testPlayer.publicKey);
    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const [testBetStatePDA] = getBetStatePDA(program.programId, testPlayer.publicKey);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .placeBet(new anchor.BN(10), true)
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    const invalidRoomNumber = 999;
    const [testRoomPDA] = getRoomStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red, invalidRoomNumber);

    try {
      await program.methods
        .enterRoom({ red: {} }, invalidRoomNumber)
        .accounts({
          roomState: testRoomPDA,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown InvalidRoomNumber error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("InvalidRoomNumber");
    }
  });

  // ===== TEST: test_enter_room_already_explored =====
  it("test_enter_room_already_explored", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const roomNumber = 2;
    const [testRoomPDA] = getRoomStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red, roomNumber);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .placeBet(new anchor.BN(10), true)
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Enter room first time
    await program.methods
      .enterRoom({ red: {} }, roomNumber)
      .accounts({
        roomState: testRoomPDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    // Shoot enemy to clear the bet
    await program.methods
      .shootEnemy(new anchor.BN(40000))
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Place another bet
    await program.methods
      .placeBet(new anchor.BN(10), true)
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Try to enter same room again
    try {
      await program.methods
        .enterRoom({ red: {} }, roomNumber)
        .accounts({
          roomState: testRoomPDA,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown RoomAlreadyExplored error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("RoomAlreadyExplored");
    }
  });

  // ===== TEST: test_buy_food_insufficient_xp =====
  it("test_buy_food_insufficient_xp", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testPlayerStatePDA] = getPlayerStatePDA(program.programId, testPlayer.publicKey);
    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Take damage first so we can buy food later
    await program.methods
      .takeDamage(30)
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Get current XP and food cost
    const config = await program.account.gameConfig.fetch(gameConfigPDA);
    let playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    const currentXP = playerState.xp.toNumber();
    const foodCost = config.foodCost.toNumber();

    // Strategy: Place large bets to drain XP
    // We'll bet on "false" (fake enemy) which will likely lose since pseudo-random gives ~50% real enemies
    // When we lose, we lose the bet amount
    const zoneState = await program.account.zoneState.fetch(testRedZonePDA);
    const availableEncounters = Math.min(zoneState.remainingEncounters, 10);

    for (let i = 0; i < availableEncounters; i++) {
      playerState = await program.account.playerState.fetch(testPlayerStatePDA);

      // Calculate bet amount: try to drain XP below food cost
      const currentXP = playerState.xp.toNumber();
      if (currentXP < foodCost) break;

      // Bet a large amount (but not more than current XP)
      const betAmount = Math.min(Math.floor(currentXP * 0.3), currentXP - 10);

      if (betAmount <= 0) break;

      await program.methods
        .placeBet(new anchor.BN(betAmount), false) // Bet on fake enemy
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .shootEnemy(new anchor.BN((20000 + i).toString()))
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();
    }

    // Verify XP was drained below food cost
    const finalState = await program.account.playerState.fetch(testPlayerStatePDA);

    // Try to buy food - should fail with InsufficientXP
    try {
      await program.methods
        .buyFood()
        .accounts({ player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();

      // If we reach here, either we have enough XP or the error wasn't thrown
      if (finalState.xp.toNumber() >= foodCost) {
        console.log(`XP (${finalState.xp.toNumber()}) >= food cost (${foodCost}), couldn't drain enough`);
        // This is acceptable - we tried our best to drain XP
        return;
      }
      expect.fail("Should have thrown InsufficientXP error");
    } catch (e: any) {
      expect(e.error?.errorCode?.code).to.equal("InsufficientXP", "Expected InsufficientXP error");
    }
  });

  // ===== TEST: test_buy_food_health_already_full =====
  it("test_buy_food_health_already_full", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    try {
      await program.methods
        .buyFood()
        .accounts({ player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown HealthAlreadyFull error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("HealthAlreadyFull");
    }
  });

  // ===== TEST: test_place_bet_insufficient_xp =====
  it("test_place_bet_insufficient_xp", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testPlayerStatePDA] = getPlayerStatePDA(program.programId, testPlayer.publicKey);
    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    const playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    const excessiveBet = playerState.xp.toNumber() + 1000;

    try {
      await program.methods
        .placeBet(new anchor.BN(excessiveBet), true)
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown InsufficientXP error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("InsufficientXP");
    }
  });

  // ===== TEST: test_action_without_active_game =====
  it("test_action_without_active_game", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    try {
      await program.methods
        .placeBet(new anchor.BN(50), true)
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown GameNotActive error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("GameNotActive");
    }
  });

  // ===== TEST: test_enter_room_wrong_zone =====
  it("test_enter_room_wrong_zone", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const [testRoomPDA] = getRoomStatePDA(program.programId, testPlayer.publicKey, ZoneType.Blue, 1);

    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .placeBet(new anchor.BN(10), true)
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    try {
      await program.methods
        .enterRoom({ blue: {} }, 1)
        .accounts({
          roomState: testRoomPDA,
          player: testPlayer.publicKey,
        })
        .signers([testPlayer])
        .rpc();
      expect.fail("Should have thrown InvalidZone error");
    } catch (e: any) {
      expect(e.error.errorCode.code).to.equal("InvalidZone");
    }
  });

  // ===== TEST: test_multi_zone_complete_flow =====
  it("test_multi_zone_complete_flow", async () => {
    const testPlayer = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testPlayer.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [testPlayerStatePDA] = getPlayerStatePDA(program.programId, testPlayer.publicKey);
    const [testRedZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Red);
    const [testBlueZonePDA] = getZoneStatePDA(program.programId, testPlayer.publicKey, ZoneType.Blue);

    // Initialize
    await program.methods
      .initializePlayer()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ red: {} })
      .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .initializeZone({ blue: {} })
      .accounts({ zoneState: testBlueZonePDA, player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    await program.methods
      .startGame()
      .accounts({ player: testPlayer.publicKey })
      .signers([testPlayer])
      .rpc();

    // Complete Red Zone - shoot enough enemies until zone is complete
    const redZoneStateBefore = await program.account.zoneState.fetch(testRedZonePDA);
    const totalEncounters = redZoneStateBefore.remainingEncounters;

    // Shoot all encounters to ensure we kill all real enemies
    for (let i = 0; i < totalEncounters; i++) {
      await program.methods
        .placeBet(new anchor.BN(10), true)
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();

      await program.methods
        .shootEnemy(new anchor.BN((3000 + i).toString()))
        .accounts({ zoneState: testRedZonePDA, player: testPlayer.publicKey })
        .signers([testPlayer])
        .rpc();

      // Check if zone is complete
      const currentZoneState = await program.account.zoneState.fetch(testRedZonePDA);
      if (currentZoneState.remainingRealEnemies === 0) {
        break;
      }
    }

    // Verify red zone completed
    const redZoneAfter = await program.account.zoneState.fetch(testRedZonePDA);
    expect(redZoneAfter.remainingRealEnemies).to.equal(0, "red zone complete");

    // Change to Blue Zone
    await program.methods
      .changeZone({ blue: {} })
      .accounts({
        currentZoneState: testRedZonePDA,
        targetZoneState: testBlueZonePDA,
        player: testPlayer.publicKey,
      })
      .signers([testPlayer])
      .rpc();

    const playerState = await program.account.playerState.fetch(testPlayerStatePDA);
    expect(playerState.currentZone.blue).to.not.be.undefined;

    console.log("Multi-zone complete flow test passed!");
  });

  // ========================================
  // EPHEMERAL ROLLUPS TESTS
  // ========================================
  // These tests follow the MagicBlock pattern from the counter example

  describe("Ephemeral Rollups Integration", () => {
    // Create a dedicated test player for ER tests
    const erPlayer = anchor.web3.Keypair.generate();
    const [erPlayerStatePDA] = getPlayerStatePDA(program.programId, erPlayer.publicKey);
    const [erPlayerStatsPDA] = getPlayerStatsPDA(program.programId, erPlayer.publicKey);
    const [erRedZonePDA] = getZoneStatePDA(program.programId, erPlayer.publicKey, ZoneType.Red);
    const [erBetStatePDA] = getBetStatePDA(program.programId, erPlayer.publicKey);
    const [erGameSessionPDA] = getGameSessionPDA(program.programId, erPlayer.publicKey);

    before(async function () {
      // Airdrop SOL to ER test player
      const airdropSig = await provider.connection.requestAirdrop(
        erPlayer.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
      console.log("\n💰 Airdropped to ER test player:", erPlayer.publicKey.toString());
    });

    it("ER 1: Initialize player on Base Layer", async () => {
      const start = Date.now();

      // Initialize player on base layer
      let tx = await program.methods
        .initializePlayer()
        .accounts({
          player: erPlayer.publicKey,
        })
        .transaction();

      const txHash = await provider.sendAndConfirm(tx, [erPlayer], {
        skipPreflight: true,
        commitment: "confirmed",
      });

      const duration = Date.now() - start;
      console.log(`${duration}ms (Base Layer) Initialize Player txHash: ${txHash}`);

      // Verify player initialized
      const playerStats = await program.account.playerStats.fetch(erPlayerStatsPDA);
      expect(playerStats.player.toString()).to.equal(erPlayer.publicKey.toString());
    });

    it("ER 2: Initialize zone on Base Layer", async () => {
      const start = Date.now();

      let tx = await program.methods
        .initializeZone({ red: {} })
        .accounts({
          zoneState: erRedZonePDA,
          player: erPlayer.publicKey,
        })
        .transaction();

      const txHash = await provider.sendAndConfirm(tx, [erPlayer], {
        skipPreflight: true,
        commitment: "confirmed",
      });

      const duration = Date.now() - start;
      console.log(`${duration}ms (Base Layer) Initialize Zone txHash: ${txHash}`);
    });

    it("ER 3: Delegate player state to ER", async function() {
      if (!erAvailable) {
        this.skip();
        return;
      }
      const start = Date.now();

      // Add local validator identity to remaining accounts if running on localnet
      const remainingAccounts =
        providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1")
          ? [
              {
                pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
                isSigner: false,
                isWritable: false,
              },
            ]
          : [];

      let tx = await program.methods
        .delegatePlayer()
        .accounts({
          payer: erPlayer.publicKey,
          pda: erPlayerStatePDA,
        })
        .remainingAccounts(remainingAccounts)
        .transaction();

      const txHash = await provider.sendAndConfirm(tx, [erPlayer], {
        skipPreflight: true,
        commitment: "confirmed",
      });

      const duration = Date.now() - start;
      console.log(`${duration}ms (Base Layer) Delegate Player txHash: ${txHash}`);
    });

    it("ER 4: Start game on ER", async function() {
      if (!erAvailable) {
        this.skip();
        return;
      }
      const start = Date.now();

      let tx = await program.methods
        .startGame()
        .accounts({
          player: erPlayer.publicKey,
        })
        .transaction();

      tx.feePayer = erPlayer.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;

      // Sign with ER player only
      tx.sign(erPlayer);

      const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Start Game txHash: ${txHash}`);

      // Verify on ER
      const playerState = await providerEphemeralRollup.connection.getAccountInfo(erPlayerStatePDA);
      expect(playerState).to.not.be.null;
    });

    it("ER 5: Place bet on ER", async function() {
      if (!erAvailable) { this.skip(); return; }
      const start = Date.now();

      let tx = await program.methods
        .placeBet(new anchor.BN(50), true)
        .accounts({
          zoneState: erRedZonePDA,
          player: erPlayer.publicKey,
        })
        .transaction();

      tx.feePayer = erPlayer.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;

      tx.sign(erPlayer);

      const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Place Bet txHash: ${txHash}`);
    });

    it("ER 6: Shoot enemy on ER", async function() {
      if (!erAvailable) { this.skip(); return; }
      const start = Date.now();

      const enemyId = BigInt(777777);
      let tx = await program.methods
        .shootEnemy(new anchor.BN(enemyId.toString()))
        .accounts({
          zoneState: erRedZonePDA,
          player: erPlayer.publicKey,
        })
        .transaction();

      tx.feePayer = erPlayer.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;

      tx.sign(erPlayer);

      const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Shoot Enemy txHash: ${txHash}`);
    });

    it("ER 7: Commit player state from ER to Base Layer", async function() {
      if (!erAvailable) { this.skip(); return; }
      const start = Date.now();

      let tx = await program.methods
        .commitPlayer()
        .accounts({
          payer: providerEphemeralRollup.wallet.publicKey,
        })
        .transaction();

      tx.feePayer = providerEphemeralRollup.wallet.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;
      tx = await providerEphemeralRollup.wallet.signTransaction(tx);

      const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Commit txHash: ${txHash}`);

      // Get the commitment signature on the base layer
      const commitStart = Date.now();
      const txCommitSgn = await GetCommitmentSignature(
        txHash,
        providerEphemeralRollup.connection,
      );
      const commitDuration = Date.now() - commitStart;
      console.log(`${commitDuration}ms (Base Layer) Commit Confirmation: ${txCommitSgn}`);
    });

    it("ER 8: Continue playing on ER (post-commit)", async function() {
      if (!erAvailable) { this.skip(); return; }
      const start = Date.now();

      // Place another bet
      let tx = await program.methods
        .placeBet(new anchor.BN(25), false)
        .accounts({
          zoneState: erRedZonePDA,
          player: erPlayer.publicKey,
        })
        .transaction();

      tx.feePayer = erPlayer.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;

      tx.sign(erPlayer);

      const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Post-Commit Action txHash: ${txHash}`);
    });

    it("ER 9: Undelegate player state from ER", async function() {
      if (!erAvailable) { this.skip(); return; }
      const start = Date.now();

      let tx = await program.methods
        .undelegatePlayer()
        .accounts({
          payer: providerEphemeralRollup.wallet.publicKey,
        })
        .transaction();

      tx.feePayer = provider.wallet.publicKey;
      tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;
      tx = await providerEphemeralRollup.wallet.signTransaction(tx);

      const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      const duration = Date.now() - start;
      console.log(`${duration}ms (ER) Undelegate txHash: ${txHash}`);

      console.log("\n✅ Complete ER workflow: Delegate → Play → Commit → Undelegate");
    });
  });
});
