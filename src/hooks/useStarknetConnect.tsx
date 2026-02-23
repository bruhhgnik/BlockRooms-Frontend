import { useState, useEffect, useCallback, useRef } from 'react';
import useAppStore from '../zustand/store';
import {
  getSessionKeypair,
  ensureGameConfigInitialized,
} from '../lib/solana';

export const useStarknetConnect = () => {
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const didAutoConnect = useRef(false);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setStatus('connecting');
    setConnectionStatus('connecting');

    try {
      const keypair = getSessionKeypair();
      const pubkey = keypair.publicKey.toString();
      console.log('[Wallet] Session keypair:', pubkey);

      const hasGameConfig = await ensureGameConfigInitialized(keypair);
      if (!hasGameConfig) {
        console.warn(
          '[Wallet] Game config is not readable for this deployment. Start game may fail until config is reinitialized.'
        );
      }

      setStatus('connected');
      setAddress(pubkey);
      setConnectionStatus('connected');
    } catch (e) {
      console.error('[Wallet] Connection failed:', e);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  }, [setConnectionStatus]);

  useEffect(() => {
    // React StrictMode runs mount effects twice in dev.
    if (didAutoConnect.current) return;
    didAutoConnect.current = true;
    void handleConnect();
  }, [handleConnect]);

  return {
    status,
    address,
    handleConnect,
    isConnecting,
  };
};
