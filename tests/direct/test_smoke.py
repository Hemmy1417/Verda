"""The spine, end to end, before anything else: draft → fund → submit →
adjudicate → promote → settle → claim, plus the challenge round reading the
recorded snapshot. If this file is red, nothing else is worth reading."""

import json

from conftest import (
    ASSESSOR_URL, BOND, FUNDER, OPERATOR, REWARD, SAT_URL, STRANGER, TARGET, W,
    advance, agreement, answer, as_, conserve, dossier, err, fetches, final,
    funded, panel_says, sent, settled, submitted, past_deadline, clear_fetches,
)
import pytest


def test_happy_path_pays_pro_rata_and_returns_the_remainder(module, c):
    aid = settled(module, c)
    ag = agreement(c, aid)
    assert ag["status"] == "SETTLED"
    assert ag["verdict"] == "QUALIFIED"
    assert ag["verified_impact"] == 463
    payout = 463 * REWARD // TARGET
    assert ag["payout_atto"] == str(payout)
    assert ag["refund_atto"] == str(REWARD - payout)
    assert c.get_claimable(OPERATOR) == str(payout)
    assert c.get_claimable(FUNDER) == str(REWARD - payout)
    conserve(module, c)

    as_(module, OPERATOR, 0)
    c.claim()
    as_(module, FUNDER, 0)
    c.claim()
    assert sent() == [(OPERATOR, payout), (FUNDER, REWARD - payout)]
    assert int(c.escrow_atto) == 0
    conserve(module, c)
    stats = json.loads(c.get_stats())
    assert stats["settled"] == 1 and stats["qualified"] == 1
    assert stats["paid_atto"] == str(payout)


def test_dossier_records_the_snapshot_with_digests(module, c):
    aid = final(module, c)
    d = dossier(c, aid, 1)
    assert d["verdict"] == "QUALIFIED" and d["verified_impact"] == 463
    assert [r["id"] for r in d["rows"]] == ["EV-001", "EV-002"]
    sat = d["rows"][0]
    assert sat["cls"] == "INDEPENDENT" and sat["basis"] == "FETCHED"
    assert sat["readable"] is True and "463 hectares" in sat["excerpt"]
    assert sat["digest"] == module._sha256_hex(sat["excerpt"])
    assert sat["figure"] == 463 and sat["scope_ok"] is True
    assert d["rows"][1]["cls"] == "OPERATOR"


def test_challenge_round_rereads_the_record_and_fetches_only_the_new_source(module, c):
    aid = final(module, c)
    clear_fetches()
    as_(module, FUNDER, BOND)
    c.challenge(aid, "the satellite page counts planted area, not canopy cover",
                ASSESSOR_URL, "Independent field audit")
    ag = agreement(c, aid)
    assert ag["challenge_open"] is True and ag["evidence_version"] == 2
    conserve(module, c)

    # the second panel: assessor states 460 -> two independent publishers
    # agree within tolerance -> verified = min(463, 460) = 460 -> still QUALIFIED
    panel_says(answer(figures={"EV-001": 463, "EV-002": 480, "EV-003": 460}))
    as_(module, STRANGER, 0)
    out = json.loads(c.re_adjudicate(aid))
    assert out["verdict"] == "QUALIFIED" and out["verified_impact"] == 460
    # a changed FIGURE is a changed money fact: the challenger is made whole
    assert out["bond_returned"] is True
    assert c.get_claimable(FUNDER) == str(BOND)

    # S36: the original sources were NOT refetched — only the challenger's,
    # once by the leader and once by the validator's own rerun
    assert fetches() == [ASSESSOR_URL, ASSESSOR_URL]
    d2 = dossier(c, aid, 2)
    assert [r["basis"] for r in d2["rows"]] == ["RECORDED", "RECORDED", "NEW"]
    d1 = dossier(c, aid, 1)
    assert d2["rows"][0]["excerpt"] == d1["rows"][0]["excerpt"]
    assert d2["rows"][0]["fetch_epoch"] == d1["rows"][0]["fetch_epoch"]
    assert d2["reconsidered_round"] == 1 and d2["round_kind"] == "RE_ADJUDICATION"
    conserve(module, c)


def test_walls_before_funding_and_before_deadline(module, c):
    aid = funded(module, c)
    E = err(module)
    as_(module, STRANGER, 0)
    with pytest.raises(E, match="submit evidence first"):
        c.adjudicate(aid)
    as_(module, OPERATOR, 0)
    c.submit_evidence(aid, 463, json.dumps([{"url": SAT_URL, "label": "sat"}]))
    with pytest.raises(E, match="judged after the deadline"):
        as_(module, STRANGER, 0)
        c.adjudicate(aid)
    past_deadline()
    panel_says(answer(figures={"EV-001": 463}))
    c.adjudicate(aid)
    with pytest.raises(E, match="finality window is still open"):
        c.promote(aid)
    advance(W + 1)
    c.promote(aid)
    with pytest.raises(E, match="challenge window is still open"):
        c.settle(aid)
    conserve(module, c)
