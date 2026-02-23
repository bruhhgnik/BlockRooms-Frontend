import { useState } from 'react';
import useAppStore from '../zustand/store';
import {
  getSessionKeypair,
  callInitializePlayer,
  callInitializeZone,
  fetchPlayerState,
  fetchPlayerStats,
  ensureGameConfigInitialized,
  toFriendlyProgramError,
} from '../lib/solana';

export const useInitializePlayer = () => {
  const [isLoading, setIsLoading] = useState(false);
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const player = useAppStore((state) => state.player);
  const setPlayer = useAppStore((state) => state.setPlayer);
  const setPlayerStats = useAppStore((state) => state.setPlayerStats);
  const canInitialize = connectionStatus === 'connected' && !isLoading && !player?.game_active;

  const initializePlayer = async () => {
    setIsLoading(true);
    console.log('[InitPlayer] Initializing player on-chain...');

    try {
      const keypair = getSessionKeypair();
      const pubkey = keypair.publicKey.toString();

      // Check if already initialized by trying to fetch
      let ps = await fetchPlayerState(keypair);
      if (!ps) {
        const configReady = await ensureGameConfigInitialized(keypair);
        if (!configReady) {
          setIsLoading(false);
          return {
            success: false,
            error:
              'Invalid game_config on this deployment. Redeploy/upgrade gameframework and run initialize_config once.',
          };
        }

        // Initialize player (creates PlayerState + PlayerStats)
        await callInitializePlayer(keypair);

        // Initialize Red zone (starting zone)
        await callInitializeZone(keypair, { red: {} });

        // Fetch the created state
        ps = await fetchPlayerState(keypair);
      } else {
        console.log('[InitPlayer] Player already initialized');
      }

      const stats = await fetchPlayerStats(keypair);

      // Map on-chain data to frontend Player model
      const playerData = {
        player_address: pubkey,
        player_id: pubkey,
        current_room: 0,
        health: ps ? Number(ps.health) : 0,
        max_health: 100,
        score: ps ? Number(ps.xp) : 0,
        shards: 0,
        rooms_cleared: 0,
        has_shard_one: false,
        has_shard_two: false,
        has_shard_three: false,
        has_key: false,
        is_alive: true,
        game_active: ps ? ps.gameActive : false,
        special_ability_cooldown: 0,
        position: { x: 400, y: 400 },
      } as any;

      const statsData = {
        total_games: stats ? Number(stats.gamesCompleted) + Number(stats.gamesFailed) : 0,
        total_wins: stats ? Number(stats.gamesCompleted) : 0,
        total_deaths: stats ? Number(stats.gamesFailed) : 0,
      };

      setPlayer(playerData);
      setPlayerStats(statsData);
      setIsLoading(false);
      console.log('[InitPlayer] Player initialized on-chain');
      return { success: true };
    } catch (e: any) {
      console.error('[InitPlayer] Error:', e);
      setIsLoading(false);
      return { success: false, error: toFriendlyProgramError(e) };
    }
  };

  return {
    initializePlayer,
    isLoading,
    canInitialize,
  };
};
