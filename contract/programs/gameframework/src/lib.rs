use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("9noA6NrVVSLjacxEnu2FqNAxPa7bqNVsRnUV12FXf7Tc");

// ===== SEEDS =====
pub const GAME_CONFIG_SEED: &[u8] = b"game_config";
pub const PLAYER_STATE_SEED: &[u8] = b"player_state";
pub const PLAYER_STATS_SEED: &[u8] = b"player_stats";
pub const ZONE_STATE_SEED: &[u8] = b"zone_state";
pub const ROOM_STATE_SEED: &[u8] = b"room_state";
pub const BET_STATE_SEED: &[u8] = b"bet_state";
pub const GAME_SESSION_SEED: &[u8] = b"game_session";
pub const ENEMY_STATE_SEED: &[u8] = b"enemy_state";

// ===== ENUMS =====
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ZoneType {
    Red,
    Blue,
    Green,
}

impl ZoneType {
    pub fn to_u8(&self) -> u8 {
        match self {
            ZoneType::Red => 0,
            ZoneType::Blue => 1,
            ZoneType::Green => 2,
        }
    }

    pub fn from_u8(val: u8) -> Option<Self> {
        match val {
            0 => Some(ZoneType::Red),
            1 => Some(ZoneType::Blue),
            2 => Some(ZoneType::Green),
            _ => None,
        }
    }

    pub fn next_zone(&self) -> Option<Self> {
        match self {
            ZoneType::Red => Some(ZoneType::Blue),
            ZoneType::Blue => Some(ZoneType::Green),
            ZoneType::Green => None,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum GameResult {
    Victory,
    Defeat,
    InProgress,
}

// ===== ACCOUNTS =====

#[account]
#[derive(InitSpace)]
pub struct GameConfig {
    pub authority: Pubkey,
    pub red_zone_rooms: u32,
    pub blue_zone_rooms: u32,
    pub green_zone_rooms: u32,
    pub red_zone_real_enemies: u32,
    pub blue_zone_real_enemies: u32,
    pub green_zone_real_enemies: u32,
    pub red_zone_damage: u32,
    pub blue_zone_damage: u32,
    pub green_zone_damage: u32,
    pub starting_health: u32,
    pub starting_xp: u64,
    pub food_cost: u64,
    pub food_health_restore: u32,
    pub food_hive_bonus: u64,
    pub xp_to_hive_rate: u64,
    pub bet_win_percentage: u64,
    pub bump: u8,
}

impl GameConfig {
    pub fn get_zone_rooms(&self, zone: ZoneType) -> u32 {
        match zone {
            ZoneType::Red => self.red_zone_rooms,
            ZoneType::Blue => self.blue_zone_rooms,
            ZoneType::Green => self.green_zone_rooms,
        }
    }

    pub fn get_zone_real_enemies(&self, zone: ZoneType) -> u32 {
        match zone {
            ZoneType::Red => self.red_zone_real_enemies,
            ZoneType::Blue => self.blue_zone_real_enemies,
            ZoneType::Green => self.green_zone_real_enemies,
        }
    }

    pub fn get_zone_damage(&self, zone: ZoneType) -> u32 {
        match zone {
            ZoneType::Red => self.red_zone_damage,
            ZoneType::Blue => self.blue_zone_damage,
            ZoneType::Green => self.green_zone_damage,
        }
    }

    pub fn calculate_xp_reward(&self, current_health: u32, is_real_enemy: bool) -> u64 {
        if is_real_enemy {
            (current_health as u64) * 5
        } else {
            current_health as u64
        }
    }

    pub fn calculate_bet_reward(&self, bet_amount: u64) -> u64 {
        (bet_amount * self.bet_win_percentage) / 100
    }
}

#[account]
#[derive(InitSpace)]
pub struct PlayerState {
    pub player: Pubkey,
    pub current_zone: ZoneType,
    pub health: u32,
    pub xp: u64,
    pub game_active: bool,
    pub current_session_id: u64,
    pub encounter_count: u32,
    pub bump: u8,
}

impl PlayerState {
    pub fn start_new_game(&mut self, session_id: u64, starting_health: u32, starting_xp: u64) {
        self.current_zone = ZoneType::Red;
        self.health = starting_health;
        self.xp = starting_xp;
        self.game_active = true;
        self.current_session_id = session_id;
        self.encounter_count = 0;
    }

    pub fn take_damage(&mut self, damage: u32) -> bool {
        if damage >= self.health {
            self.health = 0;
            self.game_active = false;
            false
        } else {
            self.health -= damage;
            true
        }
    }

    pub fn restore_health(&mut self, amount: u32, max_health: u32) {
        let new_health = self.health.saturating_add(amount);
        self.health = new_health.min(max_health);
    }

    pub fn deduct_xp(&mut self, amount: u64) -> bool {
        if self.xp >= amount {
            self.xp -= amount;
            true
        } else {
            false
        }
    }

    pub fn add_xp(&mut self, amount: u64) {
        self.xp = self.xp.saturating_add(amount);
    }

    pub fn increment_encounter(&mut self) {
        self.encounter_count += 1;
    }

    pub fn end_game(&mut self) {
        self.game_active = false;
    }

    pub fn has_sufficient_xp(&self, amount: u64) -> bool {
        self.xp >= amount
    }

    pub fn is_alive(&self) -> bool {
        self.health > 0
    }
}

#[account]
#[derive(InitSpace)]
pub struct PlayerStats {
    pub player: Pubkey,
    pub hive_balance: u64,
    pub total_real_enemies_killed: u32,
    pub total_fake_enemies_killed: u32,
    pub games_completed: u32,
    pub games_failed: u32,
    pub total_time_played: u64,
    pub bump: u8,
}

impl PlayerStats {
    pub fn add_hive(&mut self, amount: u64) {
        self.hive_balance = self.hive_balance.saturating_add(amount);
    }

    pub fn record_enemy_kill(&mut self, is_real: bool) {
        if is_real {
            self.total_real_enemies_killed += 1;
        } else {
            self.total_fake_enemies_killed += 1;
        }
    }

    pub fn complete_game(&mut self) {
        self.games_completed += 1;
    }

    pub fn fail_game(&mut self) {
        self.games_failed += 1;
    }

    pub fn add_playtime(&mut self, duration: u64) {
        self.total_time_played = self.total_time_played.saturating_add(duration);
    }

    pub fn convert_xp_to_hive(&mut self, xp_amount: u64, conversion_rate: u64) -> u64 {
        if conversion_rate == 0 {
            return 0;
        }
        let hive_earned = xp_amount / conversion_rate;
        if hive_earned > 0 {
            self.hive_balance = self.hive_balance.saturating_add(hive_earned);
        }
        hive_earned
    }
}

#[account]
#[derive(InitSpace)]
pub struct ZoneState {
    pub player: Pubkey,
    pub zone: ZoneType,
    pub real_enemies_killed: u32,
    pub remaining_real_enemies: u32,
    pub remaining_encounters: u32,
    pub zone_completed: bool,
    pub rooms_explored: u32,
    pub bump: u8,
}

impl ZoneState {
    pub fn initialize(&mut self, required_real_enemies: u32, total_encounters: u32) {
        self.real_enemies_killed = 0;
        self.remaining_real_enemies = required_real_enemies;
        self.remaining_encounters = total_encounters;
        self.zone_completed = false;
    }

    pub fn kill_real_enemy(&mut self) {
        self.real_enemies_killed += 1;
        if self.remaining_real_enemies > 0 {
            self.remaining_real_enemies -= 1;
        }
    }

    pub fn decrement_encounters(&mut self) {
        if self.remaining_encounters > 0 {
            self.remaining_encounters -= 1;
        }
    }

    pub fn complete_zone(&mut self) {
        self.zone_completed = true;
    }

    pub fn is_complete(&self) -> bool {
        self.remaining_real_enemies == 0
    }

    pub fn force_real_enemy_needed(&self) -> bool {
        self.remaining_real_enemies == self.remaining_encounters
    }

    pub fn is_room_explored(&self, room_number: u32) -> bool {
        self.rooms_explored & (1 << (room_number - 1)) != 0
    }

    pub fn mark_room_explored(&mut self, room_number: u32) {
        self.rooms_explored |= 1 << (room_number - 1);
    }
}

#[account]
#[derive(InitSpace)]
pub struct RoomState {
    pub player: Pubkey,
    pub zone: ZoneType,
    pub room_number: u32,
    pub explored: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EnemyState {
    pub enemy_id: u64,
    pub player: Pubkey,
    pub zone: ZoneType,
    pub is_real: bool,
    pub is_shot: bool,
    pub encounter_order: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BetState {
    pub player: Pubkey,
    pub active: bool,
    pub amount: u64,
    pub prediction: bool, // true = predicting real enemy, false = predicting fake
    pub bump: u8,
}

impl BetState {
    pub fn place_bet(&mut self, amount: u64, prediction: bool) -> bool {
        if !self.active {
            self.active = true;
            self.amount = amount;
            self.prediction = prediction;
            true
        } else {
            false
        }
    }

    pub fn clear_bet(&mut self) {
        self.active = false;
        self.amount = 0;
        self.prediction = false;
    }

    pub fn has_active_bet(&self) -> bool {
        self.active
    }

    pub fn get_bet_result(&self, enemy_is_real: bool) -> bool {
        self.prediction == enemy_is_real
    }
}

#[account]
#[derive(InitSpace)]
pub struct GameSession {
    pub session_id: u64,
    pub player: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub zones_completed: u32,
    pub total_hive_earned: u64,
    pub total_xp_earned: u64,
    pub session_complete: bool,
    pub bump: u8,
}

impl GameSession {
    pub fn start_session(&mut self, session_id: u64, player: Pubkey, start_time: i64) {
        self.session_id = session_id;
        self.player = player;
        self.start_time = start_time;
        self.end_time = 0;
        self.zones_completed = 0;
        self.total_hive_earned = 0;
        self.total_xp_earned = 0;
        self.session_complete = false;
    }

    pub fn complete_zone(&mut self) {
        self.zones_completed += 1;
    }

    pub fn add_hive_earned(&mut self, amount: u64) {
        self.total_hive_earned = self.total_hive_earned.saturating_add(amount);
    }

    pub fn add_xp_earned(&mut self, amount: u64) {
        self.total_xp_earned = self.total_xp_earned.saturating_add(amount);
    }

    pub fn end_session(&mut self, end_time: i64) {
        self.end_time = end_time;
        self.session_complete = true;
    }

    pub fn get_session_duration(&self) -> u64 {
        if self.end_time > self.start_time {
            (self.end_time - self.start_time) as u64
        } else {
            0
        }
    }
}

// ===== ERROR CODES =====
#[error_code]
pub enum GameError {
    #[msg("Insufficient XP for this action")]
    InsufficientXP,
    #[msg("Invalid zone")]
    InvalidZone,
    #[msg("Enemy already shot")]
    EnemyAlreadyShot,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Room already explored")]
    RoomAlreadyExplored,
    #[msg("Invalid room number")]
    InvalidRoomNumber,
    #[msg("No active bet")]
    NoActiveBet,
    #[msg("Zone not initialized")]
    ZoneNotInitialized,
    #[msg("Previous zone not completed")]
    ZoneNotCompleted,
    #[msg("Bet already active")]
    BetAlreadyActive,
    #[msg("Health already full")]
    HealthAlreadyFull,
    #[msg("Game already active")]
    GameAlreadyActive,
    #[msg("Player already initialized")]
    PlayerAlreadyInitialized,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid movement delta. Use -1, 0, or 1 and avoid 0,0")]
    InvalidMovementDelta,
}

// ===== EVENTS =====
#[event]
pub struct GameStarted {
    pub player: Pubkey,
    pub session_id: u64,
    pub start_time: i64,
}

#[event]
pub struct BetPlaced {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub bet_prediction: bool,
}

#[event]
pub struct EnemyGenerated {
    pub player: Pubkey,
    pub enemy_id: u64,
    pub zone: ZoneType,
    pub is_real: bool,
    pub encounter_order: u32,
}

#[event]
pub struct EnemyShot {
    pub player: Pubkey,
    pub enemy_id: u64,
    pub bet_result: bool,
    pub xp_gained: u64,
    pub hive_earned: u64,
}

#[event]
pub struct DamageTaken {
    pub player: Pubkey,
    pub damage_amount: u32,
    pub remaining_health: u32,
}

#[event]
pub struct PlayerMoved {
    pub player: Pubkey,
    pub x_delta: i8,
    pub y_delta: i8,
}

#[event]
pub struct ZoneProgress {
    pub player: Pubkey,
    pub zone: ZoneType,
    pub real_enemies_killed: u32,
    pub encounters_remaining: u32,
}

#[event]
pub struct GameCompleted {
    pub player: Pubkey,
    pub session_id: u64,
    pub zones_completed: u32,
    pub total_hive_earned: u64,
    pub result: GameResult,
}

#[event]
pub struct GameFailed {
    pub player: Pubkey,
    pub session_id: u64,
    pub reason: String,
}

// ===== PROGRAM =====
#[ephemeral]
#[program]
pub mod gameframework {
    use super::*;

    /// Initialize the game config (admin only, once per game)
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        config.authority = ctx.accounts.authority.key();
        config.red_zone_rooms = 8;
        config.blue_zone_rooms = 8;
        config.green_zone_rooms = 4;
        config.red_zone_real_enemies = 3;
        config.blue_zone_real_enemies = 2;
        config.green_zone_real_enemies = 1;
        config.red_zone_damage = 10;
        config.blue_zone_damage = 15;
        config.green_zone_damage = 20;
        config.starting_health = 100;
        config.starting_xp = 500;
        config.food_cost = 50;
        config.food_health_restore = 10;
        config.food_hive_bonus = 5;
        config.xp_to_hive_rate = 100;
        config.bet_win_percentage = 10;
        config.bump = ctx.bumps.game_config;

        msg!("Game config initialized");
        Ok(())
    }

    /// Update game config (admin only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        red_zone_rooms: u32,
        blue_zone_rooms: u32,
        green_zone_rooms: u32,
        red_zone_real_enemies: u32,
        blue_zone_real_enemies: u32,
        green_zone_real_enemies: u32,
        red_zone_damage: u32,
        blue_zone_damage: u32,
        green_zone_damage: u32,
        starting_health: u32,
        starting_xp: u64,
        food_cost: u64,
        food_health_restore: u32,
        food_hive_bonus: u64,
        xp_to_hive_rate: u64,
        bet_win_percentage: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.game_config;
        config.red_zone_rooms = red_zone_rooms;
        config.blue_zone_rooms = blue_zone_rooms;
        config.green_zone_rooms = green_zone_rooms;
        config.red_zone_real_enemies = red_zone_real_enemies;
        config.blue_zone_real_enemies = blue_zone_real_enemies;
        config.green_zone_real_enemies = green_zone_real_enemies;
        config.red_zone_damage = red_zone_damage;
        config.blue_zone_damage = blue_zone_damage;
        config.green_zone_damage = green_zone_damage;
        config.starting_health = starting_health;
        config.starting_xp = starting_xp;
        config.food_cost = food_cost;
        config.food_health_restore = food_health_restore;
        config.food_hive_bonus = food_hive_bonus;
        config.xp_to_hive_rate = xp_to_hive_rate;
        config.bet_win_percentage = bet_win_percentage;

        msg!("Game config updated");
        Ok(())
    }

    /// Initialize a new player
    pub fn initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
        let player_stats = &mut ctx.accounts.player_stats;
        let player_state = &mut ctx.accounts.player_state;
        let bet_state = &mut ctx.accounts.bet_state;

        // Initialize player stats
        player_stats.player = ctx.accounts.player.key();
        player_stats.hive_balance = 0;
        player_stats.total_real_enemies_killed = 0;
        player_stats.total_fake_enemies_killed = 0;
        player_stats.games_completed = 0;
        player_stats.games_failed = 0;
        player_stats.total_time_played = 0;
        player_stats.bump = ctx.bumps.player_stats;

        // Initialize player state
        player_state.player = ctx.accounts.player.key();
        player_state.current_zone = ZoneType::Red;
        player_state.health = 0;
        player_state.xp = 0;
        player_state.game_active = false;
        player_state.current_session_id = 0;
        player_state.encounter_count = 0;
        player_state.bump = ctx.bumps.player_state;

        // Initialize bet state
        bet_state.player = ctx.accounts.player.key();
        bet_state.active = false;
        bet_state.amount = 0;
        bet_state.prediction = false;
        bet_state.bump = ctx.bumps.bet_state;

        msg!("Player {} initialized", ctx.accounts.player.key());
        Ok(())
    }

    /// Initialize a zone for the player
    pub fn initialize_zone(ctx: Context<InitializeZone>, zone: ZoneType) -> Result<()> {
        let zone_state = &mut ctx.accounts.zone_state;
        let config = &ctx.accounts.game_config;

        zone_state.player = ctx.accounts.player.key();
        zone_state.zone = zone;
        zone_state.real_enemies_killed = 0;
        zone_state.remaining_real_enemies = config.get_zone_real_enemies(zone);
        zone_state.remaining_encounters = config.get_zone_rooms(zone);
        zone_state.zone_completed = false;
        zone_state.bump = ctx.bumps.zone_state;

        msg!("Zone {:?} initialized for player {}", zone, ctx.accounts.player.key());
        Ok(())
    }

    /// Start a new game session
    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        let player_state = &mut ctx.accounts.player_state;
        let game_session = &mut ctx.accounts.game_session;
        let config = &ctx.accounts.game_config;
        let clock = Clock::get()?;

        require!(!player_state.game_active, GameError::GameAlreadyActive);

        // Generate session ID from timestamp and player
        let session_id = clock.unix_timestamp as u64;

        // Start new game
        player_state.start_new_game(session_id, config.starting_health, config.starting_xp);

        // Initialize game session
        game_session.session_id = session_id;
        game_session.player = ctx.accounts.player.key();
        game_session.start_time = clock.unix_timestamp;
        game_session.end_time = 0;
        game_session.zones_completed = 0;
        game_session.total_hive_earned = 0;
        game_session.total_xp_earned = 0;
        game_session.session_complete = false;
        game_session.bump = ctx.bumps.game_session;

        emit!(GameStarted {
            player: ctx.accounts.player.key(),
            session_id,
            start_time: clock.unix_timestamp,
        });

        msg!("Game started for player {}", ctx.accounts.player.key());
        Ok(())
    }

    /// Place a bet on whether the next enemy is real or fake
    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, prediction: bool) -> Result<()> {
        let player_state = &ctx.accounts.player_state;
        let bet_state = &mut ctx.accounts.bet_state;
        let zone_state = &ctx.accounts.zone_state;

        if bet_state.player == Pubkey::default() {
            bet_state.player = ctx.accounts.player.key();
            bet_state.active = false;
            bet_state.amount = 0;
            bet_state.prediction = false;
            bet_state.bump = ctx.bumps.bet_state;
        }

        require!(player_state.game_active, GameError::GameNotActive);
        require!(player_state.has_sufficient_xp(amount), GameError::InsufficientXP);
        require!(!bet_state.has_active_bet(), GameError::BetAlreadyActive);
        require!(zone_state.remaining_encounters > 0, GameError::ZoneNotInitialized);

        bet_state.place_bet(amount, prediction);

        emit!(BetPlaced {
            player: ctx.accounts.player.key(),
            bet_amount: amount,
            bet_prediction: prediction,
        });

        msg!("Bet placed: {} XP on {}", amount, if prediction { "real" } else { "fake" });
        Ok(())
    }

    /// Enter a room in the current zone
    pub fn enter_room(ctx: Context<EnterRoom>, zone: ZoneType, room_number: u32) -> Result<()> {
        let player_state = &ctx.accounts.player_state;
        let bet_state = &ctx.accounts.bet_state;
        let room_state = &mut ctx.accounts.room_state;
        let config = &ctx.accounts.game_config;

        require!(player_state.game_active, GameError::GameNotActive);
        require!(player_state.current_zone == zone, GameError::InvalidZone);
        require!(bet_state.has_active_bet(), GameError::NoActiveBet);

        let max_rooms = config.get_zone_rooms(zone);
        require!(room_number > 0 && room_number <= max_rooms, GameError::InvalidRoomNumber);
        require!(!room_state.explored, GameError::RoomAlreadyExplored);

        room_state.player = ctx.accounts.player.key();
        room_state.zone = zone;
        room_state.room_number = room_number;
        room_state.explored = true;
        room_state.bump = ctx.bumps.room_state;

        msg!("Entered room {} in zone {:?}", room_number, zone);
        Ok(())
    }

    /// Record a grid movement step.
    /// Frontend sends one transaction each time player crosses into a new grid cell.
    pub fn move_player(ctx: Context<MovePlayer>, x_delta: i8, y_delta: i8) -> Result<()> {
        let player_state = &ctx.accounts.player_state;
        require!(player_state.game_active, GameError::GameNotActive);
        require!(
            x_delta >= -1 && x_delta <= 1 && y_delta >= -1 && y_delta <= 1 && !(x_delta == 0 && y_delta == 0),
            GameError::InvalidMovementDelta
        );

        emit!(PlayerMoved {
            player: ctx.accounts.player.key(),
            x_delta,
            y_delta,
        });

        msg!("Player moved. dx={}, dy={}", x_delta, y_delta);
        Ok(())
    }

    /// Shoot an enemy and resolve the encounter
    pub fn shoot_enemy(ctx: Context<ShootEnemy>, enemy_id: u64) -> Result<()> {
        let player_state = &mut ctx.accounts.player_state;
        let player_stats = &mut ctx.accounts.player_stats;
        let bet_state = &mut ctx.accounts.bet_state;
        let zone_state = &mut ctx.accounts.zone_state;
        let game_session = &mut ctx.accounts.game_session;
        let enemy_state = &mut ctx.accounts.enemy_state;
        let config = &ctx.accounts.game_config;
        let clock = Clock::get()?;

        require!(player_state.game_active, GameError::GameNotActive);
        require!(bet_state.has_active_bet(), GameError::NoActiveBet);

        // Determine if enemy is real using pseudo-randomness
        let force_real = zone_state.force_real_enemy_needed();
        let is_real = if force_real {
            true
        } else {
            // Use clock and player key for pseudo-randomness
            let seed = clock.unix_timestamp as u64
                ^ player_state.encounter_count as u64
                ^ ctx.accounts.player.key().to_bytes()[0] as u64;
            seed % 2 == 0
        };

        emit!(EnemyGenerated {
            player: ctx.accounts.player.key(),
            enemy_id,
            zone: player_state.current_zone,
            is_real,
            encounter_order: player_state.encounter_count,
        });

        // Initialize enemy state
        enemy_state.enemy_id = enemy_id;
        enemy_state.player = ctx.accounts.player.key();
        enemy_state.zone = player_state.current_zone;
        enemy_state.is_real = is_real;
        enemy_state.is_shot = true;
        enemy_state.encounter_order = player_state.encounter_count;
        enemy_state.bump = ctx.bumps.enemy_state;

        // Calculate XP reward
        let xp_reward = config.calculate_xp_reward(player_state.health, is_real);
        player_state.add_xp(xp_reward);

        // Process betting outcome
        let bet_won = bet_state.get_bet_result(is_real);
        let mut hive_earned: u64 = 0;

        if bet_won {
            hive_earned = config.calculate_bet_reward(bet_state.amount);
            player_stats.add_hive(hive_earned);
            game_session.add_hive_earned(hive_earned);
        } else {
            player_state.deduct_xp(bet_state.amount);
        }

        // Update zone state if real enemy killed
        if is_real {
            zone_state.kill_real_enemy();
            zone_state.decrement_encounters();

            if zone_state.is_complete() {
                zone_state.complete_zone();
                game_session.complete_zone();
            }

            emit!(ZoneProgress {
                player: ctx.accounts.player.key(),
                zone: player_state.current_zone,
                real_enemies_killed: zone_state.real_enemies_killed,
                encounters_remaining: zone_state.remaining_encounters,
            });
        }

        player_stats.record_enemy_kill(is_real);
        player_state.increment_encounter();
        bet_state.clear_bet();

        emit!(EnemyShot {
            player: ctx.accounts.player.key(),
            enemy_id,
            bet_result: bet_won,
            xp_gained: xp_reward,
            hive_earned,
        });

        msg!("Enemy shot! Real: {}, Bet won: {}, XP: {}, Hive: {}", is_real, bet_won, xp_reward, hive_earned);
        Ok(())
    }

    /// Take damage from an enemy
    pub fn take_damage(ctx: Context<TakeDamage>, damage: u32) -> Result<()> {
        let player_state = &mut ctx.accounts.player_state;
        let player_stats = &mut ctx.accounts.player_stats;
        let game_session = &mut ctx.accounts.game_session;
        let clock = Clock::get()?;

        require!(player_state.game_active, GameError::GameNotActive);

        let survived = player_state.take_damage(damage);

        emit!(DamageTaken {
            player: ctx.accounts.player.key(),
            damage_amount: damage,
            remaining_health: player_state.health,
        });

        if !survived {
            let end_time = clock.unix_timestamp;
            game_session.end_session(end_time);
            let session_duration = game_session.get_session_duration();
            player_stats.add_playtime(session_duration);
            player_state.end_game();
            player_stats.fail_game();

            emit!(GameFailed {
                player: ctx.accounts.player.key(),
                session_id: game_session.session_id,
                reason: "health_depleted".to_string(),
            });

            msg!("Player died! Game over.");
        } else {
            msg!("Took {} damage, {} health remaining", damage, player_state.health);
        }

        Ok(())
    }

    /// Buy food to restore health
    pub fn buy_food(ctx: Context<BuyFood>) -> Result<()> {
        let player_state = &mut ctx.accounts.player_state;
        let player_stats = &mut ctx.accounts.player_stats;
        let config = &ctx.accounts.game_config;

        require!(player_state.game_active, GameError::GameNotActive);
        require!(player_state.has_sufficient_xp(config.food_cost), GameError::InsufficientXP);
        require!(player_state.health < config.starting_health, GameError::HealthAlreadyFull);

        player_state.deduct_xp(config.food_cost);
        player_state.restore_health(config.food_health_restore, config.starting_health);
        player_stats.add_hive(config.food_hive_bonus);

        msg!("Bought food! -{} XP, +{} health, +{} hive",
            config.food_cost, config.food_health_restore, config.food_hive_bonus);
        Ok(())
    }

    /// Change to a new zone (requires previous zone completion)
    pub fn change_zone(ctx: Context<ChangeZone>, new_zone: ZoneType) -> Result<()> {
        let player_state = &mut ctx.accounts.player_state;
        let current_zone_state = &ctx.accounts.current_zone_state;
        let target_zone_state = &ctx.accounts.target_zone_state;

        require!(player_state.game_active, GameError::GameNotActive);
        require!(target_zone_state.remaining_encounters > 0, GameError::ZoneNotInitialized);

        // For non-Red zones, ensure previous zone is completed
        if new_zone != ZoneType::Red {
            require!(current_zone_state.is_complete(), GameError::ZoneNotCompleted);
        }

        player_state.current_zone = new_zone;

        msg!("Changed to zone {:?}", new_zone);
        Ok(())
    }

    /// End the current game session
    pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
        let player_state = &mut ctx.accounts.player_state;
        let player_stats = &mut ctx.accounts.player_stats;
        let game_session = &mut ctx.accounts.game_session;
        let config = &ctx.accounts.game_config;
        let clock = Clock::get()?;

        require!(player_state.game_active, GameError::GameNotActive);

        let end_time = clock.unix_timestamp;

        // Convert remaining XP to Hive
        let hive_from_xp = player_stats.convert_xp_to_hive(player_state.xp, config.xp_to_hive_rate);
        game_session.add_hive_earned(hive_from_xp);

        game_session.end_session(end_time);
        let session_duration = game_session.get_session_duration();
        player_stats.add_playtime(session_duration);

        player_state.end_game();
        player_stats.complete_game();

        emit!(GameCompleted {
            player: ctx.accounts.player.key(),
            session_id: game_session.session_id,
            zones_completed: game_session.zones_completed,
            total_hive_earned: game_session.total_hive_earned,
            result: GameResult::Victory,
        });

        msg!("Game ended! Zones: {}, Hive earned: {}",
            game_session.zones_completed, game_session.total_hive_earned);
        Ok(())
    }

    // ===== EPHEMERAL ROLLUP FUNCTIONS =====

    /// Delegate player state to ephemeral rollup
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[PLAYER_STATE_SEED, ctx.accounts.payer.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        msg!("Player state delegated to ER");
        Ok(())
    }

    /// Delegate player stats to ephemeral rollup
    pub fn delegate_player_stats(ctx: Context<DelegatePlayer>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[PLAYER_STATS_SEED, ctx.accounts.payer.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        msg!("Player stats delegated to ER");
        Ok(())
    }

    /// Delegate zone state to ephemeral rollup
    pub fn delegate_zone_state(ctx: Context<DelegatePlayer>, zone: u8) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[ZONE_STATE_SEED, ctx.accounts.payer.key().as_ref(), &[zone]],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        msg!("Zone state delegated to ER");
        Ok(())
    }

    /// Delegate game session to ephemeral rollup
    pub fn delegate_game_session(ctx: Context<DelegatePlayer>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[GAME_SESSION_SEED, ctx.accounts.payer.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        msg!("Game session delegated to ER");
        Ok(())
    }

    /// Commit player state from ER
    pub fn commit_player(ctx: Context<CommitPlayer>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.player_state.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("Player state committed");
        Ok(())
    }

    /// Undelegate player state from ER
    pub fn undelegate_player(ctx: Context<CommitPlayer>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.player_state.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("Player state undelegated");
        Ok(())
    }
}

// ===== ACCOUNT CONTEXTS =====

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GameConfig::INIT_SPACE,
        seeds = [GAME_CONFIG_SEED],
        bump
    )]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [GAME_CONFIG_SEED],
        bump,
        has_one = authority @ GameError::Unauthorized
    )]
    pub game_config: Account<'info, GameConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + PlayerStats::INIT_SPACE,
        seeds = [PLAYER_STATS_SEED, player.key().as_ref()],
        bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    #[account(
        init,
        payer = player,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        init,
        payer = player,
        space = 8 + BetState::INIT_SPACE,
        seeds = [BET_STATE_SEED, player.key().as_ref()],
        bump
    )]
    pub bet_state: Account<'info, BetState>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(zone: ZoneType)]
pub struct InitializeZone<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + ZoneState::INIT_SPACE,
        seeds = [ZONE_STATE_SEED, player.key().as_ref(), &[zone.to_u8()]],
        bump
    )]
    pub zone_state: Account<'info, ZoneState>,
    #[account(seeds = [GAME_CONFIG_SEED], bump)]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        init,
        payer = player,
        space = 8 + GameSession::INIT_SPACE,
        seeds = [GAME_SESSION_SEED, player.key().as_ref()],
        bump
    )]
    pub game_session: Account<'info, GameSession>,
    #[account(seeds = [GAME_CONFIG_SEED], bump)]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + BetState::INIT_SPACE,
        seeds = [BET_STATE_SEED, player.key().as_ref()],
        bump
    )]
    pub bet_state: Account<'info, BetState>,
    #[account(
        seeds = [ZONE_STATE_SEED, player.key().as_ref(), &[player_state.current_zone.to_u8()]],
        bump = zone_state.bump
    )]
    pub zone_state: Account<'info, ZoneState>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(zone: ZoneType, room_number: u32)]
pub struct EnterRoom<'info> {
    #[account(
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        seeds = [BET_STATE_SEED, player.key().as_ref()],
        bump = bet_state.bump
    )]
    pub bet_state: Account<'info, BetState>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + RoomState::INIT_SPACE,
        seeds = [ROOM_STATE_SEED, player.key().as_ref(), &[zone.to_u8()], &room_number.to_le_bytes()],
        bump
    )]
    pub room_state: Account<'info, RoomState>,
    #[account(seeds = [GAME_CONFIG_SEED], bump)]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MovePlayer<'info> {
    #[account(
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(enemy_id: u64)]
pub struct ShootEnemy<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [PLAYER_STATS_SEED, player.key().as_ref()],
        bump = player_stats.bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    #[account(
        mut,
        seeds = [BET_STATE_SEED, player.key().as_ref()],
        bump = bet_state.bump
    )]
    pub bet_state: Account<'info, BetState>,
    #[account(
        mut,
        seeds = [ZONE_STATE_SEED, player.key().as_ref(), &[player_state.current_zone.to_u8()]],
        bump = zone_state.bump
    )]
    pub zone_state: Account<'info, ZoneState>,
    #[account(
        mut,
        seeds = [GAME_SESSION_SEED, player.key().as_ref()],
        bump = game_session.bump
    )]
    pub game_session: Account<'info, GameSession>,
    #[account(
        init,
        payer = player,
        space = 8 + EnemyState::INIT_SPACE,
        seeds = [ENEMY_STATE_SEED, player.key().as_ref(), &enemy_id.to_le_bytes()],
        bump
    )]
    pub enemy_state: Account<'info, EnemyState>,
    #[account(seeds = [GAME_CONFIG_SEED], bump)]
    pub game_config: Account<'info, GameConfig>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TakeDamage<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [PLAYER_STATS_SEED, player.key().as_ref()],
        bump = player_stats.bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    #[account(
        mut,
        seeds = [GAME_SESSION_SEED, player.key().as_ref()],
        bump = game_session.bump
    )]
    pub game_session: Account<'info, GameSession>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyFood<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [PLAYER_STATS_SEED, player.key().as_ref()],
        bump = player_stats.bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    #[account(seeds = [GAME_CONFIG_SEED], bump)]
    pub game_config: Account<'info, GameConfig>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(new_zone: ZoneType)]
pub struct ChangeZone<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        seeds = [ZONE_STATE_SEED, player.key().as_ref(), &[player_state.current_zone.to_u8()]],
        bump = current_zone_state.bump
    )]
    pub current_zone_state: Account<'info, ZoneState>,
    #[account(
        seeds = [ZONE_STATE_SEED, player.key().as_ref(), &[new_zone.to_u8()]],
        bump = target_zone_state.bump
    )]
    pub target_zone_state: Account<'info, ZoneState>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct EndGame<'info> {
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, player.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
    #[account(
        mut,
        seeds = [PLAYER_STATS_SEED, player.key().as_ref()],
        bump = player_stats.bump
    )]
    pub player_stats: Account<'info, PlayerStats>,
    #[account(
        mut,
        seeds = [GAME_SESSION_SEED, player.key().as_ref()],
        bump = game_session.bump
    )]
    pub game_session: Account<'info, GameSession>,
    #[account(seeds = [GAME_CONFIG_SEED], bump)]
    pub game_config: Account<'info, GameConfig>,
    pub player: Signer<'info>,
}

// ===== EPHEMERAL ROLLUP CONTEXTS =====

#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The PDA to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitPlayer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, payer.key().as_ref()],
        bump = player_state.bump
    )]
    pub player_state: Account<'info, PlayerState>,
}
