import { useEffect, useRef, useState } from "react";
import useAppStore, { GamePhase } from "../zustand/store";
import {
  callMovePlayer,
  getSessionKeypair,
  toFriendlyProgramError,
} from "../lib/solana";

type GridPos = { x: number; y: number };

function toGrid(pos: { x: number; z: number }): GridPos {
  // World uses X/Z for floor plane; UI shows grid as X/Y.
  return {
    x: Math.floor(pos.x),
    y: Math.floor(pos.z),
  };
}

export const usePlayerMovement = () => {
  const { position, connectionStatus, gamePhase } = useAppStore();

  const [showTransactionPopup, setShowTransactionPopup] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [isProcessingTransaction, setIsProcessingTransaction] = useState(false);

  const lastCommittedGrid = useRef<GridPos | null>(null);
  const lastObservedGrid = useRef<GridPos | null>(null);
  const pendingSteps = useRef<Array<{ dx: number; dy: number }>>([]);
  const processingQueue = useRef(false);

  useEffect(() => {
    if (connectionStatus !== "connected" || gamePhase !== GamePhase.ACTIVE) {
      const current = toGrid({ x: position.x, z: position.z });
      lastCommittedGrid.current = current;
      lastObservedGrid.current = current;
      pendingSteps.current = [];
      return;
    }

    const currentGrid = toGrid({ x: position.x, z: position.z });

    if (!lastCommittedGrid.current) {
      lastCommittedGrid.current = currentGrid;
      lastObservedGrid.current = currentGrid;
      return;
    }

    if (!lastObservedGrid.current) {
      lastObservedGrid.current = currentGrid;
      return;
    }

    if (
      currentGrid.x === lastObservedGrid.current.x &&
      currentGrid.y === lastObservedGrid.current.y
    ) {
      return;
    }

    const cursor = { ...lastObservedGrid.current };
    while (cursor.x !== currentGrid.x || cursor.y !== currentGrid.y) {
      const dx = Math.sign(currentGrid.x - cursor.x);
      const dy = Math.sign(currentGrid.y - cursor.y);
      pendingSteps.current.push({ dx, dy });
      cursor.x += dx;
      cursor.y += dy;
    }
    lastObservedGrid.current = currentGrid;

    if (processingQueue.current) return;

    const flushQueue = async () => {
      processingQueue.current = true;
      setShowTransactionPopup(true);
      setTransactionError(null);
      setIsProcessingTransaction(true);

      try {
        const keypair = getSessionKeypair();

        while (pendingSteps.current.length > 0 && lastCommittedGrid.current) {
          const step = pendingSteps.current[0];
          const nextGrid = {
            x: lastCommittedGrid.current.x + step.dx,
            y: lastCommittedGrid.current.y + step.dy,
          };
          await callMovePlayer(keypair, step.dx, step.dy, nextGrid);
          pendingSteps.current.shift();

          lastCommittedGrid.current = nextGrid;
        }

        setIsProcessingTransaction(false);
        setShowTransactionPopup(false);
      } catch (error) {
        setIsProcessingTransaction(false);
        setTransactionError(toFriendlyProgramError(error));
      } finally {
        processingQueue.current = false;
      }
    };

    void flushQueue();
  }, [position.x, position.z, connectionStatus, gamePhase]);

  const closeTransactionPopup = () => {
    setShowTransactionPopup(false);
    setTransactionError(null);
  };

  return {
    showTransactionPopup,
    transactionError,
    isProcessingTransaction,
    closeTransactionPopup,
  };
};
