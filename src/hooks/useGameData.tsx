import { useState } from 'react';
import useAppStore from '../zustand/store';
import {
  getSessionSigner,
  getSessionKeypair,
  fetchPlayerState,
  fetchPlayerStats,
  fetchGameSession,
  fetchGameConfig,
} from '../lib/solana';

export const useGameData = () => {
  const [isLoading, setIsLoading] = useState(false);
  const playerStats = useAppStore((state) => state.playerStats);

  const refetch = async () => {
    setIsLoading(true);
    console.log('[GameData] Fetching on-chain data...');

    try {
      if (!getSessionSigner()) {
        console.warn('[GameData] Session signer unavailable; skipping fetch.');
        return;
      }

      const keypair = getSessionKeypair();
      const store = useAppStore.getState();

      const [ps, stats, session, config] = await Promise.all([
        fetchPlayerState(keypair),
        fetchPlayerStats(keypair),
        fetchGameSession(keypair),
        fetchGameConfig(keypair),
      ]);

      if (ps) {
        const currentPlayer = store.player;
        const pubkey = keypair.publicKey.toString();
        store.setPlayer({
          player_address: currentPlayer?.player_address || pubkey,
          player_id: currentPlayer?.player_id || pubkey,
          current_room: currentPlayer?.current_room ?? 0,
          health: Number(ps.health),
          max_health: currentPlayer?.max_health ?? 100,
          score: Number(ps.xp),
          shards: currentPlayer?.shards ?? 0,
          rooms_cleared: currentPlayer?.rooms_cleared ?? 0,
          has_shard_one: currentPlayer?.has_shard_one ?? false,
          has_shard_two: currentPlayer?.has_shard_two ?? false,
          has_shard_three: currentPlayer?.has_shard_three ?? false,
          has_key: currentPlayer?.has_key ?? false,
          game_active: ps.gameActive,
          is_alive: Number(ps.health) > 0,
          special_ability_cooldown: currentPlayer?.special_ability_cooldown ?? 0,
          position: currentPlayer?.position ?? { x: 400, y: 400 },
        });
      }

      if (stats) {
        store.setPlayerStats({
          total_games: Number(stats.gamesCompleted) + Number(stats.gamesFailed),
          total_wins: Number(stats.gamesCompleted),
          total_deaths: Number(stats.gamesFailed),
        });
      }

      if (session) {
        store.setGameSession({
          game_id: session.sessionId?.toString() || '0',
          start_time: Number(session.startTime || 0),
          is_active: !session.sessionComplete,
          victory_achieved: false,
          session_complete: session.sessionComplete || false,
        });
      }

      if (config) {
        store.setGameConfig({
          max_health: Number(config.startingHealth),
          max_rooms: Number(config.redZoneRooms),
        });
      }
    } catch (e) {
      console.error('[GameData] Error fetching:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return { playerStats, isLoading, refetch };
};
