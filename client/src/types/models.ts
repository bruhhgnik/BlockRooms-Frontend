// Simplified types to replace Dojo models

export interface Player {
  player_address: string;
  player_id?: string; // Optional for UI compatibility
  current_room: number;
  health: number;
  max_health: number;
  score: number;
  shards: number;
  rooms_cleared: number;
  has_shard_one: boolean;
  has_shard_two: boolean;
  has_shard_three: boolean;
  has_key: boolean;
  is_alive: boolean;
  game_active: boolean;
  special_ability_cooldown: number;
  position: { x: number; y: number };
}

export interface PlayerStats {
  total_games: number;
  total_wins: number;
  total_deaths: number;
}

export interface GameSession {
  game_id: string;
  start_time: number;
  is_active: boolean;
  victory_achieved: boolean;
  session_complete: boolean;
}

export interface GameConfig {
  max_health: number;
  max_rooms: number;
}

export interface Room {
  room_id: number;
  cleared: boolean;
  toString?: () => string;
}

export interface Entity {
  entity_id: string;
  room_id: number;
  is_alive: boolean;
  health: number;
}

export interface EntityState {
  entity_id: string;
  state: string;
}

export interface ShardLocation {
  shard_id: string;
  room_id: number;
  collected: boolean;
}

// Event types
export interface GameStarted {
  game_id: string;
  timestamp: number;
}

export interface GameCompleted {
  game_id: string;
  timestamp: number;
}

export interface VictoryAchieved {
  game_id: string;
  timestamp: number;
}

export interface RoomCleared {
  room_id: number;
  timestamp: number;
}

export interface RoomEntered {
  room_id: number;
  timestamp: number;
}

export interface RoomExited {
  room_id: number;
  timestamp: number;
}

export interface PlayerDeath {
  player_address: string;
  timestamp: number;
}

export interface NumberedShardCollected {
  shard_id: string;
  timestamp: number;
}

// Numbered shard enum replacement
export enum NumberedShardEnum {
  One = 'One',
  Two = 'Two',
  Three = 'Three'
}
