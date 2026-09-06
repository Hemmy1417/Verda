"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRACT_ADDRESS, formatGen, formatRelative, formatSpan, formatStamp } from "../../../lib/config";
import {
  actionMethod, actionVerb, corroborationSentence, deadlineSentence, formatCount, fundingMath,
  holdSentence, nextAction, progressBps, thresholdSentence, verdictSentence,
  type ActionKind, type NextAction,
} from "../../../lib/derive";
import {
  adjudicationRecorded, agreementStatusIs, cancelled, challengeClosed, challengeOpen,
  claimDrained, evidenceVersionAbove, isFunder, isOperator, promoted, reclaimed, settled,
} from "../../../lib/predicates";
import { getAgreement, getClaimable, getDossier, getPackage, invalidateReads } from "../../../lib/read";
import { timeline } from "../../../lib/timeline";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import type { Agreement, BasisEntry, Dossier, Package } from "../../../lib/types";
import { distinctPublishers, hostOf, matchBasis, normalizeUrl, registrableDomain, validUrl } from "../../../lib/urls";
import { useNow } from "../../../lib/useNow";
import { useWallet } from "../../../lib/wallet";
import {
  basisWord, classWord, conflictWord, evidenceSentence, evidenceWord, figureWord, filedByWord,
  humanTitle, kindWord, labelWord, ordinalOf, outcomeTitle, partyWord, readWord, roundWord,
  scopeWord, splitLabel, verdictWord,
} from "../../../lib/words";
import {
  ClassChip, Figure, Gen, KindChip, ProgressBar, Seal, StateNote, StatusChip, Technical,
  VerdictStamp,
} from "../../components/bits";
import { Timeline } from "../../components/Timeline";
import { TxFlow } from "../../components/TxFlow";

const MAX_SOURCES = 6;
const MAX_LABEL_CHARS = 80;
const MAX_FIGURE = 10 ** 12;
const GROUNDS_CHARS: [number, number] = [20, 600];

type RunFn = (
  functionName: string,
  args: unknown[],
  valueAtto: bigint,
  predicate: () => Promise<boolean>,
  confirmedDetail: string,
) => Promise<void>;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── the record ──────────────────────────────────────────────────────────────

function AgreementCard({ ag }: { ag: Agreement }) {
  return (
    <section className="card record">
      <h2 className="eyebrow">Agreement</h2>
      <dl className="kv">
        <dt>Outcome</dt>
        <dd>{outcomeTitle(ag)}. Measured as {ag.metric}, in {ag.region}.</dd>
        <dt>Threshold</dt>
        <dd>{cap(thresholdSentence(ag))}. Below it the whole reward returns to the funder.</dd>
        <dt>Corroboration</dt>
        <dd>{corroborationSentence(ag)}. Two pages on one publisher are one voice.</dd>
        <dt>Reward</dt>
        <dd><Gen atto={ag.max_reward_atto} /> at most; challenge bond <Gen atto={ag.challenge_bond_atto} />.</dd>
        <dt>Deadline</dt>
        <dd>{deadlineSentence(ag)}</dd>
        <dt>Windows</dt>
        <dd>
          Submission grace {formatSpan(ag.submission_grace)} after the deadline, then the funder may reclaim.
          Finality {formatSpan(ag.finality_window)}: a verdict becomes state after it.
          Challenge {formatSpan(ag.challenge_window)}: a party may challenge inside it, and anyone settles after.
        </dd>
        <dt>Verdict</dt>
        <dd>{verdictSentence(ag)}</dd>
      </dl>

      <div>
        <p className="small">
          Evidence basis: the only origins the panel may read. Kinds and classes are labels both
          wallets signed; the panel is told so and judges each page as what it shows itself to be.
        </p>
        <ul className="basis-list">
          {ag.basis.map((b) => (
            <li key={b.origin}>
              <KindChip kind={b.kind} />
              <ClassChip cls={b.class} />
              <span className="small caption">{b.origin}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="technical terms">
        <summary>Read the terms</summary>
        <pre>{ag.terms_text}</pre>
      </details>
      <Technical
        rows={[
          { label: "Agreement id", value: ag.agreement_id },
          { label: "Terms hash", value: ag.terms_sha256 },
          { label: "Operator", value: ag.operator },
          { label: "Funder", value: ag.funder },
          { label: "Evidence root", value: ag.evidence_root },
          { label: "Drafted epoch", value: String(ag.created_epoch) },
          { label: "Funded epoch", value: ag.funded_epoch ? String(ag.funded_epoch) : "" },
        ]}
      />
    </section>
  );
}

function EvidenceVersion({ pkg, unit }: { pkg: Package; unit: string }) {
  const byChallenger = pkg.added_by.startsWith("challenger");
  return (
    <div className="version">
      <h3 className="subheading">Version {pkg.version}</h3>
      <p>
        Filed by {filedByWord(pkg.added_by)}, claiming {formatCount(pkg.claimed_impact)} {unit}.
        {byChallenger ? " The judged rows, plus the one source the challenger added." : ""}
      </p>
      <div className="tablewrap">
        <table className="rows">
          <thead>
            <tr>
              <th>Source</th>
              <th>Kind</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            {pkg.rows.map((r) => {
              const label = splitLabel(r.label);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="title">
                      {label.text}
                      {label.challenger && <span className="chip inline-chip">added by the challenger</span>}
                    </div>
                    <div className="small caption">{r.domain}</div>
                  </td>
                  <td><KindChip kind={r.kind} /></td>
                  <td><ClassChip cls={r.cls} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Technical
        rows={[
          ...pkg.rows.map((r) => ({ label: `${r.id} url`, value: r.url, href: r.url, wide: true })),
          { label: "Package root", value: pkg.root },
        ]}
      />
    </div>
  );
}

function Round({ d, ag, pending }: { d: Dossier; ag: Agreement; pending: boolean }) {
  const hold = d.verdict === "INCONCLUSIVE";
  return (
    <div className="round">
      <div className="round-head">
        <VerdictStamp verdict={d.verdict} />
        <div className="round-figure">
          {hold ? <span className="big-word">on hold</span> : <Figure value={d.verified_impact} unit={ag.unit} big />}
          <span className="small">verified</span>
        </div>
      </div>
      <p>
        {roundWord(d.round_kind, d.evidence_version, d.reconsidered_round)}, observed {formatStamp(d.observed_epoch)}.
        {pending && ` Pending finality until ${formatStamp(ag.pending_until_epoch)}.`}
      </p>
      <dl className="kv">
        <dt>Outcome</dt>
        <dd>
          {hold
            ? `On hold: ${holdSentence(d.hold_reason)}.`
            : `${verdictWord(d.verdict)}: ${formatCount(d.verified_impact)} ${ag.unit} verified, the lowest usable independent figure, against a claim of ${formatCount(d.claimed_impact)} ${ag.unit}.`}
        </dd>
        <dt>Evidence</dt>
        <dd>{cap(evidenceWord(d.evidence_flag))}: {evidenceSentence(d.evidence_flag)}.</dd>
        <dt>Score</dt>
        <dd>score {d.score} of 100</dd>
        {d.conflicts.length > 0 && (
          <>
            <dt>Conflicts</dt>
            <dd>{cap(d.conflicts.map(conflictWord).join("; "))}.</dd>
          </>
        )}
        <dt>Claimed</dt>
        <dd>{formatCount(d.claimed_impact)} {ag.unit}</dd>
      </dl>
      <blockquote className="reason">{d.reason}</blockquote>
      <div className="tablewrap">
        <table className="rows readings">
          <thead>
            <tr>
              <th>Source</th>
              <th>Class</th>
              <th>Bytes</th>
              <th>Read</th>
              <th className="num">Figure</th>
              <th>Scope</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => {
              const label = splitLabel(r.label);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="title">{label.text}</div>
                    <div className="small caption">{r.domain}</div>
                  </td>
                  <td><ClassChip cls={r.cls} /></td>
                  <td>{basisWord(r.basis, r.basis_round)}</td>
                  <td>{readWord(r.readable)}</td>
                  <td className="num">
                    {r.figure === null || r.figure === undefined
                      ? <span className="sans">{figureWord(r.figure, ag.unit)}</span>
                      : figureWord(r.figure, ag.unit)}
                  </td>
                  <td>{scopeWord(r.readable, r.scope_ok)}</td>
                  <td>{labelWord(r.readable, r.kind_matches)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Technical
        rows={[
          { label: "Dossier id", value: d.dossier_id },
          { label: "Evidence root", value: d.evidence_root },
          { label: "Round epoch", value: String(d.observed_epoch) },
          ...d.rows.map((r) => ({ label: `${r.id} digest`, value: r.digest })),
        ]}
      />
    </div>
  );
}

// ── forms ───────────────────────────────────────────────────────────────────

type SourceDraft = { url: string; label: string };

/** Everything the contract would say about one row, said here first. */
function rowProblem(
  row: SourceDraft,
  index: number,
  basis: BasisEntry[],
  seen: Set<string>,
): { problem: string; entry: BasisEntry | null } {
  const url = row.url.trim();
  const label = row.label.trim();
  if (!url) return { problem: "a url is needed", entry: null };
  if (!validUrl(url)) {
    return { problem: "the url must be http or https, plain ASCII without quotes or vertical bars, 12 to 400 characters", entry: null };
  }
  const entry = matchBasis(url, basis);
  if (!entry) {
    return { problem: `${hostOf(url)} is outside the agreed basis; the panel reads only the origins both parties signed`, entry: null };
  }
  const norm = normalizeUrl(url);
  if (seen.has(norm)) {
    return { problem: "this page is already in the package; one page is one source, however it is spelled", entry };
  }
  seen.add(norm);
  if (label.length < 1 || label.length > MAX_LABEL_CHARS) {
    return { problem: `source ${index + 1} needs a label of 1 to ${MAX_LABEL_CHARS} characters`, entry };
  }
  return { problem: "", entry };
}

function SourceRows({
  rows, basis, seenBefore, onChange, max,
}: {
  rows: SourceDraft[];
  basis: BasisEntry[];
  /** Normalized urls already in the record this package joins. */
  seenBefore: string[];
  onChange: (rows: SourceDraft[]) => void;
  max: number;
}) {
  const seen = new Set(seenBefore);
  return (
    <div className="stack">
      {rows.map((r, i) => {
        const { problem, entry } = rowProblem(r, i, basis, seen);
        return (
          <div key={i} className="rowform">
            <label className="field">
              <span className="label">Page {i + 1}</span>
              <input
                value={r.url}
                spellCheck={false}
                placeholder="https://"
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              />
              <span className={problem ? "hint problem" : "hint"}>
                {problem
                  ? problem
                  : entry
                    ? `${kindWord(entry.kind)}, ${classWord(entry.class)}, published by ${registrableDomain(hostOf(r.url.trim()))}`
                    : ""}
              </span>
            </label>
            <label className="field">
              <span className="label">What this page is</span>
              <input
                value={r.label}
                maxLength={MAX_LABEL_CHARS}
                placeholder="Satellite pass, September"
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <span className="hint">{r.label.trim().length} of {MAX_LABEL_CHARS} characters</span>
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                className="linkish"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                Remove this page
              </button>
            )}
          </div>
        );
      })}
      {rows.length < max && (
        <button type="button" className="linkish" onClick={() => onChange([...rows, { url: "", label: "" }])}>
          Add a page ({rows.length} of {max})
        </button>
      )}
    </div>
  );
}

function SubmitForm({
  ag, busy, run,
}: {
  ag: Agreement;
  busy: boolean;
  run: RunFn;
}) {
  const [rows, setRows] = useState<SourceDraft[]>([{ url: "", label: "" }]);
  const [claimed, setClaimed] = useState("");
  const [review, setReview] = useState(false);
  const version = ag.evidence_version + 1;

  const problems: string[] = [];
  const seen = new Set<string>();
  const matched: Array<{ entry: BasisEntry; host: string }> = [];
  rows.forEach((r, i) => {
    const { problem, entry } = rowProblem(r, i, ag.basis, seen);
    if (problem) problems.push(`page ${i + 1}: ${problem}`);
    else if (entry) matched.push({ entry, host: hostOf(r.url.trim()) });
  });
  if (rows.length < 1 || rows.length > MAX_SOURCES) problems.push(`name 1 to ${MAX_SOURCES} pages`);
  if (problems.length === 0 && !matched.some((m) => m.entry.class === "INDEPENDENT")) {
    problems.push("the package needs at least one page from an independent origin; the operator's own record cannot carry a payout");
  }
  const claimedNum = /^\d+$/.test(claimed.trim()) ? Number(claimed.trim()) : NaN;
  if (!Number.isInteger(claimedNum) || claimedNum < 0 || claimedNum > MAX_FIGURE) {
    problems.push(`the claimed figure must be a whole number of ${ag.unit}, 0 to ${formatCount(MAX_FIGURE)}`);
  }
  const publishers = distinctPublishers(matched.filter((m) => m.entry.class === "INDEPENDENT").map((m) => m.host));
  const ready = problems.length === 0;
  const sources = rows.map((r) => ({ url: r.url.trim(), label: r.label.trim() }));
  const sourcesJson = JSON.stringify(sources);

  return (
    <div className="action">
      <p>
        A package is whole: 1 to {MAX_SOURCES} pages inside the agreed basis, each inheriting its
        kind and class from the origin it matches, plus your claimed figure. The claim is a ceiling
        on what can be verified, never a floor. This will be version {version}; earlier versions
        stay on the record.
      </p>
      <SourceRows rows={rows} basis={ag.basis} seenBefore={[]} onChange={setRows} max={MAX_SOURCES} />
      <div className="field">
        <span className="label">Claimed figure ({ag.unit})</span>
        <input value={claimed} inputMode="numeric" onChange={(e) => setClaimed(e.target.value)} />
        <span className="hint">
          the target is {formatCount(ag.target)} {ag.unit}; the verified figure never exceeds your claim
        </span>
      </div>
      {problems.length > 0 ? (
        <p className="problem">Before this can be sent: {problems.join("; ")}.</p>
      ) : (
        <p className="small">
          {publishers} independent publisher{publishers === 1 ? "" : "s"} among these pages;
          the agreement requires {ag.min_independent} to state a usable figure before money can move.
        </p>
      )}
      {!review ? (
        <div className="action-row">
          <button className="pill" disabled={!ready || busy} onClick={() => setReview(true)}>
            Review before signing
          </button>
          <span className="price">no GEN is sent; the fee deposit is separate and mostly refunded</span>
        </div>
      ) : (
        <div className="review">
          <p className="eyebrow">What you sign</p>
          <p>
            Evidence version {version} for agreement {ordinalOf(ag.agreement_id)}: {sources.length} page{sources.length === 1 ? "" : "s"},
            claiming {formatCount(claimedNum)} {ag.unit}. No GEN is sent; the fee deposit is separate and mostly refunded.
          </p>
          <ul className="review-list">
            {sources.map((s, i) => {
              const m = matched[i];
              return (
                <li key={i}>
                  <span className="title">{s.label}</span>
                  <span className="small caption">
                    {registrableDomain(hostOf(s.url))}{m ? ` · ${kindWord(m.entry.kind)} · ${classWord(m.entry.class)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <Technical
            title="Exactly what is sent"
            rows={[
              { label: "Method", value: actionMethod("submit") },
              { label: "Agreement id", value: ag.agreement_id },
              { label: "Claimed figure", value: String(claimedNum) },
              { label: "Sources", value: sourcesJson, wide: true },
            ]}
          />
          <div className="action-row">
            <button
              className="pill"
              disabled={!ready || busy}
              onClick={() => void run(
                "submit_evidence", [ag.agreement_id, claimedNum, sourcesJson], 0n,
                evidenceVersionAbove(ag.agreement_id, ag.evidence_version),
                `Evidence version ${version} is on the record, finalized.`,
              )}
            >
              Submit evidence
            </button>
            <button className="pill quiet" disabled={busy} onClick={() => setReview(false)}>Back to editing</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChallengeForm({
  ag, judged, bond, busy, run,
}: {
  ag: Agreement;
  judged: Package | null;
  bond: bigint;
  busy: boolean;
  run: RunFn;
}) {
  const [grounds, setGrounds] = useState("");
  const [extra, setExtra] = useState<SourceDraft>({ url: "", label: "" });
  const [review, setReview] = useState(false);
  const g = grounds.trim();
  const problems: string[] = [];
  if (g.length < GROUNDS_CHARS[0] || g.length > GROUNDS_CHARS[1]) {
    problems.push(`grounds must be ${GROUNDS_CHARS[0]} to ${GROUNDS_CHARS[1]} characters (now ${g.length})`);
  }
  const hasExtra = extra.url.trim() !== "" || extra.label.trim() !== "";
  let extraEntry: BasisEntry | null = null;
  if (hasExtra) {
    const seen = new Set((judged?.rows ?? []).map((r) => r.norm_url));
    const { problem, entry } = rowProblem(extra, 0, ag.basis, seen);
    if (problem) problems.push(`new page: ${problem}`);
    extraEntry = entry;
  }
  const ready = problems.length === 0;
  const newVersion = ag.evidence_version + 1;
  const bondGen = formatGen(bond);

  return (
    <div className="action">
      <p>
        Your grounds reach the second panel as a party claim, never as proof. The panel re-reads
        the recorded bytes of round {ag.judged_version} and fetches live only the one page you may
        add here, from inside the basis. The bond returns if the verdict or the verified figure
        changes; otherwise it goes to the other party.
      </p>
      <div className="field">
        <span className="label">Grounds</span>
        <textarea rows={4} value={grounds} onChange={(e) => setGrounds(e.target.value)} />
        <span className="hint">{g.length} characters; {GROUNDS_CHARS[0]} to {GROUNDS_CHARS[1]}</span>
      </div>
      <p className="eyebrow">One new page (optional)</p>
      <SourceRows
        rows={[extra]}
        basis={ag.basis}
        seenBefore={(judged?.rows ?? []).map((r) => r.norm_url)}
        onChange={(rows) => setExtra(rows[0] ?? { url: "", label: "" })}
        max={1}
      />
      {problems.length > 0 && <p className="problem">Before this can be sent: {problems.join("; ")}.</p>}
      {!review ? (
        <div className="action-row">
          <button className="pill" disabled={!ready || busy} onClick={() => setReview(true)}>
            Review before signing
          </button>
          <span className="price">bond: exactly <span className="figure">{bondGen} GEN</span></span>
        </div>
      ) : (
        <div className="review">
          <p className="eyebrow">What you sign</p>
          <p>
            You post a bond of exactly {bondGen} GEN, sent with the transaction and held until the
            round concludes. The record is re-read as evidence version {newVersion}
            {hasExtra && extraEntry
              ? `, with one new page added: ${extra.label.trim()}, published by ${registrableDomain(hostOf(extra.url.trim()))}, ${kindWord(extraEntry.kind)}, ${classWord(extraEntry.class)}.`
              : ", with no new page."}
          </p>
          <blockquote className="reason">{g}</blockquote>
          <Technical
            title="Exactly what is sent"
            rows={[
              { label: "Method", value: actionMethod("challenge") },
              { label: "Agreement id", value: ag.agreement_id },
              { label: "Bond (atto)", value: bond.toString() },
              { label: "New page url", value: hasExtra ? extra.url.trim() : "", href: hasExtra ? extra.url.trim() : undefined, wide: true },
              { label: "New page label", value: hasExtra ? extra.label.trim() : "" },
            ]}
          />
          <div className="action-row">
            <button
              className="pill"
              disabled={!ready || busy}
              onClick={() => void run(
                "challenge",
                [ag.agreement_id, g, hasExtra ? extra.url.trim() : "", hasExtra ? extra.label.trim() : ""],
                bond,
                challengeOpen(ag.agreement_id),
                "The challenge is filed and the bond is in custody; re-adjudication is open to anyone.",
              )}
            >
              Challenge <span className="amount">{bondGen} GEN</span>
            </button>
            <button className="pill quiet" disabled={busy} onClick={() => setReview(false)}>Back to editing</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── the one legal action ────────────────────────────────────────────────────

/** A one-verb action with a review step and no form: adjudicate, promote,
 *  settle, reclaim, lapse, re-adjudicate, cancel, claim. */
function SimpleAction({
  kind, ag, amount, review, predicate, confirmed, busy, needsWallet, args, valueAtto = 0n, run,
}: {
  kind: ActionKind;
  ag: Agreement;
  /** "0.046 GEN" beside the verb, for claim; nothing for a free call. */
  amount?: string;
  /** The human sentence of what signing does. */
  review: string;
  predicate: () => Promise<boolean>;
  confirmed: string;
  busy: boolean;
  needsWallet: boolean;
  args: unknown[];
  valueAtto?: bigint;
  run: RunFn;
}) {
  const [open, setOpen] = useState(false);
  const verb = actionVerb(kind);
  const label = (
    <>
      {verb}
      {amount ? <span className="amount">{amount}</span> : null}
    </>
  );
  if (!open) {
    return (
      <div className="action-row">
        <button className="pill" disabled={busy || needsWallet} onClick={() => setOpen(true)}>{label}</button>
        <span className="price">
          {needsWallet ? "connect a wallet to sign this" : "no GEN is sent; only the fee deposit, mostly refunded"}
        </span>
      </div>
    );
  }
  return (
    <div className="review">
      <p className="eyebrow">What you sign</p>
      <p>{review}</p>
      <Technical
        title="Exactly what is sent"
        rows={[
          { label: "Method", value: actionMethod(kind) },
          ...(args.length ? [{ label: "Agreement id", value: ag.agreement_id }] : []),
          { label: "Value (atto)", value: valueAtto.toString() },
        ]}
      />
      <div className="action-row">
        <button className="pill" disabled={busy} onClick={() => void run(actionMethod(kind), args, valueAtto, predicate, confirmed)}>
          {label}
        </button>
        <button className="pill quiet" disabled={busy} onClick={() => setOpen(false)}>Back</button>
      </div>
    </div>
  );
}

function ActionBody({
  ag, action, address, claimable, judged, busy, run,
}: {
  ag: Agreement;
  action: NextAction;
  address: string;
  claimable: string;
  judged: Package | null;
  busy: boolean;
  run: RunFn;
}) {
  const [review, setReview] = useState(false);
  const now = useNow();
  const id = ag.agreement_id;
  const n = ordinalOf(id);
  const reward = BigInt(ag.max_reward_atto);
  const rewardGen = formatGen(reward);
  const bond = BigInt(ag.challenge_bond_atto);
  const needsWallet = action.kind !== "wait" && action.kind !== "none" && !address;
  const simple = (kind: ActionKind, review: string, predicate: () => Promise<boolean>, confirmed: string) => (
    <SimpleAction
      kind={kind} ag={ag} review={review} predicate={predicate} confirmed={confirmed}
      busy={busy} needsWallet={needsWallet} args={[id]} run={run}
    />
  );

  switch (action.kind) {
    case "fund":
      return (
        <div className="action">
          <p>{action.why}</p>
          {!review ? (
            <div className="action-row">
              <button className="pill" disabled={busy || needsWallet} onClick={() => setReview(true)}>
                Fund <span className="amount">{rewardGen} GEN</span>
              </button>
              <span className="price">
                {needsWallet ? "connect a wallet to fund" : <>sends exactly <span className="figure">{rewardGen} GEN</span></>}
              </span>
            </div>
          ) : (
            <div className="review">
              <p className="eyebrow">What you sign</p>
              <p>You send exactly {rewardGen} GEN, the whole maximum reward. It stays locked in the contract until settlement or reclaim.</p>
              <p>You become the funder. You may challenge a verdict inside its window, and the reward returns to your ledger if nothing is proven inside the grace.</p>
              <p>You accept the terms, the outcome, the money rule and the evidence basis exactly as this page shows them. They freeze under your deposit.</p>
              <Technical
                title="Exactly what is sent"
                rows={[
                  { label: "Method", value: actionMethod("fund") },
                  { label: "Agreement id", value: id },
                  { label: "Value (atto)", value: reward.toString() },
                  { label: "Terms hash", value: ag.terms_sha256 },
                ]}
              />
              <div className="action-row">
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() => void run(
                    "fund", [id], reward, agreementStatusIs(id, "FUNDED"),
                    `Funded: ${rewardGen} GEN is locked and the agreement is in force, finalized.`,
                  )}
                >
                  Fund <span className="amount">{rewardGen} GEN</span>
                </button>
                <button className="pill quiet" disabled={busy} onClick={() => setReview(false)}>Back</button>
              </div>
            </div>
          )}
        </div>
      );
    case "cancel":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("cancel", `This withdraws draft agreement ${n}. It holds nothing, and nobody is owed anything.`, cancelled(id), "Cancelled, finalized. The draft held nothing.")}
        </div>
      );
    case "submit":
      return (
        <div className="action">
          <p>{action.why}</p>
          <SubmitForm ag={ag} busy={busy} run={run} />
        </div>
      );
    case "adjudicate":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("adjudicate",
            `This puts evidence version ${ag.evidence_version} of agreement ${n} to the panel. Every validator fetches each page itself; the round takes a minute or two of consensus. No GEN is sent.`,
            adjudicationRecorded(id, ag.evidence_version),
            "The panel has judged; the verdict is recorded and pending its finality window.")}
        </div>
      );
    case "promote":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("promote",
            `This promotes the recorded verdict on agreement ${n} into its state. An inconclusive verdict returns the agreement to funded; a conclusive one opens the challenge window. No GEN is sent.`,
            promoted(id), "Promoted: the recorded verdict is now the agreement's state.")}
        </div>
      );
    case "challenge":
      return (
        <div className="action">
          <p>{action.why}</p>
          <ChallengeForm ag={ag} judged={judged} bond={bond} busy={busy} run={run} />
        </div>
      );
    case "re_adjudicate":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("re_adjudicate",
            `This runs the second panel on agreement ${n}. It re-reads the recorded bytes of round ${ag.challenged_version} and fetches only the page the challenger added. The bond follows whether the verdict or figure changes. No GEN is sent.`,
            challengeClosed(id), "Re-judged: the challenge is concluded and the new verdict is pending its finality window.")}
        </div>
      );
    case "lapse":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("lapse",
            `This lapses the stale challenge on agreement ${n}: the challenged verdict is restored exactly and the bond returns to the challenger. No GEN is sent.`,
            challengeClosed(id), "Lapsed: the challenged verdict is restored exactly and the bond returned.")}
        </div>
      );
    case "settle":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("settle",
            `This settles agreement ${n} by the standing verdict, in one call. ${fundingMath(ag)} Payees claim from their ledger afterwards. No GEN is sent.`,
            settled(id), "Settled: the ledger reflects the verdict; payees claim from it.")}
        </div>
      );
    case "reclaim":
      return (
        <div className="action">
          <p>{action.why}</p>
          {simple("reclaim",
            `This returns the ${rewardGen} GEN reward of agreement ${n} to the funder's ledger. Nothing was proven inside the grace. No GEN is sent by you.`,
            reclaimed(id), `Reclaimed: ${rewardGen} GEN is back in the funder's ledger.`)}
        </div>
      );
    case "claim":
      return (
        <div className="action">
          <p>{action.why}</p>
          <SimpleAction
            kind="claim" ag={ag} amount={`${formatGen(claimable)} GEN`}
            review={`This pays your wallet ${formatGen(claimable)} GEN from the contract's ledger. The ledger is zeroed first, and the transfer rides the transaction's finality.`}
            predicate={claimDrained(address)}
            confirmed="Claimed: the transfer rides the transaction's finality and lands with it."
            busy={busy} needsWallet={needsWallet} args={[]} run={run}
          />
        </div>
      );
    case "wait":
      return (
        <div className="action">
          <p>
            Nothing is legal here until {formatStamp(action.until)}, {formatRelative(action.until, now)}.
          </p>
          <p>{action.why}</p>
        </div>
      );
    default:
      return <div className="action"><p>{action.why}</p></div>;
  }
}

function railTitle(action: NextAction): string {
  if (action.kind === "wait") return "Wait";
  if (action.kind === "none") return "Closed";
  return actionVerb(action.kind);
}

function ActionRail({
  ag, action, address, claimable, judged, busy, run, tx,
}: {
  ag: Agreement;
  action: NextAction;
  address: string;
  claimable: string;
  judged: Package | null;
  busy: boolean;
  run: RunFn;
  tx: TxProgress | null;
}) {
  // On a narrow screen the rail is fixed to the bottom and opens on demand;
  // on desktop the toggle is hidden by CSS and the body is always shown.
  const [open, setOpen] = useState(false);
  const showSecondaryClaim = action.kind !== "claim" && !!address && BigInt(claimable) > 0n;
  const price =
    action.kind === "fund" ? `${formatGen(ag.max_reward_atto)} GEN`
    : action.kind === "challenge" ? `bond ${formatGen(ag.challenge_bond_atto)} GEN`
    : action.kind === "claim" ? `${formatGen(claimable)} GEN`
    : action.kind === "wait" ? formatStamp(action.until)
    : action.kind === "none" ? ""
    : "fee only";

  return (
    <aside className={open ? "rail open" : "rail"} aria-label="Next step">
      <div className="rail-head">
        <div>
          <p className="eyebrow">Next step</p>
          <h2 className="heading-sm rail-title">
            {railTitle(action)}
            {price ? <span className="rail-price">{price}</span> : null}
          </h2>
        </div>
        <button type="button" className="pill quiet rail-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div className="rail-body">
        <ActionBody
          ag={ag}
          action={action}
          address={address}
          claimable={claimable}
          judged={judged}
          busy={busy}
          run={run}
        />
        {showSecondaryClaim && (
          <div className="action-row rail-secondary">
            <button
              className="pill quiet"
              disabled={busy}
              onClick={() => void run("claim", [], 0n, claimDrained(address), "Claimed: the transfer rides the transaction's finality and lands with it.")}
            >
              Claim <span className="amount">{formatGen(claimable)} GEN</span>
            </button>
            <span className="price">this wallet&apos;s balance across every agreement</span>
          </div>
        )}
        <TxFlow p={tx} />
        <p className="small rail-note">
          The contract keeps its own clock; a boundary shown here may be a few minutes off.
          Every write simulates first, so one the contract would refuse stops before your wallet opens.
        </p>
      </div>
    </aside>
  );
}

// ── the page ────────────────────────────────────────────────────────────────

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const { address, client } = useWallet();
  const now = useNow();

  const [ag, setAg] = useState<Agreement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "unreachable">("loading");
  const [error, setError] = useState("");
  const [claimable, setClaimable] = useState("0");
  const [packages, setPackages] = useState<(Package | null)[]>([]);
  const [dossiers, setDossiers] = useState<(Dossier | null)[]>([]);
  const [recordState, setRecordState] = useState<"loading" | "ready" | "unreachable">("loading");
  const [tx, setTx] = useState<TxProgress | null>(null);

  const loadRecord = useCallback(async (versions: number) => {
    const vs = Array.from({ length: versions }, (_, i) => i + 1);
    try {
      const [p, d] = await Promise.all([
        Promise.all(vs.map((v) => getPackage(id, v))),
        Promise.all(vs.map((v) => getDossier(id, v))),
      ]);
      setPackages(p);
      setDossiers(d);
      setRecordState("ready");
    } catch {
      setRecordState((s) => (s === "ready" ? s : "unreachable"));
    }
  }, [id]);

  const refresh = useCallback(async (force = false) => {
    try {
      const a = await getAgreement(id, force);
      if (!a) {
        setState("missing");
        return;
      }
      setAg(a);
      setState("ready");
      if (address) setClaimable(await getClaimable(address, force));
      void loadRecord(a.evidence_version);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState((s) => (s === "ready" ? s : "unreachable"));
    }
  }, [id, address, loadRecord]);

  useEffect(() => {
    const kick = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 50_000);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
    };
  }, [refresh]);

  const busy = inFlight(tx?.stage ?? "idle");

  const run: RunFn = async (functionName, args, valueAtto, predicate, confirmedDetail) => {
    try {
      await writeAndConfirm({
        client, address: CONTRACT_ADDRESS, functionName, args, valueAtto,
        predicate, onProgress: setTx, confirmedDetail,
      });
      invalidateReads();
      await refresh(true);
    } catch {
      /* rendered by the flow */
    }
  };

  const action = useMemo<NextAction | null>(
    () => (ag ? nextAction(ag, { address: address || null, nowEpoch: now, claimableAtto: BigInt(claimable) }) : null),
    [ag, address, now, claimable],
  );

  const rounds = useMemo(
    () => dossiers.filter((d): d is Dossier => d !== null),
    [dossiers],
  );
  const events = useMemo(() => (ag ? timeline(ag, rounds, now) : []), [ag, rounds, now]);

  if (state === "loading") {
    return <main className="page"><StateNote kind="loading">Reading the agreement from the contract.</StateNote></main>;
  }
  if (state === "missing") {
    return (
      <main className="page">
        <StateNote kind="empty">
          No agreement exists at this address on the contract.{" "}
          <Link href="/projects" className="inline-link">Back to the agreements.</Link>
        </StateNote>
      </main>
    );
  }
  if (state === "unreachable" || !ag || !action) {
    return (
      <main className="page">
        <StateNote kind="unreachable">
          Studio Next could not be reached, so the agreement cannot be shown right now. The
          record has not gone anywhere, and this page keeps retrying. {error}
        </StateNote>
      </main>
    );
  }

  const judged = ag.judged_version > 0 && ag.verdict !== "";
  const proven = judged ? ag.verified_impact : null;
  const operator = isOperator(address, ag.operator);
  const funder = isFunder(address, ag.funder);
  const judgedPackage = ag.judged_version > 0 ? packages[ag.judged_version - 1] ?? null : null;
  const roundsNewestFirst = [...rounds].reverse();

  const paid = (() => {
    const locked = ag.status === "FUNDED" || ag.status === "PENDING_FINALITY" || ag.status === "FINAL";
    if (ag.status === "SETTLED" && ag.verdict === "QUALIFIED") {
      return { value: <Gen atto={ag.payout_atto} big />, under: `${formatGen(ag.refund_atto)} GEN returned to the funder` };
    }
    if (ag.status === "SETTLED" || ag.status === "RECLAIMED") {
      return { value: <Gen atto="0" big />, under: `the ${formatGen(ag.refund_atto)} GEN reward returned to the funder` };
    }
    if (locked) return { value: <Gen atto={ag.max_reward_atto} big />, under: "locked in the contract; paid only at settlement" };
    if (ag.status === "DRAFT") return { value: <span className="big-word">nothing yet</span>, under: "nothing is locked until a funder deposits the reward" };
    return { value: <span className="big-word">nothing</span>, under: "never funded" };
  })();

  const provenUnder = judged && ag.verdict === "INCONCLUSIVE"
    ? `on hold: ${holdSentence(ag.hold_reason)}`
    : judged
      ? `the lowest usable independent figure, on evidence version ${ag.judged_version}`
      : ag.status === "PENDING_FINALITY"
        ? "a verdict is recorded and pending its finality window"
        : "nothing judged yet";

  return (
    <main className="page detail">
      <header className="detail-head">
        <Seal n={ordinalOf(ag.agreement_id)} size="lg" />
        <div className="detail-title">
          <p className="eyebrow">{ag.title}</p>
          <h1 className="heading-lg">{humanTitle(ag)}</h1>
          <div className="chips">
            <StatusChip status={ag.status} />
            {ag.challenge_open && <span className="chip">challenge open</span>}
            {operator && <span className="chip">you are the operator</span>}
            {funder && <span className="chip">you are the funder</span>}
          </div>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card figures-card">
            <div className="grid three figures">
              <div>
                <span className="stat-label">Promised</span>
                <Figure value={ag.target} unit={ag.unit} big />
                <span className="under">{ag.metric}</span>
              </div>
              <div>
                <span className="stat-label">Proven</span>
                <Figure value={proven} unit={ag.unit} big fallback={judged ? "on hold" : "not yet judged"} />
                <span className="under">{provenUnder}</span>
              </div>
              <div>
                <span className="stat-label">Paid</span>
                {paid.value}
                <span className="under">{paid.under}</span>
              </div>
            </div>
            <ProgressBar bps={progressBps(proven ?? 0, ag.target)} label="verified over target" />
          </section>

          <AgreementCard ag={ag} />

          <section className="card record">
            <h2 className="eyebrow">Evidence</h2>
            {ag.evidence_version === 0 && (
              <StateNote kind="empty">
                No evidence has been filed yet. The operator files a package after the deadline;
                it may be filed until {formatStamp(ag.deadline_epoch + ag.submission_grace)}.
              </StateNote>
            )}
            {ag.evidence_version > 0 && recordState === "loading" && (
              <StateNote kind="loading">Reading the evidence record.</StateNote>
            )}
            {ag.evidence_version > 0 && recordState === "unreachable" && (
              <StateNote kind="unreachable">
                The evidence record could not be read just now; the versions exist on-chain and
                this page keeps retrying.
              </StateNote>
            )}
            {recordState === "ready" && packages.map((p, i) => (
              p ? <EvidenceVersion key={i} pkg={p} unit={ag.unit} /> : null
            ))}
          </section>

          <section className="card record">
            <h2 className="eyebrow">Adjudication</h2>
            {ag.evidence_version === 0 && (
              <StateNote kind="empty">No panel round has run: there is no evidence to judge yet.</StateNote>
            )}
            {ag.evidence_version > 0 && recordState === "loading" && (
              <StateNote kind="loading">Reading the dossiers.</StateNote>
            )}
            {ag.evidence_version > 0 && recordState === "unreachable" && (
              <StateNote kind="unreachable">The dossiers could not be read just now; this page keeps retrying.</StateNote>
            )}
            {recordState === "ready" && ag.evidence_version > 0 && roundsNewestFirst.length === 0 && (
              <StateNote kind="empty">
                No panel round has run yet. Evidence version {ag.evidence_version} is filed; anyone may
                adjudicate it after the deadline.
              </StateNote>
            )}
            {recordState === "ready" && roundsNewestFirst.map((d) => (
              <Round
                key={d.evidence_version}
                d={d}
                ag={ag}
                pending={ag.status === "PENDING_FINALITY" && ag.pending_version === d.evidence_version}
              />
            ))}
          </section>

          <section className="card record">
            <h2 className="eyebrow">Funding math</h2>
            <p>{fundingMath(ag)}</p>
            {ag.challenge_open && (
              <p>
                A challenge is open with a {formatGen(ag.challenge_bond_atto)} GEN bond, filed{" "}
                {formatStamp(ag.challenge_filed_epoch)} by {partyWord(ag.challenger, ag)}. The bond
                returns to the challenger if the re-read verdict or figure differs; otherwise it goes
                to the other party.
              </p>
            )}
          </section>

          <section className="card record">
            <h2 className="eyebrow">Activity</h2>
            <Timeline events={events} now={now} />
          </section>
        </div>

        <ActionRail
          ag={ag}
          action={action}
          address={address}
          claimable={claimable}
          judged={judgedPackage}
          busy={busy}
          run={run}
          tx={tx}
        />
      </div>
    </main>
  );
}
