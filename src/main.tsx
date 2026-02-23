import { Buffer } from "buffer";
const g = globalThis as any;
g.Buffer = Buffer;
g.global = g.global || g;
g.process = g.process || { env: {} };

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Simple initialization without Dojo/Starknet
async function main() {
  try {
    console.log("🚀 Initializing BlockRooms...");

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      throw new Error("Root element not found");
    }

    // Load the app after globals are in place for Solana/Anchor dependencies.
    const { default: App } = await import("./app/App");

    console.log("✅ Root element found, rendering app...");

    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    console.log("✅ App rendered successfully");
  } catch (error) {
    console.error("❌ Failed to initialize app:", error);

    // Show error on screen
    const rootElement = document.getElementById("root");
    if (rootElement) {
      rootElement.innerHTML = `
        <div style="min-height: 100vh; background: #1a1a1a; color: white; display: flex; align-items: center; justify-content: center; font-family: monospace; padding: 20px;">
          <div style="max-width: 600px; background: #2a2a2a; padding: 30px; border-radius: 8px; border: 2px solid #ff4444;">
            <h1 style="color: #ff4444; margin-top: 0;">⚠️ Initialization Error</h1>
            <p style="margin: 20px 0;">Failed to start the application:</p>
            <pre style="background: #1a1a1a; padding: 15px; border-radius: 4px; overflow: auto;">${error instanceof Error ? error.message : String(error)}</pre>
            <p style="margin-top: 20px; opacity: 0.7;">Check the browser console (F12) for more details.</p>
          </div>
        </div>
      `;
    }
  }
}

void main();
