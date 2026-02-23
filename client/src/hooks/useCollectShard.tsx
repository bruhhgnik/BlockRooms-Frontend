export const useCollectShard = () => {
  const collectShard = async (shardId: string) => {
    console.log(`Collecting shard ${shardId}`);
    // TODO: Implement Solana contract call
    return { success: true };
  };

  return { collectShard };
};
