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

export async function view(method, args = {}, account = CFG.contract) {
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
            account_id: account,
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

export async function call(
  selector,
  method,
  args = {},
  deposit = "0",
  receiverId = CFG.contract,
  gas = "100000000000000",
) {
  const wallet = await selector.wallet();
  // Wallet Selector v10 wallets expect near-api-js (NAJ) actions,
  // not the legacy { type, params } shape.
  return wallet.signAndSendTransaction({
    receiverId,
    actions: [
      actionCreators.functionCall(method, args, BigInt(gas), BigInt(deposit)),
    ],
  });
}

// ---- Sputnik DAO (v2) helpers ----
const dao = (method, args = {}) => view(method, args, CFG.dao);

export const daoPolicy = () => dao("get_policy");

export async function daoProposals(limit = 6) {
  const last = await dao("get_last_proposal_id");
  if (!last) return [];
  const from = Math.max(0, last - limit);
  const list = await dao("get_proposals", { from_index: from, limit });
  return list.sort((a, b) => b.id - a.id);
}

// Propose that the DAO sends `amount` SPUD (in yocto) from its treasury.
export function proposeSpend(
  selector,
  { description, receiver, amountYocto, bond },
) {
  return call(
    selector,
    "add_proposal",
    {
      proposal: {
        description,
        kind: {
          Transfer: {
            token_id: CFG.contract,
            receiver_id: receiver,
            amount: amountYocto,
          },
        },
      },
    },
    bond,
    CFG.dao,
    "100000000000000",
  );
}

// Propose adding `member` to a DAO role (default: the voting council).
// Anyone can submit this (the "all" role has *:AddProposal); the council
// must then approve it before the member is actually added.
export function proposeAddMember(
  selector,
  { description, member, role = "council", bond },
) {
  return call(
    selector,
    "add_proposal",
    {
      proposal: {
        description,
        kind: {
          AddMemberToRole: {
            member_id: member,
            role,
          },
        },
      },
    },
    bond,
    CFG.dao,
    "100000000000000",
  );
}

// action: "VoteApprove" | "VoteReject" | "VoteRemove"
export const voteProposal = (selector, id, action) =>
  call(
    selector,
    "act_proposal",
    { id, action },
    "0",
    CFG.dao,
    "200000000000000",
  );
