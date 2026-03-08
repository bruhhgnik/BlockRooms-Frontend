import { useState } from 'react';
import useAppStore from '../zustand/store';
import {
  getSessionKeypair,
  callPlaceBet,
  callEnterRoom,
  fetchBetState,
  fetchPlayerState,
} from '../lib/solana';

/**
 * Map frontend door IDs to contract zone + room_number.
 * The contract has 3 zones (Red=8 rooms, Blue=8 rooms, Green=4 rooms).
 * Frontend doors 1-13 map to rooms within the Red zone for now.
 */
function doorToZoneRoom(doorId: string): { zone: { red: {} } | { blue: {} } | { green: {} }; roomNumber: number } {
  const id = parseInt(doorId) || 1;
  // Map door IDs to Red zone rooms (1-8)
  // Doors 1-2 = Room 1, Doors 3-4 = Room 2, Doors 5-6 = Room 3, Door 7 = Room 4
  // Doors 8-9 = Room 5, Doors 10-11 = Room 6, Doors 12-13 = Room 7
  let roomNumber: number;
  if (id <= 2) roomNumber = 1;
  else if (id <= 4) roomNumber = 2;
  else if (id <= 6) roomNumber = 3;
  else if (id === 7) roomNumber = 4;
  else if (id <= 9) roomNumber = 5;
  else if (id <= 11) roomNumber = 6;
  else roomNumber = 7;

  return { zone: { red: {} }, roomNumber };
}

export const useOpenDoor = () => {
  const [isLoading, setIsLoading] = useState(false);

  const enterDoor = async (doorId: string) => {
    console.log(`[Door] Entering door ${doorId}`);
    setIsLoading(true);

    try {
      const keypair = getSessionKeypair();
      const { zone, roomNumber } = doorToZoneRoom(doorId);

      // Room entry requires an active bet.
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

      await callEnterRoom(keypair, zone, roomNumber);

      // Refresh player state
      const ps = await fetchPlayerState(keypair);
      const store = useAppStore.getState();
      if (ps && store.player) {
        store.setPlayer({
          ...store.player,
          health: Number(ps.health),
          score: Number(ps.xp),
          current_room: roomNumber,
        });
      }

      // Set current room in store
      store.setCurrentRoom({ room_id: roomNumber, cleared: false });

      // Create a mock entity for this room so the 3D cube + shoot flow works
      const entityId = `door_entity_${roomNumber}`;
      const existingEntity = store.entities.find((e) => e.entity_id === entityId);
      if (!existingEntity) {
        store.setEntities([
          ...store.entities,
          {
            entity_id: entityId,
            room_id: roomNumber,
            is_alive: true,
            health: 100,
          },
        ]);
      }

      // Create a shard location for this room
      const shardId = `shard_${roomNumber}`;
      const existingShard = store.shardLocations.find((s) => s.shard_id === shardId);
      if (!existingShard) {
        store.setShardLocations([
          ...store.shardLocations,
          {
            shard_id: shardId,
            room_id: roomNumber,
            collected: false,
          },
        ]);
      }

      setIsLoading(false);
      console.log(`[Door] Entered room ${roomNumber} on-chain`);
      return { success: true };
    } catch (e: any) {
      console.error('[Door] Error:', e);
      setIsLoading(false);
      return { success: false, error: e.message };
    }
  };

  const exitDoor = async (doorId: string) => {
    console.log(`[Door] Exiting door ${doorId}`);
    setIsLoading(true);

    // Exit is a frontend-only action (contract doesn't have an exit instruction)
    // Mark the room as cleared and update store
    const store = useAppStore.getState();
    if (store.currentRoom) {
      store.updateRoom({ ...store.currentRoom, cleared: true });
    }

    setIsLoading(false);
    return { success: true };
  };

  return { isLoading, enterDoor, exitDoor };
};
