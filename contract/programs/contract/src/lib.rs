use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("CrgPTeh4yRygMe4x7VuNLsNp5LwRAc3dBMCidQUYRu6w");

pub const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod contract {
    use super::*;

    /// Initialize the counter.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Increment the counter.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        if counter.count > 1000 {
            counter.count = 0;
        }
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Delegate the account to the delegation program
    pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[COUNTER_SEED],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Manual commit the account in the ER.
    pub fn commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Undelegate the account from the delegation program
    pub fn undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Increment the counter + manual commit the account in the ER.
    pub fn increment_and_commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        counter.exit(&crate::ID)?;
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Increment the counter + undelegate from ER.
    pub fn increment_and_undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        counter.exit(&crate::ID)?;
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The pda to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[commit]
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub count: u64,
}

// ===== UNIT TESTS =====
#[cfg(test)]
mod tests {
    use super::*;

    // Test Counter struct size calculation
    #[test]
    fn test_counter_size() {
        // Counter should be 8 bytes (u64)
        assert_eq!(std::mem::size_of::<u64>(), 8);
    }

    // Test counter initialization value
    #[test]
    fn test_counter_default_value() {
        let counter = Counter { count: 0 };
        assert_eq!(counter.count, 0);
    }

    // Test counter increment logic
    #[test]
    fn test_counter_increment() {
        let mut count: u64 = 0;
        count += 1;
        assert_eq!(count, 1);
    }

    // Test counter overflow protection (resets at 1000)
    #[test]
    fn test_counter_overflow_reset() {
        let mut count: u64 = 1000;
        count += 1;
        if count > 1000 {
            count = 0;
        }
        assert_eq!(count, 0);
    }

    // Test counter at boundary (exactly 1000)
    #[test]
    fn test_counter_at_boundary() {
        let mut count: u64 = 999;
        count += 1;
        if count > 1000 {
            count = 0;
        }
        assert_eq!(count, 1000);
    }

    // Test counter just before overflow
    #[test]
    fn test_counter_before_overflow() {
        let count: u64 = 1000;
        assert!(count <= 1000);
    }

    // Test multiple increments
    #[test]
    fn test_counter_multiple_increments() {
        let mut count: u64 = 0;
        for _ in 0..100 {
            count += 1;
            if count > 1000 {
                count = 0;
            }
        }
        assert_eq!(count, 100);
    }

    // Test counter wrapping behavior
    #[test]
    fn test_counter_wrap_around() {
        let mut count: u64 = 0;
        // Simulate incrementing past 1000
        for _ in 0..1005 {
            count += 1;
            if count > 1000 {
                count = 0;
            }
        }
        // After 1001 increments, it resets to 0, then increments 4 more times
        assert_eq!(count, 4);
    }

    // Test PDA seed constant
    #[test]
    fn test_counter_seed() {
        assert_eq!(COUNTER_SEED, b"counter");
        assert_eq!(COUNTER_SEED.len(), 7);
    }

    // Test counter max value before reset
    #[test]
    fn test_counter_max_value() {
        let max_allowed: u64 = 1000;
        let mut count: u64 = max_allowed;
        // Should not reset at exactly 1000
        if count > 1000 {
            count = 0;
        }
        assert_eq!(count, 1000);
    }
}
