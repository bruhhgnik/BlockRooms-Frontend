import useAppStore, { GamePhase } from '../zustand/store';
import {
  getSessionKeypair,
  callEndGame,
  fetchPlayerState,
  fetchPlayerStats,
  fetchGameSession,
} from '../lib/solana';

export const useEndGame = () => {
  const endGame = async () => {
    console.log('[EndGame] Ending game on-chain...');

    try {
      const keypair = getSessionKeypair();

      await callEndGame(keypair);

      // Fetch final state
      const ps = await fetchPlayerState(keypair);
      const stats = await fetchPlayerStats(keypair);
      const session = await fetchGameSession(keypair);
      const store = useAppStore.getState();

      if (ps && store.player) {
        store.setPlayer({
          ...store.player,
          game_active: false,
          health: Number(ps.health),
          score: Number(ps.xp),
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
          game_id: session.sessionId.toString(),
          start_time: Number(session.startTime),
          is_active: false,
          victory_achieved: session.sessionComplete,
          session_complete: true,
        });
      }

      store.setGamePhase(GamePhase.COMPLETED);
      console.log('[EndGame] Game ended on-chain');
      return { success: true };
    } catch (e: any) {
      console.error('[EndGame] Error:', e);
      return { success: false, error: e.message };
    }
  };

  return { endGame };
};
