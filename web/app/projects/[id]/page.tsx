"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRACT_ADDRESS, formatBps, formatGen, formatSpan, formatStamp } from "../../../lib/config";
import {
  deadlineSentence, formatCount, fundingMath, holdSentence, nextAction, progressBps,
  verdictSentence, type NextAction,
} from "../../../lib/derive";
import {
  adjudicationRecorded, agreementStatusIs, cancelled, challengeClosed, challengeOpen,
  claimDrained, evidenceVersionAbove, isFunder, isOperator, promoted, reclaimed, settled,
} from "../../../lib/predicates";
import { getAgreement, getClaimable, getDossier, getPackage, invalidateReads } from "../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import { TERMINAL_STATUSES, type Agreement, type BasisEntry, type Dossier, type DossierRow, type Package } from "../../../lib/types";
import { distinctPublishers, hostOf, matchBasis, normalizeUrl, validUrl } from "../../../lib/urls";
import { useNow } from "../../../lib/useNow";
import { useWallet } from "../../../lib/wallet";
import {
  Addr, BasisClass, Figure, Gen, ProgressBar, StateNote, StatusChip, VerdictStamp,
} from "../../components/bits";
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

// ── the record ──────────────────────────────────────────────────────────────

function UrlCell({ url }: { url: string }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span className="url" title={url}>{url}</span>
      <button
        className="copy-btn"
        onClick={() => void navigator.clipboard?.writeText(url)}
        aria-label="Copy url"
      >
        copy
      </button>{" "}
      <a href={url} target="_blank" rel="noreferrer" className="ghost">open</a>
    </span>
  );
}

function EvidenceVersion({ pkg, unit }: { pkg: Package; unit: string }) {
  const byChallenger = pkg.added_by.startsWith("challenger");
  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
        <span className="subheading">Version {pkg.version}</span>
        <span>
          claimed <Figure value={pkg.claimed_impact} unit={unit} />
        </span>
        <span className="small muted">
          {byChallenger
            ? `filed by the ${pkg.added_by.split(":")[1] ?? "challenger"} as challenger — the judged rows plus one new source`
            : "filed by the operator"}
        </span>
      </div>
      <div className="tablewrap" style={{ marginTop: 12 }}>
        <table className="rows">
          <thead>
            <tr>
              <th>Id</th>
              <th>Label</th>
              <th>Publisher</th>
              <th>Kind</th>
              <th>Class</th>
              <th>Url</th>
            </tr>
          </thead>
          <tbody>
            {pkg.rows.map((r) => {
              const challenger = r.label.startsWith("[CHALLENGER]");
              return (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    {challenger ? (
                      <>
                        <span className="chip" style={{ marginRight: 8 }}>challenger</span>
                        {r.label.replace(/^\[CHALLENGER\]\s*/, "")}
                      </>
                    ) : r.label}
                  </td>
                  <td>
                    {r.domain}
                    {r.host !== r.domain && <div className="small muted">{r.host}</div>}
                  </td>
                  <td className="small">{r.kind.replace(/_/g, " ").toLowerCase()}</td>
                  <td><BasisClass cls={r.cls} /></td>
                  <td><UrlCell url={r.url} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="technical" style={{ marginTop: 12 }}>
        <summary>package root</summary>
        <div className="technical-body">{pkg.root}</div>
      </details>
    </div>
  );
}

function basisText(r: DossierRow): string {
  if (r.basis === "RECORDED") return `recorded at round ${r.basis_round}`;
  if (r.basis === "NEW") return "new — added by the challenger";
  return "fetched this round";
}

function Round({ d, ag, pending }: { d: Dossier; ag: Agreement; pending: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline" }}>
        <VerdictStamp verdict={d.verdict} hold={d.hold_reason} />
        <Figure value={d.verified_impact} unit={ag.unit} big />
      </div>
      <dl className="kv" style={{ marginTop: 16 }}>
        <dt>Round</dt>
        <dd>
          {d.round_kind === "RE_ADJUDICATION"
            ? `re-adjudication of evidence v${d.evidence_version}, reconsidering round ${d.reconsidered_round} — the recorded bytes of that round, plus what the challenger added`
            : `adjudication of evidence v${d.evidence_version}`}
          {" · "}observed {formatStamp(d.observed_epoch)}
          {pending && ` · pending finality until ${formatStamp(ag.pending_until_epoch)}`}
        </dd>
        <dt>Evidence</dt>
        <dd className="mono">{d.evidence_flag}</dd>
        <dt>Score</dt>
        <dd className="figure">{d.score} / 100</dd>
        {d.conflicts.length > 0 && (
          <>
            <dt>Conflicts</dt>
            <dd style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {d.conflicts.map((c) => (
                <span key={c} className="chip">{c.replace(/_/g, " ")}</span>
              ))}
            </dd>
          </>
        )}
        {d.hold_reason && (
          <>
            <dt>Hold</dt>
            <dd>{holdSentence(d.hold_reason)}</dd>
          </>
        )}
        <dt>Claimed</dt>
        <dd><Figure value={d.claimed_impact} unit={ag.unit} /></dd>
      </dl>
      <blockquote className="reason" style={{ marginTop: 20 }}>{d.reason}</blockquote>
      <div className="tablewrap" style={{ marginTop: 20 }}>
        <table className="rows">
          <thead>
            <tr>
              <th>Id</th>
              <th>Class</th>
              <th>Basis</th>
              <th>Readable</th>
              <th className="num">Figure</th>
              <th>On scope</th>
              <th>Label fits</th>
              <th>Digest</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">
                  {r.id}
                  <div className="small muted">{r.domain}</div>
                </td>
                <td><BasisClass cls={r.cls} /></td>
                <td className="small">{basisText(r)}</td>
                <td>{r.readable ? "yes" : "unreachable or empty"}</td>
                <td className="num">{r.figure === null ? "null" : formatCount(r.figure)}</td>
                <td>{r.readable ? (r.scope_ok ? "yes" : "no") : "—"}</td>
                <td>{r.readable ? (r.kind_matches ? "yes" : "no") : "—"}</td>
                <td><Addr value={r.digest} label="Copy digest" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="technical" style={{ marginTop: 12 }}>
        <summary>dossier record</summary>
        <div className="technical-body">
          {`dossier id      ${d.dossier_id}\nevidence root   ${d.evidence_root}\nexcerpts        ${d.rows.filter((r) => r.readable).length} readable of ${d.rows.length}, each digest = sha256 of the bytes stored`}
        </div>
      </details>
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
    return { problem: "the url must be http(s), printable ASCII without quotes or '|', 12–400 characters", entry: null };
  }
  const entry = matchBasis(url, basis);
  if (!entry) {
    return { problem: `${hostOf(url)} is outside the agreed basis — the panel reads only the origins both parties signed`, entry: null };
  }
  const norm = normalizeUrl(url);
  if (seen.has(norm)) {
    return { problem: `${norm} is already in the package — one page is one source, however it is spelled`, entry };
  }
  seen.add(norm);
  if (label.length < 1 || label.length > MAX_LABEL_CHARS) {
    return { problem: `source ${index + 1} needs a label of 1–${MAX_LABEL_CHARS} characters`, entry };
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
              <span className="label">Url {i + 1}</span>
              <input
                value={r.url}
                spellCheck={false}
                placeholder="https://…"
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
              />
              <span className={problem ? "hint problem" : "hint ok"}>
                {problem
                  ? problem
                  : entry
                    ? `inherits ${entry.kind.replace(/_/g, " ").toLowerCase()} · ${entry.class} from ${entry.origin}`
                    : ""}
              </span>
            </label>
            <label className="field">
              <span className="label">Label</span>
              <input
                value={r.label}
                maxLength={MAX_LABEL_CHARS}
                placeholder="what this page is"
                onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <span className="hint">{r.label.trim().length}/{MAX_LABEL_CHARS}</span>
            </label>
            <div className="field">
              <span className="label">&nbsp;</span>
              <button
                className="linkish"
                disabled={rows.length <= 1}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                remove
              </button>
            </div>
          </div>
        );
      })}
      {rows.length < max && (
        <button className="linkish" onClick={() => onChange([...rows, { url: "", label: "" }])}>
          add a source ({rows.length} of {max})
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
  const matched: BasisEntry[] = [];
  const hosts: string[] = [];
  rows.forEach((r, i) => {
    const { problem, entry } = rowProblem(r, i, ag.basis, seen);
    if (problem) problems.push(`source ${i + 1}: ${problem}`);
    else if (entry) {
      matched.push(entry);
      if (entry.class === "INDEPENDENT") hosts.push(hostOf(r.url.trim()));
    }
  });
  if (rows.length < 1 || rows.length > MAX_SOURCES) problems.push(`name 1–${MAX_SOURCES} sources`);
  if (problems.length === 0 && !matched.some((e) => e.class === "INDEPENDENT")) {
    problems.push("the package needs at least one source from an INDEPENDENT origin — the operator's own record cannot carry a payout");
  }
  const claimedNum = /^\d+$/.test(claimed.trim()) ? Number(claimed.trim()) : NaN;
  if (!Number.isInteger(claimedNum) || claimedNum < 0 || claimedNum > MAX_FIGURE) {
    problems.push(`the claimed figure must be a whole number of ${ag.unit}, 0–${formatCount(MAX_FIGURE)}`);
  }
  const publishers = distinctPublishers(hosts);
  const ready = problems.length === 0;
  const sources = rows.map((r) => ({ url: r.url.trim(), label: r.label.trim() }));
  const sourcesJson = JSON.stringify(sources);

  return (
    <div className="action">
      <p className="muted">
        A package is whole: 1–{MAX_SOURCES} URLs inside the agreed basis, each inheriting its
        kind and class from the origin it matches, plus your claimed figure — a ceiling on
        what can be verified, never a floor. This will be version {version}; earlier
        versions stay on-chain.
      </p>
      <SourceRows rows={rows} basis={ag.basis} seenBefore={[]} onChange={setRows} max={MAX_SOURCES} />
      <div className="field" style={{ maxWidth: 320 }}>
        <span className="label">Claimed figure ({ag.unit})</span>
        <input value={claimed} inputMode="numeric" onChange={(e) => setClaimed(e.target.value)} />
        <span className="hint">
          the target is {formatCount(ag.target)} {ag.unit}; the verified figure never exceeds your claim
        </span>
      </div>
      {problems.length > 0 ? (
        <p className="problem">Before this can be sent: {problems.join("; ")}.</p>
      ) : (
        <p className="ok">
          {publishers} independent publisher{publishers === 1 ? "" : "s"} among these rows;
          the agreement requires {ag.min_independent} to state a usable figure before money can move.
        </p>
      )}
      {!review ? (
        <div className="action-row">
          <button className="pill" disabled={!ready || busy} onClick={() => setReview(true)}>
            Review before signing
          </button>
          <span className="price">no value is sent; only the fee deposit, mostly refunded</span>
        </div>
      ) : (
        <div className="review">
          <p className="eyebrow">What your signature sends — exactly</p>
          <dl className="kv">
            <dt>Method</dt>
            <dd className="mono">submit_evidence({ag.agreement_id}, {claimedNum}, sources)</dd>
            <dt>Claimed</dt>
            <dd><Figure value={claimedNum} unit={ag.unit} /></dd>
            <dt>Sources</dt>
            <dd className="mono small" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(sources, null, 2)}</dd>
            <dt>Value</dt>
            <dd>0 GEN — the fee deposit is separate and mostly refunded</dd>
          </dl>
          <div className="action-row">
            <button
              className="pill"
              disabled={!ready || busy}
              onClick={() => void run(
                "submit_evidence", [ag.agreement_id, claimedNum, sourcesJson], 0n,
                evidenceVersionAbove(ag.agreement_id, ag.evidence_version),
                `Evidence v${version} is on the record, finalized.`,
              )}
            >
              Submit evidence v{version}
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
    problems.push(`grounds must be ${GROUNDS_CHARS[0]}–${GROUNDS_CHARS[1]} characters (now ${g.length})`);
  }
  const hasExtra = extra.url.trim() !== "" || extra.label.trim() !== "";
  let extraEntry: BasisEntry | null = null;
  if (hasExtra) {
    const seen = new Set((judged?.rows ?? []).map((r) => r.norm_url));
    const { problem, entry } = rowProblem(extra, 0, ag.basis, seen);
    if (problem) problems.push(`new source: ${problem}`);
    extraEntry = entry;
  }
  const ready = problems.length === 0;
  const newVersion = ag.evidence_version + 1;

  return (
    <div className="action">
      <p className="muted">
        Your grounds reach the second panel as a party claim, never as proof. The panel
        re-reads the recorded bytes of round {ag.judged_version} and fetches live only the
        one source you may add here, from inside the basis. The bond returns if the verdict
        or the verified figure changes; otherwise it goes to the other party.
      </p>
      <div className="field">
        <span className="label">Grounds ({GROUNDS_CHARS[0]}–{GROUNDS_CHARS[1]} characters)</span>
        <textarea rows={4} value={grounds} onChange={(e) => setGrounds(e.target.value)} />
        <span className="hint">{g.length} characters</span>
      </div>
      <p className="eyebrow">One new source (optional)</p>
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
          <span className="price">
            bond: exactly <span className="figure">{formatGen(bond)} GEN</span>
          </span>
        </div>
      ) : (
        <div className="review">
          <p className="eyebrow">What your signature sends — exactly</p>
          <dl className="kv">
            <dt>Method</dt>
            <dd className="mono">challenge({ag.agreement_id}, grounds, extra_url, extra_label)</dd>
            <dt>Bond</dt>
            <dd><Gen atto={bond.toString()} /> — sent as the transaction&apos;s value, held until the round concludes</dd>
            <dt>Grounds</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{g}</dd>
            <dt>New source</dt>
            <dd>
              {hasExtra && extraEntry
                ? <>{extra.url.trim()} — labelled &ldquo;[CHALLENGER] {extra.label.trim()}&rdquo;, inheriting {extraEntry.kind.replace(/_/g, " ").toLowerCase()} · {extraEntry.class}; becomes evidence v{newVersion}</>
                : <>none — the record is re-read as it stands (still stored as evidence v{newVersion})</>}
            </dd>
          </dl>
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
              Post the bond and challenge — {formatGen(bond)} GEN
            </button>
            <button className="pill quiet" disabled={busy} onClick={() => setReview(false)}>Back to editing</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── the one legal action ────────────────────────────────────────────────────

function Actions({
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
  const id = ag.agreement_id;
  const reward = BigInt(ag.max_reward_atto);
  const bond = BigInt(ag.challenge_bond_atto);
  const needsWallet = action.kind !== "wait" && action.kind !== "none" && !address;

  const simple = (label: string, functionName: string, predicate: () => Promise<boolean>, confirmed: string, price = "costs nothing but the fee deposit, mostly refunded") => (
    <div className="action">
      <p className="muted">{action.why}</p>
      <div className="action-row">
        <button
          className="pill"
          disabled={busy || needsWallet}
          onClick={() => void run(functionName, [id], 0n, predicate, confirmed)}
        >
          {label}
        </button>
        <span className="price">{needsWallet ? "connect a wallet to sign this" : price}</span>
      </div>
    </div>
  );

  let body: React.ReactNode;
  switch (action.kind) {
    case "fund":
      body = (
        <div className="action">
          <p className="muted">{action.why}</p>
          {!review ? (
            <div className="action-row">
              <button className="pill" disabled={busy || needsWallet} onClick={() => setReview(true)}>
                Review before funding
              </button>
              <span className="price">
                {needsWallet ? "connect a wallet to fund" : <>sends exactly <span className="figure">{formatGen(reward)} GEN</span></>}
              </span>
            </div>
          ) : (
            <div className="review">
              <p className="eyebrow">What your signature sends — exactly</p>
              <dl className="kv">
                <dt>Method</dt>
                <dd className="mono">fund({id})</dd>
                <dt>Value</dt>
                <dd><Gen atto={reward.toString()} /> — the whole maximum reward, locked until settlement or reclaim</dd>
                <dt>You become</dt>
                <dd>the funder: you may challenge a verdict inside its window, and the reward returns to your ledger if nothing is proven inside the grace</dd>
                <dt>You accept</dt>
                <dd>the terms (sha256 <span className="mono small">{ag.terms_sha256.slice(0, 16)}…</span>), the outcome, the money rule and the evidence basis below, frozen</dd>
              </dl>
              <div className="action-row">
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() => void run(
                    "fund", [id], reward, agreementStatusIs(id, "FUNDED"),
                    `Funded: ${formatGen(reward)} GEN is locked and the agreement is in force, finalized.`,
                  )}
                >
                  Fund — exactly {formatGen(reward)} GEN
                </button>
                <button className="pill quiet" disabled={busy} onClick={() => setReview(false)}>Back</button>
              </div>
            </div>
          )}
        </div>
      );
      break;
    case "cancel":
      body = simple("Cancel the draft", "cancel_draft", cancelled(id), "Cancelled, finalized. The draft held nothing.");
      break;
    case "submit":
      body = <SubmitForm ag={ag} busy={busy} run={run} />;
      break;
    case "adjudicate":
      body = simple(
        `Adjudicate evidence v${ag.evidence_version}`, "adjudicate",
        adjudicationRecorded(id, ag.evidence_version),
        "The panel has judged; the verdict is recorded and pending its finality window.",
        "costs nothing but the fee deposit · a minute or two of consensus",
      );
      break;
    case "promote":
      body = simple("Promote the verdict", "promote", promoted(id), "Promoted: the recorded verdict is now the agreement's state.");
      break;
    case "challenge":
      body = <ChallengeForm ag={ag} judged={judged} bond={bond} busy={busy} run={run} />;
      break;
    case "re_adjudicate":
      body = simple(
        "Run the re-adjudication", "re_adjudicate", challengeClosed(id),
        "Re-judged: the challenge is concluded and the new verdict is pending its finality window.",
        "costs nothing but the fee deposit · a minute or two of consensus",
      );
      break;
    case "lapse":
      body = simple("Lapse the stale challenge", "lapse_challenge", challengeClosed(id), "Lapsed: the challenged verdict is restored exactly and the bond returned.");
      break;
    case "settle":
      body = simple("Settle", "settle", settled(id), "Settled: the ledger reflects the verdict; payees claim from it.");
      break;
    case "reclaim":
      body = simple("Reclaim for the funder", "reclaim", reclaimed(id), `Reclaimed: ${formatGen(reward)} GEN is back in the funder's ledger.`);
      break;
    case "claim":
      body = (
        <div className="action">
          <p className="muted">{action.why}</p>
          <div className="action-row">
            <button
              className="pill"
              disabled={busy}
              onClick={() => void run("claim", [], 0n, claimDrained(address), "Claimed: the transfer rides the transaction's finality and lands with it.")}
            >
              Claim {formatGen(claimable)} GEN
            </button>
            <span className="price">pays this wallet <span className="figure">{formatGen(claimable)} GEN</span></span>
          </div>
        </div>
      );
      break;
    case "wait":
      body = (
        <div className="action">
          <p>
            Nothing is legal here until <span className="mono">{formatStamp(action.until)}</span>.
          </p>
          <p className="muted">{action.why}</p>
        </div>
      );
      break;
    default:
      body = <p className="muted">{action.why}</p>;
  }

  const showSecondaryClaim = action.kind !== "claim" && address && BigInt(claimable) > 0n;

  return (
    <>
      {body}
      {showSecondaryClaim && (
        <div className="action-row" style={{ marginTop: 20 }}>
          <button
            className="pill quiet"
            disabled={busy}
            onClick={() => void run("claim", [], 0n, claimDrained(address), "Claimed: the transfer rides the transaction's finality and lands with it.")}
          >
            Claim {formatGen(claimable)} GEN
          </button>
          <span className="price">this wallet&apos;s ledger balance across every agreement</span>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 20 }}>
        The contract keeps its own clock; a boundary shown here may be a few minutes off.
        Every write simulates first, so one the contract would refuse stops before your wallet opens.
      </p>
    </>
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

  if (state === "loading") {
    return <main className="page"><StateNote kind="loading">Reading the agreement from the contract…</StateNote></main>;
  }
  if (state === "missing") {
    return (
      <main className="page">
        <StateNote kind="empty">
          No agreement <span className="mono">{id}</span> exists on this contract.{" "}
          <Link href="/projects" className="inline-link">Back to the projects.</Link>
        </StateNote>
      </main>
    );
  }
  if (state === "unreachable" || !ag || !action) {
    return (
      <main className="page">
        <StateNote kind="unreachable">
          Studio Next could not be reached, so the agreement cannot be shown right now — the
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
  const rounds = dossiers
    .map((d, i) => ({ d, v: i + 1 }))
    .filter((x): x is { d: Dossier; v: number } => x.d !== null)
    .reverse();

  const paid = (() => {
    const locked = ag.status === "FUNDED" || ag.status === "PENDING_FINALITY" || ag.status === "FINAL";
    if (ag.status === "SETTLED" && ag.verdict === "QUALIFIED") {
      return { value: <Gen atto={ag.payout_atto} big />, under: `${formatGen(ag.refund_atto)} GEN returned to the funder` };
    }
    if (ag.status === "SETTLED" || ag.status === "RECLAIMED") {
      return { value: <Gen atto="0" big />, under: `the ${formatGen(ag.refund_atto)} GEN reward returned to the funder` };
    }
    if (locked) return { value: <Gen atto={ag.max_reward_atto} big />, under: "locked in the contract; paid only at settlement" };
    if (ag.status === "DRAFT") return { value: <span className="big-figure">—</span>, under: "nothing is locked until a funder deposits the reward" };
    return { value: <span className="big-figure">—</span>, under: "never funded" };
  })();

  return (
    <main className="page">
      <div>
        <p className="eyebrow">{ag.region}</p>
        <h1 className="heading-lg" style={{ marginTop: 12 }}>{ag.title}</h1>
        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
          <StatusChip status={ag.status} terminal={TERMINAL_STATUSES.includes(ag.status)} />
          {ag.challenge_open && <span className="chip">challenge open</span>}
          {operator && <span className="chip">you are the operator</span>}
          {funder && <span className="chip">you are the funder</span>}
        </div>
        <details className="technical" style={{ marginTop: 16 }}>
          <summary>agreement id</summary>
          <div className="technical-body">{ag.agreement_id}</div>
        </details>
      </div>

      <div className="grid three figures">
        <div>
          <span className="stat-label">Promised</span>
          <Figure value={ag.target} unit={ag.unit} big />
          <span className="under">{ag.metric}</span>
        </div>
        <div>
          <span className="stat-label">Proven</span>
          <Figure value={proven} unit={ag.unit} big />
          <span className="under">
            {judged && ag.verdict === "INCONCLUSIVE"
              ? `on hold — ${holdSentence(ag.hold_reason)}`
              : judged
                ? `the lowest usable independent figure, on evidence v${ag.judged_version}`
                : ag.status === "PENDING_FINALITY"
                  ? "a verdict is recorded and pending its finality window"
                  : "nothing judged yet"}
          </span>
        </div>
        <div>
          <span className="stat-label">Paid</span>
          {paid.value}
          <span className="under">{paid.under}</span>
        </div>
      </div>
      <ProgressBar bps={progressBps(proven ?? 0, ag.target)} label="verified over target" />

      <section className="section">
        <p className="eyebrow">Impact agreement</p>
        <dl className="kv">
          <dt>Outcome</dt>
          <dd>{ag.metric} — <Figure value={ag.target} unit={ag.unit} /></dd>
          <dt>Threshold</dt>
          <dd>
            {formatBps(ag.threshold_bps)} of the target — at least{" "}
            <Figure value={Math.ceil((ag.target * ag.threshold_bps) / 10_000)} unit={ag.unit} /> to qualify; below it the whole reward returns
          </dd>
          <dt>Corroboration</dt>
          <dd>
            {ag.min_independent} independent publisher{ag.min_independent === 1 ? "" : "s"} required to state a usable figure — two pages on one publisher are one voice
          </dd>
          <dt>Reward</dt>
          <dd><Gen atto={ag.max_reward_atto} /> at most; challenge bond <Gen atto={ag.challenge_bond_atto} /></dd>
          <dt>Deadline</dt>
          <dd>{deadlineSentence(ag)}</dd>
          <dt>Windows</dt>
          <dd>
            submission grace {formatSpan(ag.submission_grace)} after the deadline — then the funder may reclaim;
            finality {formatSpan(ag.finality_window)} — a verdict becomes state only after it;
            challenge {formatSpan(ag.challenge_window)} — a party may challenge inside it, anyone settles after
          </dd>
          <dt>Verdict</dt>
          <dd>{verdictSentence(ag)}</dd>
        </dl>

        <div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            The evidence basis: the only origins the panel may read. Kinds and classes are
            labels both wallets signed; the panel is told so and judges each page as what it
            shows itself to be.
          </p>
          <div className="tablewrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Agreed kind</th>
                  <th>Agreed class</th>
                </tr>
              </thead>
              <tbody>
                {ag.basis.map((b) => (
                  <tr key={b.origin}>
                    <td className="mono">{b.origin}</td>
                    <td>{b.kind.replace(/_/g, " ").toLowerCase()}</td>
                    <td><BasisClass cls={b.class} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <details className="technical terms">
          <summary>open the full text of the terms ({ag.terms_text.length} characters)</summary>
          <pre>{ag.terms_text}</pre>
        </details>
        <details className="technical">
          <summary>technical record</summary>
          <div className="technical-body">
            {`terms sha256    ${ag.terms_sha256}\noperator        ${ag.operator}\nfunder          ${ag.funder || "(not yet funded)"}\nevidence root   ${ag.evidence_root || "(no evidence yet)"}\ndrafted         ${formatStamp(ag.created_epoch)}${ag.funded_epoch ? `\nfunded          ${formatStamp(ag.funded_epoch)}` : ""}`}
          </div>
        </details>
      </section>

      <section className="section">
        <p className="eyebrow">Evidence</p>
        {ag.evidence_version === 0 && (
          <StateNote kind="empty">
            No evidence has been filed yet. The operator files a package after the deadline;
            it may be filed until {formatStamp(ag.deadline_epoch + ag.submission_grace)}.
          </StateNote>
        )}
        {ag.evidence_version > 0 && recordState === "loading" && (
          <StateNote kind="loading">Reading the evidence record…</StateNote>
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

      <section className="section">
        <p className="eyebrow">Adjudication</p>
        {ag.evidence_version === 0 && (
          <StateNote kind="empty">No panel round has run: there is no evidence to judge yet.</StateNote>
        )}
        {ag.evidence_version > 0 && recordState === "loading" && (
          <StateNote kind="loading">Reading the dossiers…</StateNote>
        )}
        {ag.evidence_version > 0 && recordState === "unreachable" && (
          <StateNote kind="unreachable">The dossiers could not be read just now; this page keeps retrying.</StateNote>
        )}
        {recordState === "ready" && ag.evidence_version > 0 && rounds.length === 0 && (
          <StateNote kind="empty">
            No panel round has run yet. Evidence v{ag.evidence_version} is filed; anyone may
            adjudicate it after the deadline.
          </StateNote>
        )}
        {recordState === "ready" && rounds.map(({ d, v }) => (
          <Round key={v} d={d} ag={ag} pending={ag.status === "PENDING_FINALITY" && ag.pending_version === v} />
        ))}
      </section>

      <section className="section">
        <p className="eyebrow">Funding math</p>
        <p style={{ maxWidth: "72ch" }}>{fundingMath(ag)}</p>
        {ag.challenge_open && (
          <p className="muted" style={{ maxWidth: "72ch" }}>
            A challenge is open with a {formatGen(ag.challenge_bond_atto)} GEN bond, filed{" "}
            {formatStamp(ag.challenge_filed_epoch)} by <Addr value={ag.challenger} />. The bond
            returns to the challenger if the re-read verdict or figure differs; otherwise it goes
            to the other party.
          </p>
        )}
      </section>

      <section className="section">
        <p className="eyebrow">Actions</p>
        <Actions
          ag={ag}
          action={action}
          address={address}
          claimable={claimable}
          judged={judgedPackage}
          busy={busy}
          run={run}
        />
        <TxFlow p={tx} />
      </section>
    </main>
  );
}
