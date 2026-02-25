import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy, useActiveWallet } from '@privy-io/react-auth';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import useAppStore from '../zustand/store';
import {
  setSessionSigner,
  ensureGameConfigInitialized,
  getSessionKeypair,
  type SessionSigner,
} from '../lib/solana';

/**
 * Builds a SessionSigner adapter from a Privy BaseConnectedSolanaWallet.
 * The wallet's provider uses Wallet Standard (Uint8Array-based signTransaction),
 * so we bridge that to web3.js Transaction types.
 */
function buildSigner(wallet: { address: string; provider: any }): SessionSigner {
  const publicKey = new PublicKey(wallet.address);
  const provider = wallet.provider;

  return {
    publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      // Serialize to bytes for wallet standard interface
      const serialized =
        tx instanceof Transaction
          ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
          : tx.serialize();

      const result = await provider.signTransaction({ transaction: new Uint8Array(serialized) });
      const signedBytes = result.signedTransaction as Uint8Array;

      // Deserialize back to the same Transaction type
      if (tx instanceof Transaction) {
        return Transaction.from(signedBytes) as T;
      }
      return VersionedTransaction.deserialize(signedBytes) as T;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      return Promise.all(txs.map((tx) => this.signTransaction(tx)));
    },
  };
}

export const usePrivyAuth = () => {
  const { login, logout, ready, authenticated, user } = usePrivy();
  const { wallet, connect: connectActiveWallet } = useActiveWallet();
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const didSetup = useRef(false);

  // When Privy auth + wallet are ready, wire up the signer
  useEffect(() => {
    if (!ready || !authenticated || !wallet) return;
    if ((wallet as any).type !== 'solana') return;
    if (didSetup.current && address === wallet.address) return;

    didSetup.current = true;
    const signer = buildSigner(wallet as any);
    setSessionSigner(signer);
    setAddress(wallet.address);
    setStatus('connected');
    setConnectionStatus('connected');

    // Ensure game config is initialized in the background
    const keypair = getSessionKeypair(); // uses the signer's publicKey
    ensureGameConfigInitialized(keypair).then((ok) => {
      if (!ok) {
        console.warn('[Privy] Game config not readable for this deployment.');
      }
    });
  }, [ready, authenticated, wallet, address, setConnectionStatus]);

  const handleConnect = useCallback(async () => {
    if (authenticated && wallet) {
      // Already logged in — just connect the active wallet
      try {
        await connectActiveWallet();
      } catch {
        // wallet already connected
      }
      return;
    }

    setIsConnecting(true);
    setStatus('connecting');
    setConnectionStatus('connecting');

    try {
      login();
      // Privy's login is modal-based; the useEffect above handles the rest
      // once authenticated + wallet become truthy.
    } catch (e) {
      console.error('[Privy] Login failed:', e);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  }, [authenticated, wallet, login, connectActiveWallet, setConnectionStatus]);

  const handleDisconnect = useCallback(async () => {
    await logout();
    didSetup.current = false;
    setStatus('disconnected');
    setAddress(null);
    setConnectionStatus('disconnected');
  }, [logout, setConnectionStatus]);

  return {
    status,
    address,
    handleConnect,
    handleDisconnect,
    isConnecting,
    ready,
  };
};
