/**
 * THE LIVE ARC — three Impact Agreements driven end to end on GenLayer
 * Studio Next against the deployed Verda contract, by three wallets:
 *
 *   ACT I   rv-7  — QUALIFIED. Satellite page states 463 of 500 ha; the
 *                   operator's own report says 480 and cannot raise the
 *                   figure. The funder challenges with a bond and a NEW
 *                   independent assessment (460 ha): the second panel
 *                   re-reads the RECORDED bytes of round one, fetches only
 *                   the new page, lands QUALIFIED at 460 — a changed money
 *                   fact, so the challenger is made whole — and settlement
 *                   pays 460/500 of the reward to the operator, the rest
 *                   back to the funder.
 *   ACT II  rv-12 — the operator is not paid for a figure the independent
 *                   evidence does not support. The satellite states 410 of
 *                   500 ha, below the 90% bar; the operator claims 470 on a
 *                   forecast. Either honest verdict pays the operator nothing:
 *                   NOT_QUALIFIED refunds at settlement, INCONCLUSIVE holds on
 *                   the contradiction and the funder reclaims. v0.1.1 held.
 *   ACT III rv-7b — the S34 floor. Only the operator's report is readable;
 *                   the independent URL 404s. The hold is INCONCLUSIVE with
 *                   either honest reason: the panel may call a one-voice
 *                   record INSUFFICIENT (its prompt teaches exactly that)
 *                   before the code can count publishers and say
 *                   UNCORROBORATED. Both branches pay nobody; the agreement
 *                   returns to FUNDED, and after the grace anyone reclaims
 *                   the reward for the funder.
 *
 * Walls (writes the contract must refuse) are proven between the acts.
 * Every step is idempotent and the run is RESUMABLE: state is read from the
 * chain before every send, and flags in web/.data/arc.flags.json mark what
 * has already been proven.
 *
 * Run DETACHED (PowerShell Start-Process) — the arc waits out four 900s
 * windows per agreement and a foreground shell would time out first:
 *   $env:VERDA_CONTRACT="0x…"; $env:EVIDENCE_SHA="<40-hex>"; node web/scripts/arc.mjs
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONTRACT = process.env.VERDA_CONTRACT;
const SHA = process.env.EVIDENCE_SHA;
if (!/^0x[0-9a-fA-F]{40}$/.test(CONTRACT ?? "")) throw new Error("VERDA_CONTRACT must be the deployed address");
if (!/^[0-9a-f]{40}$/.test(SHA ?? "")) throw new Error("EVIDENCE_SHA must be the full commit sha the fixtures are pinned to");

const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };

const KEYS = JSON.parse(readFileSync(new URL("../.data/keys.json", import.meta.url), "utf-8"));

const REWARD = 5n * 10n ** 16n;     // 0.05 GEN per agreement
const BOND = 5n * 10n ** 16n;       // the floor dominates at this reward
const W = 900;                      // every window at the enforced minimum
const DEADLINE_IN = 1000;           // seconds after drafting
const MARGIN_S = 330;               // one clock tolerance past a boundary, plus slack
const FEE_FLOOR = 10n ** 15n;

const LOG = fileURLToPath(new URL("../arc.log", import.meta.url));
const OUT = fileURLToPath(new URL("../arc.transcript.json", import.meta.url));
const FLAGS = fileURLToPath(new URL("../.data/arc.flags.json", import.meta.url));

const transcript = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf-8"))
  : { contract: CONTRACT, evidence_sha: SHA, steps: [] };
const flags = existsSync(FLAGS) ? JSON.parse(readFileSync(FLAGS, "utf-8")) : {};

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  appendFileSync(LOG, msg + "\n");
}
function record(step) {
  transcript.steps.push({ at: new Date().toISOString(), ...step });
  writeFileSync(OUT, JSON.stringify(transcript, null, 2));
}
function flag(name, value = new Date().toISOString()) {
  flags[name] = value;
  writeFileSync(FLAGS, JSON.stringify(flags, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lane = Promise.resolve();
let lastAt = 0;
const GAP_MS = 4000;
function paced(job) {
  const run = lane.then(async () => {
    const wait = Math.max(0, lastAt + GAP_MS - Date.now());
    if (wait) await sleep(wait);
    lastAt = Date.now();
    return job();
  });
  lane = run.then(() => undefined, () => undefined);
  return run;
}

const TRANSIENT = /fetch failed|rate limit|429|-32029|timeout|ECONNRESET|socket|network|closed|terminated|other side|unknown rpc|execution slots|SSL/i;

function mk(name, pk) {
  const account = createAccount(pk);
  return { name, account, client: createClient({ chain, account }), address: account.address };
}
const OP = mk("operator", KEYS.CREATOR.pk);
const FU = mk("funder", KEYS.YES.pk);
const ST = mk("stranger", KEYS.NO.pk);
const reader = createClient({ chain });

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 verda-arc" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

async function view(fn, args = [], tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await paced(() => reader.readContract({ address: CONTRACT, functionName: fn, args }));
    } catch (err) {
      if (i >= tries - 1 || !TRANSIENT.test(String(err?.message ?? err))) throw err;
      await sleep(8_000 * (i + 1));
    }
  }
}
async function jview(fn, args = []) {
  const raw = await view(fn, args);
  return raw ? JSON.parse(raw) : null;
}
const agreement = (id) => jview("get_agreement", [id]);
const dossier = (id, v) => jview("get_dossier", [id, v]);
const claimable = async (addr) => BigInt(String(await view("get_claimable", [addr])));

// Studio Next needs a fee distribution on every transaction and a message
// allocation for every message the write emits (claim() emits a transfer).
// The SDK derives both by simulating the write; the deposit is floored
// because the Studio's own estimate can land at zero.
async function feesFor(actor, fn, args, value) {
  // The Studio's simulator occasionally answers "GenVM internal error";
  // retry it, and for a write that emits no message fall back to the plain
  // estimate rather than aborting the arc. claim() gets no fallback: its
  // outgoing transfer NEEDS the allocations only the simulation produces.
  let lastErr;
  for (let attempt = 0; attempt < (fn === "claim" ? 6 : 3); attempt++) {
    try {
      const est = await actor.client.estimateTransactionFeesForWrite({
        address: CONTRACT, functionName: fn, args, value,
      });
      const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
      return { distribution: est.distribution, feeValue, messageAllocations: est.messageAllocations };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.details ?? e?.message ?? e);
      // A contract refusal is deterministic — retrying cannot change it,
      // and the caller wants the [EXPECTED] sentence, not a retry loop.
      if (msg.includes("[EXPECTED]") || msg.includes("execution failed")) throw e;
      log(`  fee simulation unhealthy (${msg.slice(0, 80)}) — retry ${attempt + 1}`);
      await sleep(5_000 * (attempt + 1));
    }
  }
  if (fn === "claim") throw lastErr;
  log("  fee simulation exhausted — plain estimate (no message allocations needed here)");
  const est = await actor.client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  return { distribution: est.distribution, feeValue };
}

async function landed(hash, label) {
  for (let i = 0; i < 80; i++) {
    await sleep(10_000);
    let t = null;
    try { t = (await rpc("eth_getTransactionByHash", [hash])).result; } catch { continue; }
    const status = t?.status ?? t?.statusName ?? "";
    if (status === "FINALIZED") {
      // The consensus result decides whether the write's state landed; a
      // vetoed round finalizes MAJORITY_DISAGREE with nothing written.
      const resultName = t?.result_name ?? "";
      if (resultName === "MAJORITY_DISAGREE") {
        const err = new Error(`${label}: finalized MAJORITY_DISAGREE — vetoed, nothing written`);
        err.disagreed = true;
        throw err;
      }
      // The receipt array mixes the leader entry with validator entries;
      // only the LEADER entry's execution result decides.
      const receipts = t?.consensus_data?.leader_receipt ?? [];
      const arr = Array.isArray(receipts) ? receipts : [receipts];
      const leader = arr.find((r) => r?.mode !== "validator") ?? arr[0];
      const deciding = leader?.execution_result;
      if (deciding === "ERROR") {
        const err = new Error(`${label}: finalized REFUSED`);
        err.refused = true;
        err.stderr = String(leader?.genvm_result?.stderr ?? "").slice(-600);
        throw err;
      }
      log(`   ${label}: FINALIZED (${resultName || "?"}; leader ${deciding || "?"})`);
      return t;
    }
    if (status === "CANCELED" || status === "UNDETERMINED") {
      const err = new Error(`${label}: ${status}`);
      err.canceled = true;
      throw err;
    }
    if (i % 6 === 5) log(`   ${label}: still ${status || "pending"}…`);
  }
  throw new Error(`${label}: no finality after 13 min`);
}

async function write(actor, fn, args, value = 0n, already = null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (already && (await already())) {
      log(`>> ${actor.name} ${fn}: already reflected on-chain — skipping send`);
      return null;
    }
    log(`>> ${actor.name} ${fn}(${args.map((a) => JSON.stringify(a).slice(0, 60)).join(", ")})${value ? ` value ${Number(value / 10n ** 15n) / 1000} GEN` : ""}${attempt ? ` [retry ${attempt}]` : ""}`);
    let hash;
    try {
      const fees = await paced(() => feesFor(actor, fn, args, value));
      hash = await paced(() =>
        actor.client.writeContract({ address: CONTRACT, functionName: fn, args, value, fees }),
      );
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (!TRANSIENT.test(msg)) throw err;
      log(`   send failed transiently (${msg.slice(0, 100)}) — checking state before retrying`);
      await sleep(20_000);
      continue;
    }
    log(`   tx ${hash}`);
    try {
      await landed(hash, fn);
    } catch (err) {
      if (err?.disagreed || err?.canceled) {
        // An honest veto or a transport cancel: the crank is permissionless,
        // so the honest response is to turn it again.
        log(`   ${fn}: ${err.message} — retrying the round`);
        record({ kind: err.disagreed ? "veto" : "canceled", actor: actor.name, fn, hash });
        await sleep(20_000);
        continue;
      }
      if (err?.refused) log(`   stderr tail: ${err.stderr}`);
      throw err;
    }
    record({ kind: "write", actor: actor.name, fn, value: value.toString(), hash });
    return hash;
  }
  throw new Error(`${fn}: could not send after retries`);
}

async function wall(name, actor, fn, args, value = 0n) {
  if (flags[`wall:${name}`]) {
    log(`WALL ${name}: already proven earlier — skipping`);
    return;
  }
  log(`>> WALL ${actor.name} ${fn} — expecting refusal (${name})`);
  let hash;
  try {
    // The simulation that estimates fees ALSO runs the method, so a refused
    // write usually surfaces here, before anything is signed. Either way the
    // refusal is the contract's own message.
    const fees = await paced(() => feesFor(actor, fn, args, value));
    hash = await paced(() =>
      actor.client.writeContract({ address: CONTRACT, functionName: fn, args, value, fees }),
    );
  } catch (err) {
    const msg = String(err?.message ?? err).slice(0, 200);
    if (TRANSIENT.test(msg)) throw err;
    log(`   refused pre-flight: ${msg}`);
    record({ kind: "wall", name, refusedAt: "preflight", msg });
    flag(`wall:${name}`);
    return;
  }
  log(`   tx ${hash} (must finalize as ERROR)`);
  try {
    await landed(hash, fn);
  } catch (err) {
    if (err?.refused) {
      log(`   refused on-chain, finalized as ERROR — the wall held`);
      record({ kind: "wall", name, refusedAt: "finalized", hash, stderr: err.stderr });
      flag(`wall:${name}`);
      return;
    }
    throw err;
  }
  throw new Error(`WALL ${name}: was NOT refused`);
}

async function waitUntil(epoch, label) {
  for (;;) {
    const wait = epoch + MARGIN_S - Math.floor(Date.now() / 1000);
    if (wait <= 0) return;
    log(`waiting ${wait}s — ${label}`);
    await sleep(Math.min(wait, 300) * 1000);
  }
}

function expect(cond, what) {
  if (!cond) throw new Error(`EXPECTATION FAILED: ${what}`);
  log(`   ok: ${what}`);
}

// ── the fixtures: three CDN origins mirroring one commit of this repo ──────
const RAW = (p) => `https://raw.githubusercontent.com/Hemmy1417/Verda/${SHA}/evidence/${p}`;
const JSD = (p) => `https://cdn.jsdelivr.net/gh/Hemmy1417/Verda@${SHA}/evidence/${p}`;
const STAT = (p) => `https://rawcdn.githack.com/Hemmy1417/Verda/${SHA}/evidence/${p}`;

const BASIS = JSON.stringify([
  { kind: "SATELLITE_OBSERVATION", origin: "raw.githubusercontent.com", class: "INDEPENDENT" },
  { kind: "INDEPENDENT_ASSESSMENT", origin: "cdn.jsdelivr.net", class: "INDEPENDENT" },
  { kind: "PROJECT_REPORT", origin: "rawcdn.githack.com", class: "OPERATOR" },
]);

const TERMS_RV7 = `IMPACT AGREEMENT - Rio Verde restoration block RV-7, municipality of Paragominas, Para, Brazil. OUTCOME: hectares of degraded pasture inside polygon RV-7 restored to native forest cover. A hectare counts as restored when canopy cover exceeds 30 percent as read from satellite imagery of the polygon, or when an independent field assessor certifies survival of at least 1,100 live stems per hectare. Work outside polygon RV-7 does not count. Plans, forecasts and planted-but-unverified areas do not count. TARGET: 500 hectares by the deadline. REWARD: pro rata to verified hectares over the target, payable only if verified hectares reach 90 percent of the target; below that the whole reward returns to the funder.`;
const TERMS_RV12 = TERMS_RV7.replaceAll("RV-7", "RV-12");

const src = (url, label) => ({ url, label });

async function draftFundSubmit(key, title, terms, sources, claimed, extraWalls) {
  // ACT-scoped: draft → (walls) → fund → (walls) → submit. Idempotent on resume.
  let ag = flags[`${key}:aid`] ? await agreement(flags[`${key}:aid`]) : null;
  if (!ag) {
    const before = ((await jview("get_agreements_for", [OP.address])) ?? []).length;
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_IN;
    await write(OP, "draft_agreement",
      [title, "Para, Brazil", "hectares of degraded forest restored", "hectares", 500, 9000, 1,
        REWARD.toString(), deadline, W, W, W, terms, BASIS], 0n,
      async () => ((await jview("get_agreements_for", [OP.address])) ?? []).length > before);
    const mine = await jview("get_agreements_for", [OP.address]);
    ag = mine[mine.length - 1];
    flag(`${key}:aid`, ag.agreement_id);
  }
  const AID = ag.agreement_id;
  log(`${key}: ${AID} — ${ag.status} — deadline ${ag.deadline_epoch}`);

  if (ag.status === "DRAFT") {
    if (extraWalls?.beforeFund) await extraWalls.beforeFund(AID);
    await write(FU, "fund", [AID], REWARD, async () => (await agreement(AID)).status !== "DRAFT");
    ag = await agreement(AID);
    expect(ag.status === "FUNDED" && ag.funder.toLowerCase() === FU.address.toLowerCase(), `${AID} funded by the funder wallet`);
  }
  if (extraWalls?.afterFund) await extraWalls.afterFund(AID);

  if (ag.status === "FUNDED" && ag.evidence_version === 0) {
    await write(OP, "submit_evidence", [AID, claimed, JSON.stringify(sources)], 0n,
      async () => (await agreement(AID)).evidence_version >= 1);
    ag = await agreement(AID);
    expect(ag.evidence_version === 1 && ag.claimed_impact === claimed, `${AID} evidence v1 on record, claimed ${claimed}`);
  }
  return AID;
}

async function adjudicateAndPromote(AID, expectVerdict, expectVerified, label, atVersion = null) {
  let ag = await agreement(AID);
  /* The round being checked, not merely the latest. On a fresh run they are
     the same. On a RESUME after a challenge they are not: round one is v1 and
     the latest is v2, and checking round one's 463 against v2's re-adjudicated
     460 stopped a run whose chain state was already correct and complete. */
  const version = atVersion ?? ag.evidence_version;
  if (ag.status === "FUNDED" && ag.judged_version < version) {
    await waitUntil(ag.deadline_epoch, `${label}: the deadline (adjudication is judged after the period)`);
    await write(ST, "adjudicate", [AID], 0n, async () => {
      const a = await agreement(AID);
      return a.status !== "FUNDED" || a.judged_version >= version;
    });
    ag = await agreement(AID);
  }
  const d = await dossier(AID, version);
  expect(!!d, `${label}: dossier v${version} recorded`);
  log(`   panel: ${d.verdict} · verified ${d.verified_impact} · hold ${d.hold_reason || "-"} · evidence ${d.evidence_flag} · score ${d.score}`);
  log(`   reason: ${d.reason}`);
  for (const r of d.rows) log(`   ${r.id} ${r.cls} ${r.kind} ${r.basis} readable=${r.readable} figure=${r.figure} scope=${r.scope_ok} kind_ok=${r.kind_matches} digest=${String(r.digest).slice(0, 12)}`);
  /* An act may accept more than one honest verdict, and must say so by name.
     The list is the bar: anything outside it fails exactly as before. */
  const allowed = Array.isArray(expectVerdict) ? expectVerdict : [expectVerdict];
  expect(allowed.includes(d.verdict), `${label}: panel derived ${allowed.join(" or ")} (got ${d.verdict}${d.hold_reason ? " · " + d.hold_reason : ""})`);
  if (expectVerified !== null) expect(d.verified_impact === expectVerified, `${label}: verified ${expectVerified} (got ${d.verified_impact})`);
  record({ kind: "dossier", aid: AID, version, verdict: d.verdict, verified: d.verified_impact, hold: d.hold_reason, flag: d.evidence_flag, score: d.score, reason: d.reason, rows: d.rows.map((r) => ({ id: r.id, cls: r.cls, basis: r.basis, readable: r.readable, figure: r.figure, scope_ok: r.scope_ok, kind_matches: r.kind_matches, digest: r.digest })) });

  if (ag.status === "PENDING_FINALITY") {
    await waitUntil(ag.pending_until_epoch, `${label}: the finality window`);
    await write(ST, "promote", [AID], 0n, async () => (await agreement(AID)).status !== "PENDING_FINALITY");
    ag = await agreement(AID);
  }
  return ag;
}

async function main() {
  log(`VERDA ARC ${existsSync(FLAGS) ? "RESUME" : "START"} — contract ${CONTRACT} — fixtures @${SHA}`);
  log(`operator ${OP.address} · funder ${FU.address} · stranger ${ST.address}`);
  const stats0 = await jview("get_stats");
  log(`stats at start ${JSON.stringify(stats0)}`);

  // ════════════════════════════════ ACT I ════════════════════════════════
  log("═══ ACT I — rv-7: QUALIFIED, challenged, settled ═══");
  const A = await draftFundSubmit("a1", "Rio Verde restoration — block RV-7", TERMS_RV7,
    [src(RAW("rv-7/satellite-observation-2026q3.txt"), "Satellite observation summary, RV-7, 2026-Q3"),
     src(STAT("rv-7/operator-completion-report.txt"), "Project completion report, RV-7")],
    463,
    {
      beforeFund: async (AID) => {
        await wall("fund-wrong-amount", FU, "fund", [AID], REWARD - 1n);
        await wall("operator-funds-own-draft", OP, "fund", [AID], REWARD);
        await wall("submit-before-funding", OP, "submit_evidence", [AID, 463, JSON.stringify([src(RAW("rv-7/satellite-observation-2026q3.txt"), "x")])]);
      },
      afterFund: async (AID) => {
        await wall("second-funder", ST, "fund", [AID], REWARD);
        await wall("stranger-submits", ST, "submit_evidence", [AID, 463, JSON.stringify([src(RAW("rv-7/satellite-observation-2026q3.txt"), "x")])]);
        await wall("duplicate-url-normalized", OP, "submit_evidence", [AID, 463, JSON.stringify([
          src(RAW("rv-7/satellite-observation-2026q3.txt"), "one"),
          src(RAW("rv-7/satellite-observation-2026q3.txt").replace("https://raw.", "HTTPS://RAW.") + "#top", "the same page, spelled differently")])]);
        await wall("off-basis-origin", OP, "submit_evidence", [AID, 463, JSON.stringify([src("https://example.org/rv-7/report.txt", "outside the basis")])]);
        await wall("operator-only-package", OP, "submit_evidence", [AID, 463, JSON.stringify([src(STAT("rv-7/operator-completion-report.txt"), "only the operator")])]);
        await wall("adjudicate-before-deadline", ST, "adjudicate", [AID]);
      },
    });

  let a = await adjudicateAndPromote(A, "QUALIFIED", 463, "act I round 1", 1);
  if (a.status === "FINAL" && !a.challenge_open && a.judged_version === 1) {
    await wall("settle-inside-challenge-window", ST, "settle", [A]);
    await wall("challenge-wrong-bond", FU, "challenge", [A, "the satellite page counts canopy, the plots say fewer stems survived", JSD("rv-7/independent-assessment-final.txt"), "audit"], BOND - 1n);
    await wall("stranger-challenges", ST, "challenge", [A, "a stranger with a bond and an opinion has no standing here", "", ""], BOND);
    await wall("adjudicate-judged-version", ST, "adjudicate", [A]);
    await write(FU, "challenge",
      [A, "the satellite summary reads canopy cover; the independent field audit certified stem survival on fewer hectares and should be read alongside it",
        JSD("rv-7/independent-assessment-final.txt"), "Independent field assessment, RV-7, final"],
      BOND, async () => (await agreement(A)).challenge_open);
    a = await agreement(A);
    expect(a.challenge_open && a.evidence_version === 2, "act I: challenge open, evidence v2 appended (the challenger's one new source)");
  }
  if (a.challenge_open) {
    await wall("submit-during-challenge", OP, "submit_evidence", [A, 463, JSON.stringify([src(RAW("rv-7/satellite-observation-2026q3.txt"), "x")])]);
    const ledgerBefore = await claimable(FU.address);
    await write(ST, "re_adjudicate", [A], 0n, async () => !(await agreement(A)).challenge_open);
    const d2 = await dossier(A, 2);
    expect(d2.round_kind === "RE_ADJUDICATION" && d2.reconsidered_round === 1, "act I: round 2 is a re-adjudication of round 1");
    expect(d2.rows[0].basis === "RECORDED" && d2.rows[1].basis === "RECORDED" && d2.rows[2].basis === "NEW", "act I: rows 1-2 RECORDED (not refetched), row 3 NEW");
    const d1 = await dossier(A, 1);
    expect(d2.rows[0].excerpt === d1.rows[0].excerpt && d2.rows[0].fetch_epoch === d1.rows[0].fetch_epoch, "act I: the recorded satellite bytes and fetch epoch are exactly round one's");
    log(`   round 2: ${d2.verdict} · verified ${d2.verified_impact} · ${d2.reason}`);
    for (const r of d2.rows) log(`   ${r.id} ${r.cls} ${r.basis} readable=${r.readable} figure=${r.figure} scope=${r.scope_ok} kind_ok=${r.kind_matches}`);
    expect(d2.verdict === "QUALIFIED" && d2.verified_impact === 460, `act I: two independent publishers agree within tolerance, verified is the lower (460)`);
    const ledgerAfter = await claimable(FU.address);
    expect(ledgerAfter - ledgerBefore === BOND, "act I: the figure changed, so the challenger's bond came back to the funder's ledger");
    record({ kind: "dossier", aid: A, version: 2, verdict: d2.verdict, verified: d2.verified_impact, reason: d2.reason, rows: d2.rows.map((r) => ({ id: r.id, cls: r.cls, basis: r.basis, readable: r.readable, figure: r.figure, digest: r.digest })) });
    a = await agreement(A);
  }
  if (a.status === "PENDING_FINALITY") {
    await waitUntil(a.pending_until_epoch, "act I: finality of the re-adjudication");
    await write(ST, "promote", [A], 0n, async () => (await agreement(A)).status !== "PENDING_FINALITY");
    a = await agreement(A);
  }
  if (a.status === "FINAL") {
    expect(a.verdict === "QUALIFIED" && a.verified_impact === 460, "act I: FINAL at QUALIFIED · 460");
    await wall("reclaim-in-final", ST, "reclaim", [A]);
    await waitUntil(a.challenge_until_epoch, "act I: the challenge window");
    await write(ST, "settle", [A], 0n, async () => (await agreement(A)).status === "SETTLED");
    a = await agreement(A);
  }
  if (a.status === "SETTLED") {
    const payout = 460n * REWARD / 500n;
    expect(BigInt(a.payout_atto) === payout && BigInt(a.refund_atto) === REWARD - payout, `act I: settled — operator ${payout} atto, funder ${REWARD - payout} atto`);
    await wall("settle-twice", ST, "settle", [A]);
    await wall("challenge-after-settlement", FU, "challenge", [A, "the settled record cannot be reopened by a late objection", "", ""], BOND);
  }

  // ═══════════════════════════════ ACT II ════════════════════════════════
  /* ACT II proves ONE property: the operator is not paid for a figure the
     independent evidence does not support. The operator claims 470; the only
     independent source, a satellite observation, states 410 — below the 90%
     bar — and the operator's own report offers a forecast, not an achieved
     figure.

     Two honest verdicts deliver that property, and the panel has reached
     each on a live run:
       NOT_QUALIFIED — it counts the satellite's 410 against the bar and the
                       claim fails; the funder is refunded at settlement.
       INCONCLUSIVE  — it will not conclude over the operator-vs-satellite
                       contradiction, holds the record, and the funder
                       reclaims after the grace.
     The v0.1.1 run took the second route: FIGURE_CONTRADICTION, a majority
     of validators agreeing, no leader rotation. QUALIFIED is not on the list
     and fails exactly as before, and the money assertion below runs on
     EVERY route rather than only when settlement happened. */
  log("═══ ACT II — rv-12: the claim the independent evidence does not support ═══");
  const B = await draftFundSubmit("a2", "Rio Verde restoration — block RV-12", TERMS_RV12,
    [src(RAW("rv-12/satellite-observation-2026q3.txt"), "Satellite observation summary, RV-12, 2026-Q3"),
     src(STAT("rv-12/operator-completion-report.txt"), "Project completion report, RV-12")],
    470, null);
  let b = await adjudicateAndPromote(B, ["NOT_QUALIFIED", "INCONCLUSIVE"], null, "act II");
  if (b.status === "FINAL") {
    expect(b.verdict === "NOT_QUALIFIED", "act II: FINAL at NOT_QUALIFIED");
    expect(b.verified_impact === 410, `act II: the satellite's 410 is the verified figure (got ${b.verified_impact})`);
    await waitUntil(b.challenge_until_epoch, "act II: the challenge window");
    await write(ST, "settle", [B], 0n, async () => (await agreement(B)).status === "SETTLED");
    b = await agreement(B);
  } else if (b.status === "FUNDED") {
    expect(b.verdict === "INCONCLUSIVE", `act II: the hold returned the agreement to FUNDED (got ${b.verdict})`);
    log(`   act II hold reason live: ${b.hold_reason}`);
    await waitUntil(b.deadline_epoch + W, "act II: the submission grace");
    await write(ST, "reclaim", [B], 0n, async () => (await agreement(B)).status === "RECLAIMED");
    b = await agreement(B);
  }
  expect((b.status === "SETTLED" || b.status === "RECLAIMED")
      && b.payout_atto === "0" && BigInt(b.refund_atto) === REWARD,
    `act II: nothing to the operator, the whole reward to the funder (${b.status}, payout ${b.payout_atto}, refund ${b.refund_atto})`);

  // ═══════════════════════════════ ACT III ═══════════════════════════════
  log("═══ ACT III — rv-7b: the uncorroborated floor and the reclaim ═══");
  const C = await draftFundSubmit("a3", "Rio Verde restoration — block RV-7 (second operator filing)", TERMS_RV7,
    [src(RAW("rv-7/does-not-exist.txt"), "Satellite observation (link the operator could not produce)"),
     src(STAT("rv-7/operator-completion-report.txt"), "Project completion report, RV-7")],
    480, null);
  let c = await adjudicateAndPromote(C, "INCONCLUSIVE", 0, "act III");
  // Either hold reason is the floor holding: EVIDENCE_INSUFFICIENT when the
  // panel itself calls the one-voice record insufficient (the derivation's
  // first branch), UNCORROBORATED when the publisher count decides. The
  // direct suite pins each branch deterministically; live, the model speaks
  // first.
  expect(c.verdict === "INCONCLUSIVE"
      && (c.hold_reason === "UNCORROBORATED" || c.hold_reason === "EVIDENCE_INSUFFICIENT"),
    "act III: the floor held — INCONCLUSIVE with a corroboration-class hold reason");
  log(`   act III hold reason live: ${c.hold_reason}`);
  if (c.status === "FUNDED") {
    /* A REFUSAL CAN ONLY BE PROVEN WHILE ITS PRECONDITION HOLDS.
       This check exists to show a reclaim is refused INSIDE the submission
       grace. On the v0.1.1 run the laptop stalled for five hours between the
       deadline and this step, so it ran after the grace had closed — the
       contract, correctly, allowed the reclaim, and the check both reported
       "was NOT refused" and sent a real transaction. A refusal test attempted
       outside its window tests nothing. It now runs only while the window is
       open, and says so when it cannot. */
    const graceEnds = Number(c.deadline_epoch) + W;
    if (Math.floor(Date.now() / 1000) + MARGIN_S < graceEnds) {
      await wall("reclaim-before-grace", ST, "reclaim", [C]);
    } else {
      log("WALL reclaim-before-grace: NOT EXERCISED — the grace had already closed when this step ran, so a reclaim is legitimately allowed and there is no refusal to demonstrate; the refusal is pinned by the direct suite");
    }
    await waitUntil(graceEnds, "act III: the submission grace");
    await write(ST, "reclaim", [C], 0n, async () => (await agreement(C)).status === "RECLAIMED");
    c = await agreement(C);
  }
  expect(c.status === "RECLAIMED" && c.payout_atto === "0" && BigInt(c.refund_atto) === REWARD,
    `act III: reclaimed — nothing to the operator, the reward on the funder's ledger (${c.status}, payout ${c.payout_atto}, refund ${c.refund_atto})`);

  // ═══════════════════════════════ CLAIMS ════════════════════════════════
  log("═══ claims — the only external value path ═══");
  for (const actor of [OP, FU]) {
    const owed = await claimable(actor.address);
    if (owed > 0n) {
      log(`   ${actor.name} ledger ${owed} atto`);
      await write(actor, "claim", [], 0n, async () => (await claimable(actor.address)) === 0n);
      record({ kind: "claim", actor: actor.name, amount: owed.toString() });
    }
  }
  await wall("claim-nothing", ST, "claim", []);
  const stats = await jview("get_stats");
  log(`STATS ${JSON.stringify(stats)}`);
  expect(stats.escrow_atto === "0", "custody is zero: every atto left through claim()");
  record({ kind: "stats", stats });
  /* The closing line is COUNTED, not written. It used to say "three verdict
     classes" as a constant, true of the run this arc was designed for
     (QUALIFIED / NOT_QUALIFIED / INCONCLUSIVE) and false of the v0.1.1 run,
     where act II held INCONCLUSIVE on a figure contradiction. A summary that
     can be wrong about its own run is the last thing a reader sees. */
  const verdicts = [];
  for (const id of [A, B, C]) verdicts.push((await agreement(id)).verdict);
  const classes = [...new Set(verdicts)];
  log(`ARC COMPLETE — ${verdicts.length} agreements (${verdicts.join(", ")}), ${classes.length} verdict class${classes.length === 1 ? "" : "es"}, custody zero.`);
}

main().catch((err) => {
  log(`ARC FAILED: ${err?.message ?? err}`);
  record({ kind: "failure", message: String(err?.message ?? err) });
  process.exit(1);
});
