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

  // After auth, actively connect the wallet if it's not already available
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (connectAttempted.current) return;

    // If wallet is already available, skip
    if (wallet) return;

    connectAttempted.current = true;
    console.log('[Privy] Authenticated, connecting active wallet...');
    connectActiveWallet().then((result) => {
      console.log('[Privy] connectActiveWallet result:', result);
    }).catch((e) => {
      console.warn('[Privy] connectActiveWallet failed:', e);
    });
  }, [ready, authenticated, wallet, connectActiveWallet]);

  // When wallet becomes available, wire up the signer
  useEffect(() => {
    if (!ready || !authenticated || !wallet) return;
    if (didSetup.current && address === wallet.address) return;

    const walletType = (wallet as any).type;
    console.log('[Privy] Wallet available:', wallet.address, 'type:', walletType);

    // Accept both Solana wallets and wallets without an explicit type
    if (walletType && walletType !== 'solana') {
      console.log('[Privy] Wallet is not Solana, skipping. Type:', walletType);
      // Still show as connected with the address even if we can't sign yet
      // This helps debug what wallet type is returned
      return;
    }

    didSetup.current = true;
    const signer = buildSigner(wallet as any);
    setSessionSigner(signer);
    setAddress(wallet.address);
    setStatus('connected');
    setConnectionStatus('connected');
    setIsConnecting(false);

    const keypair = getSessionKeypair();
    ensureGameConfigInitialized(keypair).then((ok) => {
      if (!ok) {
        console.warn('[Privy] Game config not readable for this deployment.');
      }
    });
  }, [ready, authenticated, wallet, address, setConnectionStatus]);

  // Fallback: if authenticated but no wallet from useActiveWallet,
  // try to find the Solana address from the user's linked accounts
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (didSetup.current) return;
    if (wallet) return; // useActiveWallet already provided one

    const solanaAccount = (user as any).linkedAccounts?.find(
      (a: any) => a.type === 'wallet' && a.chainType === 'solana'
    );
    if (solanaAccount?.address) {
      console.log('[Privy] Found Solana wallet in linked accounts:', solanaAccount.address);
      setAddress(solanaAccount.address);
      // We have the address but no provider yet for signing.
      // Show the address in UI but don't mark fully connected until provider is available.
    }
  }, [ready, authenticated, user, wallet]);

  const handleConnect = useCallback(async () => {
    if (authenticated) {
      // Already logged in — try to activate the wallet
      try {
        const result = await connectActiveWallet();
        console.log('[Privy] Re-connected wallet:', result);
      } catch (e) {
        console.warn('[Privy] Re-connect failed:', e);
      }
      return;
    }

    setIsConnecting(true);
    setStatus('connecting');
    setConnectionStatus('connecting');
    connectAttempted.current = false;

    try {
      login();
    } catch (e) {
      console.error('[Privy] Login failed:', e);
      setStatus('disconnected');
      setConnectionStatus('disconnected');
      setIsConnecting(false);
    }
  }, [authenticated, login, connectActiveWallet, setConnectionStatus]);

  const handleDisconnect = useCallback(async () => {
    await logout();
    didSetup.current = false;
    connectAttempted.current = false;
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
