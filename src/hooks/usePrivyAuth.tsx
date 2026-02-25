import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import useAppStore from '../zustand/store';
import {
  setSessionSigner,
  ensureGameConfigInitialized,
  getSessionKeypair,
  type SessionSigner,
} from '../lib/solana';

/**
 * Builds a SessionSigner adapter from a Privy ConnectedStandardSolanaWallet.
 * Bridges Privy's Wallet Standard interface (Uint8Array) to web3.js Transaction types.
 */
function buildSigner(address: string, provider: any): SessionSigner {
  const publicKey = new PublicKey(address);

  return {
    publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      const serialized =
        tx instanceof Transaction
          ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
          : tx.serialize();

      const result = await provider.signTransaction({ transaction: new Uint8Array(serialized) });
      const signedBytes = result.signedTransaction as Uint8Array;

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
  const { login, logout, ready, authenticated } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const didSetup = useRef(false);

  // When Privy auth is done and Solana wallets are available, wire up the signer
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (solanaWallets.length === 0) return;

    const wallet = solanaWallets[0];
    const walletAddress = wallet.address;
    if (didSetup.current && address === walletAddress) return;

    console.log('[Privy] Solana wallet ready:', walletAddress);
    didSetup.current = true;

    const signer = buildSigner(walletAddress, wallet);
    setSessionSigner(signer);
    setAddress(walletAddress);
    setStatus('connected');
    setConnectionStatus('connected');
    setIsConnecting(false);

    const keypair = getSessionKeypair();
    void ensureGameConfigInitialized(keypair).then((ok) => {
      if (!ok) {
        console.warn('[Privy] Game config not readable for this deployment.');
      }
    });
  }, [ready, authenticated, solanaWallets, address, setConnectionStatus]);

  // Reset on logout
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      didSetup.current = false;
      setStatus('disconnected');
      setConnectionStatus('disconnected');
      setAddress(null);
      setIsConnecting(false);
    }
  }, [ready, authenticated, setConnectionStatus]);

  const handleConnect = useCallback(async () => {
    if (authenticated) return; // already logged in, useEffect handles wallet setup

    setIsConnecting(true);
    setStatus('connecting');
    setConnectionStatus('connecting');

    try {
      login();
    } catch (e) {
      console.error('[Privy] Login failed:', e);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
      setIsConnecting(false);
    }
  }, [authenticated, login, setConnectionStatus]);

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
