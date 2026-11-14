import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupSender } from "@near-wallet-selector/sender";
import { setupNightly } from "@near-wallet-selector/nightly";
import { setupLedger } from "@near-wallet-selector/ledger";
import { setupBitteWallet } from "@near-wallet-selector/bitte-wallet";
import { actionCreators } from "@near-js/transactions";
import { setupModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";

export const CFG = {
  contract: import.meta.env.VITE_CONTRACT,
  dao: import.meta.env.VITE_DAO,
  explorer: "https://testnet.nearblocks.io",
  rpcs: [
    "https://test.rpc.fastnear.com",
    "https://rpc.testnet.fastnear.com",
    "https://rpc.testnet.near.org",
  ],
};

export async function view(method, args = {}) {
  let last;
  for (const url of CFG.rpcs) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "query",
          params: {
            request_type: "call_function",
            finality: "optimistic",
            account_id: CFG.contract,
            method_name: method,
            args_base64: btoa(JSON.stringify(args)),
          },
        }),
      });
      const j = await r.json();
      if (j.error || j.result.error)
        throw new Error(JSON.stringify(j.error || j.result.error));
      return JSON.parse(
        new TextDecoder().decode(new Uint8Array(j.result.result)),
      );
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export const fmt = (y) => (BigInt(y) / 10n ** 18n).toLocaleString("en-US");

export async function initWallet() {
  const selector = await setupWalletSelector({
    network: "testnet",
    modules: [
      setupMeteorWallet(),
      setupMyNearWallet(),
      setupHereWallet(),
      setupSender(),
      setupNightly(),
      setupBitteWallet(),
      setupLedger(),
    ],
  });
  const modal = setupModal(selector, { contractId: CFG.contract });
  return { selector, modal };
}

export async function call(selector, method, args = {}, deposit = "0") {
  const wallet = await selector.wallet();
  // Wallet Selector v10 wallets expect near-api-js (NAJ) actions,
  // not the legacy { type, params } shape.
  return wallet.signAndSendTransaction({
    receiverId: CFG.contract,
    actions: [
      actionCreators.functionCall(
        method,
        args,
        BigInt("100000000000000"),
        BigInt(deposit),
      ),
    ],
  });
}
