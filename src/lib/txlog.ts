/**
 * Transaction Log — lightweight store for displaying recent on-chain transactions.
 */

export interface TxEntry {
  id: number;
  action: string;
  signature: string;
  status: "pending" | "confirmed" | "error";
  error?: string;
  timestamp: number;
}

type Listener = () => void;

const MAX_ENTRIES = 12;
let _entries: TxEntry[] = [];
let _nextId = 1;
const _listeners = new Set<Listener>();
const _pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const PENDING_TIMEOUT_MS = 45000;

function notify() {
  _listeners.forEach((fn) => fn());
}

/** Subscribe to log changes (returns unsubscribe) */
export function subscribeTxLog(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Get current entries (newest first) */
export function getTxEntries(): TxEntry[] {
  return _entries;
}

/** Log a pending transaction */
export function txPending(action: string): number {
  const id = _nextId++;
  _entries = [
    { id, action, signature: "", status: "pending" as const, timestamp: Date.now() },
    ..._entries,
  ].slice(0, MAX_ENTRIES);
  const t = setTimeout(() => {
    _pendingTimers.delete(id);
    txError(id, "timeout");
  }, PENDING_TIMEOUT_MS);
  _pendingTimers.set(id, t);
  notify();
  return id;
}

/** Mark a transaction as confirmed */
export function txConfirmed(id: number, signature: string) {
  const t = _pendingTimers.get(id);
  if (t) {
    clearTimeout(t);
    _pendingTimers.delete(id);
  }
  _entries = _entries.map((e) =>
    e.id === id ? { ...e, signature, status: "confirmed" as const } : e
  );
  notify();
}

/** Mark a transaction as errored */
export function txError(id: number, error: string) {
  const t = _pendingTimers.get(id);
  if (t) {
    clearTimeout(t);
    _pendingTimers.delete(id);
  }
  _entries = _entries.map((e) =>
    e.id === id ? { ...e, status: "error" as const, error } : e
  );
  notify();
}

/** Clear all entries */
export function txClear() {
  for (const t of _pendingTimers.values()) clearTimeout(t);
  _pendingTimers.clear();
  _entries = [];
  notify();
}
