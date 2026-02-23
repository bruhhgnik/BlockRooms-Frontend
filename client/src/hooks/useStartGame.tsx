import { useState } from 'react';
import useAppStore, { GamePhase } from '../zustand/store';
import {
  getSessionKeypair,
  callStartGame,
  fetchPlayerState,
  ensureGameConfigInitialized,
  toFriendlyProgramError,
} from '../lib/solana';

export const useStartGame = () => {
  const [isLoading, setIsLoading] = useState(false);
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const player = useAppStore((state) => state.player);
  const gamePhase = useAppStore((state) => state.gamePhase);
  const setPlayer = useAppStore((state) => state.setPlayer);
  const setGamePhase = useAppStore((state) => state.setGamePhase);
  const canStartGame =
    connectionStatus === 'connected' &&
    !!player &&
    !player.game_active &&
    gamePhase !== GamePhase.ACTIVE &&
    !isLoading;

  const startGame = async () => {
    if (!canStartGame) {
      return { success: false, error: 'Player must be connected and initialized before starting.' };
    }

    setIsLoading(true);
    console.log('[StartGame] Starting game on-chain...');

    try {
      const keypair = getSessionKeypair();
      const configReady = await ensureGameConfigInitialized(keypair);
      if (!configReady) {
        setIsLoading(false);
        return {
          success: false,
          error:
            'Invalid game_config on this deployment. Redeploy/upgrade gameframework and run initialize_config once.',
        };
      }

      await callStartGame(keypair);

      // Fetch updated player state
      const ps = await fetchPlayerState(keypair);
      if (ps) {
        const currentPlayer = useAppStore.getState().player;
        const pubkey = keypair.publicKey.toString();
        setPlayer({
          player_address: currentPlayer?.player_address || pubkey,
          player_id: currentPlayer?.player_id || pubkey,
          current_room: 1,
          health: Number(ps.health),
          max_health: currentPlayer?.max_health ?? 100,
          score: Number(ps.xp),
          shards: currentPlayer?.shards ?? 0,
          rooms_cleared: currentPlayer?.rooms_cleared ?? 0,
          has_shard_one: currentPlayer?.has_shard_one ?? false,
          has_shard_two: currentPlayer?.has_shard_two ?? false,
          has_shard_three: currentPlayer?.has_shard_three ?? false,
          has_key: currentPlayer?.has_key ?? false,
          game_active: true,
          is_alive: true,
          special_ability_cooldown: currentPlayer?.special_ability_cooldown ?? 0,
          position: currentPlayer?.position ?? { x: 400, y: 400 },
        });
      }

      setGamePhase(GamePhase.ACTIVE);
      setIsLoading(false);
      console.log('[StartGame] Game started on-chain');
      return { success: true };
    } catch (e: any) {
      console.error('[StartGame] Error:', e);
      setIsLoading(false);
      return { success: false, error: toFriendlyProgramError(e) };
    }
  };

  return {
    startGame,
    isLoading,
    canStartGame,
  };
};
