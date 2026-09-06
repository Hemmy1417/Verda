/**
 * Pure derivations over an agreement — the sentences and the one legal action
 * the pages render. No I/O, no React, unit-tested in tests/derive.test.ts.
 *
 * Every rule here restates a wall in contracts/verda.py so the page offers
 * only what the contract would accept. The restatement is display gating: the
 * contract enforces every window with its own consensus clock, and a boundary
 * computed here from the browser's clock may sit a few minutes from the one
 * the contract sees. The UI says so once, beside the action.
 *
 * Copy rules the pages depend on: sentence case, no em dashes, versions
 * spelled "version 1", enum values never shown as written on-chain.
 */
import { sameAddress } from "./chain";
import { formatBps, formatGen, formatStamp } from "./config";
import type { AgreementSummary, HoldReason } from "./types";

/** contracts/verda.py MAX_VERSIONS — a fifth package is refused. */
export const MAX_VERSIONS = 4;
/** contracts/verda.py STALE_CHALLENGE_SECONDS — the unilateral exit opens. */
export const STALE_CHALLENGE_SECONDS = 3_600;

/** Whole-unit figure with thousands separators, deterministic across locales. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, Math.floor(n)));
}

/** verified / target in basis points, clamped to 0–10000. The bar's LENGTH. */
export function progressBps(verified: number, target: number): number {
  if (!(target > 0) || !(verified > 0)) return 0;
  if (verified >= target) return 10_000;
  return Math.floor((verified * 10_000) / target);
}

/** `_payout_atto`: verified / target × reward in integer atto, capped at the
 *  reward. BigInt throughout — a reward is up to 10^21 atto. */
export function payoutPreview(verified: number, target: number, rewardAtto: string | bigint): bigint {
  const reward = typeof rewardAtto === "bigint" ? rewardAtto : BigInt(rewardAtto || "0");
  if (target <= 0 || verified <= 0) return 0n;
  const share = (BigInt(Math.floor(verified)) * reward) / BigInt(Math.floor(target));
  return share < reward ? share : reward;
}

const HOLD: Record<HoldReason, string> = {
  EVIDENCE_INSUFFICIENT: "the record does not establish the outcome for this region and period",
  UNCORROBORATED: "fewer independent publishers than the agreement requires state a usable figure",
  SOURCES_CONTRADICT: "the independent figures disagree by more than 15 percent",
};

/** The hold reason as the sentence a reader needs, or "" for no hold. */
export function holdSentence(hold: string): string {
  return (HOLD as Record<string, string>)[hold] ?? "";
}

/** The threshold as a whole-unit floor: ceil(target × bps / 10000). */
export function thresholdFloor(target: number, thresholdBps: number): number {
  return Math.ceil((target * thresholdBps) / 10_000);
}

/** "90% of the target, at least 450 hectares" */
export function thresholdSentence(ag: Pick<AgreementSummary, "target" | "threshold_bps" | "unit">): string {
  return `${formatBps(ag.threshold_bps)} of the target, at least ${formatCount(thresholdFloor(ag.target, ag.threshold_bps))} ${ag.unit}`;
}

/** "1 independent publisher must state a figure" */
export function corroborationSentence(ag: Pick<AgreementSummary, "min_independent">): string {
  const n = ag.min_independent;
  return `${n} independent publisher${n === 1 ? "" : "s"} must state a figure`;
}

/** What the standing (or pending) verdict means for this agreement. */
export function verdictSentence(ag: AgreementSummary): string {
  const unit = ag.unit;
  const threshold = `${formatBps(ag.threshold_bps)} threshold of ${formatCount(ag.target)} ${unit}`;
  if (ag.status === "PENDING_FINALITY" && ag.pending_version > 0) {
    return `A verdict on evidence version ${ag.pending_version} is recorded and pending its finality window. It becomes the agreement's state only when promoted.`;
  }
  switch (ag.verdict) {
    case "QUALIFIED":
      return `Qualified on evidence version ${ag.judged_version}. The lowest usable independent figure is ${formatCount(ag.verified_impact)} ${unit}, at or above the ${threshold}.`;
    case "NOT_QUALIFIED":
      return `Not qualified on evidence version ${ag.judged_version}. The verified figure of ${formatCount(ag.verified_impact)} ${unit} is below the ${threshold}, so the whole reward returns to the funder.`;
    case "INCONCLUSIVE":
      return `Inconclusive on evidence version ${ag.judged_version}: ${holdSentence(ag.hold_reason)}. Nothing moves.`;
    default:
      return "No verdict yet.";
  }
}

/** Every deadline WITH its consequence, in one sentence. */
export function deadlineSentence(ag: AgreementSummary): string {
  const deadline = formatStamp(ag.deadline_epoch);
  const graceEnd = formatStamp(ag.deadline_epoch + ag.submission_grace);
  const opens = ag.status === "DRAFT"
    ? "Funding closes at it and adjudication opens after it"
    : "Adjudication opens after it";
  return `Deadline ${deadline}. ${opens}; evidence may be filed until ${graceEnd}, then the funder may reclaim.`;
}

/** The arithmetic with the real numbers, for the Funding math section. */
export function fundingMath(ag: AgreementSummary): string {
  const reward = formatGen(ag.max_reward_atto);
  const target = formatCount(ag.target);
  const unit = ag.unit;
  const pct = formatBps(ag.threshold_bps);
  switch (ag.status) {
    case "SETTLED":
      if (ag.verdict === "QUALIFIED") {
        return `${formatCount(ag.verified_impact)} / ${target} × ${reward} GEN = ${formatGen(ag.payout_atto)} GEN to the operator; ${formatGen(ag.refund_atto)} GEN returns to the funder.`;
      }
      return `${formatCount(ag.verified_impact)} / ${target} ${unit} is below the ${pct} threshold, so the whole ${reward} GEN returned to the funder.`;
    case "RECLAIMED":
      return `Nothing was proven inside the grace: the whole ${reward} GEN returned to the funder's ledger.`;
    case "CANCELLED":
      return "Cancelled before anyone funded it; no money was ever locked.";
    case "DRAFT":
      return `If funded, settlement pays verified / ${target} × ${reward} GEN to the operator and returns the remainder to the funder; a verified figure below the ${pct} threshold returns the whole reward.`;
    case "FINAL": {
      if (ag.verdict === "QUALIFIED") {
        const payout = payoutPreview(ag.verified_impact, ag.target, ag.max_reward_atto);
        const refund = BigInt(ag.max_reward_atto) - payout;
        return `${formatCount(ag.verified_impact)} / ${target} × ${reward} GEN = ${formatGen(payout)} GEN to the operator; ${formatGen(refund)} GEN returns to the funder, at settlement after the challenge window.`;
      }
      return `${formatCount(ag.verified_impact)} / ${target} ${unit} is below the ${pct} threshold: the whole ${reward} GEN returns to the funder at settlement.`;
    }
    default:
      if (ag.verdict === "INCONCLUSIVE" && ag.judged_version > 0) {
        return `Nothing moves while the record is on hold: ${holdSentence(ag.hold_reason)}. ${reward} GEN stays locked for a new package, or returns to the funder after the grace.`;
      }
      return `${reward} GEN is locked. Settlement pays verified / ${target} × ${reward} GEN to the operator and returns the remainder to the funder; below the ${pct} threshold the whole reward returns.`;
  }
}

// ── the one legal action ───────────────────────────────────────────────────

export type ActionKind =
  | "fund" | "cancel" | "submit" | "adjudicate" | "promote" | "challenge"
  | "re_adjudicate" | "lapse" | "settle" | "reclaim" | "claim";

/** The one verb on the action card, per kind. */
const VERB: Record<ActionKind, string> = {
  fund: "Fund",
  cancel: "Cancel the draft",
  submit: "Submit evidence",
  adjudicate: "Adjudicate",
  promote: "Promote",
  challenge: "Challenge",
  re_adjudicate: "Re-adjudicate",
  lapse: "Lapse the challenge",
  settle: "Settle",
  reclaim: "Reclaim",
  claim: "Claim",
};

export function actionVerb(kind: ActionKind): string {
  return VERB[kind];
}

/** The contract method each action signs. Shown only in technical folds. */
const METHOD: Record<ActionKind, string> = {
  fund: "fund",
  cancel: "cancel_draft",
  submit: "submit_evidence",
  adjudicate: "adjudicate",
  promote: "promote",
  challenge: "challenge",
  re_adjudicate: "re_adjudicate",
  lapse: "lapse_challenge",
  settle: "settle",
  reclaim: "reclaim",
  claim: "claim",
};

export function actionMethod(kind: ActionKind): string {
  return METHOD[kind];
}

export type Viewer = {
  /** The connected wallet, or null. Ownership decides which action is theirs. */
  address: string | null;
  /** The browser's clock in seconds — display gating only. */
  nowEpoch: number;
  /** This wallet's ledger balance; claim is offered when it is above zero. */
  claimableAtto: bigint;
};

export type NextAction =
  /** A write this viewer may sign now. `priceAtto` is what the write is
   *  payable with — the exact reward or bond — and 0n for a free call. */
  | { kind: ActionKind; why: string; priceAtto: bigint }
  /** Nothing is legal until `until`; `why` names who moves it then. */
  | { kind: "wait"; until: number; why: string }
  /** Nothing will ever be legal here again. */
  | { kind: "none"; why: string };

const act = (kind: ActionKind, why: string, priceAtto = 0n): NextAction => ({ kind, why, priceAtto });
const wait = (until: number, why: string): NextAction => ({ kind: "wait", until, why });
const none = (why: string): NextAction => ({ kind: "none", why });

/**
 * The ONE legal action for this viewer now, from every write the contract
 * exposes. Where two are legal at once the order of the contract's own
 * lifecycle decides: a filed package is adjudicated before it is replaced, a
 * stale challenge is lapsed rather than re-run forever, and the wallet's own
 * ledger comes last — claim is offered only when nothing on this agreement is.
 */
export function nextAction(ag: AgreementSummary, viewer: Viewer): NextAction {
  const isOperator = sameAddress(viewer.address, ag.operator);
  const isFunder = sameAddress(viewer.address, ag.funder);
  const primary = agreementAction(ag, viewer.nowEpoch, isOperator, isOperator || isFunder);
  if ((primary.kind === "wait" || primary.kind === "none") && viewer.claimableAtto > 0n) {
    return act(
      "claim",
      `This wallet holds ${formatGen(viewer.claimableAtto)} GEN in the contract's ledger. Claim is the only path money takes out; the transfer rides the transaction's finality.`,
    );
  }
  return primary;
}

function agreementAction(ag: AgreementSummary, now: number, isOperator: boolean, isParty: boolean): NextAction {
  const reward = BigInt(ag.max_reward_atto || "0");
  const rewardGen = formatGen(reward);
  const deadline = ag.deadline_epoch;
  const graceEnd = deadline + ag.submission_grace;
  const version = ag.evidence_version;

  switch (ag.status) {
    case "DRAFT": {
      if (isOperator) {
        return act("cancel", "Your draft holds nothing and can be withdrawn freely until someone funds it.");
      }
      if (now < deadline) {
        return act(
          "fund",
          `Funding is exactly the maximum reward, ${rewardGen} GEN, and is the counter-signature: the outcome, the money rule and the evidence basis freeze under your deposit. The operator cannot fund its own draft.`,
          reward,
        );
      }
      return none("The deadline passed before anyone funded this draft; a period that is over cannot be entered. Only the operator can cancel it.");
    }

    case "FUNDED": {
      const unjudged = version > ag.judged_version;
      if (unjudged) {
        if (now > deadline) {
          return act(
            "adjudicate",
            `Evidence version ${version} is filed and unjudged. Anyone may put it to the panel: every validator fetches each source itself, and the round takes a minute or two of consensus.`,
          );
        }
        if (isOperator && version < MAX_VERSIONS) {
          return act(
            "submit",
            `Evidence version ${version} is filed; you may replace it with a new version until ${formatStamp(graceEnd)}. Adjudication opens after the deadline, ${formatStamp(deadline)}.`,
          );
        }
        return wait(deadline, `Evidence version ${version} is filed; adjudication opens to anyone after the deadline.`);
      }
      if (isOperator && now <= graceEnd && version < MAX_VERSIONS) {
        return act(
          "submit",
          version === 0
            ? `File the evidence package: URLs inside the agreed basis and your claimed figure. It may be filed until ${formatStamp(graceEnd)}; after that the funder may reclaim.`
            : `The panel held version ${version}: ${holdSentence(ag.hold_reason)}. A new package may be filed until ${formatStamp(graceEnd)}; after that the funder may reclaim.`,
        );
      }
      if (now > graceEnd) {
        return act(
          "reclaim",
          `The submission grace ended ${formatStamp(graceEnd)} with no verdict standing. Anyone may return the ${rewardGen} GEN reward to the funder's ledger.`,
        );
      }
      // Nothing filed, or a hold: the next moment anything becomes legal for
      // a non-operator is the end of the grace, whichever side of the
      // deadline the clock is on — the deadline itself opens nothing to them.
      return wait(
        graceEnd,
        version === 0
          ? now <= deadline
            ? `The operator files evidence, and adjudication opens after the deadline ${formatStamp(deadline)}; if nothing is filed by the end of the grace, anyone may reclaim the reward for the funder.`
            : "The operator files evidence; if none is filed by then, anyone may reclaim the reward for the funder."
          : `The panel held version ${version}. The operator may file a new package until then; afterwards anyone may reclaim the reward for the funder.`,
      );
    }

    case "PENDING_FINALITY": {
      if (now > ag.pending_until_epoch) {
        return act(
          "promote",
          `The finality window closed ${formatStamp(ag.pending_until_epoch)}. Anyone may promote the recorded verdict into the agreement's state; an inconclusive verdict returns it to funded.`,
        );
      }
      return wait(ag.pending_until_epoch, "A verdict is recorded and pending; after the finality window anyone may promote it.");
    }

    case "FINAL": {
      const bond = BigInt(ag.challenge_bond_atto || "0");
      if (ag.challenge_open) {
        const stale = ag.challenge_filed_epoch + STALE_CHALLENGE_SECONDS;
        if (now > stale) {
          return act(
            "lapse",
            `No re-adjudication has concluded within an hour of the challenge filed ${formatStamp(ag.challenge_filed_epoch)}. Anyone may lapse it: the challenged verdict is restored exactly and the bond returns to the challenger.`,
          );
        }
        return act(
          "re_adjudicate",
          `A challenge is open. Anyone may run the second panel: it re-reads the recorded bytes of round ${ag.challenged_version} and fetches only the source the challenger added. The bond follows whether the verdict or figure changes.`,
        );
      }
      if (now <= ag.challenge_until_epoch) {
        if (isParty && version < MAX_VERSIONS) {
          return act(
            "challenge",
            `Either party may challenge until ${formatStamp(ag.challenge_until_epoch)} with a bond of exactly ${formatGen(bond)} GEN and, optionally, one new source from inside the basis. The bond returns if the verdict or figure changes; otherwise it goes to the other party.`,
            bond,
          );
        }
        return wait(
          ag.challenge_until_epoch,
          isParty
            ? "The record holds its maximum of four versions, so no further challenge is possible; settlement opens to anyone after the window."
            : `Either party may challenge with a ${formatGen(bond)} GEN bond until then; afterwards anyone settles.`,
        );
      }
      return act(
        "settle",
        ag.verdict === "QUALIFIED"
          ? `The challenge window closed ${formatStamp(ag.challenge_until_epoch)}. Anyone may settle: ${formatGen(payoutPreview(ag.verified_impact, ag.target, reward))} GEN to the operator's ledger, the remainder to the funder's, in one call.`
          : `The challenge window closed ${formatStamp(ag.challenge_until_epoch)}. Anyone may settle: the whole ${rewardGen} GEN returns to the funder's ledger.`,
      );
    }

    case "SETTLED":
      return none(
        `Settled ${formatStamp(ag.settled_epoch)}: ${formatGen(ag.payout_atto)} GEN to the operator and ${formatGen(ag.refund_atto)} GEN to the funder, each claimable from their ledger.`,
      );
    case "RECLAIMED":
      return none(`Reclaimed ${formatStamp(ag.reclaimed_epoch)}: the ${formatGen(ag.refund_atto)} GEN reward returned to the funder's ledger.`);
    case "CANCELLED":
      return none(`Cancelled ${formatStamp(ag.cancelled_epoch)} by the operator; the draft held nothing.`);
    default:
      return none("This agreement is in a state the app does not recognise.");
  }
}
