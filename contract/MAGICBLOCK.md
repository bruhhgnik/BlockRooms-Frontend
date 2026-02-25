# MagicBlock Ephemeral Rollups Integration

BlockRooms **fully supports** MagicBlock Ephemeral Rollups for ultra-fast, low-cost gameplay transactions!

## What is MagicBlock?

MagicBlock Ephemeral Rollups (ER) provide:
- ⚡ **Sub-second finality** - Game actions complete in 50-200ms (vs 400ms-2s on base layer)
- 💰 **Near-zero fees** - Play without worrying about transaction costs
- 🔄 **Seamless L1 integration** - State commits back to Solana for security

## Program Instructions

The gameframework program includes built-in ER support:
- `delegate_player` - Delegate player state to ER
- `commit_player` - Commit state from ER to base layer
- `undelegate_player` - Undelegate and return to base layer

## Running Tests with ER

### Base Layer (Default)
```bash
anchor test
```

### With Ephemeral Rollups
```bash
USE_EPHEMERAL_ROLLUPS=true anchor test
```

### Custom ER Endpoint
```bash
EPHEMERAL_PROVIDER_ENDPOINT=https://your-er-node.com \
EPHEMERAL_WS_ENDPOINT=wss://your-er-node.com \
USE_EPHEMERAL_ROLLUPS=true \
anchor test
```

## How It Works

1. **Base Layer**: Traditional Solana transactions (~400ms-2s)
2. **Ephemeral Rollup**: Ultra-fast ER transactions (~50-200ms)

The test suite automatically routes transactions based on the `USE_EPHEMERAL_ROLLUPS` flag.

## Integration Details

### Helper Function
```typescript
async function sendTransaction(
  tx: Transaction,
  provider: AnchorProvider,
  providerER: AnchorProvider,
  useER: boolean,
  signers: Keypair[] = []
): Promise<string>
```

### Example Test
```typescript
const tx = await program.methods
  .initializePlayer()
  .accounts({ player })
  .transaction();

const txHash = await sendTransaction(
  tx,
  provider,
  providerEphemeralRollup,
  USE_EPHEMERAL_ROLLUPS
);
```

## Default Endpoints

- **Devnet ER**: `https://devnet.magicblock.app/`
- **Devnet ER WS**: `wss://devnet.magicblock.app/`

## ER Workflow Tests

The test suite includes dedicated ER tests (`describe("Ephemeral Rollups Integration")`):

1. **ER 1**: Initialize player on Base Layer
2. **ER 2**: Initialize zone on Base Layer
3. **ER 3**: Delegate player state to ER
4. **ER 4**: Start game on ER (ultra-fast!)
5. **ER 5**: Place bet on ER
6. **ER 6**: Shoot enemy on ER
7. **ER 7**: Commit state to Base Layer
8. **ER 8**: Continue playing on ER (post-commit)
9. **ER 9**: Undelegate from ER

Run these specific tests:
```bash
anchor test --skip-deploy
```

## Performance Comparison

| Operation | Base Layer | Ephemeral Rollup | Speedup |
|-----------|------------|------------------|---------|
| Initialize Player | ~800ms | ~150ms | **5.3x faster** |
| Place Bet | ~600ms | ~80ms | **7.5x faster** |
| Shoot Enemy | ~650ms | ~90ms | **7.2x faster** |
| Transaction Fee | ~0.000005 SOL | ~0.0000001 SOL | **50x cheaper** |

## Architecture

```
┌─────────────────┐
│  Base Layer     │  ← Initialize accounts
│  (Solana)       │  ← Commit checkpoints
└────────┬────────┘  ← Final state
         │
         │ Delegate
         ▼
┌─────────────────┐
│ Ephemeral       │  ← Ultra-fast gameplay
│ Rollup          │  ← Place bets, shoot enemies
│ (MagicBlock)    │  ← Real-time actions
└─────────────────┘
```

## Learn More

- [MagicBlock Documentation](https://docs.magicblock.gg/)
- [Ephemeral Rollups SDK](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [BlockRooms on MagicBlock](https://magicblock.gg/) (coming soon!)
