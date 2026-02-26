import React, { useEffect, useMemo, useRef, useState } from "react";
import useAppStore, { GamePhase } from "../../zustand/store";
import { useSolanaConnect } from "../../hooks/useSolanaConnect";
import { useGameData } from "../../hooks/useGameData";
import { useInitializePlayer } from "../../hooks/useInitializePlayer";
import { useStartGame } from "../../hooks/useStartGame";
import { clearSessionKeypair } from "../../lib/solana";

export function MainMenu(): JSX.Element {
  const { status, address, handleConnect, isConnecting } = useSolanaConnect();
  const { isLoading: playerLoading, refetch } = useGameData();
  const {
    initializePlayer,
    isLoading: initializing,
    canInitialize,
  } = useInitializePlayer();
  const {
    startGame,
    isLoading: startingGame,
    canStartGame,
  } = useStartGame();
  const { setConnectionStatus, setLoading, gamePhase, player, startGame: startGameUI } =
    useAppStore();

  const isConnected = status === "connected";
  const hasPlayer = player !== null;
  const isLoading = isConnecting || playerLoading || initializing || startingGame;
  const lastFetchedAddressRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const images = useMemo(
    () => ["/bk1.jpg", "/bk2.jpg", "/bk3.jpg", "/bk4.jpg", "/bk5.jpg", "/bk6.jpg"],
    []
  );
  const [bg, setBg] = useState(0);

  useEffect(() => {
    setConnectionStatus(
      status === "connected" ? "connected" : isConnecting ? "connecting" : "disconnected"
    );
  }, [status, isConnecting, setConnectionStatus]);

  useEffect(() => setLoading(isLoading), [isLoading, setLoading]);

  useEffect(() => {
    if (!isConnected || !address) {
      lastFetchedAddressRef.current = null;
      return;
    }
    if (lastFetchedAddressRef.current === address) return;

    lastFetchedAddressRef.current = address;
    void refetch();
  }, [isConnected, address, refetch]);

  // tiny ambient background swapper
  useEffect(() => {
    const t = setInterval(() => {
      setBg((b) => (b + 1) % images.length);
    }, 5000);
    return () => clearInterval(t);
  }, [images.length]);

  const canEnterGame = isConnected && hasPlayer && !startingGame;
  const gameAlreadyActive = gamePhase === GamePhase.ACTIVE || (player as any)?.game_active;
  const startDisabled = !isConnected || startingGame || (!gameAlreadyActive && !canStartGame);

  const handleWalletConnect = async (): Promise<void> => {
    setError(null);
    await handleConnect();
  };

  const handlePlayerInit = async (): Promise<void> => {
    setError(null);
    const res = await initializePlayer();
    if (res?.success) setTimeout(() => refetch(), 2000);
    else if (res?.error) setError(res.error);
  };

  const handleStartOrEnterGame = async (): Promise<void> => {
    setError(null);
    if (gameAlreadyActive) {
      startGameUI();
      return;
    }
    if (!canStartGame) return;
    const res = await startGame();
    if (res?.success) startGameUI();
    else if (res?.error) setError(res.error);
  };

  const handleNewWallet = (): void => {
    clearSessionKeypair();
    window.location.reload();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundImage: `url(${images[bg]})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.85) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            width: 520,
            maxWidth: "92vw",
            border: "2px solid #444",
            borderRadius: 16,
            padding: 24,
            background: "rgba(0,0,0,0.6)",
            color: "white",
            fontFamily: "monospace",
            boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontSize: 26, letterSpacing: 2, color: "#E1CF48" }}>
            BLOCKROOMS
          </div>
          <div style={{ opacity: 0.8, marginTop: 4 }}>
            {address ? `Wallet: ${address.slice(0, 6)}...${address.slice(-4)}` : "Wallet: —"}
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 22 }}>
            <button
              onClick={handleWalletConnect}
              disabled={isConnected || isConnecting}
              style={{
                padding: "12px 16px",
                border: "2px solid #555",
                borderRadius: 10,
                background: isConnected ? "#224422" : "#111",
                color: isConnected ? "#9AD8AA" : "white",
                cursor: isConnected ? "default" : "pointer",
              }}
            >
              1. {isConnected ? "CONNECTED" : isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
            </button>

            <button
              onClick={handlePlayerInit}
              disabled={!isConnected || !canInitialize || initializing || hasPlayer}
              style={{
                padding: "12px 16px",
                border: "2px solid #555",
                borderRadius: 10,
                background: hasPlayer ? "#224422" : canInitialize ? "#111" : "#1a1a1a",
                color: hasPlayer ? "#9AD8AA" : "white",
                cursor: hasPlayer || !canInitialize ? "default" : "pointer",
              }}
            >
              2. {initializing ? "INITIALIZING..." : hasPlayer ? "PLAYER READY" : "INITIALIZE PLAYER"}
            </button>

            <button
              onClick={handleStartOrEnterGame}
              disabled={startDisabled}
              style={{
                padding: "12px 16px",
                border: "2px solid #555",
                borderRadius: 10,
                background: !startDisabled ? "#333" : "#111",
                color: !startDisabled ? "#E1CF48" : "white",
                cursor: startDisabled ? "not-allowed" : "pointer",
              }}
            >
              {startingGame
                ? "3. STARTING GAME..."
                : gameAlreadyActive
                ? "3. ENTER GAME"
                : canEnterGame
                ? "3. START GAME"
                : "3. START GAME"}
            </button>

            {isLoading && (
              <div style={{ marginTop: 10, color: "#ccc", fontSize: 13 }}>
                Processing blockchain transaction...
              </div>
            )}

            {error && (
              <div style={{ marginTop: 10, color: "#ff6b6b", fontSize: 13 }}>
                Error: {error}
              </div>
            )}

            {isConnected && (
              <button
                onClick={handleNewWallet}
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  border: "1px solid #333",
                  borderRadius: 8,
                  background: "transparent",
                  color: "#888",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                NEW WALLET
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MainMenu;
