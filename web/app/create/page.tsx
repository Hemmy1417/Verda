"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CONTRACT_ADDRESS, formatBps, formatGen, formatSpan, formatStamp } from "../../lib/config";
import { formatCount, thresholdFloor } from "../../lib/derive";
import { bondFor, FALLBACK, MIN_DEADLINE_AHEAD, parseGen, toLocalInput, windowChoices } from "../../lib/limits";
import { agreementCountAbove } from "../../lib/predicates";
import { getAgreements, getAgreementsFor, getConfig, invalidateReads } from "../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../lib/tx";
import type { BasisEntry, ChainConfig, SourceClass, SourceKind } from "../../lib/types";
import { distinctPublishers, registrableDomain, validOrigin } from "../../lib/urls";
import { useNow } from "../../lib/useNow";
import { useWallet } from "../../lib/wallet";
import { classSentence, classWord, humanTitle, kindWord, ordinalOf } from "../../lib/words";
import { ClassChip, KindChip, StateNote, StepChips, Technical } from "../components/bits";
import { TxFlow } from "../components/TxFlow";

const STEPS = ["Outcome", "Money", "Evidence basis", "Terms", "Review"];

type BasisDraft = { origin: string; kind: SourceKind; class: SourceClass };

const TERMS_TEMPLATE = `IMPACT AGREEMENT between the project operator and the funder.

OUTCOME: the operator will restore native vegetation across the named restoration block and have the achieved area measured by the deadline.

WHAT COUNTS: hectares inside the block boundary with established native cover as stated by an independent satellite observation or an independent field assessment for this block and this period. Planned, forecast or projected hectares do not count.

WHERE: the block as described here, and nowhere else. Figures for the wider region or for other blocks do not count.

PERIOD: work completed and observable by the deadline. A figure dated after the deadline does not count.

MONEY: verified over target of the reward to the operator; the remainder to the funder. Below the threshold share of the target the whole reward returns to the funder.`;

const inRange = (n: number, [lo, hi]: [number, number]) => Number.isFinite(n) && n >= lo && n <= hi;

/**
 * Drafting an agreement, in five steps with step chips. Every field
 * validates live against the contract's bounds (mirrored, then live), and
 * the review step says in human terms exactly what the signature sends,
 * with the raw arguments behind a technical fold.
 */
export default function Create() {
  const { address, client } = useWallet();
  const now = useNow();
  const [cfg, setCfg] = useState<ChainConfig>(FALLBACK);
  const [cfgState, setCfgState] = useState<"loading" | "ready" | "unreachable">("loading");
  const [step, setStep] = useState(0);

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
  const unitWord = unit.trim() || "units";

  // Problems, per step. Each is the sentence the contract would say, said here first.
  const outcomeProblems: string[] = [];
  if (!inRange(title.trim().length, cfg.title_chars)) outcomeProblems.push(`the title needs ${cfg.title_chars[0]} to ${cfg.title_chars[1]} characters`);
  if (!inRange(region.trim().length, cfg.region_chars)) outcomeProblems.push(`the region needs ${cfg.region_chars[0]} to ${cfg.region_chars[1]} characters`);
  if (!inRange(metric.trim().length, cfg.metric_chars)) outcomeProblems.push(`the metric needs ${cfg.metric_chars[0]} to ${cfg.metric_chars[1]} characters`);
  if (!inRange(unit.trim().length, cfg.unit_chars)) outcomeProblems.push(`the unit needs ${cfg.unit_chars[0]} to ${cfg.unit_chars[1]} characters`);
  if (!Number.isInteger(targetNum) || !inRange(targetNum, cfg.target)) outcomeProblems.push(`the target must be a whole number of units, ${cfg.target[0]} to ${formatCount(cfg.target[1])}`);
  if (!inRange(thresholdBps, cfg.threshold_bps)) outcomeProblems.push(`the threshold must be ${cfg.threshold_bps[0] / 100}% to ${cfg.threshold_bps[1] / 100}%`);

  const moneyProblems: string[] = [];
  if (!rewardAtto || rewardAtto < BigInt(cfg.min_reward_atto) || rewardAtto > BigInt(cfg.max_reward_atto)) {
    moneyProblems.push(`the reward must be ${formatGen(cfg.min_reward_atto)} to ${formatGen(cfg.max_reward_atto, 0)} GEN`);
  }
  if (!Number.isInteger(minInd) || !inRange(minInd, cfg.min_independent)) moneyProblems.push(`the independent publishers required must be ${cfg.min_independent[0]} to ${cfg.min_independent[1]}`);
  if (!Number.isFinite(deadlineEpoch) || deadlineEpoch < now + MIN_DEADLINE_AHEAD) {
    moneyProblems.push("the deadline must be at least 15 minutes ahead; the contract refuses one closer than a window to its own clock");
  }
  if (!inRange(windows.submission_grace, cfg.submission_grace_seconds)) moneyProblems.push(`the submission grace must be ${formatSpan(cfg.submission_grace_seconds[0])} to ${formatSpan(cfg.submission_grace_seconds[1])}`);
  if (!inRange(windows.finality, cfg.window_seconds)) moneyProblems.push(`the finality window must be ${formatSpan(cfg.window_seconds[0])} to ${formatSpan(cfg.window_seconds[1])}`);
  if (!inRange(windows.challenge, cfg.window_seconds)) moneyProblems.push(`the challenge window must be ${formatSpan(cfg.window_seconds[0])} to ${formatSpan(cfg.window_seconds[1])}`);

  const basisProblems: string[] = [];
  if (!inRange(cleanBasis.length, cfg.basis_entries)) basisProblems.push(`the basis names ${cfg.basis_entries[0]} to ${cfg.basis_entries[1]} origins`);
  const seenOrigins = new Set<string>();
  cleanBasis.forEach((b, i) => {
    if (!validOrigin(b.origin)) basisProblems.push(`origin ${i + 1} must be a lowercase hostname with a dot (letters, digits, dots, hyphens)`);
    else if (seenOrigins.has(b.origin)) basisProblems.push(`origin ${i + 1}, ${b.origin}, is listed twice`);
    seenOrigins.add(b.origin);
  });
  if (independentPublishers === 0) basisProblems.push("the basis needs at least one independent origin; an outcome the operator alone attests cannot be paid");
  else if (Number.isInteger(minInd) && minInd > independentPublishers) {
    basisProblems.push(`${minInd} independent publishers are required but the basis has only ${independentPublishers}; the agreement could never be satisfied`);
  }

  const termsProblems: string[] = [];
  if (!inRange(terms.trim().length, cfg.terms_chars)) termsProblems.push(`the terms need ${cfg.terms_chars[0]} to ${formatCount(cfg.terms_chars[1])} characters (now ${formatCount(terms.trim().length)})`);

  const stepProblems = [outcomeProblems, moneyProblems, basisProblems, termsProblems, []];
  const problems = [...outcomeProblems, ...moneyProblems, ...basisProblems, ...termsProblems];

  const ready = problems.length === 0 && !!address && !!client;
  const busy = inFlight(tx?.stage ?? "idle");
  const basisJson = JSON.stringify(cleanBasis);
  const args = [
    title.trim(), region.trim(), metric.trim(), unit.trim(),
    targetNum, thresholdBps, minInd, rewardAtto?.toString() ?? "0", deadlineEpoch,
    windows.submission_grace, windows.finality, windows.challenge,
    terms.trim(), basisJson,
  ];
  const bond = rewardAtto ? bondFor(rewardAtto, cfg) : null;
  const floor = Number.isInteger(targetNum) && inRange(thresholdBps, cfg.threshold_bps)
    ? thresholdFloor(targetNum, thresholdBps)
    : null;

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

  const windowSelect = (key: "submission_grace" | "finality" | "challenge", label: string, hint: string, bounds: [number, number]) => (
    <label className="field" key={key}>
      <span className="label">{label}</span>
      <select value={windows[key]} onChange={(e) => setWindows((w) => ({ ...w, [key]: Number(e.target.value) }))}>
        {windowChoices(windows[key], bounds).map((s) => (
          <option key={s} value={s}>{formatSpan(s)}</option>
        ))}
      </select>
      <span className="hint">{hint}</span>
    </label>
  );

  if (createdId) {
    return (
      <main className="page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Draft an agreement</p>
            <h1 className="heading-lg">Drafted as agreement {ordinalOf(createdId)}.</h1>
          </div>
        </div>
        <section className="card record">
          <p>
            It holds nothing until a funder deposits exactly {rewardAtto ? formatGen(rewardAtto) : "the reward"} GEN.
            You may cancel it freely until then.
          </p>
          <div className="action-row">
            <Link className="pill" href={`/projects/${createdId}`}>Open the agreement</Link>
          </div>
          <TxFlow p={tx} />
          <Technical rows={[{ label: "Agreement id", value: createdId }]} />
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Draft an agreement</p>
          <h1 className="heading-lg">One outcome, one deadline, one reward.</h1>
          <p className="lede">
            You are the operator. By signing you commit to one measurable outcome by the deadline,
            proven only through pages on the origins you list here. Money follows the lowest usable
            independent figure, never your own claim, and a figure below the threshold pays nothing.
          </p>
        </div>
      </div>

      {cfgState === "loading" && (
        <StateNote kind="loading">Reading the contract&apos;s limits. The form validates against mirrored bounds meanwhile.</StateNote>
      )}
      {cfgState === "unreachable" && (
        <StateNote kind="unreachable">
          The contract&apos;s limits could not be read; this form validates against the bounds
          mirrored from the deployed source, and the write simulates before anything is sent.
        </StateNote>
      )}

      <StepChips steps={STEPS} current={step} onSelect={setStep} />

      <section className="card record form-card">
        {step === 0 && (
          <>
            <h2 className="heading-sm">Outcome</h2>
            <p>What is promised, where, and how it is counted.</p>
            <div className="form-grid">
              <label className="field">
                <span className="label">Title</span>
                <input value={title} maxLength={cfg.title_chars[1]} onChange={(e) => setTitle(e.target.value)} placeholder="Rio Verde restoration block RV-7" />
                <span className="hint">{title.trim().length} of {cfg.title_chars[1]} characters</span>
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
                <span className="label">Target ({unitWord})</span>
                <input value={target} inputMode="numeric" onChange={(e) => setTarget(e.target.value)} placeholder="500" />
                <span className="hint">the outcome promised, {cfg.target[0]} to {formatCount(cfg.target[1])}</span>
              </label>
              <label className="field">
                <span className="label">Qualification threshold (%)</span>
                <input value={thresholdPct} inputMode="decimal" onChange={(e) => setThresholdPct(e.target.value)} />
                <span className="hint">
                  {floor !== null
                    ? `at least ${formatCount(floor)} ${unitWord} to qualify; below it the whole reward returns to the funder`
                    : `${cfg.threshold_bps[0] / 100}% to ${cfg.threshold_bps[1] / 100}% of the target; below it the whole reward returns`}
                </span>
              </label>
            </div>
            {outcomeProblems.length === 0 && (
              <p className="small">You promise {humanTitle({ target: targetNum, unit: unit.trim(), metric: metric.trim(), region: region.trim() })}.</p>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="heading-sm">Money and time</h2>
            <p>The reward the funder deposits, how many publishers must speak, and the clock.</p>
            <div className="form-grid">
              <label className="field">
                <span className="label">Maximum reward (GEN)</span>
                <input value={rewardGen} inputMode="decimal" onChange={(e) => setRewardGen(e.target.value)} />
                <span className="hint">
                  the funder deposits exactly this{bond ? `; a challenge bond is ${formatGen(bond)} GEN` : ""}
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
                  the basis names {independentPublishers}
                </span>
              </label>
              <label className="field">
                <span className="label">Deadline (your local time)</span>
                <input type="datetime-local" value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)} />
                <span className="hint">
                  {Number.isFinite(deadlineEpoch)
                    ? `${formatStamp(deadlineEpoch)}; funding closes at it, adjudication opens after it`
                    : "at least 15 minutes ahead"}
                </span>
              </label>
              {windowSelect("submission_grace", "Submission grace", "after the deadline; then the funder may reclaim", cfg.submission_grace_seconds)}
              {windowSelect("finality", "Finality window", "a verdict becomes state after it", cfg.window_seconds)}
              {windowSelect("challenge", "Challenge window", "a party may challenge inside it; anyone settles after", cfg.window_seconds)}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="heading-sm">Evidence basis</h2>
            <p>
              The only origins the panel may read. A hostname per row, lowercase. Pages on that host
              or under it inherit the kind and class you agree here; the class says whether both
              parties regard the origin as independent of you. At least one independent origin; up
              to {cfg.basis_entries[1]} rows.
            </p>
            <div className="stack">
              {basis.map((b, i) => {
                const origin = b.origin.trim().toLowerCase();
                const dup = cleanBasis.findIndex((x) => x.origin === origin) !== i;
                const problem = !origin
                  ? "an origin is needed"
                  : !validOrigin(origin)
                    ? "a lowercase hostname with a dot: letters, digits, dots and hyphens"
                    : dup
                      ? "listed twice"
                      : "";
                return (
                  <div key={i} className="rowform basis-form">
                    <label className="field">
                      <span className="label">Origin {i + 1}</span>
                      <input
                        value={b.origin}
                        spellCheck={false}
                        placeholder="sat.example.org"
                        onChange={(e) => setBasisRow(i, { origin: e.target.value.toLowerCase() })}
                      />
                      <span className={problem ? "hint problem" : "hint"}>
                        {problem || `publisher ${registrableDomain(origin)}`}
                      </span>
                    </label>
                    <label className="field">
                      <span className="label">Agreed kind</span>
                      <select value={b.kind} onChange={(e) => setBasisRow(i, { kind: e.target.value as SourceKind })}>
                        {cfg.source_kinds.map((k) => (
                          <option key={k} value={k}>{kindWord(k)}</option>
                        ))}
                      </select>
                      <span className="hint">what pages on this origin are</span>
                    </label>
                    <label className="field">
                      <span className="label">Agreed class</span>
                      <select value={b.class} onChange={(e) => setBasisRow(i, { class: e.target.value as SourceClass })}>
                        {cfg.source_classes.map((c) => (
                          <option key={c} value={c}>{classWord(c)}</option>
                        ))}
                      </select>
                      <span className="hint">{classSentence(b.class)}</span>
                    </label>
                    {basis.length > 1 && (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => setBasis((rows) => rows.filter((_, j) => j !== i))}
                      >
                        Remove this origin
                      </button>
                    )}
                  </div>
                );
              })}
              {basis.length < cfg.basis_entries[1] && (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setBasis((rows) => [...rows, { origin: "", kind: "PROJECT_REPORT", class: "OPERATOR" }])}
                >
                  Add an origin ({basis.length} of {cfg.basis_entries[1]})
                </button>
              )}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="heading-sm">Terms</h2>
            <p>
              Frozen at drafting and signed by the funder&apos;s deposit. The panel reads what counts,
              where and when from this text alone.
            </p>
            <label className="field">
              <span className="label">Terms</span>
              <textarea rows={16} value={terms} onChange={(e) => setTerms(e.target.value)} spellCheck={false} />
              <span className="hint">
                {formatCount(terms.trim().length)} characters; {cfg.terms_chars[0]} to {formatCount(cfg.terms_chars[1])}
              </span>
            </label>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="heading-sm">Review</h2>
            {problems.length > 0 ? (
              <>
                <p>Before this can be signed:</p>
                <ul className="problem-list">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </>
            ) : (
              <div className="review">
                <p className="eyebrow">What you sign</p>
                <p>
                  You promise {humanTitle({ target: targetNum, unit: unit.trim(), metric: metric.trim(), region: region.trim() })},
                  by {formatStamp(deadlineEpoch)}. The agreement is titled {title.trim()}.
                </p>
                <p>
                  The funder deposits exactly {rewardAtto ? formatGen(rewardAtto) : ""} GEN. Settlement pays verified
                  over {formatCount(targetNum)} of it to you and returns the rest; below {formatBps(thresholdBps)} of
                  the target ({formatCount(floor ?? 0)} {unitWord}) the whole reward returns to the funder.
                  A challenge bond is {bond ? formatGen(bond) : ""} GEN.
                </p>
                <p>
                  {minInd} independent publisher{minInd === 1 ? "" : "s"} must state a figure. Evidence may be filed
                  until {formatStamp(deadlineEpoch + windows.submission_grace)} ({formatSpan(windows.submission_grace)} after
                  the deadline). A verdict becomes state after {formatSpan(windows.finality)}; a party may challenge for{" "}
                  {formatSpan(windows.challenge)} after that.
                </p>
                <ul className="basis-list">
                  {cleanBasis.map((b) => (
                    <li key={b.origin}>
                      <KindChip kind={b.kind} />
                      <ClassChip cls={b.class} />
                      <span className="small caption">{b.origin}</span>
                    </li>
                  ))}
                </ul>
                <p>
                  The terms, {formatCount(terms.trim().length)} characters, freeze under one hash with everything
                  above. No GEN is sent; the draft holds nothing until a funder deposits the reward.
                </p>
                <Technical
                  title="Exactly what is sent"
                  rows={[
                    { label: "Method", value: "draft_agreement" },
                    { label: "Deadline epoch", value: String(deadlineEpoch) },
                    { label: "Reward (atto)", value: rewardAtto?.toString() ?? "" },
                    { label: "Windows (seconds)", value: `${windows.submission_grace}, ${windows.finality}, ${windows.challenge}` },
                    { label: "Arguments", value: JSON.stringify(args), wide: true },
                  ]}
                />
              </div>
            )}
            <div className="action-row">
              <button className="pill" disabled={!ready || busy} onClick={() => void sign()}>
                {address ? "Sign the draft" : "Connect a wallet first"}
              </button>
              <span className="price">no GEN is sent; the draft holds nothing until funded</span>
            </div>
            <TxFlow p={tx} />
          </>
        )}

        {step < 4 && (
          <>
            {stepProblems[step].length > 0 && (
              <p className="problem">Before continuing: {stepProblems[step].join("; ")}.</p>
            )}
            <div className="action-row">
              {step > 0 && (
                <button className="pill quiet" onClick={() => setStep(step - 1)}>Back</button>
              )}
              <button className="pill" onClick={() => setStep(step + 1)}>
                {step === 3 ? "Review" : "Continue"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
