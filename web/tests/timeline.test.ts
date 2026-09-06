/**
 * lib/timeline.ts derives the activity timeline from the epochs the contract
 * recorded. The fixtures walk the lifecycle the way the live probe did
 * (draft, fund, file, judge inconclusive, reclaim) and the way the arc does
 * (judge qualified, promote, challenge, settle).
 */
import { describe, expect, it } from "vitest";
import { timeline } from "@/lib/timeline";
import type { AgreementSummary, Dossier } from "@/lib/types";

const OPERATOR = "0x86ddeafc53b2e194aad4d74d265ab7cb741118b5";
const FUNDER = "0x57a7dc8ea2d2de0a5906eb28902b8d677dfc657c";

/** The live vrd-000001 record on the preliminary contract, verbatim. */
const LIVE: AgreementSummary = {
  agreement_id: "vrd-000001",
  operator: OPERATOR,
  funder: FUNDER,
  status: "RECLAIMED",
  title: "Rio Verde restoration (probe)",
  region: "Para, Brazil",
  metric: "hectares of degraded forest restored",
  unit: "hectares",
  target: 500,
  threshold_bps: 9000,
  min_independent: 1,
  max_reward_atto: "50000000000000000",
  challenge_bond_atto: "50000000000000000",
  terms_sha256: "1d3856d5ff75a08c2db1e45300ea8a87bbb915dd3239e7a944594e9ede4703c4",
  deadline_epoch: 1788616339,
  submission_grace: 900,
  finality_window: 900,
  challenge_window: 900,
  created_epoch: 1788613953,
  funded_epoch: 1788614062,
  evidence_version: 1,
  evidence_root: "c5f92b84e583432dd6d058227a66300226529653e726032f5330a50752a4df96",
  last_submit_epoch: 1788614123,
  claimed_impact: 463,
  judged_version: 1,
  pending_version: 0,
  pending_until_epoch: 0,
  verdict: "INCONCLUSIVE",
  verified_impact: 0,
  score: 4,
  evidence_flag: "INSUFFICIENT",
  hold_reason: "EVIDENCE_INSUFFICIENT",
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
  refund_atto: "50000000000000000",
  reclaimed_epoch: 1788634271,
  cancelled_epoch: 0,
};

const LIVE_DOSSIER: Dossier = {
  dossier_id: "vrd-000001-d1",
  agreement_id: "vrd-000001",
  evidence_version: 1,
  evidence_root: LIVE.evidence_root,
  round_kind: "ADJUDICATION",
  reconsidered_round: 0,
  observed_epoch: 1788632857,
  target: 500,
  threshold_bps: 9000,
  min_independent: 1,
  claimed_impact: 463,
  verdict: "INCONCLUSIVE",
  verified_impact: 0,
  hold_reason: "EVIDENCE_INSUFFICIENT",
  score: 4,
  evidence_flag: "INSUFFICIENT",
  conflicts: ["SOURCE_MISLABELLED"],
  reason: "EV-001 and EV-002 are not evidence about this project.",
  rows: [],
};

const NOW = 1788700000;

describe("timeline — the live probe record", () => {
  const events = timeline(LIVE, [LIVE_DOSSIER], NOW);

  it("lists what happened, in order, with no boundaries left on a terminal record", () => {
    expect(events.map((e) => e.key)).toEqual(["drafted", "funded", "filed", "judged-1", "reclaimed"]);
    expect(events.every((e) => !e.boundary)).toBe(true);
    expect(events.every((e) => !e.future)).toBe(true);
    for (let i = 1; i < events.length; i++) expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
  });
  it("spells every detail in words with the real numbers", () => {
    const by = Object.fromEntries(events.map((e) => [e.key, e]));
    expect(by.drafted.detail).toBe("The operator drafted the agreement: 500 hectares promised for at most 0.050 GEN.");
    expect(by.funded.detail).toMatch(/deposited exactly 0\.050 GEN/);
    expect(by.filed.title).toBe("Evidence filed");
    expect(by.filed.detail).toBe("Version 1, claiming 463 hectares.");
    expect(by["judged-1"].title).toBe("Judged on version 1");
    expect(by["judged-1"].detail).toBe(
      "The panel read every source itself. Inconclusive: the record does not establish the outcome for this region and period.",
    );
    expect(by.reclaimed.detail).toMatch(/^0\.050 GEN returned to the funder's ledger/);
    for (const e of events) {
      expect(e.title + e.detail).not.toMatch(/[A-Z]{3,}_[A-Z]|—/);
    }
  });
});

describe("timeline — boundaries while the record is moving", () => {
  it("a funded agreement before its deadline shows the deadline and the grace end ahead", () => {
    const ag: AgreementSummary = { ...LIVE, status: "FUNDED", evidence_version: 0, judged_version: 0, verdict: "", hold_reason: "", evidence_flag: "", last_submit_epoch: 0, reclaimed_epoch: 0, refund_atto: "0" };
    const now = LIVE.funded_epoch + 10;
    const events = timeline(ag, [], now);
    expect(events.map((e) => e.key)).toEqual(["drafted", "funded", "deadline", "grace"]);
    const deadline = events.find((e) => e.key === "deadline")!;
    expect(deadline.boundary).toBe(true);
    expect(deadline.future).toBe(true);
    expect(deadline.detail).toBe("Adjudication opens after it.");
    expect(events.find((e) => e.key === "grace")!.at).toBe(LIVE.deadline_epoch + 900);
  });
  it("a draft says funding closes at the deadline and has no grace boundary", () => {
    const ag: AgreementSummary = { ...LIVE, status: "DRAFT", funder: "", funded_epoch: 0, evidence_version: 0, judged_version: 0, verdict: "", hold_reason: "", evidence_flag: "", last_submit_epoch: 0, reclaimed_epoch: 0, refund_atto: "0" };
    const events = timeline(ag, [], LIVE.created_epoch + 5);
    expect(events.map((e) => e.key)).toEqual(["drafted", "deadline"]);
    expect(events[1].detail).toBe("Funding closes at it; adjudication opens after it.");
  });
  it("a pending verdict shows the finality window as a boundary", () => {
    const ag: AgreementSummary = { ...LIVE, status: "PENDING_FINALITY", pending_version: 1, pending_until_epoch: LIVE_DOSSIER.observed_epoch + 900, judged_version: 0, verdict: "", hold_reason: "", reclaimed_epoch: 0, refund_atto: "0" };
    const events = timeline(ag, [LIVE_DOSSIER], LIVE_DOSSIER.observed_epoch + 10);
    const keys = events.map((e) => e.key);
    expect(keys).toContain("finality");
    expect(keys).not.toContain("grace");
    expect(events.find((e) => e.key === "finality")!.future).toBe(true);
  });
  it("a qualified verdict, promoted, challenged and settled reads as a story", () => {
    const finalAt = LIVE_DOSSIER.observed_epoch + 1000;
    const d1: Dossier = { ...LIVE_DOSSIER, verdict: "QUALIFIED", verified_impact: 460, hold_reason: "", evidence_flag: "SUFFICIENT", score: 88, conflicts: [] };
    const d2: Dossier = { ...d1, evidence_version: 2, round_kind: "RE_ADJUDICATION", reconsidered_round: 1, observed_epoch: finalAt + 500, verified_impact: 455 };
    const ag: AgreementSummary = {
      ...LIVE, status: "SETTLED", verdict: "QUALIFIED", verified_impact: 455, judged_version: 2, evidence_version: 2,
      hold_reason: "", evidence_flag: "SUFFICIENT", final_epoch: finalAt + 2000, challenge_until_epoch: finalAt + 2900,
      challenger: FUNDER, challenged_version: 1, challenge_new_version: 2, challenge_filed_epoch: finalAt + 100,
      settled_epoch: finalAt + 4000, payout_atto: "45500000000000000", refund_atto: "4500000000000000",
      reclaimed_epoch: 0,
    };
    const events = timeline(ag, [d1, d2], finalAt + 5000);
    expect(events.map((e) => e.key)).toEqual(["drafted", "funded", "filed", "judged-1", "challenged", "judged-2", "promoted", "settled"]);
    const by = Object.fromEntries(events.map((e) => [e.key, e]));
    expect(by["judged-1"].detail).toBe("The panel read every source itself. Qualified, 460 hectares verified.");
    expect(by.challenged.detail).toBe("Filed by the funder with a 0.050 GEN bond against the verdict on version 1.");
    expect(by["judged-2"].title).toBe("Re-judged on version 2");
    expect(by["judged-2"].detail).toMatch(/^The second panel re-read the recorded bytes of round 1\. Qualified, 455 hectares verified\.$/);
    expect(by.promoted.detail).toMatch(/^Qualified became the agreement's state/);
    expect(by.settled.detail).toBe("0.045 GEN to the operator and 0.004 GEN to the funder, each claimable from their ledger.");
  });
  it("an open challenge shows the stale boundary and names re-adjudication", () => {
    const finalAt = LIVE_DOSSIER.observed_epoch + 1000;
    const ag: AgreementSummary = {
      ...LIVE, status: "FINAL", verdict: "QUALIFIED", verified_impact: 460, judged_version: 1, evidence_version: 2,
      hold_reason: "", evidence_flag: "SUFFICIENT", final_epoch: finalAt, challenge_until_epoch: finalAt + 900,
      challenge_open: true, challenger: OPERATOR, challenged_version: 1, challenge_new_version: 2,
      challenge_filed_epoch: finalAt + 100, reclaimed_epoch: 0, refund_atto: "0",
    };
    const events = timeline(ag, [], finalAt + 200);
    const keys = events.map((e) => e.key);
    expect(keys).toContain("stale");
    expect(keys).not.toContain("window");
    const ch = events.find((e) => e.key === "challenged")!;
    expect(ch.detail).toMatch(/^Filed by the operator .* Re-adjudication is open to anyone\.$/);
    expect(events.find((e) => e.key === "stale")!.at).toBe(finalAt + 100 + 3600);
  });
  it("a final verdict with no challenge shows the window closing", () => {
    const finalAt = LIVE_DOSSIER.observed_epoch + 1000;
    const ag: AgreementSummary = {
      ...LIVE, status: "FINAL", verdict: "NOT_QUALIFIED", verified_impact: 300, judged_version: 1,
      hold_reason: "", evidence_flag: "SUFFICIENT", final_epoch: finalAt, challenge_until_epoch: finalAt + 900,
      reclaimed_epoch: 0, refund_atto: "0",
    };
    const events = timeline(ag, [], finalAt + 10);
    expect(events.at(-1)).toMatchObject({ key: "window", boundary: true, future: true, detail: "Anyone may settle after it." });
  });
});
