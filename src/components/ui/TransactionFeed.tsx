import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  subscribeTxLog,
  getTxEntries,
  TxEntry,
} from "../../lib/txlog";

const EXPLORER = "https://explorer.solana.com/tx/";
const CLUSTER = "?cluster=devnet";
const USE_MAGICBLOCK = true;

function shortenSig(sig: string): string {
  if (!sig) return "";
  return sig.slice(0, 8) + "..." + sig.slice(-6);
}

function timeSince(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 2) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

const statusColor: Record<TxEntry["status"], string> = {
  pending: "#E1CF48",
  confirmed: "#4ade80",
  error: "#ff6666",
};

const statusIcon: Record<TxEntry["status"], string> = {
  pending: "...",
  confirmed: "OK",
  error: "ERR",
};

export const TransactionFeed: React.FC = () => {
  const entries = useSyncExternalStore(subscribeTxLog, getTxEntries);
  const [, forceUpdate] = useState(0);

  // Re-render every 5s to update "time since" labels
  useEffect(() => {
    const t = setInterval(() => forceUpdate((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 4000,
        width: 420,
        maxWidth: "94vw",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 10,
          color: "#888",
          textAlign: "center",
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        MagicBlock ER Action Transactions
      </div>

      {/* Entries */}
      {entries.slice(0, 6).map((tx) => {
        const age = (Date.now() - tx.timestamp) / 1000;
        const opacity = age > 30 ? 0.3 : age > 15 ? 0.5 : 0.9;

        return (
          <div
            key={tx.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 10px",
              borderRadius: 6,
              background: "rgba(0,0,0,0.82)",
              border: `1px solid ${statusColor[tx.status]}33`,
              fontFamily: "monospace",
              fontSize: 11,
              color: "#ddd",
              opacity,
              pointerEvents: "auto",
              transition: "opacity 0.5s",
            }}
          >
            {/* Status badge */}
            <span
              style={{
                display: "inline-block",
                minWidth: 32,
                padding: "1px 4px",
                borderRadius: 3,
                background: statusColor[tx.status] + "22",
                color: statusColor[tx.status],
                fontWeight: "bold",
                fontSize: 9,
                textAlign: "center",
              }}
            >
              {statusIcon[tx.status]}
            </span>

            {/* Action label */}
            <span style={{ flex: 1, color: "#fff", fontWeight: 500 }}>
              {tx.action}
            </span>

            {/* Signature link */}
            {tx.signature && !USE_MAGICBLOCK ? (
              <a
                href={EXPLORER + tx.signature + CLUSTER}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#8bb4ff",
                  textDecoration: "none",
                  fontSize: 10,
                }}
                title={tx.signature}
              >
                {shortenSig(tx.signature)}
              </a>
            ) : tx.signature ? (
              <span style={{ color: "#8bb4ff", fontSize: 10 }} title={tx.signature}>
                {shortenSig(tx.signature)}
              </span>
            ) : tx.status === "error" ? (
              <span style={{ color: "#ff6666", fontSize: 10 }}>
                {tx.error?.slice(0, 24) || "failed"}
              </span>
            ) : (
              <span style={{ color: "#E1CF48", fontSize: 10 }}>
                pending...
              </span>
            )}

            {/* Time */}
            <span style={{ color: "#666", fontSize: 9, minWidth: 42, textAlign: "right" }}>
              {timeSince(tx.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
};
