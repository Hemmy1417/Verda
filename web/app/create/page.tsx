"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CONTRACT_ADDRESS, formatGen, formatSpan, formatStamp } from "../../lib/config";
import { formatCount } from "../../lib/derive";
import { agreementCountAbove } from "../../lib/predicates";
import { getAgreements, getAgreementsFor, getConfig, invalidateReads } from "../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../lib/tx";
import type { BasisEntry, ChainConfig, SourceClass, SourceKind } from "../../lib/types";
import { distinctPublishers, registrableDomain, validOrigin } from "../../lib/urls";
import { useNow } from "../../lib/useNow";
import { useWallet } from "../../lib/wallet";
import { StateNote } from "../components/bits";
import { TxFlow } from "../components/TxFlow";

const GEN = 10n ** 18n;

/** "0.05" → 5×10^16 atto; null for anything that is not a GEN amount. */
function parseGen(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * GEN + BigInt((f + "0".repeat(18)).slice(0, 18));
}

/** Epoch → the value a datetime-local input takes, in the browser's zone. */
function toLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The contract's bounds, mirrored so the form validates before get_config
 *  answers; the live config replaces them the moment it arrives. */
const FALLBACK: ChainConfig = {
  version: "0.1.0",
  min_reward_atto: "10000000000000000",
  max_reward_atto: "1000000000000000000000",
  threshold_bps: [5000, 10000],
  target: [1, 1_000_000_000],
  min_independent: [1, 3],
  terms_chars: [100, 12000],
  title_chars: [1, 120],
  region_chars: [1, 80],
  metric_chars: [1, 80],
  unit_chars: [1, 24],
  label_chars: [1, 80],
  url_chars: [12, 400],
  grounds_chars: [20, 600],
  basis_entries: [1, 6],
  sources: [1, 6],
  versions_max: 4,
  window_seconds: [900, 2_592_000],
  submission_grace_seconds: [900, 7_776_000],
  default_windows: { submission_grace: 1_209_600, finality: 86_400, challenge: 86_400 },
  stale_challenge_seconds: 3600,
  challenge_bond_bps: 500,
  challenge_bond_floor_atto: "50000000000000000",
  contradiction_tolerance_bps: 1500,
  excerpt_chars: 6000,
  source_kinds: [
    "SATELLITE_OBSERVATION", "INDEPENDENT_ASSESSMENT", "GOVERNMENT_REGISTRY",
    "FIELD_MEASUREMENT", "PROJECT_REPORT", "PHOTOGRAPHIC_RECORD", "OTHER",
  ],
  source_classes: ["INDEPENDENT", "OPERATOR"],
  basis_tags: ["FETCHED", "RECORDED", "NEW"],
  conflict_codes: [
    "FABRICATION_INDICATED", "PERIOD_MISMATCH", "SCOPE_MISMATCH",
    "FIGURE_CONTRADICTION", "SOURCE_MISLABELLED", "OTHER_CONFLICT",
  ],
  verdicts: ["QUALIFIED", "NOT_QUALIFIED", "INCONCLUSIVE"],
  hold_reasons: ["EVIDENCE_INSUFFICIENT", "UNCORROBORATED", "SOURCES_CONTRADICT"],
  evidence_flags: ["SUFFICIENT", "PARTIAL", "INSUFFICIENT"],
  statuses: ["DRAFT", "FUNDED", "PENDING_FINALITY", "FINAL", "SETTLED", "RECLAIMED", "CANCELLED"],
};

/** The deadline must sit at least one window past the contract's clock. */
const MIN_DEADLINE_AHEAD = 900;

type BasisDraft = { origin: string; kind: SourceKind; class: SourceClass };

const TERMS_TEMPLATE = `IMPACT AGREEMENT between the project operator and the funder.

OUTCOME: the operator will restore native vegetation across the named restoration block and have the achieved area measured by the deadline.

WHAT COUNTS: hectares inside the block boundary with established native cover as stated by an independent satellite observation or an independent field assessment for this block and this period. Planned, forecast or projected hectares do not count.

WHERE: the block as described here, and nowhere else. Figures for the wider region or for other blocks do not count.

PERIOD: work completed and observable by the deadline. A figure dated after the deadline does not count.

MONEY: verified over target of the reward to the operator; the remainder to the funder. Below the threshold share of the target the whole reward returns to the funder.`;

export default function Create() {
  const { address, client } = useWallet();
  const now = useNow();
  const [cfg, setCfg] = useState<ChainConfig>(FALLBACK);
  const [cfgState, setCfgState] = useState<"loading" | "ready" | "unreachable">("loading");

  const [title, setTitle] = useState("");
  const [region, setRegion] = useState("");
  const [metric, setMetric] = useState("");
  const [unit, setUnit] = useState("hectares");
  const [target, setTarget] = useState("");
  const [thresholdPct, setThresholdPct] = useState("90");
  const [minIndependent, setMinIndependent] = useState("1");
  const [rewardGen, setRewardGen] = useState("0.05");
  const [deadlineLocal, setDeadlineLocal] = useState(() => toLocalInput(Math.floor(Date.now() / 1000) + 7 * 86_400));
  const [windows, setWindows] = useState(FALLBACK.default_windows);
  const [terms, setTerms] = useState(TERMS_TEMPLATE);
  const [basis, setBasis] = useState<BasisDraft[]>([
    { origin: "", kind: "SATELLITE_OBSERVATION", class: "INDEPENDENT" },
  ]);
  const [review, setReview] = useState(false);
  const [tx, setTx] = useState<TxProgress | null>(null);
  const [createdId, setCreatedId] = useState("");

  useEffect(() => {
    getConfig()
      .then((c) => {
        setCfg(c);
        setWindows(c.default_windows);
        setCfgState("ready");
      })
      .catch(() => setCfgState("unreachable"));
  }, []);

  const thresholdBps = Math.round(Number(thresholdPct || "0") * 100);
  const targetNum = /^\d+$/.test(target.trim()) ? Number(target.trim()) : NaN;
  const minInd = Number(minIndependent);
  const rewardAtto = useMemo(() => parseGen(rewardGen), [rewardGen]);
  const deadlineEpoch = deadlineLocal ? Math.floor(new Date(deadlineLocal).getTime() / 1000) : NaN;
  const cleanBasis: BasisEntry[] = basis.map((b) => ({
    origin: b.origin.trim().toLowerCase(), kind: b.kind, class: b.class,
  }));
  const independentPublishers = distinctPublishers(
    cleanBasis.filter((b) => b.class === "INDEPENDENT").map((b) => b.origin),
  );

  const inRange = (n: number, [lo, hi]: [number, number]) => Number.isFinite(n) && n >= lo && n <= hi;
  const problems: string[] = [];
  if (!inRange(title.trim().length, cfg.title_chars)) problems.push(`title must be ${cfg.title_chars[0]}–${cfg.title_chars[1]} characters`);
  if (!inRange(region.trim().length, cfg.region_chars)) problems.push(`region must be ${cfg.region_chars[0]}–${cfg.region_chars[1]} characters`);
  if (!inRange(metric.trim().length, cfg.metric_chars)) problems.push(`metric must be ${cfg.metric_chars[0]}–${cfg.metric_chars[1]} characters`);
  if (!inRange(unit.trim().length, cfg.unit_chars)) problems.push(`unit must be ${cfg.unit_chars[0]}–${cfg.unit_chars[1]} characters`);
  if (!Number.isInteger(targetNum) || !inRange(targetNum, cfg.target)) problems.push(`target must be a whole number of units, ${cfg.target[0]}–${formatCount(cfg.target[1])}`);
  if (!inRange(thresholdBps, cfg.threshold_bps)) problems.push(`threshold must be ${cfg.threshold_bps[0] / 100}%–${cfg.threshold_bps[1] / 100}%`);
  if (!Number.isInteger(minInd) || !inRange(minInd, cfg.min_independent)) problems.push(`min_independent must be ${cfg.min_independent[0]}–${cfg.min_independent[1]}`);
  if (!rewardAtto || rewardAtto < BigInt(cfg.min_reward_atto) || rewardAtto > BigInt(cfg.max_reward_atto)) {
    problems.push(`the reward must be ${formatGen(cfg.min_reward_atto)}–${formatGen(cfg.max_reward_atto, 0)} GEN`);
  }
  if (!Number.isFinite(deadlineEpoch) || deadlineEpoch < now + MIN_DEADLINE_AHEAD) {
    problems.push("the deadline must be at least 15 minutes ahead — the contract refuses one closer than a window to its own clock, so a period can actually be entered");
  }
  if (!inRange(windows.submission_grace, cfg.submission_grace_seconds)) problems.push(`the submission grace must be ${cfg.submission_grace_seconds[0]}–${cfg.submission_grace_seconds[1]} seconds`);
  if (!inRange(windows.finality, cfg.window_seconds)) problems.push(`the finality window must be ${cfg.window_seconds[0]}–${cfg.window_seconds[1]} seconds`);
  if (!inRange(windows.challenge, cfg.window_seconds)) problems.push(`the challenge window must be ${cfg.window_seconds[0]}–${cfg.window_seconds[1]} seconds`);
  if (!inRange(terms.trim().length, cfg.terms_chars)) problems.push(`terms must be ${cfg.terms_chars[0]}–${formatCount(cfg.terms_chars[1])} characters (now ${terms.trim().length})`);
  if (!inRange(cleanBasis.length, cfg.basis_entries)) problems.push(`the basis names ${cfg.basis_entries[0]}–${cfg.basis_entries[1]} origins`);
  const seenOrigins = new Set<string>();
  cleanBasis.forEach((b, i) => {
    if (!validOrigin(b.origin)) problems.push(`basis entry ${i + 1}: origin must be a lowercase hostname with a dot (a-z, 0-9, dots, hyphens)`);
    else if (seenOrigins.has(b.origin)) problems.push(`basis entry ${i + 1}: ${b.origin} is listed twice`);
    seenOrigins.add(b.origin);
  });
  if (independentPublishers === 0) problems.push("the basis needs at least one INDEPENDENT origin — an outcome the operator alone attests cannot be paid");
  else if (Number.isInteger(minInd) && minInd > independentPublishers) {
    problems.push(`min_independent is ${minInd} but the basis has only ${independentPublishers} independent publisher${independentPublishers === 1 ? "" : "s"} — the agreement could never be satisfied`);
  }

  const ready = problems.length === 0 && !!address && !!client;
  const busy = inFlight(tx?.stage ?? "idle");
  const basisJson = JSON.stringify(cleanBasis);
  const args = [
    title.trim(), region.trim(), metric.trim(), unit.trim(),
    targetNum, thresholdBps, minInd, rewardAtto?.toString() ?? "0", deadlineEpoch,
    windows.submission_grace, windows.finality, windows.challenge,
    terms.trim(), basisJson,
  ];

  async function sign() {
    if (!ready) return;
    try {
      const before = (await getAgreements(0, 1, true)).total;
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "draft_agreement",
        args,
        predicate: agreementCountAbove(before),
        onProgress: setTx,
        confirmedDetail: "The agreement is drafted and waits for a funder, finalized.",
      });
      invalidateReads();
      // The actor index lists this wallet's agreements oldest first; ids are
      // zero-padded, so the lexicographic maximum is the newest.
      const mine = await getAgreementsFor(address, true);
      const newest = mine.map((a) => a.agreement_id).sort().at(-1) ?? "";
      setCreatedId(newest);
    } catch {
      /* the flow rendered the failure */
    }
  }

  const setBasisRow = (i: number, patch: Partial<BasisDraft>) =>
    setBasis((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <main className="page">
      <div>
        <p className="eyebrow">Draft an agreement</p>
        <h1 className="heading-lg" style={{ marginTop: 12 }}>One outcome, one deadline, one reward.</h1>
        <p className="muted" style={{ marginTop: 16, maxWidth: "62ch" }}>
          You are the operator. By signing you commit to one measurable outcome by the
          deadline and to proving it only through pages on the origins you list here; a
          funder&apos;s deposit freezes all of it under one hash. Money follows the lowest usable
          independent figure, never your own claim, and a figure below the threshold pays nothing.
        </p>
      </div>

      {cfgState === "loading" && (
        <StateNote kind="loading">Reading the contract&apos;s limits… the form validates against mirrored bounds meanwhile.</StateNote>
      )}
      {cfgState === "unreachable" && (
        <StateNote kind="unreachable">
          The contract&apos;s limits could not be read; this form validates against the bounds
          mirrored from the deployed source, and the write simulates before anything is sent.
        </StateNote>
      )}

      {createdId ? (
        <div className="stack">
          <p className="subheading">Drafted as <span className="mono">{createdId}</span>.</p>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            It holds nothing until a funder deposits exactly {rewardAtto ? formatGen(rewardAtto) : "the reward"} GEN.
            You may cancel it freely until then.
          </p>
          <Link className="pill" href={`/projects/${createdId}`}>Open the project</Link>
          <TxFlow p={tx} />
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label className="field">
              <span className="label">Title</span>
              <input value={title} maxLength={cfg.title_chars[1]} onChange={(e) => setTitle(e.target.value)} placeholder="Rio Verde restoration block RV-7" />
              <span className="hint">{title.trim().length}/{cfg.title_chars[1]}</span>
            </label>
            <label className="field">
              <span className="label">Region</span>
              <input value={region} maxLength={cfg.region_chars[1]} onChange={(e) => setRegion(e.target.value)} placeholder="Pará, Brazil" />
              <span className="hint">where the outcome is measured</span>
            </label>
            <label className="field">
              <span className="label">Metric</span>
              <input value={metric} maxLength={cfg.metric_chars[1]} onChange={(e) => setMetric(e.target.value)} placeholder="native vegetation restored" />
              <span className="hint">what is counted</span>
            </label>
            <label className="field">
              <span className="label">Unit</span>
              <input value={unit} maxLength={cfg.unit_chars[1]} onChange={(e) => setUnit(e.target.value)} placeholder="hectares" />
              <span className="hint">whole units only; the panel rounds down</span>
            </label>
            <label className="field">
              <span className="label">Target ({unit.trim() || "units"})</span>
              <input value={target} inputMode="numeric" onChange={(e) => setTarget(e.target.value)} placeholder="500" />
              <span className="hint">the outcome promised, {cfg.target[0]}–{formatCount(cfg.target[1])}</span>
            </label>
            <label className="field">
              <span className="label">Qualification threshold (%)</span>
              <input value={thresholdPct} inputMode="decimal" onChange={(e) => setThresholdPct(e.target.value)} />
              <span className="hint">
                {Number.isInteger(targetNum) && inRange(thresholdBps, cfg.threshold_bps)
                  ? `at least ${formatCount(Math.ceil((targetNum * thresholdBps) / 10_000))} ${unit.trim() || "units"} to qualify; below it the whole reward returns to the funder`
                  : `${cfg.threshold_bps[0] / 100}%–${cfg.threshold_bps[1] / 100}% of the target; below it the whole reward returns`}
              </span>
            </label>
            <label className="field">
              <span className="label">Independent publishers required</span>
              <select value={minIndependent} onChange={(e) => setMinIndependent(e.target.value)}>
                {[1, 2, 3].filter((n) => inRange(n, cfg.min_independent)).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="hint">
                how many independent publishers must state a usable figure before money moves;
                the basis has {independentPublishers}
              </span>
            </label>
            <label className="field">
              <span className="label">Maximum reward (GEN)</span>
              <input value={rewardGen} inputMode="decimal" onChange={(e) => setRewardGen(e.target.value)} />
              <span className="hint">
                the funder deposits exactly this; challenge bond {rewardAtto ? formatGen(rewardAtto * BigInt(cfg.challenge_bond_bps) / 10_000n > BigInt(cfg.challenge_bond_floor_atto) ? rewardAtto * BigInt(cfg.challenge_bond_bps) / 10_000n : BigInt(cfg.challenge_bond_floor_atto)) : "—"} GEN
              </span>
            </label>
            <label className="field">
              <span className="label">Deadline (your local time)</span>
              <input type="datetime-local" value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)} />
              <span className="hint">
                {Number.isFinite(deadlineEpoch)
                  ? `${formatStamp(deadlineEpoch)} — funding closes at it, adjudication opens after it`
                  : "at least 15 minutes ahead"}
              </span>
            </label>
            <div className="field">
              <span className="label">Windows (seconds)</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                {([
                  ["submission_grace", "grace after the deadline — then the funder may reclaim"],
                  ["finality", "finality — a verdict becomes state after it"],
                  ["challenge", "challenge — a party may challenge inside it"],
                ] as const).map(([k, hint]) => (
                  <label key={k} className="field">
                    <span className="hint">{k.replace(/_/g, " ")} · {formatSpan(windows[k])}</span>
                    <input
                      value={windows[k]}
                      inputMode="numeric"
                      onChange={(e) => setWindows((w) => ({ ...w, [k]: Number(e.target.value || 0) }))}
                    />
                    <span className="hint">{hint}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="field wide">
              <span className="label">Terms ({cfg.terms_chars[0]}–{formatCount(cfg.terms_chars[1])} characters)</span>
              <textarea rows={14} value={terms} onChange={(e) => setTerms(e.target.value)} spellCheck={false} />
              <span className="hint">
                frozen at drafting, signed by the funder&apos;s deposit; the panel reads what counts, where and
                when from this text alone · {formatCount(terms.trim().length)} characters
              </span>
            </label>

            <div className="field wide">
              <span className="label">Evidence basis — the only origins the panel may read</span>
              <p className="small muted" style={{ maxWidth: "62ch" }}>
                A hostname per row, lowercase. Pages on that host or under it inherit the kind
                and class you agree here; the class says whether both parties regard the origin as
                independent of you. At least one INDEPENDENT origin; up to {cfg.basis_entries[1]} rows.
              </p>
              <div className="stack" style={{ marginTop: 12 }}>
                {basis.map((b, i) => {
                  const origin = b.origin.trim().toLowerCase();
                  const dup = cleanBasis.findIndex((x) => x.origin === origin) !== i;
                  const problem = !origin
                    ? "an origin is needed"
                    : !validOrigin(origin)
                      ? "lowercase hostname with a dot: a-z, 0-9, dots and hyphens"
                      : dup
                        ? "listed twice"
                        : "";
                  return (
                    <div key={i} className="rowform">
                      <label className="field">
                        <span className="label">Origin {i + 1}</span>
                        <input
                          value={b.origin}
                          spellCheck={false}
                          placeholder="sat.example.org"
                          onChange={(e) => setBasisRow(i, { origin: e.target.value.toLowerCase() })}
                        />
                        <span className={problem ? "hint problem" : "hint ok"}>
                          {problem || `publisher ${registrableDomain(origin)}`}
                        </span>
                      </label>
                      <div className="field">
                        <span className="label">Agreed kind · class</span>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 8 }}>
                          <select value={b.kind} onChange={(e) => setBasisRow(i, { kind: e.target.value as SourceKind })}>
                            {cfg.source_kinds.map((k) => (
                              <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>
                            ))}
                          </select>
                          <select value={b.class} onChange={(e) => setBasisRow(i, { class: e.target.value as SourceClass })}>
                            {cfg.source_classes.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                        <span className="hint">
                          {b.class === "INDEPENDENT" ? "counts toward the verified figure" : "informs the panel; never raises the figure"}
                        </span>
                      </div>
                      <div className="field">
                        <span className="label">&nbsp;</span>
                        <button
                          className="linkish"
                          disabled={basis.length <= 1}
                          onClick={() => setBasis((rows) => rows.filter((_, j) => j !== i))}
                        >
                          remove
                        </button>
                      </div>
                    </div>
                  );
                })}
                {basis.length < cfg.basis_entries[1] && (
                  <button
                    className="linkish"
                    onClick={() => setBasis((rows) => [...rows, { origin: "", kind: "PROJECT_REPORT", class: "OPERATOR" }])}
                  >
                    add an origin ({basis.length} of {cfg.basis_entries[1]})
                  </button>
                )}
              </div>
            </div>
          </div>

          {problems.length > 0 && (
            <p className="problem">Before this can be signed: {problems.join("; ")}.</p>
          )}

          {!review ? (
            <div className="action-row">
              <button className="pill" disabled={problems.length > 0 || busy} onClick={() => setReview(true)}>
                Review before signing
              </button>
              <span className="price">no value is sent; the draft holds nothing until funded</span>
            </div>
          ) : (
            <div className="review">
              <p className="eyebrow">What your signature sends — exactly</p>
              <dl className="kv">
                <dt>Method</dt>
                <dd className="mono">draft_agreement(…14 arguments)</dd>
                <dt>Title</dt>
                <dd>{title.trim()}</dd>
                <dt>Region</dt>
                <dd>{region.trim()}</dd>
                <dt>Metric</dt>
                <dd>{metric.trim()}</dd>
                <dt>Unit</dt>
                <dd>{unit.trim()}</dd>
                <dt>Target</dt>
                <dd className="figure">{formatCount(targetNum)} {unit.trim()}</dd>
                <dt>Threshold</dt>
                <dd className="figure">{thresholdBps} bps ({thresholdBps / 100}%)</dd>
                <dt>Independent publishers</dt>
                <dd className="figure">{minInd}</dd>
                <dt>Maximum reward</dt>
                <dd className="figure">{rewardAtto?.toString()} atto = {rewardAtto ? formatGen(rewardAtto) : "—"} GEN</dd>
                <dt>Deadline</dt>
                <dd className="figure">{deadlineEpoch} = {formatStamp(deadlineEpoch)}</dd>
                <dt>Windows</dt>
                <dd className="figure">
                  grace {windows.submission_grace}s ({formatSpan(windows.submission_grace)}) · finality {windows.finality}s ({formatSpan(windows.finality)}) · challenge {windows.challenge}s ({formatSpan(windows.challenge)})
                </dd>
                <dt>Terms</dt>
                <dd>{formatCount(terms.trim().length)} characters, frozen; its sha256 enters the commitment hash</dd>
                <dt>Basis</dt>
                <dd className="mono small" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(cleanBasis, null, 2)}</dd>
                <dt>Value</dt>
                <dd>0 GEN — the fee deposit is separate and mostly refunded</dd>
              </dl>
              <div className="action-row">
                <button className="pill" disabled={!ready || busy} onClick={() => void sign()}>
                  {address ? "Sign the draft" : "Connect a wallet first"}
                </button>
                <button className="pill quiet" disabled={busy} onClick={() => setReview(false)}>Back to editing</button>
              </div>
            </div>
          )}
          <TxFlow p={tx} />
        </>
      )}
    </main>
  );
}
