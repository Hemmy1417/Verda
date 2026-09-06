/**
 * The activity timeline of one agreement, derived from the epochs the
 * agreement and its dossiers carry. Nothing is invented: an event appears
 * only when the contract recorded a time for it, and a boundary (deadline,
 * grace end, finality, challenge window, stale challenge) appears only while
 * it still decides something. Unit-tested in tests/timeline.test.ts.
 */
import { sameAddress } from "./chain";
import { formatGen, formatStamp } from "./config";
import { formatCount, holdSentence, STALE_CHALLENGE_SECONDS } from "./derive";
import type { AgreementSummary, Dossier } from "./types";
import { verdictWord } from "./words";

export type TimelineEvent = {
  key: string;
  /** Epoch seconds. */
  at: number;
  title: string;
  detail: string;
  /** A boundary is a moment the contract waits for, not something that happened. */
  boundary: boolean;
  /** Later than `now`, by the browser's clock. */
  future: boolean;
};

const TERMINAL = new Set(["SETTLED", "RECLAIMED", "CANCELLED"]);

export function timeline(ag: AgreementSummary, dossiers: Dossier[], now: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const reward = formatGen(ag.max_reward_atto);
  const unit = ag.unit;
  const graceEnd = ag.deadline_epoch + ag.submission_grace;
  const terminal = TERMINAL.has(ag.status);

  const push = (key: string, at: number, title: string, detail: string, boundary = false) => {
    if (at > 0) out.push({ key, at, title, detail, boundary, future: at > now });
  };

  push("drafted", ag.created_epoch, "Drafted",
    `The operator drafted the agreement: ${formatCount(ag.target)} ${unit} promised for at most ${reward} GEN.`);

  push("funded", ag.funded_epoch, "Funded",
    `The funder deposited exactly ${reward} GEN. The outcome, the money rule and the evidence basis froze under that deposit.`);

  if (ag.status === "DRAFT" || ag.status === "FUNDED" || ag.status === "PENDING_FINALITY" || ag.status === "FINAL") {
    push("deadline", ag.deadline_epoch, "Deadline",
      ag.deadline_epoch > now
        ? (ag.status === "DRAFT"
          ? "Funding closes at it; adjudication opens after it."
          : "Adjudication opens after it.")
        : "Adjudication opened here.",
      true);
  }

  if (ag.evidence_version > 0) {
    const v = ag.evidence_version;
    push("filed", ag.last_submit_epoch, "Evidence filed",
      v === 1
        ? `Version 1, claiming ${formatCount(ag.claimed_impact)} ${unit}.`
        : `Version ${v} is the latest of ${v}, claiming ${formatCount(ag.claimed_impact)} ${unit}. Earlier versions stay on the record.`);
  }

  for (const d of dossiers) {
    const re = d.round_kind === "RE_ADJUDICATION";
    const verdict = verdictWord(d.verdict);
    const outcome = d.verdict === "INCONCLUSIVE"
      ? `${verdict}: ${holdSentence(d.hold_reason)}.`
      : `${verdict}, ${formatCount(d.verified_impact)} ${unit} verified.`;
    push(`judged-${d.evidence_version}`, d.observed_epoch,
      re ? `Re-judged on version ${d.evidence_version}` : `Judged on version ${d.evidence_version}`,
      re
        ? `The second panel re-read the recorded bytes of round ${d.reconsidered_round}. ${outcome}`
        : `The panel read every source itself. ${outcome}`);
  }

  if (ag.status === "PENDING_FINALITY") {
    push("finality", ag.pending_until_epoch, "Finality window closes",
      "Anyone may promote the recorded verdict into the agreement's state after it.", true);
  }

  if (ag.final_epoch > 0) {
    push("promoted", ag.final_epoch, "Verdict promoted",
      `${verdictWord(ag.verdict)} became the agreement's state. Either party may challenge until ${formatStamp(ag.challenge_until_epoch)}.`);
  }

  if (ag.challenge_filed_epoch > 0) {
    const who = sameAddress(ag.challenger, ag.funder) ? "the funder" : sameAddress(ag.challenger, ag.operator) ? "the operator" : "a party";
    push("challenged", ag.challenge_filed_epoch, "Challenged",
      `Filed by ${who} with a ${formatGen(ag.challenge_bond_atto)} GEN bond against the verdict on version ${ag.challenged_version}.` +
      (ag.challenge_open ? " Re-adjudication is open to anyone." : ""));
    if (ag.challenge_open) {
      push("stale", ag.challenge_filed_epoch + STALE_CHALLENGE_SECONDS, "Challenge goes stale",
        "If no re-adjudication has concluded by then, anyone may lapse it: the verdict is restored and the bond returns.", true);
    }
  }

  if (ag.status === "FINAL" && !ag.challenge_open) {
    push("window", ag.challenge_until_epoch, "Challenge window closes",
      "Anyone may settle after it.", true);
  }

  if (ag.status === "FUNDED" && !terminal && now <= graceEnd && ag.evidence_version <= ag.judged_version) {
    push("grace", graceEnd, "Grace ends",
      "Evidence may be filed until then; afterwards anyone may reclaim the reward for the funder.", true);
  }

  push("settled", ag.settled_epoch, "Settled",
    `${formatGen(ag.payout_atto)} GEN to the operator and ${formatGen(ag.refund_atto)} GEN to the funder, each claimable from their ledger.`);
  push("reclaimed", ag.reclaimed_epoch, "Reclaimed",
    `${formatGen(ag.refund_atto)} GEN returned to the funder's ledger. Nothing was proven inside the grace.`);
  push("cancelled", ag.cancelled_epoch, "Cancelled",
    "The operator withdrew the draft. It held nothing.");

  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}
