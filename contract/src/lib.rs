//! Hot Potato Coin (SPUD): a NEP-141 token where one wallet holds the potato at a time.
//! Pass it before the timer expires or 20% of your balance rots: 50% burned,
//! 40% to a Sputnik DAO treasury, 10% bounty to whoever settles.
//! No owner, no mint function, no admin keys. Supply is fixed at init.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

const ONE: u128 = 1_000_000_000_000_000_000; // 18 decimals
const SUPPLY: u128 = 1_000_000_000 * ONE;
const SEED: u128 = SUPPLY / 10; // 10% seeded to the DAO treasury
const STARTER: u128 = 1_000 * ONE;
const MIN_HOLD: u128 = 100 * ONE; // needed to grab or receive the potato
const PENALTY_BPS: u128 = 2_000; // 20% of holder balance
const MIN_WINDOW_NS: u64 = 60_000_000_000;
const REG_COST: u128 = 1_250_000_000_000_000_000_000; // 0.00125 NEAR storage deposit
const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23f97316'/%3E%3Ccircle cx='24' cy='26' r='4' fill='%23fff7ed'/%3E%3C/svg%3E";

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near(serializers = [json])]
pub struct PotatoView {
    pub holder: Option<AccountId>,
    pub prev_holder: Option<AccountId>,
    pub deadline_ns: U64,
    pub window_ns: U64,
    pub round: U64,
    pub passes: U64,
    pub rotted: U64,
    pub total_burned: U128,
    pub total_to_treasury: U128,
    pub treasury: AccountId,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    treasury: AccountId,
    holder: Option<AccountId>,
    prev_holder: Option<AccountId>,
    deadline_ns: u64,
    window_ns: u64,
    base_window_ns: u64,
    round: u64,
    passes: u64,
    rotted: u64,
    total_burned: u128,
    total_to_treasury: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(treasury: AccountId, base_window_secs: u64) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let me = env::current_account_id();
        require!(treasury != me, "Treasury must be a different account");
        let base = base_window_secs.saturating_mul(1_000_000_000);
        require!(base >= MIN_WINDOW_NS, "Window must be at least 60 seconds");

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Hot Potato".to_string(),
            symbol: "SPUD".to_string(),
            icon: Some(ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals: 18,
        };
        metadata.assert_valid();

        let mut token = FungibleToken::new(StorageKey::FungibleToken);
        token.internal_register_account(&me);
        token.internal_register_account(&treasury);
        token.internal_deposit(&me, SUPPLY - SEED); // faucet pool, claimed by players
        token.internal_deposit(&treasury, SEED);
        FtMint::emit_many(&[
            FtMint { owner_id: &me, amount: U128(SUPPLY - SEED), memo: Some("faucet pool") },
            FtMint { owner_id: &treasury, amount: U128(SEED), memo: Some("treasury seed") },
        ]);

        Self {
            token,
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            treasury,
            holder: None,
            prev_holder: None,
            deadline_ns: 0,
            window_ns: base,
            base_window_ns: base,
            round: 0,
            passes: 0,
            rotted: 0,
            total_burned: 0,
            total_to_treasury: 0,
        }
    }

    /// One-time starter pack. The attached deposit pays for the caller's storage.
    #[payable]
    pub fn claim_starter(&mut self) {
        require!(env::attached_deposit().as_yoctonear() >= REG_COST, "Attach 0.00125 NEAR for storage");
        let me = env::current_account_id();
        let caller = env::predecessor_account_id();
        require!(!self.token.accounts.contains_key(&caller), "Already claimed");
        self.token.internal_register_account(&caller);
        self.token.internal_transfer(&me, &caller, STARTER, Some("starter pack".to_string()));
    }

    /// Pick up a fallen potato. Starts a new round with the full-length timer.
    pub fn grab_potato(&mut self) {
        self.expire();
        require!(self.holder.is_none(), "Someone is already holding the potato");
        let caller = env::predecessor_account_id();
        require!(self.balance(&caller) >= MIN_HOLD, "Need at least 100 SPUD to hold the potato");
        self.round += 1;
        self.window_ns = self.base_window_ns;
        self.deadline_ns = env::block_timestamp() + self.window_ns;
        self.holder = Some(caller.clone());
        self.prev_holder = None;
        log!("Round {}: {} grabbed the potato", self.round, caller);
    }

    /// Pass the potato. Returns false if it had already expired (penalty applied instead).
    pub fn pass_potato(&mut self, to: AccountId) -> bool {
        if self.expire() {
            return false;
        }
        let me = env::predecessor_account_id();
        require!(self.holder.as_ref() == Some(&me), "You are not holding the potato");
        require!(to != me, "Cannot pass to yourself");
        require!(self.prev_holder.as_ref() != Some(&to), "No passing straight back");
        require!(to != self.treasury && to != env::current_account_id(), "Invalid receiver");
        require!(self.balance(&to) >= MIN_HOLD, "Receiver needs at least 100 SPUD");
        self.passes += 1;
        // each pass makes the next timer 5% shorter, down to a 60s floor
        self.window_ns = (self.window_ns / 100 * 95).max(MIN_WINDOW_NS);
        self.deadline_ns = env::block_timestamp() + self.window_ns;
        self.prev_holder = Some(me.clone());
        self.holder = Some(to.clone());
        log!("{} passed the potato to {}", me, to);
        true
    }

    /// Anyone can call this once the deadline has passed. The caller earns the bounty.
    pub fn settle(&mut self) -> bool {
        self.expire()
    }

    pub fn potato(&self) -> PotatoView {
        PotatoView {
            holder: self.holder.clone(),
            prev_holder: self.prev_holder.clone(),
            deadline_ns: U64(self.deadline_ns),
            window_ns: U64(self.window_ns),
            round: U64(self.round),
            passes: U64(self.passes),
            rotted: U64(self.rotted),
            total_burned: U128(self.total_burned),
            total_to_treasury: U128(self.total_to_treasury),
            treasury: self.treasury.clone(),
        }
    }
}

impl Contract {
    fn balance(&self, id: &AccountId) -> u128 {
        self.token.accounts.get(id).unwrap_or(0)
    }

    /// Lazy settlement: NEAR contracts cannot run on timers, so every entry point
    /// first checks whether the deadline has passed and applies the penalty if so.
    fn expire(&mut self) -> bool {
        let holder = match self.holder.clone() {
            Some(h) => h,
            None => return false,
        };
        if env::block_timestamp() <= self.deadline_ns {
            return false;
        }
        let penalty = self.balance(&holder) * PENALTY_BPS / 10_000;
        let bounty = penalty / 10;
        let burn = penalty / 2;
        let to_dao = penalty - burn - bounty;
        if penalty > 0 {
            let caller = env::predecessor_account_id();
            let finder = if caller != holder && self.token.accounts.contains_key(&caller) {
                caller
            } else {
                self.treasury.clone()
            };
            let dao = self.treasury.clone();
            self.token.internal_withdraw(&holder, penalty);
            self.token.internal_deposit(&finder, bounty);
            self.token.internal_deposit(&dao, to_dao);
            FtBurn { owner_id: &holder, amount: U128(burn), memo: Some("rotten potato") }.emit();
            self.total_burned += burn;
            self.total_to_treasury += to_dao;
        }
        self.rotted += 1;
        self.holder = None;
        self.prev_holder = None;
        log!("Potato rotted in {}'s hands: {} burned, {} to treasury", holder, burn, to_dao);
        true
    }

    /// The potato holder cannot move tokens: pass the potato first.
    fn guard(&mut self) {
        self.expire();
        require!(
            self.holder.as_ref() != Some(&env::predecessor_account_id()),
            "Hot potato! Pass it before moving SPUD"
        );
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.guard();
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.guard();
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount).0.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(
            self.holder.as_ref() != Some(&env::predecessor_account_id()),
            "Pass the potato before unregistering"
        );
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}
