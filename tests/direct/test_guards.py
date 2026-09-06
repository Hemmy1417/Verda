"""Guards the mutation sweep found unpinned: each test here exists because a
specific mutant of contracts/verda.py survived the rest of the suite."""

from conftest import (
    SAT_URL, ASSESSOR_URL, agreement, answer, dossier, err, panel_sequence,
    source, submitted, past_deadline, as_, STRANGER,
)
import pytest


def _independent(host, figure):
    return {"cls": "INDEPENDENT", "readable": True, "scope_ok": True,
            "kind_matches": True, "figure": figure, "host": host}


def test_contradiction_tolerance_is_inclusive_at_exactly_fifteen_percent(module):
    """Two independent figures whose spread is EXACTLY 15% of the higher one
    are within tolerance: 100 and 85 agree, 100 and 84 do not. The rule is
    `spread * 10000 > hi * CONTRADICTION_TOLERANCE_BPS` — strictly greater —
    so a mutant that flips it to `>=` turns the agreeing pair into a
    contradiction."""
    assert module.CONTRADICTION_TOLERANCE_BPS == 1_500
    agreeing = [_independent("a.one.org", 100), _independent("b.two.net", 85)]
    verdict, verified, hold = module._derive_verdict(100, 5_000, 1, 100, "SUFFICIENT", agreeing)
    assert (verdict, verified, hold) == ("QUALIFIED", 85, "")
    contradicting = [_independent("a.one.org", 100), _independent("b.two.net", 84)]
    verdict, verified, hold = module._derive_verdict(100, 5_000, 1, 100, "SUFFICIENT", contradicting)
    assert (verdict, verified, hold) == ("INCONCLUSIVE", 0, "SOURCES_CONTRADICT")


def test_validator_refuses_a_leader_whose_evidence_flag_differs_even_when_the_hold_is_the_same(module, c):
    """PARTIAL and INSUFFICIENT both derive INCONCLUSIVE · EVIDENCE_INSUFFICIENT,
    so the verdict, the hold reason and the re-derivation all agree — only the
    direct evidence_flag comparison can tell the two records apart. The flag
    is written into the dossier a later reader relies on, so it is pinned
    exactly, not merely through what it derives."""
    aid = submitted(module, c)
    past_deadline()
    panel_sequence(answer(evidence="PARTIAL"), answer(evidence="INSUFFICIENT"))
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match=r"\[LLM_ERROR\]"):
        c.adjudicate(aid)
    assert dossier(c, aid, 1) is None
    assert agreement(c, aid)["status"] == "FUNDED"
