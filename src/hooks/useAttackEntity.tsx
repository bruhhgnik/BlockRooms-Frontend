import useAppStore from '../zustand/store';
import {
  getSessionKeypair,
  callPlaceBet,
  callShootEnemy,
  fetchBetState,
  fetchPlayerState,
  fetchPlayerStats,
} from '../lib/solana';

export const useAttackEntity = () => {
  const attackEntity = async (entityId: string) => {
    console.log(`[Attack] Shooting enemy (entityId: ${entityId})`);

    try {
      const keypair = getSessionKeypair();

      // Keep contract parity: shoot requires an active bet.
      const betState = await fetchBetState(keypair);
      if (!betState?.active) {
        const psBefore = await fetchPlayerState(keypair);
        const xp = Number(psBefore?.xp ?? 0);
        if (xp <= 0) {
          throw new Error("Insufficient XP to place a bet");
        }
        const betAmount = Math.min(10, xp);
        await callPlaceBet(keypair, betAmount, true);
      }

      // Use entityId as the on-chain enemy_id (convert to number)
      const numericId = parseInt(entityId.replace(/\D/g, '')) || Date.now();
      await callShootEnemy(keypair, numericId);

      // Refresh player state in store
      const ps = await fetchPlayerState(keypair);
      const stats = await fetchPlayerStats(keypair);
      const store = useAppStore.getState();

      if (ps && store.player) {
        store.setPlayer({
          ...store.player,
          health: Number(ps.health),
          score: Number(ps.xp),
          game_active: ps.gameActive,
          is_alive: ps.health > 0,
        });
      }

      if (stats) {
        store.setPlayerStats({
          total_games: Number(stats.gamesCompleted) + Number(stats.gamesFailed),
          total_wins: Number(stats.gamesCompleted),
          total_deaths: Number(stats.gamesFailed),
        });
      }

      // Mark the entity as dead in the local entities array
      const entities = store.entities.map((e) =>
        e.entity_id.toString() === entityId
          ? { ...e, is_alive: false, health: 0 }
          : e
      );
      store.setEntities(entities);

      console.log('[Attack] Enemy shot on-chain');
      return { success: true };
    } catch (e: any) {
      console.error('[Attack] Error:', e);
      return { success: false, error: e.message };
    }
  };

  return { attackEntity };
};
