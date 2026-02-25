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
 * Builds a SessionSigner adapter from a Privy wallet.
 * Bridges Privy's Wallet Standard interface (Uint8Array) to web3.js Transaction types.
 */
function buildSigner(wallet: { address: string; provider: any }): SessionSigner {
  const publicKey = new PublicKey(wallet.address);
  const provider = wallet.provider;

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
  const { login, logout, ready, authenticated, user } = usePrivy();
  const { wallet, connect: connectActiveWallet } = useActiveWallet();
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const didSetup = useRef(false);
  const connectAttempted = useRef(false);

  const trySetupSigner = useCallback((candidate: unknown): boolean => {
    const walletCandidate = candidate as
      | { type?: string; address?: string; provider?: { signTransaction?: unknown } }
      | undefined;

    if (!walletCandidate?.address) return false;

    const walletType = walletCandidate.type;
    console.log('[Privy] Wallet available:', walletCandidate.address, 'type:', walletType);

    if (walletType && walletType !== 'solana') {
      console.log('[Privy] Wallet is not Solana, skipping. Type:', walletType);
      return false;
    }
    if (typeof walletCandidate.provider?.signTransaction !== 'function') {
      console.warn('[Privy] Wallet provider is missing signTransaction.');
      return false;
    }
    if (didSetup.current && address === walletCandidate.address) {
      return true;
    }

    didSetup.current = true;
    const signer = buildSigner({
      address: walletCandidate.address,
      provider: walletCandidate.provider,
    });

    setSessionSigner(signer);
    setAddress(walletCandidate.address);
    setStatus('connected');
    setConnectionStatus('connected');
    setIsConnecting(false);

    const keypair = getSessionKeypair();
    void ensureGameConfigInitialized(keypair).then((ok) => {
      if (!ok) {
        console.warn('[Privy] Game config not readable for this deployment.');
      }
    });

    return true;
  }, [address, setConnectionStatus]);

  // After auth, actively connect the wallet if it's not already available
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (connectAttempted.current) return;

    if (wallet && trySetupSigner(wallet)) return;

    connectAttempted.current = true;
    setIsConnecting(true);
    setStatus('connecting');
    setConnectionStatus('connecting');

    console.log('[Privy] Authenticated, connecting active wallet...');
    void connectActiveWallet()
      .then((result) => {
        console.log('[Privy] connectActiveWallet result:', result);
        if (result?.wallet) {
          trySetupSigner(result.wallet);
        }
      })
      .catch((e) => {
        console.warn('[Privy] connectActiveWallet failed:', e);
      })
      .finally(() => {
        if (!didSetup.current) {
          setIsConnecting(false);
          setStatus('disconnected');
          setConnectionStatus('disconnected');
        }
      });
  }, [ready, authenticated, wallet, connectActiveWallet, setConnectionStatus, trySetupSigner]);

  // When wallet becomes available, wire up the signer
  useEffect(() => {
    if (!ready || !authenticated || !wallet) return;

    const ok = trySetupSigner(wallet);
    if (!ok && !didSetup.current) {
      setIsConnecting(false);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
    }
  }, [ready, authenticated, wallet, setConnectionStatus, trySetupSigner]);

  // If auth drops, reset connection state flags.
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      didSetup.current = false;
      connectAttempted.current = false;
      setIsConnecting(false);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
      setAddress(null);
    }
  }, [ready, authenticated, setConnectionStatus]);

  // Fallback: if authenticated but no wallet from useActiveWallet,
  // try to find the Solana address from the user's linked accounts.
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (didSetup.current) return;
    if (wallet) return;

    const solanaAccount = (user as any).linkedAccounts?.find(
      (a: any) => a.type === 'wallet' && a.chainType === 'solana'
    );
    if (solanaAccount?.address) {
      console.log('[Privy] Found Solana wallet in linked accounts:', solanaAccount.address);
      setAddress(solanaAccount.address);

      if (!didSetup.current) {
        setIsConnecting(false);
        setStatus('disconnected');
        setConnectionStatus('disconnected');
      }
    }
  }, [ready, authenticated, user, wallet, setConnectionStatus]);

  const handleConnect = useCallback(async (): Promise<boolean> => {
    if (!ready || isConnecting) return false;

    if (authenticated || !!user) {
      setIsConnecting(true);
      setStatus('connecting');
      setConnectionStatus('connecting');

      try {
        const result = await connectActiveWallet({ reset: true });
        console.log('[Privy] Re-connected wallet:', result);

        if (result?.wallet && trySetupSigner(result.wallet)) {
          return true;
        }
        if (wallet && trySetupSigner(wallet)) {
          return true;
        }
      } catch (e) {
        console.warn('[Privy] Re-connect failed:', e);
      } finally {
        if (!didSetup.current) {
          setIsConnecting(false);
          setStatus('disconnected');
          setConnectionStatus('disconnected');
        }
      }

      return didSetup.current;
    }

    setIsConnecting(true);
    setStatus('connecting');
    setConnectionStatus('connecting');
    connectAttempted.current = false;

    try {
      login();
      return false;
    } catch (e) {
      console.error('[Privy] Login failed:', e);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
      setIsConnecting(false);
      return false;
    }
  }, [
    ready,
    isConnecting,
    authenticated,
    user,
    connectActiveWallet,
    trySetupSigner,
    wallet,
    login,
    setConnectionStatus,
  ]);

  const handleDisconnect = useCallback(async () => {
    await logout();
    didSetup.current = false;
    connectAttempted.current = false;
    setIsConnecting(false);
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
