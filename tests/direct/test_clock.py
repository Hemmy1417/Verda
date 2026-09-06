"""The consensus clock: fail-closed on every missing witness, tolerant of
explorer lag, strict on candidate divergence, bounded by the beacon in both
directions, and a leader/validator comparison that is integer arithmetic —
a failed round writes nothing and moves nothing."""

import calendar
import json

import pytest

from conftest import (FUNDER, OPERATOR, STRANGER, W,
                      advance, agreement, as_, clock_drift, conserve, dead,
                      demo_sources, drafted, err, final, funded, now, skew)


def _skew_traces(seconds):
    for host in ("cloudflare.com", "digitalocean.com", "medium.com"):
        skew(host, seconds)


def _beacon_time(module, epoch):
    """What a beacon head reports for a wall-clock instant: slot*12 from
    genesis, rounded down to the slot boundary."""
    g = module.BEACON_GENESIS_EPOCH
    return g + 12 * ((epoch - g) // 12)


def _nothing_written(c):
    return int(c.agreement_count) == 0 and len(c.agreement_ids) == 0


# ── the trace edges ──────────────────────────────────────────────────────────

def test_no_wall_clock_fails_closed_and_a_timed_write_refuses(module, c):
    dead("cdn-cgi/trace")
    assert c._utc_now() == 0
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    assert _nothing_written(c)


def test_one_dead_trace_source_is_survivable(module, c):
    dead("medium.com")
    aid = drafted(module, c)
    assert aid == "vrd-000001"
    assert agreement(c, aid)["created_epoch"] == now()


def test_the_clock_is_the_minimum_of_the_surviving_traces(module, c):
    dead("medium.com")
    skew("digitalocean.com", 200)
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now()


def test_forward_traces_within_tolerance_do_not_lift_the_clock(module, c):
    skew("cloudflare.com", 250)
    skew("digitalocean.com", 100)
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now()


def test_divergent_trace_sources_fail_closed(module, c):
    skew("medium.com", 400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c)
    assert _nothing_written(c)


def test_trace_divergence_at_exactly_the_tolerance_is_accepted(module, c):
    skew("medium.com", module.MAX_CLOCK_DIVERGENCE)
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now()


def test_an_insane_trace_epoch_is_dropped_like_a_dead_source(module, c):
    """A trace answering an epoch below MIN_SANE_EPOCH is not a candidate,
    so it cannot manufacture divergence between the healthy ones."""
    skew("medium.com", -(now() - 100))
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now()


# ── the execution-layer floor ────────────────────────────────────────────────

def test_explorer_block_ahead_of_the_traces_fails_closed(module, c):
    skew("blockscout", 400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c)


def test_explorer_block_at_exactly_the_tolerance_is_accepted(module, c):
    skew("blockscout", module.MAX_CLOCK_DIVERGENCE)
    assert drafted(module, c) == "vrd-000001"


def test_lagging_explorer_is_tolerated(module, c):
    """The chain floor is one-directional: an indexer 21 minutes behind is
    normal and must not freeze the contract."""
    skew("blockscout", -1_250)
    assert drafted(module, c) == "vrd-000001"


def test_dead_explorer_fails_open(module, c):
    """Corroboration only: an unreachable explorer leaves floor = 0 and the
    beacons remain the load-bearing bound."""
    dead("blockscout")
    assert drafted(module, c) == "vrd-000001"


# ── the beacon bound ─────────────────────────────────────────────────────────

def test_dead_beacon_heads_fail_closed(module, c):
    dead("headers/head")
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c)
    assert _nothing_written(c)


def test_one_dead_beacon_head_is_survivable(module, c):
    dead("publicnode.com")
    assert drafted(module, c) == "vrd-000001"


def test_an_insane_beacon_head_is_dropped_like_a_dead_one(module, c):
    """A head reporting a slot before MIN_SANE_EPOCH is not a witness, so it
    can neither bound the clock nor manufacture divergence with the other."""
    skew("publicnode.com", -(now() - 100))
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now()


def test_divergent_beacon_heads_fail_closed(module, c):
    skew("publicnode.com", 400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c)


def test_forward_skewed_wall_clock_hits_the_beacon_ceiling(module, c):
    """S20: a common forward skew of every edge host passes the mutual
    divergence check; only an independent mechanism catches it."""
    _skew_traces(400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c, deadline_in=5_000)


def test_backward_skewed_wall_clock_hits_the_beacon_floor_without_the_explorer(module, c):
    """The beacon bounds BOTH directions on its own: with the explorer dead
    (floor 0) a wall clock 400s behind the chain is still refused."""
    dead("blockscout")
    _skew_traces(-400)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c)


def test_backward_traces_within_tolerance_are_the_clock_the_state_records(module, c):
    """A modest common lag passes both bounds, and it is the consensus
    reading — not any node's wall clock — that lands in created_epoch."""
    _skew_traces(-200)
    assert c._utc_now() == now() - 200
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now() - 200


def test_beacon_ceiling_boundary_sits_on_the_slot_boundary(module, c):
    """The beacon reports whole slots, so the ceiling is 300s above the slot
    boundary, not above the wall-clock instant."""
    ceiling = _beacon_time(module, now()) + module.MAX_CLOCK_DIVERGENCE
    _skew_traces(ceiling - now())
    assert c._utc_now() == ceiling
    assert drafted(module, c, deadline_in=5_000) == "vrd-000001"
    _skew_traces(ceiling - now() + 1)
    assert c._utc_now() == 0
    with pytest.raises(err(module), match="no consensus clock"):
        drafted(module, c, deadline_in=5_000)
    assert int(c.agreement_count) == 1


# ── leader versus validator ──────────────────────────────────────────────────

@pytest.mark.parametrize("offsets", [(0, 301), (301, 0), (-301, 0)])
def test_validator_drift_beyond_tolerance_fails_the_round_and_writes_nothing(
        module, c, offsets):
    clock_drift(*offsets)
    with pytest.raises(err(module), match=r"^\[LLM_ERROR\]"):
        drafted(module, c)
    assert _nothing_written(c)


def test_validator_drift_within_tolerance_agrees_on_the_leader_reading(module, c):
    clock_drift(0, module.MAX_CLOCK_DIVERGENCE)
    aid = drafted(module, c)
    assert agreement(c, aid)["created_epoch"] == now()


@pytest.mark.parametrize("offsets", [("DEAD", 0), (0, "DEAD")])
def test_a_clock_outage_one_node_sees_is_disagreement_not_a_transient(
        module, c, offsets):
    """A leader without a clock cannot declare the clock down for validators
    that have one — nor the reverse. The round fails and is retried."""
    clock_drift(*offsets)
    with pytest.raises(err(module), match=r"^\[LLM_ERROR\]"):
        drafted(module, c)
    assert _nothing_written(c)


def test_a_clock_outage_every_node_sees_is_transient(module, c):
    clock_drift("DEAD", "DEAD")
    with pytest.raises(err(module), match=r"^\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    assert _nothing_written(c)


def test_clock_disagreement_blocks_a_timed_write_on_a_funded_agreement(module, c):
    aid = funded(module, c)
    clock_drift(0, 400)
    as_(module, OPERATOR, 0)
    with pytest.raises(err(module), match=r"^\[LLM_ERROR\]"):
        c.submit_evidence(aid, 463, json.dumps(demo_sources()))
    ag = agreement(c, aid)
    assert ag["status"] == "FUNDED" and ag["evidence_version"] == 0
    assert ag["last_submit_epoch"] == 0
    conserve(module, c)


def test_settle_without_a_consensus_clock_moves_no_money_and_is_retried(module, c):
    aid = final(module, c)
    advance(W + 1)
    clock_drift("DEAD", "DEAD")
    as_(module, STRANGER, 0)
    with pytest.raises(err(module), match="no consensus clock"):
        c.settle(aid)
    ag = agreement(c, aid)
    assert ag["status"] == "FINAL" and ag["payout_atto"] == "0"
    assert c.get_claimable(OPERATOR) == "0" and c.get_claimable(FUNDER) == "0"
    conserve(module, c)

    clock_drift()
    c.settle(aid)
    assert agreement(c, aid)["status"] == "SETTLED"
    conserve(module, c)


# ── the pure calendar helpers ────────────────────────────────────────────────

def test_epoch_from_civil_matches_known_instants(module):
    f = module._epoch_from_civil
    assert f(1970, 1, 1, 0, 0, 0) == 0
    assert f(2000, 3, 1, 0, 0, 0) == 951_868_800
    assert f(2024, 2, 29, 12, 34, 56) == 1_709_210_096
    assert f(2026, 9, 5, 0, 0, 0) == 1_788_566_400


def test_epoch_from_civil_agrees_with_the_proleptic_gregorian_calendar(module):
    """Leap days, the century rule and the 400-year cycle, checked against
    an oracle that is not the algorithm under test."""
    for y in (1972, 1999, 2000, 2024, 2026, 2100, 2400):
        for m in range(1, 13):
            for d in (1, 28):
                expect = calendar.timegm((y, m, d, 23, 59, 59, 0, 0, 0))
                assert module._epoch_from_civil(y, m, d, 23, 59, 59) == expect
    assert module._epoch_from_civil(2000, 2, 29, 0, 0, 0) == \
        calendar.timegm((2000, 2, 29, 0, 0, 0, 0, 0, 0))


def test_epoch_from_iso_parses_the_explorer_timestamp_shape(module):
    f = module._epoch_from_iso
    assert f("2026-08-28T11:22:33.000000Z") == 1_787_916_153
    assert f("2026-08-28T11:22:33Z") == 1_787_916_153
    assert f("  2026-08-28T11:22:33.5Z\n") == 1_787_916_153


def test_beacon_genesis_constant_is_the_mainnet_genesis_instant(module):
    assert module._epoch_from_iso("2020-12-01T12:00:23Z") == module.BEACON_GENESIS_EPOCH
