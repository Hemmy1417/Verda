"""Settlement and the exits: the settle walls and their boundaries (S24),
pro-rata arithmetic that sums to the reward exactly, the permissionless
reclaim (S17/S26), the claim choke point, and the S30 invariants — every
agreement's money is its own (S23), terminal states stay terminal, and the
ledger reconciles to escrow after every write."""

import json

import pytest

from conftest import (
    ASSESSOR_URL, BOND, DEADLINE_IN, FUNDER, OPERATOR, REWARD, STRANGER,
    TARGET, W, adjudicated, advance, agreement, answer, as_, conserve,
    demo_sources, dossier, drafted, err, final, funded, now, panel_says,
    panel_sequence, past_deadline, sent, settled,
)

FUNDER2 = "0x3333333333333333333333333333333333333333"
GROUNDS = "the satellite figure counts planted area, not canopy cover above 30 percent"

PAYOUT = 463 * REWARD // TARGET      # the default answer: 463 of 500 verified
REFUND = REWARD - PAYOUT


def not_qualified():
    # 400 of 500 is 80%; the agreed threshold is 90%
    return answer(figures={"EV-001": 400, "EV-002": 480})


def stats(c):
    return json.loads(c.get_stats())


def funded_by(module, c, who, **kw):
    """The conftest helpers hard-wire FUNDER; a second funder is drafted and
    funded by hand."""
    aid = drafted(module, c, **kw)
    as_(module, who, kw.get("reward", REWARD))
    c.fund(aid)
    return aid


def submit(module, c, aid, claimed=463):
    as_(module, OPERATOR, 0)
    c.submit_evidence(aid, claimed, json.dumps(demo_sources()))


def judge(module, c, aid, ans=None):
    """adjudicate then promote; the deadline must already have passed."""
    panel_says(ans or answer())
    as_(module, STRANGER, 0)
    c.adjudicate(aid)
    advance(W + 1)
    c.promote(aid)


# ── settle walls ─────────────────────────────────────────────────────────────

def test_settle_refused_in_every_state_before_final(module, c):
    E = err(module)
    aid = drafted(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in DRAFT"):
        c.settle(aid)
    aid = funded(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in FUNDED"):
        c.settle(aid)
    aid = adjudicated(module, c)
    with pytest.raises(E, match="nothing to settle in PENDING_FINALITY"):
        c.settle(aid)
    # the finality window lapsing does not make a verdict state — promote does
    advance(W + 1)
    with pytest.raises(E, match="nothing to settle in PENDING_FINALITY"):
        c.settle(aid)
    assert c.get_claimable(OPERATOR) == "0" and c.get_claimable(FUNDER) == "0"
    conserve(module, c)


def test_settle_refused_while_a_challenge_is_open_however_late(module, c):
    aid = final(module, c)
    as_(module, FUNDER, BOND)
    c.challenge(aid, GROUNDS, "", "")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="a challenge is open"):
        c.settle(aid)
    advance(10 * W)                      # past the challenge window and the stale window alike
    with pytest.raises(err(module), match="a challenge is open"):
        c.settle(aid)
    assert agreement(c, aid)["status"] == "FINAL"
    assert int(c.escrow_atto) == REWARD + BOND
    conserve(module, c)


def test_settle_window_boundary_refuses_now_equal_to_challenge_until(module, c):
    aid = final(module, c)
    until = agreement(c, aid)["challenge_until_epoch"]
    advance(until - now())
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="challenge window is still open"):
        c.settle(aid)
    assert agreement(c, aid)["status"] == "FINAL"
    assert c.get_claimable(OPERATOR) == "0"
    advance(1)
    out = json.loads(c.settle(aid))
    assert out == {"verdict": "QUALIFIED", "payout_atto": str(PAYOUT),
                   "refund_atto": str(REFUND)}
    ag = agreement(c, aid)
    assert ag["status"] == "SETTLED" and ag["settled_epoch"] == now()
    conserve(module, c)


def test_double_settle_refused_and_allocates_nothing_twice(module, c):
    aid = settled(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing to settle in SETTLED"):
        c.settle(aid)
    assert c.get_claimable(OPERATOR) == str(PAYOUT)
    assert c.get_claimable(FUNDER) == str(REFUND)
    assert stats(c)["settled"] == 1 and stats(c)["paid_atto"] == str(PAYOUT)
    conserve(module, c)


def test_inconclusive_hold_never_reaches_settle(module, c):
    # one independent publisher on the record, two required -> UNCORROBORATED
    aid = adjudicated(module, c, min_independent=2)
    assert dossier(c, aid, 1)["verdict"] == "INCONCLUSIVE"
    assert dossier(c, aid, 1)["hold_reason"] == "UNCORROBORATED"
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(aid) == "inconclusive"
    ag = agreement(c, aid)
    assert ag["status"] == "FUNDED" and ag["verdict"] == "INCONCLUSIVE"
    assert ag["verified_impact"] == 0
    with pytest.raises(err(module), match="nothing to settle in FUNDED"):
        c.settle(aid)
    advance(10 * W)
    with pytest.raises(err(module), match="nothing to settle in FUNDED"):
        c.settle(aid)
    assert c.get_claimable(OPERATOR) == "0" and c.get_claimable(FUNDER) == "0"
    assert int(c.escrow_atto) == REWARD
    conserve(module, c)


def test_depth_guards_refuse_a_final_whose_verdict_is_not_conclusive_and_sufficient(module, c):
    """White-box: promote() never produces such a FINAL, so these guards are
    reached only by tampering with storage — and they must still hold."""
    aid = final(module, c)
    advance(W + 1)
    ag = c.agreements[aid]
    as_(module, STRANGER, 0)
    ag.verdict = "INCONCLUSIVE"
    with pytest.raises(err(module), match="no conclusive verdict stands"):
        c.settle(aid)
    ag.verdict = "QUALIFIED"
    ag.evidence_flag = "PARTIAL"
    with pytest.raises(err(module), match="insufficient record cannot settle"):
        c.settle(aid)
    assert agreement(c, aid)["status"] == "FINAL"
    assert c.get_claimable(OPERATOR) == "0" and c.get_claimable(FUNDER) == "0"
    conserve(module, c)


# ── settle arithmetic ────────────────────────────────────────────────────────

def test_settle_pays_verified_over_target_and_refunds_the_remainder(module, c):
    aid = settled(module, c)
    ag = agreement(c, aid)
    assert ag["verdict"] == "QUALIFIED" and ag["verified_impact"] == 463
    assert ag["payout_atto"] == str(PAYOUT) and ag["refund_atto"] == str(REFUND)
    assert c.get_claimable(OPERATOR) == str(PAYOUT)
    assert c.get_claimable(FUNDER) == str(REFUND)
    assert PAYOUT + REFUND == REWARD
    # settlement allocates; nothing has left the contract yet
    assert int(c.escrow_atto) == REWARD
    assert stats(c) == {"agreements": 1, "funded": 1, "settled": 1,
                        "qualified": 1, "paid_atto": str(PAYOUT),
                        "escrow_atto": str(REWARD)}
    conserve(module, c)


def test_rounding_floors_the_payout_and_the_refund_takes_the_remainder(module, c):
    aid = settled(module, c, target=3, threshold=5_000, claimed=2,
                  ans=answer(figures={"EV-001": 2, "EV-002": 3}))
    ag = agreement(c, aid)
    assert ag["verified_impact"] == 2
    payout = 2 * REWARD // 3
    assert payout * 3 != 2 * REWARD          # the division does not come out even
    assert ag["payout_atto"] == str(payout) == "66666666666666666"
    assert ag["refund_atto"] == str(REWARD - payout) == "33333333333333334"
    assert int(c.get_claimable(OPERATOR)) + int(c.get_claimable(FUNDER)) == REWARD
    conserve(module, c)


def test_full_target_pays_the_whole_reward_and_leaves_the_funder_nothing(module, c):
    aid = settled(module, c, claimed=500,
                  ans=answer(figures={"EV-001": 500, "EV-002": 500}))
    ag = agreement(c, aid)
    assert ag["verified_impact"] == TARGET
    assert ag["payout_atto"] == str(REWARD) and ag["refund_atto"] == "0"
    assert c.get_claimable(OPERATOR) == str(REWARD)
    assert c.get_claimable(FUNDER) == "0"
    as_(module, FUNDER, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    as_(module, OPERATOR, 0)
    c.claim()
    assert sent() == [(OPERATOR, REWARD)]
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_not_qualified_returns_the_whole_reward_to_the_funder(module, c):
    aid = settled(module, c, ans=not_qualified())
    ag = agreement(c, aid)
    assert ag["status"] == "SETTLED" and ag["verdict"] == "NOT_QUALIFIED"
    assert ag["verified_impact"] == 400
    assert ag["payout_atto"] == "0" and ag["refund_atto"] == str(REWARD)
    assert c.get_claimable(OPERATOR) == "0"
    assert c.get_claimable(FUNDER) == str(REWARD)
    s = stats(c)
    assert s["settled"] == 1 and s["qualified"] == 0 and s["paid_atto"] == "0"
    as_(module, OPERATOR, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    conserve(module, c)


def test_settle_is_permissionless(module, c):
    aid = final(module, c)
    advance(W + 1)
    as_(module, STRANGER, 0)
    out = json.loads(c.settle(aid))
    assert out["verdict"] == "QUALIFIED"
    assert agreement(c, aid)["status"] == "SETTLED"
    conserve(module, c)


def test_payout_helper_floors_and_caps(module):
    p = module._payout_atto
    assert p(0, TARGET, REWARD) == 0
    assert p(463, TARGET, REWARD) == 463 * REWARD // TARGET
    assert p(TARGET, TARGET, REWARD) == REWARD
    assert p(TARGET + 1, TARGET, REWARD) == REWARD
    assert p(2, 3, REWARD) == 2 * REWARD // 3


# ── reclaim ──────────────────────────────────────────────────────────────────

def test_reclaim_waits_for_the_grace_boundary_then_credits_the_funder_in_full(module, c):
    aid = funded(module, c)
    ag = agreement(c, aid)
    grace_end = ag["deadline_epoch"] + ag["submission_grace"]
    advance(grace_end - now())
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=f"submission grace runs until {grace_end}"):
        c.reclaim(aid)
    assert agreement(c, aid)["status"] == "FUNDED"
    conserve(module, c)
    advance(1)
    out = json.loads(c.reclaim(aid))
    assert out == {"refund_atto": str(REWARD)}
    ag = agreement(c, aid)
    assert ag["status"] == "RECLAIMED" and ag["reclaimed_epoch"] == now()
    assert ag["refund_atto"] == str(REWARD) and ag["payout_atto"] == "0"
    assert c.get_claimable(FUNDER) == str(REWARD)
    assert c.get_claimable(OPERATOR) == "0"
    assert stats(c)["settled"] == 0 and stats(c)["escrow_atto"] == str(REWARD)
    conserve(module, c)
    as_(module, FUNDER, 0)
    c.claim()
    assert sent() == [(FUNDER, REWARD)]
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_reclaim_waits_for_an_unjudged_submission_to_have_its_finality_window(module, c):
    aid = funded(module, c)
    advance(1_500)                                   # after the deadline, inside the grace
    submit(module, c, aid)
    patience_end = now() + W
    ag = agreement(c, aid)
    grace_end = ag["deadline_epoch"] + ag["submission_grace"]
    advance(grace_end + 1 - now())
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=f"unjudged submission.*reclaim after {patience_end}"):
        c.reclaim(aid)
    advance(patience_end - now())
    with pytest.raises(err(module), match="unjudged submission"):
        c.reclaim(aid)
    assert agreement(c, aid)["status"] == "FUNDED"
    conserve(module, c)
    advance(1)
    c.reclaim(aid)
    assert agreement(c, aid)["status"] == "RECLAIMED"
    assert c.get_claimable(FUNDER) == str(REWARD)
    conserve(module, c)


def test_reclaim_after_an_inconclusive_hold_once_the_grace_has_passed(module, c):
    aid = adjudicated(module, c, ans=answer(evidence="PARTIAL"))
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing to reclaim in PENDING_FINALITY"):
        c.reclaim(aid)
    advance(W + 1)
    assert c.promote(aid) == "inconclusive"
    ag = agreement(c, aid)
    assert ag["status"] == "FUNDED" and ag["hold_reason"] == "EVIDENCE_INSUFFICIENT"
    assert ag["judged_version"] == ag["evidence_version"] == 1
    assert now() > ag["deadline_epoch"] + ag["submission_grace"]
    out = json.loads(c.reclaim(aid))
    assert out == {"refund_atto": str(REWARD)}
    ag = agreement(c, aid)
    assert ag["status"] == "RECLAIMED" and ag["verdict"] == "INCONCLUSIVE"
    assert c.get_claimable(FUNDER) == str(REWARD)
    assert c.get_claimable(OPERATOR) == "0"
    conserve(module, c)


def test_reclaim_after_an_inconclusive_hold_waits_for_the_grace_and_a_resubmission(module, c):
    aid = adjudicated(module, c, ans=answer(evidence="PARTIAL"), grace=5_000)
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(aid) == "inconclusive"
    ag = agreement(c, aid)
    grace_end = ag["deadline_epoch"] + ag["submission_grace"]
    with pytest.raises(err(module), match=f"submission grace runs until {grace_end}"):
        c.reclaim(aid)
    # a second version filed late in the grace earns its own finality window
    # before the funder can pull the money
    advance(grace_end - 100 - now())
    submit(module, c, aid)
    assert agreement(c, aid)["evidence_version"] == 2
    patience_end = now() + W
    advance(grace_end + 1 - now())
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=f"reclaim after {patience_end}"):
        c.reclaim(aid)
    advance(patience_end - now())
    with pytest.raises(err(module), match="unjudged submission"):
        c.reclaim(aid)
    advance(1)
    c.reclaim(aid)
    assert agreement(c, aid)["status"] == "RECLAIMED"
    assert c.get_claimable(FUNDER) == str(REWARD)
    conserve(module, c)


def test_reclaim_refused_in_draft_final_settled_and_during_a_challenge(module, c):
    E = err(module)
    aid = drafted(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to reclaim in DRAFT"):
        c.reclaim(aid)
    aid = final(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to reclaim in FINAL"):
        c.reclaim(aid)
    as_(module, FUNDER, BOND)
    c.challenge(aid, GROUNDS, "", "")
    advance(10 * W)                                  # grace and windows long gone; the challenge still governs
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to reclaim in FINAL"):
        c.reclaim(aid)
    conserve(module, c)
    aid = settled(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to reclaim in SETTLED"):
        c.reclaim(aid)
    conserve(module, c)


# ── claim ────────────────────────────────────────────────────────────────────

def test_claim_refused_with_nothing_on_the_ledger(module, c):
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    settled(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    assert sent() == []
    assert int(c.escrow_atto) == REWARD
    conserve(module, c)


def test_claim_zeroes_the_ledger_emits_the_transfer_and_refuses_a_second_time(module, c):
    settled(module, c)
    as_(module, OPERATOR, 0)
    out = json.loads(c.claim())
    assert out == {"claimed_atto": str(PAYOUT)}
    assert sent() == [(OPERATOR, PAYOUT)]
    assert c.get_claimable(OPERATOR) == "0"
    assert int(c.escrow_atto) == REWARD - PAYOUT
    conserve(module, c)
    with pytest.raises(err(module), match="nothing claimable"):
        c.claim()
    assert sent() == [(OPERATOR, PAYOUT)]
    # the funder's remainder is untouched by the operator's claim
    assert c.get_claimable(FUNDER) == str(REFUND)
    conserve(module, c)


def test_both_parties_claims_drain_escrow_to_exactly_zero(module, c):
    settled(module, c)
    as_(module, OPERATOR, 0)
    c.claim()
    as_(module, FUNDER, 0)
    c.claim()
    assert sent() == [(OPERATOR, PAYOUT), (FUNDER, REFUND)]
    assert sum(v for _, v in sent()) == REWARD
    assert int(c.escrow_atto) == 0
    assert c.get_claimable(OPERATOR) == "0" and c.get_claimable(FUNDER) == "0"
    conserve(module, c)


# ── S30 invariants ───────────────────────────────────────────────────────────

def test_two_funders_two_agreements_settle_independently(module, c):
    aid_a = funded(module, c)
    aid_b = funded_by(module, c, FUNDER2)
    assert int(c.escrow_atto) == 2 * REWARD
    submit(module, c, aid_a)
    submit(module, c, aid_b)
    past_deadline()
    as_(module, STRANGER, 0)
    panel_says(answer())
    c.adjudicate(aid_a)
    panel_says(not_qualified())
    c.adjudicate(aid_b)
    conserve(module, c)
    advance(W + 1)
    c.promote(aid_a)
    c.promote(aid_b)
    advance(W + 1)
    c.settle(aid_a)
    conserve(module, c)
    assert c.get_claimable(FUNDER2) == "0"         # B's funder is untouched by A's settlement
    c.settle(aid_b)
    conserve(module, c)
    a, b = agreement(c, aid_a), agreement(c, aid_b)
    assert a["verdict"] == "QUALIFIED" and a["payout_atto"] == str(PAYOUT)
    assert a["refund_atto"] == str(REFUND)
    assert b["verdict"] == "NOT_QUALIFIED" and b["payout_atto"] == "0"
    assert b["refund_atto"] == str(REWARD)
    assert c.get_claimable(OPERATOR) == str(PAYOUT)
    assert c.get_claimable(FUNDER) == str(REFUND)
    assert c.get_claimable(FUNDER2) == str(REWARD)
    assert stats(c) == {"agreements": 2, "funded": 2, "settled": 2,
                        "qualified": 1, "paid_atto": str(PAYOUT),
                        "escrow_atto": str(2 * REWARD)}
    for who in (OPERATOR, FUNDER, FUNDER2):
        as_(module, who, 0)
        c.claim()
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_post_terminal_actions_are_all_refused(module, c):
    E = err(module)
    aid_s = settled(module, c)
    aid_r = funded(module, c)
    advance(DEADLINE_IN + W + 1)
    as_(module, STRANGER, 0)
    c.reclaim(aid_r)
    aid_c = drafted(module, c)
    as_(module, OPERATOR, 0)
    c.cancel_draft(aid_c)
    conserve(module, c)

    as_(module, FUNDER, BOND)
    with pytest.raises(E, match="nothing challengeable in SETTLED"):
        c.challenge(aid_s, GROUNDS, "", "")
    as_(module, OPERATOR, 0)
    with pytest.raises(E, match="this one is RECLAIMED"):
        c.submit_evidence(aid_r, 463, json.dumps(demo_sources()))
    as_(module, FUNDER, REWARD)
    with pytest.raises(E, match="nothing to fund in CANCELLED"):
        c.fund(aid_c)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="nothing to settle in SETTLED"):
        c.settle(aid_s)
    with pytest.raises(E, match="nothing to settle in RECLAIMED"):
        c.settle(aid_r)
    with pytest.raises(E, match="nothing to settle in CANCELLED"):
        c.settle(aid_c)
    with pytest.raises(E, match="nothing to reclaim in SETTLED"):
        c.reclaim(aid_s)
    with pytest.raises(E, match="nothing to reclaim in RECLAIMED"):
        c.reclaim(aid_r)
    with pytest.raises(E, match="not RECLAIMED"):
        c.adjudicate(aid_r)
    with pytest.raises(E, match="nothing is pending finality"):
        c.promote(aid_s)
    with pytest.raises(E, match="no challenge is open"):
        c.re_adjudicate(aid_s)
    as_(module, OPERATOR, 0)
    with pytest.raises(E, match="this one is SETTLED"):
        c.cancel_draft(aid_s)

    assert [agreement(c, a)["status"] for a in (aid_s, aid_r, aid_c)] == [
        "SETTLED", "RECLAIMED", "CANCELLED"]
    assert int(c.escrow_atto) == 2 * REWARD
    assert stats(c)["funded"] == 2 and stats(c)["settled"] == 1
    conserve(module, c)
    # the ledger is the one thing a terminal state leaves open
    as_(module, FUNDER, 0)
    c.claim()
    assert sent() == [(FUNDER, REFUND + REWARD)]
    conserve(module, c)


def test_a_lost_bond_a_payout_and_a_refund_reconcile_to_escrow_at_every_step(module, c):
    aid = final(module, c)
    as_(module, FUNDER, BOND)
    c.challenge(aid, GROUNDS, "", "")
    assert int(c.escrow_atto) == REWARD + BOND
    conserve(module, c)                                  # the bond is undecided, nobody's yet
    panel_says(answer())                                 # the same readings: the challenge fails
    as_(module, STRANGER, 0)
    out = json.loads(c.re_adjudicate(aid))
    assert out["bond_returned"] is False
    assert c.get_claimable(OPERATOR) == str(BOND)
    assert c.get_claimable(FUNDER) == "0"
    assert agreement(c, aid)["challenge_open"] is False
    conserve(module, c)                                  # the bond moved to the ledger
    advance(W + 1)
    c.promote(aid)
    conserve(module, c)
    advance(W + 1)
    c.settle(aid)
    assert c.get_claimable(OPERATOR) == str(BOND + PAYOUT)
    assert c.get_claimable(FUNDER) == str(REFUND)
    assert int(c.escrow_atto) == REWARD + BOND
    conserve(module, c)
    as_(module, OPERATOR, 0)
    c.claim()
    assert int(c.escrow_atto) == REFUND
    conserve(module, c)
    as_(module, FUNDER, 0)
    c.claim()
    assert int(c.escrow_atto) == 0
    assert sent() == [(OPERATOR, BOND + PAYOUT), (FUNDER, REFUND)]
    conserve(module, c)


def test_a_failed_challenge_round_writes_nothing_and_keeps_settlement_blocked(module, c):
    aid = final(module, c)
    as_(module, FUNDER, BOND)
    c.challenge(aid, GROUNDS, ASSESSOR_URL, "Independent field audit")
    conserve(module, c)
    # leader reads 460 on the new source, validator reads 400: the derived
    # verdicts differ, the validator refuses, and the round is void
    panel_sequence(answer(figures={"EV-001": 463, "EV-002": 480, "EV-003": 460}),
                   answer(figures={"EV-001": 463, "EV-002": 480, "EV-003": 400}))
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=r"^\[LLM_ERROR\]"):
        c.re_adjudicate(aid)
    assert dossier(c, aid, 2) is None
    ag = agreement(c, aid)
    assert ag["status"] == "FINAL" and ag["challenge_open"] is True
    assert c.get_claimable(OPERATOR) == "0" and c.get_claimable(FUNDER) == "0"
    assert int(c.escrow_atto) == REWARD + BOND
    conserve(module, c)
    advance(W + 1)
    with pytest.raises(err(module), match="a challenge is open"):
        c.settle(aid)
    # anyone retries the round; a changed figure returns the bond
    panel_says(answer(figures={"EV-001": 463, "EV-002": 480, "EV-003": 460}))
    out = json.loads(c.re_adjudicate(aid))
    assert out["verified_impact"] == 460 and out["bond_returned"] is True
    assert c.get_claimable(FUNDER) == str(BOND)
    conserve(module, c)
    advance(W + 1)
    c.promote(aid)
    advance(W + 1)
    c.settle(aid)
    payout = 460 * REWARD // TARGET
    assert c.get_claimable(OPERATOR) == str(payout)
    assert c.get_claimable(FUNDER) == str(BOND + REWARD - payout)
    conserve(module, c)
    as_(module, OPERATOR, 0)
    c.claim()
    as_(module, FUNDER, 0)
    c.claim()
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_funding_is_per_agreement_settling_b_never_reaches_a(module, c):
    aid_a = funded(module, c)                            # FUNDER's deposit, never submitted
    aid_b = funded_by(module, c, FUNDER2)
    submit(module, c, aid_b)
    past_deadline()
    judge(module, c, aid_b)
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(aid_b)
    conserve(module, c)
    a = agreement(c, aid_a)
    assert a["status"] == "FUNDED"
    assert a["payout_atto"] == "0" and a["refund_atto"] == "0"
    assert c.get_claimable(FUNDER) == "0"
    assert c.get_claimable(OPERATOR) == str(PAYOUT)
    assert c.get_claimable(FUNDER2) == str(REFUND)
    assert int(c.escrow_atto) == REWARD + PAYOUT + REFUND
    as_(module, OPERATOR, 0)
    c.claim()
    as_(module, FUNDER2, 0)
    c.claim()
    # what remains is exactly A's deposit, still locked
    assert int(c.escrow_atto) == REWARD == int(a["max_reward_atto"])
    conserve(module, c)
    as_(module, STRANGER, 0)
    c.reclaim(aid_a)
    assert c.get_claimable(FUNDER) == str(REWARD)
    as_(module, FUNDER, 0)
    c.claim()
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_stats_shape_and_counters_through_a_full_arc(module, c):
    zero = {"agreements": 0, "funded": 0, "settled": 0, "qualified": 0,
            "paid_atto": "0", "escrow_atto": "0"}
    assert stats(c) == zero
    aid = drafted(module, c)
    assert stats(c) == {**zero, "agreements": 1}
    as_(module, FUNDER, REWARD)
    c.fund(aid)
    after_fund = {**zero, "agreements": 1, "funded": 1, "escrow_atto": str(REWARD)}
    assert stats(c) == after_fund
    submit(module, c, aid)
    past_deadline()
    judge(module, c, aid)
    assert stats(c) == after_fund                        # a verdict moves no counter
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(aid)
    assert stats(c) == {**after_fund, "settled": 1, "qualified": 1,
                        "paid_atto": str(PAYOUT)}
    as_(module, OPERATOR, 0)
    c.claim()
    assert stats(c)["escrow_atto"] == str(REFUND)
    as_(module, FUNDER, 0)
    c.claim()
    assert stats(c) == {**after_fund, "settled": 1, "qualified": 1,
                        "paid_atto": str(PAYOUT), "escrow_atto": "0"}
    conserve(module, c)


def test_escrow_tracks_deposits_minus_claims_exactly(module, c):
    deposits = 0

    def check():
        assert int(c.escrow_atto) == deposits - sum(v for _, v in sent())
        conserve(module, c)

    aid_a = funded(module, c)
    deposits += REWARD
    check()
    aid_b = funded_by(module, c, FUNDER2)
    deposits += REWARD
    check()
    submit(module, c, aid_b)
    past_deadline()
    judge(module, c, aid_b)
    check()
    as_(module, FUNDER2, BOND)
    c.challenge(aid_b, GROUNDS, "", "")
    deposits += BOND
    check()
    panel_says(answer())
    as_(module, STRANGER, 0)
    c.re_adjudicate(aid_b)                               # unchanged: the bond goes to the operator
    check()
    advance(W + 1)
    c.promote(aid_b)
    advance(W + 1)
    c.settle(aid_b)
    check()
    as_(module, OPERATOR, 0)
    c.claim()
    check()
    as_(module, FUNDER2, 0)
    c.claim()
    check()
    assert int(c.escrow_atto) == REWARD                  # A's deposit alone
    as_(module, STRANGER, 0)
    c.reclaim(aid_a)
    check()
    as_(module, FUNDER, 0)
    c.claim()
    check()
    assert int(c.escrow_atto) == 0
    assert sum(v for _, v in sent()) == deposits
