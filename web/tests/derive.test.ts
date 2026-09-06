/**
 * lib/derive.ts restates the contract's walls as the one legal action a page
 * offers. Each case here is a state the contract can be in, a viewer, and a
 * clock — and the action the contract would accept from them.
 */
import { describe, expect, it } from "vitest";
import {
  actionMethod, actionVerb, corroborationSentence, deadlineSentence, formatCount, fundingMath,
  holdSentence, nextAction, payoutPreview, progressBps, thresholdFloor, thresholdSentence,
  verdictSentence, type ActionKind, type NextAction, type Viewer,
} from "@/lib/derive";
import type { AgreementSummary } from "@/lib/types";

const OPERATOR = "0x86dd000000000000000000000000000000001885";
const FUNDER = "0x57a7000000000000000000000000000000000657";
const STRANGER = "0x1111111111111111111111111111111111111111";

const DEADLINE = 1_800_000_000;
const GRACE = 1_209_600;
const FINALITY = 86_400;
const CHALLENGE = 86_400;
const REWARD = "50000000000000000"; // 0.05 GEN
const BOND = "50000000000000000";   // the floor

function mk(over: Partial<AgreementSummary> = {}): AgreementSummary {
  return {
    agreement_id: "vrd-000001",
    operator: OPERATOR,
    funder: "",
    status: "DRAFT",
    title: "Rio Verde restoration block RV-7",
    region: "Pará, Brazil",
    metric: "native vegetation restored",
    unit: "hectares",
    target: 500,
    threshold_bps: 9000,
    min_independent: 1,
    max_reward_atto: REWARD,
    challenge_bond_atto: BOND,
    terms_sha256: "ab".repeat(32),
    deadline_epoch: DEADLINE,
    submission_grace: GRACE,
    finality_window: FINALITY,
    challenge_window: CHALLENGE,
    created_epoch: DEADLINE - 7 * 86_400,
    funded_epoch: 0,
    evidence_version: 0,
    evidence_root: "",
    last_submit_epoch: 0,
    claimed_impact: 0,
    judged_version: 0,
    pending_version: 0,
    pending_until_epoch: 0,
    verdict: "",
    verified_impact: 0,
    score: 0,
    evidence_flag: "",
    hold_reason: "",
    final_epoch: 0,
    challenge_until_epoch: 0,
    challenge_open: false,
    challenger: "",
    challenge_grounds: "",
    challenge_new_version: 0,
    challenged_version: 0,
    challenge_filed_epoch: 0,
    settled_epoch: 0,
    payout_atto: "0",
    refund_atto: "0",
    reclaimed_epoch: 0,
    cancelled_epoch: 0,
    ...over,
  };
}

const viewer = (address: string | null, nowEpoch: number, claimableAtto = 0n): Viewer => ({
  address, nowEpoch, claimableAtto,
});

/** The wallet layer hands addresses in EIP-55 mixed case; the contract stores
 *  lowercase. Ownership must survive that. */
const MIXED_OPERATOR = "0x86DD000000000000000000000000000000001885";

const kind = (a: NextAction) => a.kind;

describe("progressBps — the bar's length", () => {
  it("is verified over target in basis points, clamped", () => {
    expect(progressBps(0, 500)).toBe(0);
    expect(progressBps(460, 500)).toBe(9200);
    expect(progressBps(500, 500)).toBe(10_000);
    expect(progressBps(600, 500)).toBe(10_000);
    expect(progressBps(1, 3)).toBe(3333);
    expect(progressBps(10, 0)).toBe(0);
    expect(progressBps(-5, 500)).toBe(0);
  });
});

describe("payoutPreview — _payout_atto in BigInt", () => {
  it("is verified / target × reward, capped at the reward", () => {
    expect(payoutPreview(460, 500, REWARD)).toBe(46_000_000_000_000_000n);
    expect(payoutPreview(500, 500, REWARD)).toBe(50_000_000_000_000_000n);
    expect(payoutPreview(600, 500, REWARD)).toBe(50_000_000_000_000_000n);
    expect(payoutPreview(0, 500, REWARD)).toBe(0n);
    expect(payoutPreview(460, 0, REWARD)).toBe(0n);
    expect(payoutPreview(1, 3, 10n ** 18n)).toBe(333_333_333_333_333_333n);
    expect(payoutPreview(460, 500, 50_000_000_000_000_000n)).toBe(46_000_000_000_000_000n);
  });
});

describe("holdSentence", () => {
  it("names each hold in the reader's words, and nothing for no hold", () => {
    expect(holdSentence("EVIDENCE_INSUFFICIENT")).toBe("the record does not establish the outcome for this region and period");
    expect(holdSentence("UNCORROBORATED")).toBe("fewer independent publishers than the agreement requires state a usable figure");
    expect(holdSentence("SOURCES_CONTRADICT")).toBe("the independent figures disagree by more than 15 percent");
    expect(holdSentence("")).toBe("");
    expect(holdSentence("SOMETHING_ELSE")).toBe("");
  });
});

describe("deadlineSentence — every deadline with its consequence", () => {
  it("states the deadline, the grace end and what follows each", () => {
    const s = deadlineSentence(mk({ status: "FUNDED" }));
    expect(s).toBe(
      "Deadline 15 Jan 2027, 08:00 UTC. Adjudication opens after it; evidence may be filed until 29 Jan 2027, 08:00 UTC, then the funder may reclaim.",
    );
  });
  it("tells a draft that funding closes at the deadline too", () => {
    expect(deadlineSentence(mk())).toMatch(/Funding closes at it and adjudication opens after it/);
  });
});

describe("threshold and corroboration, in words", () => {
  it("states the threshold as a share and a floor", () => {
    expect(thresholdFloor(500, 9000)).toBe(450);
    expect(thresholdFloor(1, 5000)).toBe(1);
    expect(thresholdSentence(mk())).toBe("90% of the target, at least 450 hectares");
    expect(thresholdSentence(mk({ target: 1000, threshold_bps: 8550, unit: "trees" }))).toBe("85.5% of the target, at least 855 trees");
  });
  it("counts the publishers that must speak", () => {
    expect(corroborationSentence(mk())).toBe("1 independent publisher must state a figure");
    expect(corroborationSentence(mk({ min_independent: 2 }))).toBe("2 independent publishers must state a figure");
  });
});

describe("the one verb per action", () => {
  it("names every action with one verb and its contract method", () => {
    const kinds: ActionKind[] = [
      "fund", "cancel", "submit", "adjudicate", "promote", "challenge", "re_adjudicate", "lapse", "settle", "reclaim", "claim",
    ];
    const verbs = kinds.map(actionVerb);
    expect(verbs).toEqual([
      "Fund", "Cancel the draft", "Submit evidence", "Adjudicate", "Promote", "Challenge",
      "Re-adjudicate", "Lapse the challenge", "Settle", "Reclaim", "Claim",
    ]);
    expect(kinds.map(actionMethod)).toEqual([
      "fund", "cancel_draft", "submit_evidence", "adjudicate", "promote", "challenge",
      "re_adjudicate", "lapse_challenge", "settle", "reclaim", "claim",
    ]);
  });
});

describe("verdictSentence", () => {
  it("says what the standing verdict means for the money", () => {
    expect(verdictSentence(mk({ status: "FINAL", verdict: "QUALIFIED", verified_impact: 460, judged_version: 1 })))
      .toBe("Qualified on evidence version 1. The lowest usable independent figure is 460 hectares, at or above the 90% threshold of 500 hectares.");
    expect(verdictSentence(mk({ status: "FINAL", verdict: "NOT_QUALIFIED", verified_impact: 300, judged_version: 1 })))
      .toMatch(/below the 90% threshold of 500 hectares, so the whole reward returns to the funder/);
    expect(verdictSentence(mk({ status: "FUNDED", verdict: "INCONCLUSIVE", hold_reason: "EVIDENCE_INSUFFICIENT", judged_version: 1 })))
      .toBe("Inconclusive on evidence version 1: the record does not establish the outcome for this region and period. Nothing moves.");
  });
  it("names a pending verdict as pending, not as state", () => {
    expect(verdictSentence(mk({ status: "PENDING_FINALITY", pending_version: 1 }))).toMatch(/recorded and pending its finality window/);
    expect(verdictSentence(mk({ status: "FUNDED" }))).toBe("No verdict yet.");
  });
});

describe("fundingMath — the arithmetic with the real numbers", () => {
  it("shows the settled split", () => {
    const ag = mk({
      status: "SETTLED", verdict: "QUALIFIED", verified_impact: 460, judged_version: 1,
      payout_atto: "46000000000000000", refund_atto: "4000000000000000",
    });
    expect(fundingMath(ag)).toBe("460 / 500 × 0.050 GEN = 0.046 GEN to the operator; 0.004 GEN returns to the funder.");
  });
  it("previews the same split while the verdict is FINAL", () => {
    expect(fundingMath(mk({ status: "FINAL", verdict: "QUALIFIED", verified_impact: 460, judged_version: 1 })))
      .toMatch(/^460 \/ 500 × 0\.050 GEN = 0\.046 GEN to the operator; 0\.004 GEN returns to the funder/);
  });
  it("says the whole reward returns on NOT_QUALIFIED and on reclaim", () => {
    expect(fundingMath(mk({ status: "SETTLED", verdict: "NOT_QUALIFIED", verified_impact: 300, judged_version: 1, refund_atto: REWARD })))
      .toBe("300 / 500 hectares is below the 90% threshold, so the whole 0.050 GEN returned to the funder.");
    expect(fundingMath(mk({ status: "RECLAIMED", refund_atto: REWARD }))).toMatch(/whole 0\.050 GEN returned to the funder/);
  });
  it("says nothing moves on a hold", () => {
    expect(fundingMath(mk({ status: "FUNDED", verdict: "INCONCLUSIVE", hold_reason: "UNCORROBORATED", judged_version: 1, evidence_version: 1 })))
      .toMatch(/^Nothing moves while the record is on hold: fewer independent publishers/);
  });
  it("states the rule before anything is judged", () => {
    expect(fundingMath(mk())).toMatch(/If funded, settlement pays verified \/ 500 × 0\.050 GEN/);
    expect(fundingMath(mk({ status: "FUNDED" }))).toMatch(/^0\.050 GEN is locked/);
  });
  it("formats counts with separators", () => {
    expect(formatCount(1_000_000)).toBe("1,000,000");
    expect(formatCount(0)).toBe("0");
  });
});

describe("nextAction — DRAFT", () => {
  const ag = mk();
  it("offers fund to anyone but the operator before the deadline, priced at the reward", () => {
    const a = nextAction(ag, viewer(STRANGER, DEADLINE - 3600));
    expect(a).toMatchObject({ kind: "fund", priceAtto: 50_000_000_000_000_000n });
    expect(a.why).toMatch(/exactly the maximum reward, 0\.050 GEN/);
    expect(kind(nextAction(ag, viewer(null, DEADLINE - 3600)))).toBe("fund");
  });
  it("offers the operator cancel, whatever the case of the address", () => {
    expect(kind(nextAction(ag, viewer(OPERATOR, DEADLINE - 3600)))).toBe("cancel");
    expect(kind(nextAction(ag, viewer(MIXED_OPERATOR, DEADLINE - 3600)))).toBe("cancel");
    expect(kind(nextAction(ag, viewer(MIXED_OPERATOR, DEADLINE + 3600)))).toBe("cancel");
  });
  it("offers a stranger nothing once the deadline has passed", () => {
    const a = nextAction(ag, viewer(STRANGER, DEADLINE + 1));
    expect(a.kind).toBe("none");
    expect(a.why).toMatch(/period that is over cannot be entered/);
  });
});

describe("nextAction — FUNDED", () => {
  const funded = mk({ status: "FUNDED", funder: FUNDER, funded_epoch: DEADLINE - 86_400 });
  const graceEnd = DEADLINE + GRACE;

  it("offers the operator submit before and after the deadline, inside the grace", () => {
    for (const t of [DEADLINE - 3600, DEADLINE + 3600, graceEnd]) {
      const a = nextAction(funded, viewer(OPERATOR, t));
      expect(a.kind, String(t)).toBe("submit");
      expect(a.why).toMatch(/File the evidence package/);
    }
  });
  it("tells a stranger to wait for the grace to end — the deadline opens nothing to them", () => {
    const early = nextAction(funded, viewer(STRANGER, DEADLINE - 1));
    expect(early).toMatchObject({ kind: "wait", until: graceEnd });
    expect(early.why).toMatch(/adjudication opens after the deadline 15 Jan 2027, 08:00 UTC/);
    expect(nextAction(funded, viewer(FUNDER, DEADLINE + 1))).toMatchObject({ kind: "wait", until: graceEnd });
    expect(nextAction(funded, viewer(null, DEADLINE + 1)).kind).toBe("wait");
  });
  it("offers reclaim to anyone after the grace with nothing judged or filed", () => {
    for (const who of [STRANGER, FUNDER, OPERATOR]) {
      const a = nextAction(funded, viewer(who, graceEnd + 1));
      expect(a.kind, who).toBe("reclaim");
      expect(a.why).toMatch(/return the 0\.050 GEN reward to the funder/);
    }
  });

  const filed = mk({ ...funded, evidence_version: 1, claimed_impact: 463, last_submit_epoch: DEADLINE + 60 });
  it("offers adjudicate to anyone once evidence is filed and the deadline passed", () => {
    for (const who of [STRANGER, FUNDER, OPERATOR, null]) {
      const a = nextAction(filed, viewer(who, DEADLINE + 120));
      expect(a.kind, String(who)).toBe("adjudicate");
      expect(a.why).toMatch(/Evidence version 1 is filed and unjudged/);
    }
  });
  it("prefers adjudicate over reclaim while an unjudged package waits, even past the grace", () => {
    expect(kind(nextAction(filed, viewer(STRANGER, graceEnd + 1)))).toBe("adjudicate");
    expect(kind(nextAction(filed, viewer(STRANGER, graceEnd + FINALITY + 1)))).toBe("adjudicate");
  });
  it("before the deadline a filed package may be replaced by the operator; others wait", () => {
    const early = mk({ ...filed, last_submit_epoch: DEADLINE - 7200 });
    expect(kind(nextAction(early, viewer(OPERATOR, DEADLINE - 3600)))).toBe("submit");
    expect(nextAction(early, viewer(STRANGER, DEADLINE - 3600))).toMatchObject({ kind: "wait", until: DEADLINE });
  });

  const held = mk({
    ...filed, judged_version: 1, verdict: "INCONCLUSIVE", hold_reason: "EVIDENCE_INSUFFICIENT",
    evidence_flag: "INSUFFICIENT", score: 4,
  });
  it("after an INCONCLUSIVE hold the operator may submit again, and the why names the hold", () => {
    const a = nextAction(held, viewer(OPERATOR, DEADLINE + 7200));
    expect(a.kind).toBe("submit");
    expect(a.why).toMatch(/held version 1: the record does not establish the outcome/);
    expect(nextAction(held, viewer(FUNDER, DEADLINE + 7200))).toMatchObject({ kind: "wait", until: graceEnd });
  });
  it("after the grace a held record is reclaimable by anyone", () => {
    expect(kind(nextAction(held, viewer(STRANGER, graceEnd + 1)))).toBe("reclaim");
    expect(kind(nextAction(held, viewer(OPERATOR, graceEnd + 1)))).toBe("reclaim");
  });
  it("a record at its fourth version cannot be replaced: the operator waits for the grace", () => {
    const full = mk({ ...held, evidence_version: 4, judged_version: 4 });
    expect(nextAction(full, viewer(OPERATOR, DEADLINE + 7200))).toMatchObject({ kind: "wait", until: graceEnd });
  });
});

describe("nextAction — PENDING_FINALITY", () => {
  const pending = mk({
    status: "PENDING_FINALITY", funder: FUNDER, evidence_version: 1, pending_version: 1,
    pending_until_epoch: DEADLINE + 120 + FINALITY,
  });
  it("waits for the finality window, then offers promote to anyone", () => {
    expect(nextAction(pending, viewer(STRANGER, pending.pending_until_epoch))).toMatchObject({ kind: "wait", until: pending.pending_until_epoch });
    for (const who of [STRANGER, FUNDER, OPERATOR]) {
      expect(kind(nextAction(pending, viewer(who, pending.pending_until_epoch + 1))), who).toBe("promote");
    }
  });
});

describe("nextAction — FINAL", () => {
  const finalAt = DEADLINE + 120 + FINALITY + 10;
  const final = mk({
    status: "FINAL", funder: FUNDER, evidence_version: 1, judged_version: 1,
    verdict: "QUALIFIED", verified_impact: 460, evidence_flag: "SUFFICIENT", score: 88,
    final_epoch: finalAt, challenge_until_epoch: finalAt + CHALLENGE,
  });

  it("offers a party challenge inside the window, priced at the bond; strangers wait", () => {
    for (const who of [OPERATOR, FUNDER]) {
      const a = nextAction(final, viewer(who, finalAt + 100));
      expect(a, who).toMatchObject({ kind: "challenge", priceAtto: 50_000_000_000_000_000n });
      expect(a.why).toMatch(/bond of exactly 0\.050 GEN/);
    }
    expect(nextAction(final, viewer(STRANGER, finalAt + 100))).toMatchObject({ kind: "wait", until: final.challenge_until_epoch });
    expect(nextAction(final, viewer(null, finalAt + 100)).kind).toBe("wait");
  });
  it("offers settle to anyone after the window, naming the split", () => {
    const a = nextAction(final, viewer(STRANGER, final.challenge_until_epoch + 1));
    expect(a.kind).toBe("settle");
    expect(a.why).toMatch(/0\.046 GEN to the operator's ledger/);
    const nq = mk({ ...final, verdict: "NOT_QUALIFIED", verified_impact: 300 });
    expect(nextAction(nq, viewer(FUNDER, final.challenge_until_epoch + 1)).why).toMatch(/whole 0\.050 GEN returns to the funder/);
  });
  it("a party at the fourth version cannot challenge again and waits for settlement", () => {
    const full = mk({ ...final, evidence_version: 4, judged_version: 4 });
    expect(nextAction(full, viewer(FUNDER, finalAt + 100))).toMatchObject({ kind: "wait", until: final.challenge_until_epoch });
  });

  const challenged = mk({
    ...final, challenge_open: true, challenger: FUNDER, challenged_version: 1,
    challenge_new_version: 2, evidence_version: 2, challenge_filed_epoch: finalAt + 100,
    challenge_grounds: "the satellite page states 500, not 460, for this block",
  });
  it("offers re_adjudicate to anyone while a challenge is fresh", () => {
    for (const who of [STRANGER, FUNDER, OPERATOR, null]) {
      const a = nextAction(challenged, viewer(who, finalAt + 200));
      expect(a.kind, String(who)).toBe("re_adjudicate");
      expect(a.why).toMatch(/recorded bytes of round 1/);
    }
    expect(kind(nextAction(challenged, viewer(STRANGER, challenged.challenge_filed_epoch + 3600)))).toBe("re_adjudicate");
  });
  it("offers lapse once the challenge is stale by an hour", () => {
    const a = nextAction(challenged, viewer(STRANGER, challenged.challenge_filed_epoch + 3601));
    expect(a.kind).toBe("lapse");
    expect(a.why).toMatch(/restored exactly and the bond returns/);
  });
  it("an open challenge blocks settlement even after the window", () => {
    expect(kind(nextAction(challenged, viewer(STRANGER, final.challenge_until_epoch + 10)))).toBe("lapse");
  });
});

describe("nextAction — terminal states and the ledger", () => {
  const settled = mk({
    status: "SETTLED", funder: FUNDER, verdict: "QUALIFIED", verified_impact: 460, judged_version: 1,
    evidence_version: 1, settled_epoch: DEADLINE + 3 * 86_400,
    payout_atto: "46000000000000000", refund_atto: "4000000000000000",
  });
  it("names the settlement and offers nothing", () => {
    const a = nextAction(settled, viewer(STRANGER, DEADLINE + 10 * 86_400));
    expect(a.kind).toBe("none");
    expect(a.why).toMatch(/0\.046 GEN to the operator and 0\.004 GEN to the funder/);
  });
  it("offers claim when nothing on the agreement is legal and the ledger holds a balance", () => {
    const a = nextAction(settled, viewer(OPERATOR, DEADLINE + 10 * 86_400, 46_000_000_000_000_000n));
    expect(a.kind).toBe("claim");
    expect(a.why).toMatch(/0\.046 GEN in the contract's ledger/);
    // a wait is also nothing legal now, so claim wins there too
    const funded = mk({ status: "FUNDED", funder: FUNDER });
    expect(kind(nextAction(funded, viewer(STRANGER, DEADLINE - 1, 1n)))).toBe("claim");
  });
  it("never lets the ledger displace a legal action on the agreement", () => {
    const funded = mk({ status: "FUNDED", funder: FUNDER });
    expect(kind(nextAction(funded, viewer(FUNDER, DEADLINE + GRACE + 1, 10n ** 18n)))).toBe("reclaim");
    expect(kind(nextAction(mk(), viewer(STRANGER, DEADLINE - 1, 10n ** 18n)))).toBe("fund");
  });
  it("never spells an enum or an em dash into a sentence a page shows", () => {
    const states: AgreementSummary[] = [
      mk(), mk({ status: "FUNDED", funder: FUNDER }),
      mk({ status: "FUNDED", funder: FUNDER, evidence_version: 1, judged_version: 1, verdict: "INCONCLUSIVE", hold_reason: "UNCORROBORATED" }),
      mk({ status: "PENDING_FINALITY", funder: FUNDER, pending_version: 1, pending_until_epoch: DEADLINE + 100 }),
      mk({ status: "FINAL", funder: FUNDER, verdict: "QUALIFIED", verified_impact: 460, judged_version: 1, evidence_version: 1, challenge_until_epoch: DEADLINE + 200 }),
      mk({ status: "FINAL", funder: FUNDER, verdict: "NOT_QUALIFIED", verified_impact: 300, judged_version: 1, evidence_version: 1, challenge_until_epoch: DEADLINE + 200, challenge_open: true, challenger: FUNDER, challenged_version: 1, challenge_filed_epoch: DEADLINE + 50 }),
      settled, mk({ status: "RECLAIMED", funder: FUNDER, refund_atto: REWARD, reclaimed_epoch: DEADLINE + 1 }),
      mk({ status: "CANCELLED", cancelled_epoch: DEADLINE - 100 }),
    ];
    const raw = /[A-Z]{3,}_[A-Z]|—|\bv\d\b/;
    for (const ag of states) {
      for (const who of [OPERATOR, FUNDER, STRANGER, null]) {
        for (const t of [DEADLINE - 3600, DEADLINE + 3600, DEADLINE + 10 * 86_400]) {
          expect(nextAction(ag, viewer(who, t)).why, `${ag.status} ${who} ${t}`).not.toMatch(raw);
        }
      }
      expect(verdictSentence(ag)).not.toMatch(raw);
      expect(deadlineSentence(ag)).not.toMatch(raw);
      expect(fundingMath(ag)).not.toMatch(raw);
    }
  });
  it("names reclaim and cancel as terminal", () => {
    const reclaimed = mk({ status: "RECLAIMED", funder: FUNDER, refund_atto: REWARD, reclaimed_epoch: DEADLINE + GRACE + 5 });
    expect(nextAction(reclaimed, viewer(FUNDER, DEADLINE + GRACE + 10))).toMatchObject({ kind: "none" });
    expect(nextAction(reclaimed, viewer(FUNDER, DEADLINE + GRACE + 10)).why).toMatch(/0\.050 GEN reward returned to the funder's ledger/);
    const cancelled = mk({ status: "CANCELLED", cancelled_epoch: DEADLINE - 100 });
    expect(nextAction(cancelled, viewer(OPERATOR, DEADLINE))).toMatchObject({ kind: "none" });
  });
});
