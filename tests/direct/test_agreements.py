"""Agreement lifecycle before any evidence exists: the draft's validation
walls, the basis frozen into the terms hash, cancellation, and the funder's
exact deposit as the counter-signature."""

import json

import pytest

from conftest import (
    BASIS, BOND, DEADLINE_IN, FUNDER, OPERATOR, REWARD, STRANGER, TARGET,
    TERMS, THRESHOLD, W, _CliAddress, advance, agreement, as_, clock_drift,
    conserve, drafted, err, funded, now,
)


def entry(kind, origin, cls="INDEPENDENT"):
    return {"kind": kind, "origin": origin, "class": cls}


SAT = entry("SATELLITE_OBSERVATION", "sat.example.org")
ASSESSOR = entry("INDEPENDENT_ASSESSMENT", "assessor.example.net")
OPERATOR_REPORT = entry("PROJECT_REPORT", "operator.example.com", "OPERATOR")


# ── the draft ────────────────────────────────────────────────────────────────

def test_draft_returns_incrementing_ids_and_records_the_instrument(module, c):
    aid = drafted(module, c)
    assert aid == "vrd-000001"
    assert drafted(module, c) == "vrd-000002"
    assert int(c.agreement_count) == 2
    ag = agreement(c, aid)
    assert ag["status"] == "DRAFT"
    assert ag["operator"] == OPERATOR and ag["funder"] == ""
    assert ag["target"] == TARGET and ag["threshold_bps"] == THRESHOLD
    assert ag["min_independent"] == 1
    assert ag["max_reward_atto"] == str(REWARD)
    assert ag["challenge_bond_atto"] == str(BOND)
    assert ag["deadline_epoch"] == now() + DEADLINE_IN
    assert (ag["submission_grace"], ag["finality_window"], ag["challenge_window"]) == (W, W, W)
    assert ag["created_epoch"] == now() and ag["funded_epoch"] == 0
    assert ag["evidence_version"] == 0 and ag["verdict"] == ""
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_draft_strips_the_text_fields_before_storing_them(module, c):
    aid = drafted(module, c, title="  Rio Verde  ", unit=" hectares ")
    ag = agreement(c, aid)
    assert ag["title"] == "Rio Verde" and ag["unit"] == "hectares"


def test_draft_refuses_title_outside_1_to_120_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="title must be 1-120 characters"):
        drafted(module, c, title="")
    with pytest.raises(E, match="title must be 1-120 characters"):
        drafted(module, c, title="   ")
    with pytest.raises(E, match="title must be 1-120 characters"):
        drafted(module, c, title="t" * 121)
    assert agreement(c, drafted(module, c, title="t" * 120))["title"] == "t" * 120


def test_draft_refuses_region_outside_1_to_80_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="region must be 1-80 characters"):
        drafted(module, c, region="")
    with pytest.raises(E, match="region must be 1-80 characters"):
        drafted(module, c, region="r" * 81)
    assert agreement(c, drafted(module, c, region="r" * 80))["region"] == "r" * 80


def test_draft_refuses_metric_outside_1_to_80_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="metric must be 1-80 characters"):
        drafted(module, c, metric="")
    with pytest.raises(E, match="metric must be 1-80 characters"):
        drafted(module, c, metric="m" * 81)
    assert agreement(c, drafted(module, c, metric="m" * 80))["metric"] == "m" * 80


def test_draft_refuses_unit_outside_1_to_24_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="unit must be 1-24 characters"):
        drafted(module, c, unit="")
    with pytest.raises(E, match="unit must be 1-24 characters"):
        drafted(module, c, unit="u" * 25)
    assert agreement(c, drafted(module, c, unit="u" * 24))["unit"] == "u" * 24


def test_draft_refuses_terms_outside_100_to_12000_characters(module, c):
    E = err(module)
    with pytest.raises(E, match="terms must be 100-12000 characters"):
        drafted(module, c, terms="x" * 99)
    with pytest.raises(E, match="terms must be 100-12000 characters"):
        drafted(module, c, terms="x" * 12_001)
    assert agreement(c, drafted(module, c, terms="x" * 100))["terms_text"] == "x" * 100
    assert len(agreement(c, drafted(module, c, terms="x" * 12_000))["terms_text"]) == 12_000


def test_draft_refuses_target_outside_1_to_a_billion_whole_units(module, c):
    E = err(module)
    with pytest.raises(E, match="target must be 1-1000000000 whole units"):
        drafted(module, c, target=0)
    with pytest.raises(E, match="target must be 1-1000000000 whole units"):
        drafted(module, c, target=10**9 + 1)
    with pytest.raises(E, match="target must be 1-1000000000 whole units"):
        drafted(module, c, target="five hundred")
    assert agreement(c, drafted(module, c, target=1))["target"] == 1
    assert agreement(c, drafted(module, c, target=10**9))["target"] == 10**9


def test_draft_refuses_threshold_outside_5000_to_10000_bps(module, c):
    E = err(module)
    with pytest.raises(E, match="threshold must be 5000-10000 basis points"):
        drafted(module, c, threshold=4_999)
    with pytest.raises(E, match="threshold must be 5000-10000 basis points"):
        drafted(module, c, threshold=10_001)
    assert agreement(c, drafted(module, c, threshold=5_000))["threshold_bps"] == 5_000
    assert agreement(c, drafted(module, c, threshold=10_000))["threshold_bps"] == 10_000


def test_draft_refuses_min_independent_outside_1_to_3(module, c):
    E = err(module)
    with pytest.raises(E, match="min_independent must be 1-3"):
        drafted(module, c, min_independent=0)
    with pytest.raises(E, match="min_independent must be 1-3"):
        drafted(module, c, min_independent=4)


def test_draft_refuses_reward_outside_bounds_and_reports_the_bond(module, c):
    E = err(module)
    with pytest.raises(E, match="maximum reward out of bounds"):
        drafted(module, c, reward=module.MIN_REWARD_ATTO - 1)
    with pytest.raises(E, match="maximum reward out of bounds"):
        drafted(module, c, reward=module.MAX_REWARD_ATTO + 1)
    with pytest.raises(E, match="maximum reward out of bounds"):
        drafted(module, c, reward="a lot")
    lo = agreement(c, drafted(module, c, reward=module.MIN_REWARD_ATTO))
    assert lo["max_reward_atto"] == str(module.MIN_REWARD_ATTO)
    assert lo["challenge_bond_atto"] == str(module.CHALLENGE_BOND_FLOOR_ATTO)
    hi = agreement(c, drafted(module, c, reward=module.MAX_REWARD_ATTO))
    assert hi["max_reward_atto"] == str(module.MAX_REWARD_ATTO)
    # at 1000 GEN the 5% arm outruns the floor
    assert hi["challenge_bond_atto"] == str(module.MAX_REWARD_ATTO * 500 // 10_000)


def test_draft_refuses_submission_grace_outside_900s_to_90_days(module, c):
    E = err(module)
    with pytest.raises(E, match="the submission_grace window must be 900-7776000 seconds"):
        drafted(module, c, grace=899)
    with pytest.raises(E, match="the submission_grace window must be 900-7776000 seconds"):
        drafted(module, c, grace=module.MAX_SUBMISSION_GRACE + 1)
    # the grace has its own cap, wider than the other two windows
    over = module.MAX_WINDOW_SECONDS + 1
    assert agreement(c, drafted(module, c, grace=over))["submission_grace"] == over
    top = agreement(c, drafted(module, c, grace=module.MAX_SUBMISSION_GRACE))
    assert top["submission_grace"] == module.MAX_SUBMISSION_GRACE


def test_draft_refuses_finality_window_outside_900s_to_30_days(module, c):
    E = err(module)
    with pytest.raises(E, match="the finality window must be 900-2592000 seconds"):
        drafted(module, c, windows=(899, W))
    with pytest.raises(E, match="the finality window must be 900-2592000 seconds"):
        drafted(module, c, windows=(module.MAX_WINDOW_SECONDS + 1, W))
    ag = agreement(c, drafted(module, c, windows=(module.MAX_WINDOW_SECONDS, W)))
    assert ag["finality_window"] == module.MAX_WINDOW_SECONDS


def test_draft_refuses_challenge_window_outside_900s_to_30_days(module, c):
    E = err(module)
    with pytest.raises(E, match="the challenge window must be 900-2592000 seconds"):
        drafted(module, c, windows=(W, 899))
    with pytest.raises(E, match="the challenge window must be 900-2592000 seconds"):
        drafted(module, c, windows=(W, module.MAX_WINDOW_SECONDS + 1))
    ag = agreement(c, drafted(module, c, windows=(W, module.MAX_WINDOW_SECONDS)))
    assert ag["challenge_window"] == module.MAX_WINDOW_SECONDS


def test_zero_window_takes_the_protocol_default(module, c):
    ag = agreement(c, drafted(module, c, grace=0, windows=(0, 0)))
    assert ag["submission_grace"] == module.DEFAULT_SUBMISSION_GRACE
    assert ag["finality_window"] == module.DEFAULT_FINALITY_WINDOW
    assert ag["challenge_window"] == module.DEFAULT_CHALLENGE_WINDOW


def test_draft_refuses_a_deadline_inside_one_window_of_the_clock(module, c):
    with pytest.raises(err(module), match="the deadline must be at least 900 seconds from now"):
        drafted(module, c, deadline_in=899)
    with pytest.raises(err(module), match="the deadline must be at least 900 seconds from now"):
        drafted(module, c, deadline_in=-86_400)
    aid = drafted(module, c, deadline_in=900)
    assert agreement(c, aid)["deadline_epoch"] == now() + 900


# ── the basis ────────────────────────────────────────────────────────────────

def test_basis_must_be_a_json_array_of_1_to_6_entries(module, c):
    E = err(module)
    as_(module, OPERATOR, 0)
    with pytest.raises(E, match="basis must be a JSON array"):
        c.draft_agreement("t", "r", "m", "u", TARGET, THRESHOLD, 1, str(REWARD),
                          now() + DEADLINE_IN, W, W, W, TERMS, "not json")
    with pytest.raises(E, match="the evidence basis names 1-6 origins"):
        drafted(module, c, basis=SAT)
    with pytest.raises(E, match="the evidence basis names 1-6 origins"):
        drafted(module, c, basis=[])
    seven = [entry("OTHER", f"s{i}.example.org") for i in range(7)]
    with pytest.raises(E, match="the evidence basis names 1-6 origins"):
        drafted(module, c, basis=seven)
    assert len(agreement(c, drafted(module, c, basis=seven[:6]))["basis"]) == 6


def test_basis_entry_must_be_an_object(module, c):
    with pytest.raises(err(module), match="basis entry 1 is not an object"):
        drafted(module, c, basis=[SAT, "assessor.example.net"])


def test_basis_refuses_an_unknown_kind_and_uppercases_a_known_one(module, c):
    with pytest.raises(err(module), match="basis entry 0: unknown source kind"):
        drafted(module, c, basis=[entry("DRONE_FOOTAGE", "sat.example.org")])
    aid = drafted(module, c, basis=[entry(" satellite_observation ", "sat.example.org")])
    assert agreement(c, aid)["basis"][0]["kind"] == "SATELLITE_OBSERVATION"


def test_basis_refuses_a_class_outside_independent_or_operator(module, c):
    with pytest.raises(err(module), match="class must be INDEPENDENT or OPERATOR"):
        drafted(module, c, basis=[entry("SATELLITE_OBSERVATION", "sat.example.org", "THIRD_PARTY")])
    aid = drafted(module, c, basis=[SAT, entry("PROJECT_REPORT", "operator.example.com", "operator")])
    assert agreement(c, aid)["basis"][1]["class"] == "OPERATOR"


@pytest.mark.parametrize("origin", [
    ".example.org",
    "example.org.",
    "sat..example.org",
    "localhost",
    "-sat.example.org",
    "sat-.example.org",
    "sat_data.example.org",
    "https://sat.example.org",
    "sat.example.org/path",
    "sat.example.org:443",
    "sat example.org",
    "sät.example.org",
    "a.b",
    "a" * 117 + ".org",
])
def test_basis_refuses_an_origin_that_is_not_a_bare_hostname(module, c, origin):
    with pytest.raises(err(module), match="origin must be a lowercase hostname"):
        drafted(module, c, basis=[entry("SATELLITE_OBSERVATION", origin)])


def test_basis_accepts_hostnames_at_the_edges_of_the_rule(module, c):
    for origin in ("sat-data.example.org", "s3.eu-west-1.example.org",
                   "123.example.org", "a.bc", "a" * 116 + ".org"):
        aid = drafted(module, c, basis=[entry("SATELLITE_OBSERVATION", origin)])
        assert agreement(c, aid)["basis"][0]["origin"] == origin


def test_basis_lowercases_and_strips_the_origin_before_freezing_it(module, c):
    loud = drafted(module, c, basis=[entry("SATELLITE_OBSERVATION", " SAT.Example.ORG ")])
    quiet = drafted(module, c, basis=[SAT])
    assert agreement(c, loud)["basis"] == [SAT]
    # normalization precedes the hash: one basis, one commitment
    assert agreement(c, loud)["terms_sha256"] == agreement(c, quiet)["terms_sha256"]


def test_basis_refuses_a_duplicate_origin_however_it_is_cased(module, c):
    with pytest.raises(err(module), match="origin sat.example.org is listed twice"):
        drafted(module, c, basis=[SAT, entry("PHOTOGRAPHIC_RECORD", "sat.example.org")])
    with pytest.raises(err(module), match="basis entry 1: origin sat.example.org is listed twice"):
        drafted(module, c, basis=[SAT, entry("PHOTOGRAPHIC_RECORD", "SAT.EXAMPLE.ORG")])


def test_basis_without_an_independent_origin_is_refused(module, c):
    only_operator = [OPERATOR_REPORT,
                     entry("PHOTOGRAPHIC_RECORD", "photos.example.com", "OPERATOR")]
    with pytest.raises(err(module), match="needs at least one INDEPENDENT origin"):
        drafted(module, c, basis=only_operator)
    assert int(c.agreement_count) == 0


def test_min_independent_cannot_exceed_the_distinct_independent_publishers(module, c):
    with pytest.raises(err(module),
                       match="min_independent is 3 but the basis has only 2 independent publisher"):
        drafted(module, c, min_independent=3)
    assert agreement(c, drafted(module, c, min_independent=2))["min_independent"] == 2
    three = [SAT, ASSESSOR, entry("GOVERNMENT_REGISTRY", "registry.example.gov")]
    assert agreement(c, drafted(module, c, min_independent=3, basis=three))["min_independent"] == 3


def test_two_hosts_of_one_publisher_are_one_independent_voice(module, c):
    twins = [SAT, entry("INDEPENDENT_ASSESSMENT", "audit.example.org")]
    with pytest.raises(err(module), match="has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=twins)
    # the second-level suffix heuristic: example.co.uk is the publisher
    uk = [entry("SATELLITE_OBSERVATION", "imagery.example.co.uk"),
          entry("INDEPENDENT_ASSESSMENT", "audit.example.co.uk")]
    with pytest.raises(err(module), match="has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=uk)
    # the operator's own origin never counts toward the independent tally
    with pytest.raises(err(module), match="has only 1 independent publisher"):
        drafted(module, c, min_independent=2, basis=[SAT, OPERATOR_REPORT])
    assert len(agreement(c, drafted(module, c, min_independent=1, basis=twins))["basis"]) == 2


def test_basis_freezes_exactly_kind_origin_and_class(module, c):
    noisy = dict(SAT, note="ignore me", weight=3)
    aid = drafted(module, c, basis=[noisy, OPERATOR_REPORT])
    assert agreement(c, aid)["basis"] == [SAT, OPERATOR_REPORT]


# ── the terms hash ───────────────────────────────────────────────────────────

def test_terms_hash_is_the_canonical_commitment_over_outcome_money_and_basis(module, c):
    aid = drafted(module, c)
    expected = module._sha256_hex(module._canonical({
        "operator": OPERATOR, "title": "Rio Verde restoration",
        "region": "Para, Brazil", "metric": "hectares of degraded forest restored",
        "unit": "hectares", "target": TARGET, "threshold_bps": THRESHOLD,
        "min_independent": 1, "max_reward_atto": str(REWARD),
        "deadline_epoch": now() + DEADLINE_IN,
        "submission_grace": W, "finality_window": W, "challenge_window": W,
        "terms_sha256": module._sha256_hex(TERMS), "basis": BASIS,
    }))
    assert agreement(c, aid)["terms_sha256"] == expected


def test_terms_hash_commits_to_the_basis(module, c):
    full = agreement(c, drafted(module, c))["terms_sha256"]
    without_operator = agreement(c, drafted(module, c, basis=[SAT, ASSESSOR]))["terms_sha256"]
    relabelled = agreement(c, drafted(module, c, basis=[
        SAT, ASSESSOR, entry("PROJECT_REPORT", "operator.example.com", "INDEPENDENT")]))["terms_sha256"]
    assert len({full, without_operator, relabelled}) == 3


def test_same_inputs_give_the_same_hash_under_different_ids(module, c):
    a = drafted(module, c)
    b = drafted(module, c)
    assert a != b
    assert agreement(c, a)["terms_sha256"] == agreement(c, b)["terms_sha256"]
    other_terms = drafted(module, c, terms=TERMS + " Amended.")
    assert agreement(c, other_terms)["terms_sha256"] != agreement(c, a)["terms_sha256"]


# ── cancel ───────────────────────────────────────────────────────────────────

def test_cancel_marks_the_draft_cancelled_with_an_epoch(module, c):
    aid = drafted(module, c)
    advance(10)
    as_(module, OPERATOR, 0)
    assert c.cancel_draft(aid) == "cancelled"
    ag = agreement(c, aid)
    assert ag["status"] == "CANCELLED"
    assert ag["cancelled_epoch"] == now() and ag["cancelled_epoch"] == ag["created_epoch"] + 10
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_cancel_is_operator_only(module, c):
    aid = drafted(module, c)
    for who in (FUNDER, STRANGER):
        as_(module, who, 0)
        with pytest.raises(err(module), match="only the operator cancels a draft"):
            c.cancel_draft(aid)
    assert agreement(c, aid)["status"] == "DRAFT"


def test_cancel_only_from_draft(module, c):
    aid = funded(module, c)
    as_(module, OPERATOR, 0)
    with pytest.raises(err(module), match="only an unfunded draft cancels.*this one is FUNDED"):
        c.cancel_draft(aid)
    assert agreement(c, aid)["status"] == "FUNDED"
    other = drafted(module, c)
    c.cancel_draft(other)
    with pytest.raises(err(module), match="this one is CANCELLED"):
        c.cancel_draft(other)
    conserve(module, c)


def test_cancel_unknown_agreement_refused(module, c):
    as_(module, OPERATOR, 0)
    with pytest.raises(err(module), match="unknown agreement"):
        c.cancel_draft("vrd-000009")


# ── fund ─────────────────────────────────────────────────────────────────────

def test_fund_is_exactly_the_maximum_reward(module, c):
    aid = drafted(module, c)
    for value in (REWARD - 1, REWARD + 1, 0, 2 * REWARD):
        as_(module, FUNDER, value)
        with pytest.raises(err(module), match="exactly the maximum reward"):
            c.fund(aid)
    ag = agreement(c, aid)
    assert ag["status"] == "DRAFT" and ag["funder"] == ""
    assert int(c.escrow_atto) == 0
    assert json.loads(c.get_agreements_for(FUNDER)) == []
    conserve(module, c)


def test_operator_cannot_fund_its_own_draft(module, c):
    aid = drafted(module, c)
    as_(module, OPERATOR, REWARD)
    with pytest.raises(err(module), match="cannot fund its own draft"):
        c.fund(aid)
    assert agreement(c, aid)["status"] == "DRAFT"
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_a_stranger_may_fund_and_becomes_the_funder(module, c):
    aid = drafted(module, c)
    as_(module, STRANGER, REWARD)
    assert c.fund(aid) == "funded"
    ag = agreement(c, aid)
    assert ag["status"] == "FUNDED" and ag["funder"] == STRANGER
    assert [a["agreement_id"] for a in json.loads(c.get_agreements_for(STRANGER))] == [aid]
    assert int(c.escrow_atto) == REWARD
    conserve(module, c)


def test_fund_refused_on_a_cancelled_draft(module, c):
    aid = drafted(module, c)
    as_(module, OPERATOR, 0)
    c.cancel_draft(aid)
    as_(module, FUNDER, REWARD)
    with pytest.raises(err(module), match="nothing to fund in CANCELLED"):
        c.fund(aid)
    assert int(c.escrow_atto) == 0
    conserve(module, c)


def test_second_funder_is_refused_because_the_draft_is_already_funded_s30(module, c):
    aid = funded(module, c)
    as_(module, STRANGER, REWARD)
    with pytest.raises(err(module), match="nothing to fund in FUNDED"):
        c.fund(aid)
    ag = agreement(c, aid)
    assert ag["funder"] == FUNDER and ag["status"] == "FUNDED"
    assert int(c.escrow_atto) == REWARD
    assert json.loads(c.get_stats())["funded"] == 1
    assert json.loads(c.get_agreements_for(STRANGER)) == []
    conserve(module, c)


def test_fund_refused_at_and_after_the_deadline(module, c):
    early = drafted(module, c)
    late = drafted(module, c)
    advance(DEADLINE_IN - 1)
    as_(module, FUNDER, REWARD)
    c.fund(early)
    advance(1)
    as_(module, FUNDER, REWARD)
    with pytest.raises(err(module), match="the deadline has passed"):
        c.fund(late)
    assert agreement(c, late)["status"] == "DRAFT"
    assert int(c.escrow_atto) == REWARD
    conserve(module, c)


def test_fund_records_the_funder_epoch_and_locks_the_escrow(module, c):
    aid = drafted(module, c)
    advance(100)
    as_(module, FUNDER, REWARD)
    c.fund(aid)
    ag = agreement(c, aid)
    assert ag["funded_epoch"] == now() and ag["funded_epoch"] == ag["created_epoch"] + 100
    assert ag["funder"] == FUNDER
    assert int(c.escrow_atto) == REWARD
    stats = json.loads(c.get_stats())
    assert stats["funded"] == 1 and stats["escrow_atto"] == str(REWARD)
    assert c.get_claimable(FUNDER) == "0"
    conserve(module, c)


def test_fund_unknown_agreement_refused(module, c):
    as_(module, FUNDER, REWARD)
    with pytest.raises(err(module), match="unknown agreement"):
        c.fund("vrd-000001")
    assert int(c.escrow_atto) == 0


# ── views ────────────────────────────────────────────────────────────────────

def test_actor_index_lists_the_agreement_for_operator_and_funder(module, c):
    aid = funded(module, c)
    other = drafted(module, c)
    assert [a["agreement_id"] for a in json.loads(c.get_agreements_for(OPERATOR))] == [aid, other]
    assert [a["agreement_id"] for a in json.loads(c.get_agreements_for(FUNDER))] == [aid]
    assert json.loads(c.get_agreements_for(STRANGER)) == []


def test_actor_index_accepts_the_cli_address_object_and_any_hex_case(module, c):
    aid = funded(module, c)
    by_object = json.loads(c.get_agreements_for(_CliAddress(FUNDER)))
    by_upper = json.loads(c.get_agreements_for(FUNDER.upper()))
    assert [a["agreement_id"] for a in by_object] == [aid]
    assert by_upper == by_object


def test_get_agreements_paginates_newest_first(module, c):
    for _ in range(3):
        drafted(module, c)
    first = json.loads(c.get_agreements(0, 2))
    assert first["total"] == 3
    assert [a["agreement_id"] for a in first["agreements"]] == ["vrd-000003", "vrd-000002"]
    second = json.loads(c.get_agreements(2, 2))
    assert [a["agreement_id"] for a in second["agreements"]] == ["vrd-000001"]
    assert json.loads(c.get_agreements(3, 2))["agreements"] == []
    empty = json.loads(c.get_agreements(0, 0))
    assert empty["total"] == 3 and empty["agreements"] == []
    clamped = json.loads(c.get_agreements(-1, 1))
    assert [a["agreement_id"] for a in clamped["agreements"]] == ["vrd-000003"]
    # the bounded page carries the view only; the frozen text is per agreement
    assert "terms_text" not in first["agreements"][0]


def test_get_agreement_unknown_is_empty(module, c):
    assert c.get_agreement("vrd-000001") == ""
    drafted(module, c)
    assert c.get_agreement("vrd-000002") == ""
    assert c.get_agreement("") == ""


def test_get_agreement_carries_the_frozen_terms_text_and_basis(module, c):
    ag = agreement(c, drafted(module, c))
    assert ag["terms_text"] == TERMS
    assert ag["basis"] == BASIS


def test_get_config_reports_the_bounds_the_writes_enforce(module, c):
    cfg = json.loads(c.get_config())
    assert cfg["min_reward_atto"] == str(module.MIN_REWARD_ATTO)
    assert cfg["max_reward_atto"] == str(module.MAX_REWARD_ATTO)
    assert cfg["threshold_bps"] == [module.MIN_THRESHOLD_BPS, module.MAX_THRESHOLD_BPS]
    assert cfg["target"] == [module.MIN_TARGET, module.MAX_TARGET]
    assert cfg["min_independent"] == [module.MIN_INDEPENDENT, module.MAX_INDEPENDENT]
    assert cfg["terms_chars"] == [module.MIN_TERMS_CHARS, module.MAX_TERMS_CHARS]
    assert cfg["title_chars"] == [1, module.MAX_TITLE_CHARS]
    assert cfg["unit_chars"] == [1, module.MAX_UNIT_CHARS]
    assert cfg["basis_entries"] == [1, module.MAX_BASIS_ENTRIES]
    assert cfg["window_seconds"] == [module.MIN_WINDOW_SECONDS, module.MAX_WINDOW_SECONDS]
    assert cfg["submission_grace_seconds"] == [module.MIN_WINDOW_SECONDS, module.MAX_SUBMISSION_GRACE]
    assert cfg["default_windows"] == {
        "submission_grace": module.DEFAULT_SUBMISSION_GRACE,
        "finality": module.DEFAULT_FINALITY_WINDOW,
        "challenge": module.DEFAULT_CHALLENGE_WINDOW}
    assert cfg["source_kinds"] == list(module.SOURCE_KINDS)
    assert cfg["source_classes"] == ["INDEPENDENT", "OPERATOR"]
    # the reported floor is the enforced floor
    with pytest.raises(err(module), match="maximum reward out of bounds"):
        drafted(module, c, reward=int(cfg["min_reward_atto"]) - 1)
    drafted(module, c, reward=int(cfg["min_reward_atto"]))


# ── the clock ────────────────────────────────────────────────────────────────

def test_dead_clock_refuses_draft_and_fund_as_transient_and_writes_nothing(module, c):
    aid = drafted(module, c)
    clock_drift("DEAD")
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        drafted(module, c)
    # every static wall passed; the refusal consumed no id
    assert int(c.agreement_count) == 1
    as_(module, FUNDER, REWARD)
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        c.fund(aid)
    ag = agreement(c, aid)
    assert ag["status"] == "DRAFT" and ag["funder"] == "" and ag["funded_epoch"] == 0
    assert int(c.escrow_atto) == 0
    assert json.loads(c.get_agreements_for(FUNDER)) == []
    clock_drift()
    assert drafted(module, c) == "vrd-000002"
    as_(module, FUNDER, REWARD)
    c.fund(aid)
    assert agreement(c, aid)["status"] == "FUNDED"
    conserve(module, c)


def test_dead_clock_refuses_cancel_without_a_partial_write(module, c):
    aid = drafted(module, c)
    clock_drift("DEAD")
    as_(module, OPERATOR, 0)
    with pytest.raises(err(module), match=r"\[TRANSIENT\] no consensus clock"):
        c.cancel_draft(aid)
    ag = agreement(c, aid)
    assert ag["status"] == "DRAFT" and ag["cancelled_epoch"] == 0
