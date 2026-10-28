//! XAILENS lock program.
//!
//! Holders lock XAILENS in a program-owned vault to prove that they hold a
//! threshold amount for a period of time. The program records *when* each
//! threshold was first met so that off-chain services (subscription discount,
//! Founder-level access, feature voting) can verify holding duration.
//!
//! Design rules enforced here:
//! - No reward emission. Locking never pays out tokens.
//! - Withdrawals can never be blocked by the admin (pause only stops new locks).
//! - The admin cannot change the cooldown of an unlock request that is already pending.
//! - Admin authority moves only through a two-step propose/accept transfer.
//! - Only the program upgrade authority can initialize the pool.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("6urQa7RwSR1nW9tbYkGpaLznWL7WuFSmGHmwJZWcXTA9");

/// XAILENS token has 6 decimals.
pub const XAILENS_DECIMALS: u8 = 6;

/// Default unlock cooldown: 7 days.
pub const DEFAULT_COOLDOWN: i64 = 7 * 24 * 3600;

/// Upper bound for the unlock cooldown the admin may set: 30 days.
pub const MAX_COOLDOWN: i64 = 30 * 24 * 3600;

/// Minimum lock amount: 1 XAILENS.
pub const MINIMUM_LOCK: u64 = 1_000_000;

pub const POOL_SEED: &[u8] = b"lock_pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const LOCK_SEED: &[u8] = b"lock";

#[program]
pub mod xailens_lock {
    use super::*;

    /// Create the single lock pool. Callable once, only by the program's
    /// upgrade authority, so nobody can front-run pool creation.
    pub fn initialize(ctx: Context<Initialize>, params: PoolParams) -> Result<()> {
        validate_params(&params)?;

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.pending_authority = Pubkey::default();
        pool.mint = ctx.accounts.mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.cooldown_period = params.cooldown_period;
        pool.discount_threshold = params.discount_threshold;
        pool.founder_threshold = params.founder_threshold;
        pool.voting_threshold = params.voting_threshold;
        pool.total_locked = 0;
        pool.paused = false;
        pool.bump = ctx.bumps.pool;

        emit!(PoolInitialized {
            authority: pool.authority,
            mint: pool.mint,
            cooldown_period: pool.cooldown_period,
            discount_threshold: pool.discount_threshold,
            founder_threshold: pool.founder_threshold,
            voting_threshold: pool.voting_threshold,
        });
        Ok(())
    }

    /// Lock `amount` XAILENS. Adds to any existing lock. Blocked while the pool
    /// is paused or while an unlock request is pending.
    pub fn lock(ctx: Context<Lock>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.pool.paused, LockError::PoolPaused);
        require!(amount >= MINIMUM_LOCK, LockError::BelowMinimumLock);

        let lock_account = &mut ctx.accounts.lock_account;
        require!(
            lock_account.unlock_requested_at == 0,
            LockError::UnlockAlreadyRequested
        );

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        if lock_account.amount == 0 {
            lock_account.owner = ctx.accounts.user.key();
            lock_account.locked_since = now;
            lock_account.bump = ctx.bumps.lock_account;
        }
        lock_account.last_deposit_at = now;
        lock_account.amount = lock_account
            .amount
            .checked_add(amount)
            .ok_or(LockError::Overflow)?;

        let pool = &mut ctx.accounts.pool;
        pool.total_locked = pool
            .total_locked
            .checked_add(amount)
            .ok_or(LockError::Overflow)?;

        update_threshold_clocks(lock_account, pool, now);

        emit!(Locked {
            user: ctx.accounts.user.key(),
            amount,
            total_locked: lock_account.amount,
            discount_since: lock_account.discount_since,
            founder_since: lock_account.founder_since,
            voting_since: lock_account.voting_since,
            timestamp: now,
        });
        Ok(())
    }

    /// Start the unlock cooldown. The cooldown length is snapshotted so a
    /// later admin change cannot extend a pending request. Threshold clocks
    /// reset: an unlocking wallet no longer counts as holding.
    pub fn request_unlock(ctx: Context<RequestUnlock>) -> Result<()> {
        let lock_account = &mut ctx.accounts.lock_account;
        require!(lock_account.amount > 0, LockError::NothingLocked);
        require!(
            lock_account.unlock_requested_at == 0,
            LockError::UnlockAlreadyRequested
        );

        let now = Clock::get()?.unix_timestamp;
        lock_account.unlock_requested_at = now;
        lock_account.unlock_cooldown = ctx.accounts.pool.cooldown_period;
        lock_account.discount_since = 0;
        lock_account.founder_since = 0;
        lock_account.voting_since = 0;

        emit!(UnlockRequested {
            user: ctx.accounts.user.key(),
            amount: lock_account.amount,
            requested_at: now,
            cooldown: lock_account.unlock_cooldown,
        });
        Ok(())
    }

    /// Withdraw the full locked amount after the cooldown. Never blocked by
    /// pause.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool_bump = ctx.accounts.pool.bump;

        let lock_account = &mut ctx.accounts.lock_account;
        require!(lock_account.amount > 0, LockError::NothingLocked);
        require!(
            lock_account.unlock_requested_at > 0,
            LockError::NoUnlockRequested
        );
        let elapsed = now
            .checked_sub(lock_account.unlock_requested_at)
            .ok_or(LockError::Overflow)?;
        require!(
            elapsed >= lock_account.unlock_cooldown,
            LockError::CooldownNotElapsed
        );

        let amount = lock_account.amount;
        lock_account.amount = 0;
        lock_account.locked_since = 0;
        lock_account.last_deposit_at = 0;
        lock_account.unlock_requested_at = 0;
        lock_account.unlock_cooldown = 0;
        lock_account.discount_since = 0;
        lock_account.founder_since = 0;
        lock_account.voting_since = 0;

        let seeds: &[&[u8]] = &[POOL_SEED, &[pool_bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.total_locked = pool
            .total_locked
            .checked_sub(amount)
            .ok_or(LockError::Overflow)?;

        emit!(Withdrawn {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: now,
        });
        Ok(())
    }

    /// Close an empty lock account and return its rent to the owner.
    pub fn close_lock_account(ctx: Context<CloseLockAccount>) -> Result<()> {
        require!(ctx.accounts.lock_account.amount == 0, LockError::StillLocked);
        Ok(())
    }

    /// Admin: update pool parameters. Cannot touch pending unlock requests.
    pub fn update_pool(ctx: Context<AdminOnly>, update: PoolUpdate) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        if let Some(cooldown) = update.cooldown_period {
            require!(
                cooldown > 0 && cooldown <= MAX_COOLDOWN,
                LockError::InvalidCooldown
            );
            pool.cooldown_period = cooldown;
        }
        if let Some(v) = update.discount_threshold {
            pool.discount_threshold = v;
        }
        if let Some(v) = update.founder_threshold {
            pool.founder_threshold = v;
        }
        if let Some(v) = update.voting_threshold {
            pool.voting_threshold = v;
        }
        if let Some(p) = update.paused {
            pool.paused = p;
        }
        require!(
            pool.discount_threshold <= pool.founder_threshold || pool.founder_threshold == 0,
            LockError::InvalidThresholds
        );
        emit!(PoolUpdated {
            cooldown_period: pool.cooldown_period,
            discount_threshold: pool.discount_threshold,
            founder_threshold: pool.founder_threshold,
            voting_threshold: pool.voting_threshold,
            paused: pool.paused,
        });
        Ok(())
    }

    /// Admin: step 1 of authority transfer (for example to a Squads multisig).
    pub fn propose_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        require!(new_authority != Pubkey::default(), LockError::InvalidAuthority);
        let pool = &mut ctx.accounts.pool;
        pool.pending_authority = new_authority;
        emit!(AuthorityProposed {
            current: pool.authority,
            proposed: new_authority,
        });
        Ok(())
    }

    /// Step 2 of authority transfer: the proposed authority accepts.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let previous = pool.authority;
        pool.authority = ctx.accounts.new_authority.key();
        pool.pending_authority = Pubkey::default();
        emit!(AuthorityTransferred {
            previous,
            current: pool.authority,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate_params(p: &PoolParams) -> Result<()> {
    require!(
        p.cooldown_period > 0 && p.cooldown_period <= MAX_COOLDOWN,
        LockError::InvalidCooldown
    );
    require!(
        p.discount_threshold <= p.founder_threshold || p.founder_threshold == 0,
        LockError::InvalidThresholds
    );
    Ok(())
}

/// Start a threshold clock the first time the locked amount reaches the
/// threshold. Clocks are never reset here: the locked amount only grows until
/// `request_unlock`, which clears every clock.
fn update_threshold_clocks(acc: &mut LockAccount, pool: &LockPool, now: i64) {
    fn bump(since: &mut i64, amount: u64, threshold: u64, now: i64) {
        if threshold > 0 && amount >= threshold && *since == 0 {
            *since = now;
        }
    }
    bump(&mut acc.discount_since, acc.amount, pool.discount_threshold, now);
    bump(&mut acc.founder_since, acc.amount, pool.founder_threshold, now);
    bump(&mut acc.voting_since, acc.amount, pool.voting_threshold, now);
}

// ---------------------------------------------------------------------------
// Instruction data
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PoolParams {
    /// Unlock cooldown in seconds (1 ..= MAX_COOLDOWN).
    pub cooldown_period: i64,
    /// Raw amount (6 decimals) that qualifies for the subscription discount. 0 disables.
    pub discount_threshold: u64,
    /// Raw amount that qualifies for Founder-level benefits. 0 disables.
    pub founder_threshold: u64,
    /// Raw amount that qualifies for feature voting. 0 disables.
    pub voting_threshold: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct PoolUpdate {
    pub cooldown_period: Option<i64>,
    pub discount_threshold: Option<u64>,
    pub founder_threshold: Option<u64>,
    pub voting_threshold: Option<u64>,
    pub paused: Option<bool>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct LockPool {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub cooldown_period: i64,
    pub discount_threshold: u64,
    pub founder_threshold: u64,
    pub voting_threshold: u64,
    pub total_locked: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct LockAccount {
    pub owner: Pubkey,
    /// Raw locked amount.
    pub amount: u64,
    /// When the current lock started (first deposit after an empty state).
    pub locked_since: i64,
    /// Most recent deposit.
    pub last_deposit_at: i64,
    /// When the discount threshold was first met. 0 = not met.
    pub discount_since: i64,
    /// When the Founder threshold was first met. 0 = not met.
    pub founder_since: i64,
    /// When the voting threshold was first met. 0 = not met.
    pub voting_since: i64,
    /// When unlock was requested. 0 = no pending request.
    pub unlock_requested_at: i64,
    /// Cooldown snapshotted at request time.
    pub unlock_cooldown: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + LockPool::INIT_SPACE,
        seeds = [POOL_SEED],
        bump,
    )]
    pub pool: Account<'info, LockPool>,

    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// This program, used to locate its ProgramData account.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ LockError::Unauthorized)]
    pub program: Program<'info, crate::program::XailensLock>,

    /// The signer must be the program's upgrade authority.
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ LockError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Lock<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, LockPool>,

    #[account(address = pool.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + LockAccount::INIT_SPACE,
        seeds = [LOCK_SEED, user.key().as_ref()],
        bump,
    )]
    pub lock_account: Account<'info, LockAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, address = pool.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestUnlock<'info> {
    pub user: Signer<'info>,

    #[account(seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, LockPool>,

    #[account(
        mut,
        seeds = [LOCK_SEED, user.key().as_ref()],
        bump = lock_account.bump,
        constraint = lock_account.owner == user.key() @ LockError::Unauthorized,
    )]
    pub lock_account: Account<'info, LockAccount>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Account<'info, LockPool>,

    #[account(address = pool.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [LOCK_SEED, user.key().as_ref()],
        bump = lock_account.bump,
        constraint = lock_account.owner == user.key() @ LockError::Unauthorized,
    )]
    pub lock_account: Account<'info, LockAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, address = pool.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseLockAccount<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        close = user,
        seeds = [LOCK_SEED, user.key().as_ref()],
        bump = lock_account.bump,
        constraint = lock_account.owner == user.key() @ LockError::Unauthorized,
    )]
    pub lock_account: Account<'info, LockAccount>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED],
        bump = pool.bump,
        has_one = authority @ LockError::Unauthorized,
    )]
    pub pool: Account<'info, LockPool>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED],
        bump = pool.bump,
        constraint = pool.pending_authority == new_authority.key() @ LockError::Unauthorized,
    )]
    pub pool: Account<'info, LockPool>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct PoolInitialized {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub cooldown_period: i64,
    pub discount_threshold: u64,
    pub founder_threshold: u64,
    pub voting_threshold: u64,
}

#[event]
pub struct Locked {
    pub user: Pubkey,
    pub amount: u64,
    pub total_locked: u64,
    pub discount_since: i64,
    pub founder_since: i64,
    pub voting_since: i64,
    pub timestamp: i64,
}

#[event]
pub struct UnlockRequested {
    pub user: Pubkey,
    pub amount: u64,
    pub requested_at: i64,
    pub cooldown: i64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PoolUpdated {
    pub cooldown_period: i64,
    pub discount_threshold: u64,
    pub founder_threshold: u64,
    pub voting_threshold: u64,
    pub paused: bool,
}

#[event]
pub struct AuthorityProposed {
    pub current: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub previous: Pubkey,
    pub current: Pubkey,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum LockError {
    #[msg("Lock amount is below the minimum of 1 XAILENS")]
    BelowMinimumLock,
    #[msg("Nothing is locked")]
    NothingLocked,
    #[msg("Lock account still holds tokens")]
    StillLocked,
    #[msg("Cooldown period has not elapsed yet")]
    CooldownNotElapsed,
    #[msg("No unlock has been requested")]
    NoUnlockRequested,
    #[msg("Unlock has already been requested")]
    UnlockAlreadyRequested,
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Cooldown must be between 1 second and 30 days")]
    InvalidCooldown,
    #[msg("Discount threshold must not exceed Founder threshold")]
    InvalidThresholds,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("The pool is paused: no new locks (withdrawals still work)")]
    PoolPaused,
}
