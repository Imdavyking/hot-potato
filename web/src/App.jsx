import { useEffect, useState, useCallback } from "react";
import {
  CFG,
  view,
  fmt,
  initWallet,
  call,
  daoPolicy,
  daoProposals,
  proposeSpend,
  voteProposal,
} from "./chain";

const short = (a) => (a.length > 24 ? a.slice(0, 10) + "…" + a.slice(-8) : a);
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return (
    String(Math.floor(s / 60)).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
};

const Card = ({ title, children, className = "" }) => (
  <section
    className={`rounded-2xl border border-line bg-panel p-6 ${className}`}
  >
    {title && (
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-400">
        {title}
      </h3>
    )}
    {children}
  </section>
);
const Stat = ({ label, value }) => (
  <div className="rounded-xl border border-line bg-[#0d0d14] p-3">
    <div className="text-[11px] uppercase tracking-wider text-zinc-400">
      {label}
    </div>
    <div className="text-xl font-bold">{value}</div>
  </div>
);
const Btn = ({ ghost, ...p }) => (
  <button
    {...p}
    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:-translate-y-px disabled:opacity-40 ${ghost ? "border border-line text-zinc-100 hover:bg-white/5" : "bg-gradient-to-br from-hot to-hot2 text-[#1a0d00] hover:brightness-110"}`}
  />
);

const statusColor = {
  InProgress: "text-hot2",
  Approved: "text-emerald-400",
  Rejected: "text-rose-400",
};
const kindText = (k) => {
  if (k?.Transfer)
    return `Send ${fmt(k.Transfer.amount)} SPUD to ${short(k.Transfer.receiver_id)}`;
  if (typeof k === "string") return k;
  return Object.keys(k || {})[0] || "Proposal";
};
const tally = (p) =>
  Object.values(p.vote_counts || {}).reduce(
    (t, v) => [t[0] + v[0], t[1] + v[1]],
    [0, 0],
  );

function DaoCard({ w, account, flash }) {
  const [list, setList] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await daoProposals(5));
      setPolicy(await daoPolicy());
    } catch {}
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const isCouncil =
    !!account &&
    !!policy?.roles?.some(
      (r) => Array.isArray(r.kind?.Group) && r.kind.Group.includes(account),
    );

  const run = async (fn, ok) => {
    if (!account) return w?.modal.show();
    setBusy(true);
    try {
      await fn();
      flash(ok);
      load();
    } catch (e) {
      flash((e.message || String(e)).slice(0, 140));
    } finally {
      setBusy(false);
    }
  };

  const propose = () => {
    if (!receiver.trim() || !/^\d+$/.test(amount) || amount === "0")
      return flash("Enter a receiver and a whole SPUD amount");
    run(
      () =>
        proposeSpend(w.selector, {
          description: why.trim() || "Community treasury spend",
          receiver: receiver.trim(),
          amountYocto: (BigInt(amount) * 10n ** 18n).toString(),
          bond: policy?.proposal_bond ?? "100000000000000000000000",
        }),
      "Proposal submitted",
    );
  };

  return (
    <Card title="DAO proposals" className="mt-4">
      <p className="mb-4 text-sm text-zinc-400">
        Spending from the treasury needs a council vote. Council:{" "}
        {isCouncil ? "you are a member" : "connect a council account to vote"}.
      </p>
      <div className="grid gap-2.5 md:grid-cols-[1fr_9rem_1.4fr_auto]">
        <input
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder="receiver.testnet"
          className="min-w-0 rounded-xl border border-line bg-[#0d0d14] px-3 py-2.5 outline-none focus:border-hot"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="SPUD amount"
          inputMode="numeric"
          className="min-w-0 rounded-xl border border-line bg-[#0d0d14] px-3 py-2.5 outline-none focus:border-hot"
        />
        <input
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Why? (e.g. weekly prize)"
          className="min-w-0 rounded-xl border border-line bg-[#0d0d14] px-3 py-2.5 outline-none focus:border-hot"
        />
        <Btn onClick={propose} disabled={busy}>
          Propose spend
        </Btn>
      </div>
      {policy && (
        <p className="mt-2 text-xs text-zinc-500">
          Proposal bond:{" "}
          {(
            Number(BigInt(policy.proposal_bond) / 10n ** 20n) / 10000
          ).toString()}{" "}
          NEAR (refunded when the proposal is resolved)
        </p>
      )}

      <ul className="mt-5 space-y-2.5">
        {list.length === 0 && (
          <li className="text-sm text-zinc-500">No proposals yet.</li>
        )}
        {list.map((p) => {
          const [yes, no] = tally(p);
          return (
            <li
              key={p.id}
              className="rounded-xl border border-line bg-[#0d0d14] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">
                    #{p.id} · {kindText(p.kind)}
                  </div>
                  <div className="break-words text-sm text-zinc-400">
                    {p.description}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div
                    className={`font-semibold ${statusColor[p.status] || "text-zinc-300"}`}
                  >
                    {p.status}
                  </div>
                  <div className="text-zinc-400">
                    👍 {yes} · 👎 {no}
                  </div>
                </div>
              </div>
              {p.status === "InProgress" && isCouncil && (
                <div className="mt-2.5 flex gap-2">
                  <Btn
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => voteProposal(w.selector, p.id, "VoteApprove"),
                        "Vote recorded",
                      )
                    }
                  >
                    Approve
                  </Btn>
                  <Btn
                    ghost
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => voteProposal(w.selector, p.id, "VoteReject"),
                        "Vote recorded",
                      )
                    }
                  >
                    Reject
                  </Btn>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function App() {
  const [w, setW] = useState(null);
  const [account, setAccount] = useState(null);
  const [S, setS] = useState(null);
  const [treasury, setTreasury] = useState("0");
  const [bal, setBal] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [to, setTo] = useState("");
  const [toast, setToast] = useState("");
  const [offline, setOffline] = useState(false);

  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  };

  useEffect(() => {
    initWallet().then((x) => {
      const pick = (s) => s.accounts.find((a) => a.active)?.accountId ?? null;
      setW(x);
      setAccount(pick(x.selector.store.getState()));
      x.selector.store.observable.subscribe((s) => setAccount(pick(s)));
    });
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const p = await view("potato");
      setS(p);
      setOffline(false);
      setTreasury(await view("ft_balance_of", { account_id: p.treasury }));
      if (account) setBal(await view("ft_balance_of", { account_id: account }));
    } catch {
      setOffline(true);
    }
  }, [account]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const send = async (method, args, deposit) => {
    if (!account) return w?.modal.show();
    try {
      await call(w.selector, method, args, deposit);
      flash("Confirmed on-chain");
      refresh();
    } catch (e) {
      flash((e.message || String(e)).slice(0, 140));
    }
  };
  const toggleWallet = async () => {
    if (!account) return w?.modal.show();
    const wallet = await w.selector.wallet();
    await wallet.signOut();
  };

  const left = S?.holder ? Number(BigInt(S.deadline_ns) / 1000000n) - now : 0;
  const win = S ? Number(BigInt(S.window_ns) / 1000000n) : 1;
  const phase = !S
    ? "load"
    : !S.holder
      ? "floor"
      : left <= 0
        ? "rotten"
        : "hot";
  const pct =
    phase === "hot" ? 100 - (left / win) * 100 : phase === "rotten" ? 100 : 0;
  const mine = account && S?.holder === account;

  return (
    <div className="mx-auto max-w-5xl p-5">
      <header className="flex items-center justify-between pb-6">
        <div className="flex items-center gap-2.5 text-lg font-bold">
          <span className="text-3xl">🥔</span> Hot Potato
          <span className="ml-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-normal text-zinc-400">
            SPUD · NEAR testnet
          </span>
        </div>
        <Btn onClick={toggleWallet}>
          {account ? `${short(account)} · Sign out` : "Connect wallet"}
        </Btn>
      </header>

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <Card title={`Round ${S?.round ?? "–"}`} className="text-center">
          <div
            className={`bob inline-block text-8xl leading-none ${phase === "rotten" || phase === "floor" ? "grayscale brightness-50 [animation:none]" : "drop-shadow-[0_0_24px_#ff7a1a]"}`}
          >
            🥔
          </div>
          <div className="mt-3 font-mono text-5xl font-bold tabular-nums">
            {phase === "hot"
              ? clock(left)
              : phase === "rotten"
                ? "ROTTEN"
                : "--:--"}
          </div>
          <div className="my-3 h-1.5 overflow-hidden rounded bg-line">
            <div
              className="h-full rounded bg-gradient-to-r from-hot to-rose-500 transition-all"
              style={{ width: pct + "%" }}
            />
          </div>
          <p className="break-all text-zinc-400">
            {offline ? (
              `Cannot reach ${CFG.contract}. Is it deployed?`
            ) : phase === "floor" ? (
              <>
                The potato is on the floor.{" "}
                <b className="text-zinc-100">Grab it.</b>
              </>
            ) : phase === "rotten" ? (
              <>
                <b className="text-zinc-100">{S.holder}</b> let it rot. Settle
                to claim the bounty.
              </>
            ) : phase === "hot" ? (
              <>
                Held by <b className="text-zinc-100">{S.holder}</b>
                {mine && " (you)"}
              </>
            ) : (
              "Loading chain state…"
            )}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <Btn
              ghost
              onClick={() =>
                send("claim_starter", {}, "1250000000000000000000")
              }
            >
              Claim 1,000 SPUD
            </Btn>
            <Btn onClick={() => send("grab_potato")} disabled={phase === "hot"}>
              Grab potato
            </Btn>
            <Btn
              ghost
              onClick={() => send("settle")}
              disabled={phase !== "rotten"}
            >
              Settle rotten potato
            </Btn>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="friend.testnet"
              className="min-w-0 flex-1 rounded-xl border border-line bg-[#0d0d14] px-3 py-2.5 outline-none focus:border-hot"
            />
            <Btn
              onClick={() =>
                to.trim()
                  ? send("pass_potato", { to: to.trim() })
                  : flash("Enter an account to pass to")
              }
              disabled={!mine || phase !== "hot"}
            >
              Pass it
            </Btn>
          </div>
          {bal !== null && (
            <p className="mt-4 text-zinc-400">
              Your balance: <b className="text-zinc-100">{fmt(bal)} SPUD</b>
            </p>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Community treasury">
            <div className="text-3xl font-bold text-hot2">
              {fmt(treasury)} SPUD
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              Held by{" "}
              <a
                className="text-hot2 underline"
                target="_blank"
                rel="noreferrer"
                href={`${CFG.explorer}/address/${CFG.dao}`}
              >
                {CFG.dao}
              </a>
              , a Sputnik DAO. Spending needs a council vote.
            </p>
          </Card>
          <Card title="Rotten so far">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Burned" value={S ? fmt(S.total_burned) : "–"} />
              <Stat
                label="To treasury"
                value={S ? fmt(S.total_to_treasury) : "–"}
              />
              <Stat label="Passes" value={S?.passes ?? "–"} />
              <Stat label="Rotted" value={S?.rotted ?? "–"} />
            </div>
          </Card>
        </div>
      </div>

      <DaoCard w={w} account={account} flash={flash} />

      <Card title="How it works" className="mt-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-zinc-400">
          <li>
            <b className="text-zinc-100">Claim</b> a starter pack, then{" "}
            <b className="text-zinc-100">grab</b> a fallen potato (100 SPUD
            minimum).
          </li>
          <li>
            <b className="text-zinc-100">Pass</b> it to another holder before
            the clock hits zero. Every pass shrinks the next timer by 5%.
          </li>
          <li>
            Miss the deadline and <b className="text-zinc-100">20%</b> of your
            SPUD rots: 50% burned, 40% to the DAO treasury, 10% to whoever
            settles.
          </li>
          <li>
            You can’t move SPUD while holding the potato. No owner, no mint
            function, fixed supply.
          </li>
        </ol>
      </Card>
      <footer className="py-6 text-center text-xs text-zinc-500">
        NEAR contracts can’t run timers, so rot is applied by the next call.
        That’s why anyone can click Settle and earn the bounty.
      </footer>

      {toast && (
        <div className="fixed bottom-6 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-xl border border-line bg-[#1d1d29] px-4 py-2.5 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
