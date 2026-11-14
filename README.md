# Hot Potato Coin (SPUD)

**One sentence:** one wallet holds the potato at a time; pass it before the timer runs out or 20% of your SPUD rots, and the rot funds a DAO treasury.

NEP-141 token on NEAR, React + Tailwind + Vite frontend with NEAR Wallet Selector (`tracks: memecoins, games, social`). No owner, no mint function, no admin keys. Supply is fixed at deploy: 90% faucet pool, 10% seeded to a Sputnik DAO.

## Mechanic
- `claim_starter` (0.00125 NEAR storage deposit): get 1,000 SPUD once per account.
- `grab_potato`: any account holding at least 100 SPUD can pick up a fallen potato.
- `pass_potato(to)`: holder passes to a registered account with at least 100 SPUD. Each pass shrinks the next timer by 5% (floor 60s). Cannot pass straight back.
- While holding the potato you cannot transfer SPUD.
- `settle()`: once the deadline passes, anyone can call it. 20% of the holder’s balance is taken: 50% burned, 40% to the DAO treasury, 10% bounty to the caller. The potato falls and a new round begins.
- NEAR contracts cannot run on timers, so expiry is applied lazily by the next call (`settle`, `pass_potato`, `grab_potato`, any transfer).

## Run it
```bash
rustup target add wasm32-unknown-unknown
./create-dao.sh hotpotato-dao imdavyking.testnet          # social treasury (needs ~6 NEAR)
near account create-account fund-myself hotpotato.you.testnet '10 NEAR' \
  autogenerate-new-keypair save-to-keychain \
  sign-as you.testnet network-config testnet sign-with-keychain send
./deploy.sh hotpotato.you.testnet hotpotato-dao.sputnikv2.testnet 600
cd web && npm install && npm run dev                 # open the URL Vite prints
```
Demo: claim with two wallets, grab, pass, wait 10 min (or use a shorter window at deploy), click Settle, then watch the burn and the DAO balance change.

After the demo, delete the contract account’s keys so the code is immutable.
