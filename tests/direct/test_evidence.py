"""submit_evidence and the S35 rules: who files, when, how many versions,
what a row must look like, how a URL finds its basis entry, why two
spellings of one page are one source, why two pages on one publisher are
one voice, and what the stored package binds."""

import json

import pytest

from conftest import (
    ASSESSOR_URL, DEADLINE_IN, FUNDER, OPERATOR, OPERATOR_URL, SAT_URL,
    SAT_URL_TWIN, STRANGER, W, adjudicated, advance, agreement, answer, as_,
    conserve, demo_sources, drafted, err, fetches, final, funded, now, package,
    settled, source, submitted,
)

SAT_TILES = "https://tiles.sat.example.org/rv-7/2026-08.tif"
OPERATOR_CDN = "https://cdn.operator.example.com/reports/rv-7.pdf"

# One origin nested inside another: a host under ops.example.org matches both
# entries and must take the LONGEST, whatever order the operator listed them.
NESTED_BASIS = [
    {"kind": "OTHER", "origin": "example.org", "class": "INDEPENDENT"},
    {"kind": "PROJECT_REPORT", "origin": "ops.example.org", "class": "OPERATOR"},
]

UK_BASIS = [
    {"kind": "GOVERNMENT_REGISTRY", "origin": "registry.example.co.uk", "class": "INDEPENDENT"},
]


def submit(module, c, aid, sources, claimed=463):
    as_(module, OPERATOR, 0)
    return json.loads(c.submit_evidence(aid, claimed, json.dumps(sources)))


def refused(module, c, aid, sources, match, claimed=463, who=OPERATOR):
    as_(module, who, 0)
    with pytest.raises(err(module), match=match) as ei:
        c.submit_evidence(aid, claimed, json.dumps(sources))
    return str(ei.value)


def _cancelled(module, c):
    aid = drafted(module, c)
    as_(module, OPERATOR, 0)
    c.cancel_draft(aid)
    return aid


def _reclaimed(module, c):
    aid = funded(module, c)
    advance(DEADLINE_IN + W + 1)
    as_(module, STRANGER, 0)
    c.reclaim(aid)
    return aid


# ── who and when ─────────────────────────────────────────────────────────────

def test_only_the_operator_submits_evidence(module, c):
    aid = funded(module, c)
    for who in (FUNDER, STRANGER):
        refused(module, c, aid, demo_sources(), "only the operator submits", who=who)
    assert agreement(c, aid)["evidence_version"] == 0
    submit(module, c, aid, demo_sources())
    assert agreement(c, aid)["evidence_version"] == 1
    conserve(module, c)


def test_the_sender_wall_speaks_before_the_status_wall(module, c):
    aid = drafted(module, c)
    refused(module, c, aid, demo_sources(), "only the operator submits", who=STRANGER)


def test_an_unknown_agreement_is_refused(module, c):
    funded(module, c)
    refused(module, c, "vrd-000099", demo_sources(), "unknown agreement")


@pytest.mark.parametrize("status,reach", [
    ("DRAFT", drafted),
    ("PENDING_FINALITY", adjudicated),
    ("FINAL", final),
    ("SETTLED", settled),
    ("CANCELLED", _cancelled),
    ("RECLAIMED", _reclaimed),
], ids=["DRAFT", "PENDING_FINALITY", "FINAL", "SETTLED", "CANCELLED", "RECLAIMED"])
def test_evidence_is_filed_only_in_funded_and_the_refusal_names_the_status(
        module, c, status, reach):
    aid = reach(module, c)
    before = agreement(c, aid)
    assert before["status"] == status
    refused(module, c, aid, demo_sources(), f"this one is {status}")
    after = agreement(c, aid)
    assert after["evidence_version"] == before["evidence_version"]
    assert after["evidence_root"] == before["evidence_root"]
    assert c.get_package(aid, before["evidence_version"] + 1) == ""
    conserve(module, c)


def test_submission_is_open_through_the_last_second_of_grace_and_closed_after(module, c):
    aid = funded(module, c)
    ag = agreement(c, aid)
    grace_end = ag["deadline_epoch"] + ag["submission_grace"]
    advance(grace_end - now())
    assert now() == grace_end and now() > ag["deadline_epoch"]
    submit(module, c, aid, demo_sources())
    assert agreement(c, aid)["last_submit_epoch"] == grace_end
    advance(1)
    refused(module, c, aid, demo_sources(), "submission grace")
    assert agreement(c, aid)["evidence_version"] == 1
    conserve(module, c)


def test_after_an_inconclusive_hold_the_operator_resubmits_a_new_version(module, c):
    aid = adjudicated(module, c, ans=answer(evidence="PARTIAL"), grace=3600)
    advance(W + 1)
    as_(module, STRANGER, 0)
    assert c.promote(aid) == "inconclusive"
    assert agreement(c, aid)["status"] == "FUNDED"
    out = submit(module, c, aid, [source(SAT_URL, "sat"), source(ASSESSOR_URL, "audit")])
    ag = agreement(c, aid)
    assert out["version"] == 2
    assert ag["evidence_version"] == 2 and ag["judged_version"] == 1
    assert ag["evidence_root"] == package(c, aid, 2)["root"]
    assert package(c, aid, 1)["version"] == 1
    conserve(module, c)


def test_the_record_holds_at_most_four_versions(module, c):
    assert module.MAX_VERSIONS == 4
    aid = funded(module, c)
    for v in range(1, 5):
        assert submit(module, c, aid, demo_sources(), claimed=460 + v)["version"] == v
    refused(module, c, aid, demo_sources(), "at most 4 versions", claimed=470)
    ag = agreement(c, aid)
    assert ag["evidence_version"] == 4 and ag["claimed_impact"] == 464
    assert [package(c, aid, v)["claimed_impact"] for v in range(1, 5)] == [461, 462, 463, 464]
    assert c.get_package(aid, 5) == ""
    conserve(module, c)


def test_claimed_impact_bounds(module, c):
    aid = funded(module, c)
    for bad in (-1, module.MAX_FIGURE + 1, "abc", "4.5", None):
        refused(module, c, aid, demo_sources(), "claimed impact out of bounds", claimed=bad)
    assert agreement(c, aid)["evidence_version"] == 0
    submit(module, c, aid, demo_sources(), claimed=0)
    assert agreement(c, aid)["claimed_impact"] == 0
    submit(module, c, aid, demo_sources(), claimed=module.MAX_FIGURE)
    assert agreement(c, aid)["claimed_impact"] == module.MAX_FIGURE
    # the CLI delivers numbers as strings; a numeric string is a number
    submit(module, c, aid, demo_sources(), claimed="463")
    assert agreement(c, aid)["claimed_impact"] == 463
    conserve(module, c)


def test_intake_fetches_nothing(module, c):
    aid = funded(module, c)
    submit(module, c, aid, demo_sources())
    assert fetches() == []


# ── the sources JSON ─────────────────────────────────────────────────────────

def test_sources_must_be_a_json_array_of_one_to_six_rows(module, c):
    aid = funded(module, c)
    E = err(module)
    as_(module, OPERATOR, 0)
    with pytest.raises(E, match="sources must be a JSON array"):
        c.submit_evidence(aid, 463, "not json at all")
    for not_an_array in (json.dumps(source(SAT_URL, "an object")),
                         json.dumps(SAT_URL), json.dumps(7), "null"):
        as_(module, OPERATOR, 0)
        with pytest.raises(E, match="name 1-6 sources"):
            c.submit_evidence(aid, 463, not_an_array)
    refused(module, c, aid, [], "name 1-6 sources")
    tiles = [source(f"https://sat.example.org/tiles/{i}.txt", f"tile {i}") for i in range(7)]
    refused(module, c, aid, tiles, "name 1-6 sources")
    assert agreement(c, aid)["evidence_version"] == 0
    submit(module, c, aid, tiles[:6])
    assert [r["id"] for r in package(c, aid, 1)["rows"]] == [
        "EV-001", "EV-002", "EV-003", "EV-004", "EV-005", "EV-006"]


def test_every_row_must_be_an_object_and_the_refusal_names_the_row(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [42], "source 0 is not an object")
    refused(module, c, aid, [source(SAT_URL, "sat"), SAT_URL], "source 1 is not an object")
    refused(module, c, aid, [source(SAT_URL, "sat"), None], "source 1 is not an object")
    refused(module, c, aid, [source(SAT_URL, "sat"), [SAT_URL]], "source 1 is not an object")
    assert agreement(c, aid)["evidence_version"] == 0


@pytest.mark.parametrize("bad", [
    "sat.example.org/observations/rv-7",              # no scheme
    "//sat.example.org/observations/rv-7",            # scheme-relative
    "ftp://sat.example.org/observations/rv-7",        # not http(s)
    "HTTPS://sat.example.org/observations/rv-7",      # the scheme is matched case-sensitively
    "https://sat.example.org/café",                   # non-ASCII
    "https://sat.example.org/a b",                    # space
    "https://sat.example.org/a\tb",                   # control character
    "https://sat.example.org/x'y",                    # quote
    'https://sat.example.org/x"y',                    # double quote
    "https://sat.example.org/`x`",                    # backtick
    "https://sat.example.org/<x>",                    # angle bracket
    "https://sat.example.org/a|b",                    # the fence header delimiter
    "https://sat.example.org/a\\b",                   # backslash
    "https://a.b",                                    # 11 chars, one short
    "https://sat.example.org/" + "a" * 377,           # 401 chars, one over
    12345,                                            # not even a string
], ids=["no-scheme", "scheme-relative", "ftp", "upper-scheme", "non-ascii", "space", "tab",
        "quote", "dquote", "backtick", "angle", "pipe", "backslash", "short", "long",
        "number"])
def test_url_spellings_the_intake_refuses(module, c, bad):
    aid = funded(module, c)
    # a good row ahead of the bad one saves nothing: the package is refused whole
    refused(module, c, aid, [source(SAT_URL, "sat"), source(bad, "some label")],
            "source 1: url must be http")
    assert agreement(c, aid)["evidence_version"] == 0
    assert c.get_package(aid, 1) == ""


def test_a_row_without_a_url_is_refused_at_the_url_wall(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [{"label": "no url at all"}], "source 0: url must be http")


def test_url_length_cap_is_inclusive(module, c):
    aid = funded(module, c)
    longest = "https://sat.example.org/" + "a" * 376
    assert len(longest) == module.MAX_URL_CHARS == 400
    assert submit(module, c, aid, [source(longest, "at the cap")])["version"] == 1
    assert package(c, aid, 1)["rows"][0]["url"] == longest


def test_every_row_needs_a_label_within_eighty_chars(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [{"url": SAT_URL}], "source 0 needs a label")
    refused(module, c, aid, [source(SAT_URL, "   ")], "source 0 needs a label")
    refused(module, c, aid, [source(SAT_URL, "fine"), source(OPERATOR_URL, "x" * 81)],
            "source 1 needs a label")
    assert agreement(c, aid)["evidence_version"] == 0
    submit(module, c, aid, [source(SAT_URL, "  " + "x" * 80 + "  ")])
    assert package(c, aid, 1)["rows"][0]["label"] == "x" * 80


# ── finding the basis entry ──────────────────────────────────────────────────

def test_a_row_inherits_kind_and_class_from_the_origin_its_host_equals(module, c):
    aid = submitted(module, c)
    sat, op = package(c, aid, 1)["rows"]
    assert sat["host"] == "sat.example.org" and sat["origin"] == "sat.example.org"
    assert sat["kind"] == "SATELLITE_OBSERVATION" and sat["cls"] == "INDEPENDENT"
    assert sat["domain"] == "example.org"
    assert op["host"] == "operator.example.com" and op["origin"] == "operator.example.com"
    assert op["kind"] == "PROJECT_REPORT" and op["cls"] == "OPERATOR"
    assert op["domain"] == "example.com"
    assert set(demo_sources()[0]) == {"url", "label"}


def test_a_row_cannot_declare_its_own_kind_or_class(module, c):
    aid = funded(module, c)
    dressed = dict(source(OPERATOR_URL, "report"), kind="SATELLITE_OBSERVATION",
                   cls="INDEPENDENT", **{"class": "INDEPENDENT"})
    refused(module, c, aid, [dressed], "INDEPENDENT origin")
    submit(module, c, aid, [source(SAT_URL, "sat"), dressed])
    row = package(c, aid, 1)["rows"][1]
    assert row["kind"] == "PROJECT_REPORT" and row["cls"] == "OPERATOR"
    assert "class" not in row


def test_a_subdomain_of_an_origin_is_inside_it_and_inherits_kind_and_class(module, c):
    aid = funded(module, c)
    submit(module, c, aid, [source(SAT_TILES, "tiles"), source(OPERATOR_CDN, "report mirror")])
    t, o = package(c, aid, 1)["rows"]
    assert t["host"] == "tiles.sat.example.org" and t["origin"] == "sat.example.org"
    assert t["kind"] == "SATELLITE_OBSERVATION" and t["cls"] == "INDEPENDENT"
    assert t["domain"] == "example.org"
    assert o["host"] == "cdn.operator.example.com" and o["origin"] == "operator.example.com"
    assert o["kind"] == "PROJECT_REPORT" and o["cls"] == "OPERATOR"


def test_a_subdomain_of_the_operator_origin_alone_cannot_carry_a_payout(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [source(OPERATOR_CDN, "mirror")], "INDEPENDENT origin")


def test_a_host_that_merely_ends_with_the_origin_text_is_outside_the_basis(module, c):
    aid = funded(module, c)
    msg = refused(module, c, aid,
                  [source("https://notsat.example.org/observations/rv-7", "lookalike")],
                  "outside the agreed evidence basis")
    assert "source 0: notsat.example.org is outside" in msg
    assert agreement(c, aid)["evidence_version"] == 0


@pytest.mark.parametrize("url", [
    "https://example.org/observations/rv-7",             # the origin's parent
    "https://sat.example.org.evil.io/observations",      # the origin as a prefix
    "https://sat.example.net/observations/rv-7",         # the origin's TLD swapped
    "https://other.example.io/observations/rv-7",        # unrelated publisher
    "https://sat.example.org@evil.io/observations",      # userinfo cannot smuggle a host
    "https://sat.example.org%40evil.io/observations",    # nor its encoded form
    "https://evil.io/#@sat.example.org/observations",    # nor a fragment
    "https://sat.example.org./observations/rv-7",        # the FQDN spelling is not matched
], ids=["parent", "prefix", "tld-swap", "unrelated", "userinfo", "encoded-at", "fragment-at",
        "trailing-dot"])
def test_an_off_basis_host_is_refused_and_nothing_is_written(module, c, url):
    aid = funded(module, c)
    refused(module, c, aid, [source(SAT_URL, "sat"), source(url, "x")],
            "source 1: .* is outside the agreed evidence basis")
    assert agreement(c, aid)["evidence_version"] == 0
    assert c.get_package(aid, 1) == ""


def test_a_query_before_any_path_cannot_smuggle_an_off_basis_host(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [source("https://evil.io?x=@sat.example.org", "x")],
            "outside the agreed evidence basis")


def test_the_longest_matching_origin_wins_when_origins_nest(module, c):
    for basis in (NESTED_BASIS, list(reversed(NESTED_BASIS))):
        aid = funded(module, c, basis=basis)
        submit(module, c, aid, [
            source("https://data.example.org/figures", "publisher data"),
            source("https://ops.example.org/report", "operator report"),
            source("https://deep.ops.example.org/annex", "operator annex"),
        ])
        data, ops, deep = package(c, aid, 1)["rows"]
        assert data["origin"] == "example.org"
        assert data["kind"] == "OTHER" and data["cls"] == "INDEPENDENT"
        assert ops["origin"] == "ops.example.org"
        assert ops["kind"] == "PROJECT_REPORT" and ops["cls"] == "OPERATOR"
        assert deep["origin"] == "ops.example.org" and deep["cls"] == "OPERATOR"
        assert {r["domain"] for r in (data, ops, deep)} == {"example.org"}
    conserve(module, c)


def test_under_a_nested_basis_the_inherited_class_decides_the_independence_wall(module, c):
    aid = funded(module, c, basis=NESTED_BASIS)
    refused(module, c, aid, [source("https://ops.example.org/report", "report"),
                             source("https://deep.ops.example.org/annex", "annex")],
            "INDEPENDENT origin")
    submit(module, c, aid, [source("https://ops.example.org/report", "report"),
                            source("https://www.example.org/figures", "figures")])
    assert [r["cls"] for r in package(c, aid, 1)["rows"]] == ["OPERATOR", "INDEPENDENT"]


def test_the_publisher_of_a_co_uk_origin_keeps_its_second_level(module, c):
    aid = funded(module, c, basis=UK_BASIS)
    submit(module, c, aid, [source("https://api.registry.example.co.uk/parcels/rv-7", "parcels")])
    row = package(c, aid, 1)["rows"][0]
    assert row["host"] == "api.registry.example.co.uk"
    assert row["origin"] == "registry.example.co.uk"
    assert row["domain"] == "example.co.uk"


# ── S35: one page is one source ──────────────────────────────────────────────

@pytest.mark.parametrize("twin", [
    SAT_URL,
    "  " + SAT_URL + "  ",
    "https://SAT.EXAMPLE.ORG/observations/rv-7/2026-q3.txt",
    "https://sat.example.org:443/observations/rv-7/2026-q3.txt",
    SAT_URL + "#summary",
    SAT_URL + "/",
    "https://viewer@sat.example.org/observations/rv-7/2026-q3.txt",
    "https://Sat.Example.ORG:443/observations/rv-7/2026-q3.txt/#top",
], ids=["verbatim", "padded", "upper-host", "port-443", "fragment", "trailing-slash",
        "userinfo", "all-at-once"])
def test_a_second_spelling_of_a_page_already_in_the_package_is_refused(module, c, twin):
    aid = funded(module, c)
    msg = refused(module, c, aid, [source(SAT_URL, "sat"), source(twin, "the same page again")],
                  "already in the record")
    assert f"source 1: {SAT_URL} is already in the record" in msg
    assert agreement(c, aid)["evidence_version"] == 0
    assert c.get_package(aid, 1) == ""


def test_the_odd_spelling_may_come_first_and_the_canonical_one_is_the_duplicate(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [source(SAT_URL + "/#top", "first"), source(SAT_URL, "second")],
            f"source 1: {SAT_URL} is already in the record")


def test_the_duplicate_refusal_names_the_offending_row(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [source(OPERATOR_URL, "report"), source(SAT_URL, "sat"),
                             source(SAT_URL + "#again", "again")],
            f"source 2: {SAT_URL} is already in the record")


def test_an_origin_root_with_and_without_its_slash_is_one_page(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [source("https://sat.example.org", "root"),
                             source("https://sat.example.org/", "root again")],
            "source 1: https://sat.example.org/ is already in the record")
    submit(module, c, aid, [source("https://sat.example.org", "root")])
    assert package(c, aid, 1)["rows"][0]["norm_url"] == "https://sat.example.org/"


def test_an_uppercase_scheme_never_reaches_the_record(module, c):
    # refused at the URL wall, so normalization never has to fold it — and
    # would, if it did
    aid = funded(module, c)
    refused(module, c, aid, [source("HTTPS://sat.example.org/observations/rv-7/2026-q3.txt", "x")],
            "url must be http")
    assert module._normalize_url("HTTPS://sat.example.org/x") == "https://sat.example.org/x"


def test_two_different_pages_on_one_origin_are_two_rows_with_one_publisher(module, c):
    aid = funded(module, c)
    submit(module, c, aid, [source(SAT_URL, "q3 detail"), source(SAT_URL_TWIN, "q3 summary"),
                            source(SAT_TILES, "tiles"), source(ASSESSOR_URL, "audit")])
    rows = package(c, aid, 1)["rows"]
    assert [r["id"] for r in rows] == ["EV-001", "EV-002", "EV-003", "EV-004"]
    assert len({r["norm_url"] for r in rows}) == 4
    assert [r["host"] for r in rows[:3]] == ["sat.example.org", "sat.example.org",
                                             "tiles.sat.example.org"]
    assert {r["origin"] for r in rows[:3]} == {"sat.example.org"}
    assert {r["domain"] for r in rows[:3]} == {"example.org"}
    assert rows[3]["domain"] == "example.net"
    # four independent rows, two publishers: what corroboration counts
    assert len({r["domain"] for r in rows if r["cls"] == "INDEPENDENT"}) == 2


def test_a_query_string_and_a_non_default_port_distinguish_pages(module, c):
    aid = funded(module, c)
    submit(module, c, aid, [
        source(SAT_URL, "plain"),
        source(SAT_URL + "?rev=2", "revision two"),
        source(SAT_URL + "?REV=2", "revision two, shouted"),
        source("https://sat.example.org:8443/observations/rv-7/2026-q3.txt", "mirror port"),
    ])
    rows = package(c, aid, 1)["rows"]
    assert len(rows) == 4 and len({r["norm_url"] for r in rows}) == 4
    assert rows[1]["norm_url"] == SAT_URL + "?rev=2"
    assert rows[2]["norm_url"] == SAT_URL + "?REV=2"
    mirror = rows[3]
    assert mirror["host"] == "sat.example.org" and mirror["origin"] == "sat.example.org"
    assert mirror["norm_url"] == "https://sat.example.org:8443/observations/rv-7/2026-q3.txt"
    refused(module, c, aid, [source(SAT_URL + "?rev=2", "a"), source(SAT_URL + "?rev=2#x", "b")],
            "already in the record")


def test_a_package_of_operator_rows_only_cannot_carry_a_payout(module, c):
    aid = funded(module, c)
    refused(module, c, aid, [source(OPERATOR_URL, "completion report"),
                             source("https://operator.example.com/reports/rv-7-annex", "annex")],
            "INDEPENDENT origin")
    ag = agreement(c, aid)
    assert ag["evidence_version"] == 0 and ag["evidence_root"] == ""
    assert ag["last_submit_epoch"] == 0 and c.get_package(aid, 1) == ""
    submit(module, c, aid, [source(OPERATOR_URL, "completion report"), source(ASSESSOR_URL, "audit")])
    assert [r["cls"] for r in package(c, aid, 1)["rows"]] == ["OPERATOR", "INDEPENDENT"]
    conserve(module, c)


# ── the stored package ───────────────────────────────────────────────────────

def test_package_structure_and_the_root_binds_the_canonical_package(module, c):
    aid = funded(module, c)
    advance(50)
    out = submit(module, c, aid, demo_sources())
    pkg = package(c, aid, 1)
    assert out == {"version": 1, "root": pkg["root"]}
    assert pkg["agreement_id"] == aid and pkg["version"] == 1
    assert pkg["claimed_impact"] == 463 and pkg["added_by"] == "operator"
    assert pkg["rows"][0] == {
        "id": "EV-001", "url": SAT_URL, "norm_url": SAT_URL,
        "host": "sat.example.org", "domain": "example.org",
        "origin": "sat.example.org", "kind": "SATELLITE_OBSERVATION",
        "cls": "INDEPENDENT", "label": "Satellite observation summary",
        "added_version": 1,
    }
    assert pkg["rows"][1]["id"] == "EV-002" and pkg["rows"][1]["cls"] == "OPERATOR"
    assert set(pkg) == {"agreement_id", "version", "claimed_impact", "added_by", "rows", "root"}

    unrooted = dict(pkg)
    root = unrooted.pop("root")
    assert len(root) == 64
    assert root == module._sha256_hex(module._canonical(unrooted))
    tampered = json.loads(json.dumps(unrooted))
    tampered["rows"][0]["label"] = "Satellite observation summary."
    assert module._sha256_hex(module._canonical(tampered)) != root
    tampered = json.loads(json.dumps(unrooted))
    tampered["claimed_impact"] = 464
    assert module._sha256_hex(module._canonical(tampered)) != root

    ag = agreement(c, aid)
    assert ag["status"] == "FUNDED" and ag["judged_version"] == 0
    assert ag["evidence_version"] == 1 and ag["evidence_root"] == root
    assert ag["claimed_impact"] == 463 and ag["last_submit_epoch"] == now()
    conserve(module, c)


def test_a_second_submission_is_a_whole_replacement_and_the_first_stays_readable(module, c):
    aid = submitted(module, c)
    v1 = package(c, aid, 1)
    first_epoch = agreement(c, aid)["last_submit_epoch"]
    advance(120)
    out = submit(module, c, aid, [source(ASSESSOR_URL, "field audit"),
                                  source(OPERATOR_URL, "report")], claimed=470)
    v2 = package(c, aid, 2)
    assert out == {"version": 2, "root": v2["root"]}
    assert v2["version"] == 2 and v2["claimed_impact"] == 470
    assert [r["url"] for r in v2["rows"]] == [ASSESSOR_URL, OPERATOR_URL]
    assert SAT_URL not in [r["url"] for r in v2["rows"]]
    # a version is a whole package: ids restart, nothing is appended
    assert [r["id"] for r in v2["rows"]] == ["EV-001", "EV-002"]
    assert all(r["added_version"] == 2 for r in v2["rows"])
    assert package(c, aid, 1) == v1 and v1["root"] != v2["root"]

    ag = agreement(c, aid)
    assert ag["evidence_version"] == 2 and ag["evidence_root"] == v2["root"]
    assert ag["claimed_impact"] == 470
    assert ag["last_submit_epoch"] == first_epoch + 120 == now()
    conserve(module, c)


def test_a_replacement_may_name_the_same_pages_again_and_gets_its_own_root(module, c):
    aid = submitted(module, c)
    v1 = package(c, aid, 1)
    out = submit(module, c, aid, demo_sources())
    v2 = package(c, aid, 2)
    assert out["version"] == 2
    assert [r["norm_url"] for r in v2["rows"]] == [r["norm_url"] for r in v1["rows"]]
    assert v2["claimed_impact"] == v1["claimed_impact"]
    # the version number is inside the hashed package
    assert v2["root"] != v1["root"]
    assert all(r["added_version"] == 2 for r in v2["rows"])


def test_get_package_is_empty_for_a_version_that_does_not_exist(module, c):
    aid = funded(module, c)
    assert c.get_package(aid, 1) == "" and package(c, aid, 1) is None
    submit(module, c, aid, demo_sources())
    assert c.get_package(aid, 1) != ""
    for missing in (0, 2, 99, -1, "not-a-number", None):
        assert c.get_package(aid, missing) == ""
    assert c.get_package("vrd-999999", 1) == ""


# ── pure helpers ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,norm", [
    ("HTTPS://SAT.EXAMPLE.ORG/Obs/X", "https://sat.example.org/Obs/X"),
    ("https://sat.example.org:443/x", "https://sat.example.org/x"),
    ("http://sat.example.org:80/x", "http://sat.example.org/x"),
    ("https://sat.example.org:80/x", "https://sat.example.org:80/x"),
    ("http://sat.example.org:443/x", "http://sat.example.org:443/x"),
    ("https://sat.example.org:8443/x", "https://sat.example.org:8443/x"),
    ("https://sat.example.org/x#frag", "https://sat.example.org/x"),
    ("https://sat.example.org/x/", "https://sat.example.org/x"),
    ("https://sat.example.org/", "https://sat.example.org/"),
    ("https://sat.example.org", "https://sat.example.org/"),
    ("https://sat.example.org/x?b=2&a=1", "https://sat.example.org/x?b=2&a=1"),
    ("https://sat.example.org/x?", "https://sat.example.org/x"),
    ("https://sat.example.org/x?q=1#f", "https://sat.example.org/x?q=1"),
    ("https://sat.example.org/x/?q=1", "https://sat.example.org/x?q=1"),
    ("  https://sat.example.org/x  ", "https://sat.example.org/x"),
    ("https://user:pw@sat.example.org/x", "https://sat.example.org/x"),
    ("https://sat.example.org@evil.io/x", "https://evil.io/x"),
    ("https://sat.example.org/x@y", "https://sat.example.org/x@y"),
], ids=["case", "443", "80", "80-on-https", "443-on-http", "8443", "fragment", "slash",
        "root", "no-path", "query-kept", "empty-query", "query-then-fragment",
        "slash-before-query", "padding", "userinfo", "userinfo-host", "at-in-path"])
def test_normalize_url_is_idempotent_over_the_spellings_it_folds(module, raw, norm):
    assert module._normalize_url(raw) == norm
    assert module._normalize_url(norm) == norm


def test_normalize_url_drops_exactly_one_trailing_slash(module):
    # "/x//" is a different path from "/x/" to an origin server; only the
    # last slash is a spelling
    assert module._normalize_url("https://sat.example.org/x//") == "https://sat.example.org/x/"
    assert module._normalize_url("https://sat.example.org/x/") == "https://sat.example.org/x"


def test_normalize_url_keeps_the_scheme_and_the_path_case(module):
    n = module._normalize_url
    assert n("http://sat.example.org/x") != n("https://sat.example.org/x")
    assert n("https://sat.example.org/X") != n("https://sat.example.org/x")
    assert n("https://sat.example.org/x?Q=1") != n("https://sat.example.org/x?q=1")


@pytest.mark.parametrize("url,host", [
    ("https://sat.example.org/x", "sat.example.org"),
    ("https://SAT.Example.org/x", "sat.example.org"),
    ("https://sat.example.org:8443/x", "sat.example.org"),
    ("https://user@sat.example.org/x", "sat.example.org"),
    ("https://sat.example.org@evil.io/x", "evil.io"),
    ("https://sat.example.org/x@y", "sat.example.org"),
    ("https://sat.example.org/x?u=a@sat.example.org", "sat.example.org"),
    ("https://sat.example.org", "sat.example.org"),
    ("https://sat.example.org#@evil.io", "sat.example.org"),
], ids=["plain", "case", "port", "userinfo", "userinfo-host", "at-in-path", "at-in-query",
        "no-path", "at-in-fragment"])
def test_host_of(module, url, host):
    assert module._host_of(url) == host


@pytest.mark.parametrize("host,domain", [
    ("data.example.org", "example.org"),
    ("sat.example.org", "example.org"),
    ("deep.tiles.sat.example.org", "example.org"),
    ("a.b.c.example.com", "example.com"),
    ("example.com", "example.com"),
    ("a.example.co.uk", "example.co.uk"),
    ("example.co.uk", "example.co.uk"),
    ("x.y.co.jp", "y.co.jp"),
    ("x.y.ac.uk", "y.ac.uk"),
    ("data.agency.gov.br", "agency.gov.br"),
    ("www.example.io", "example.io"),
    ("localhost", "localhost"),
    ("", ""),
    ("data.example.org:8443", "example.org"),
    ("DATA.Example.ORG", "example.org"),
], ids=["sub", "sat", "deep", "deep-com", "bare", "co-uk", "bare-co-uk", "co-jp", "ac-uk",
        "gov-br", "two-letter-tld", "single-label", "empty", "port", "case"])
def test_registrable_domain(module, host, domain):
    assert module._registrable_domain(host) == domain


def test_two_hosts_of_one_publisher_share_a_registrable_domain(module):
    rd = module._registrable_domain
    assert rd("sat.example.org") == rd("gis.example.org") == rd("example.org")
    assert rd("sat.example.org") != rd("assessor.example.net")
    assert rd("sat.example.org") != rd("sat.example.com")


@pytest.mark.parametrize("host,origin,ok", [
    ("sat.example.org", "sat.example.org", True),
    ("tiles.sat.example.org", "sat.example.org", True),
    ("a.b.sat.example.org", "sat.example.org", True),
    ("sat.example.org", "example.org", True),
    ("notsat.example.org", "sat.example.org", False),
    ("sat.example.org.evil.io", "sat.example.org", False),
    ("example.org", "sat.example.org", False),
    ("sat.example.net", "sat.example.org", False),
    ("sat.example.org.", "sat.example.org", False),
    ("SAT.example.org", "sat.example.org", False),      # callers lowercase the host first
    ("", "sat.example.org", False),
    ("sat.example.org", "", False),
], ids=["exact", "sub", "deep-sub", "sub-of-parent", "no-dot-boundary", "prefix",
        "parent-of-origin", "tld-swap", "trailing-dot", "case", "empty-host", "empty-origin"])
def test_matches_origin(module, host, origin, ok):
    assert module._matches_origin(host, origin) is ok


@pytest.mark.parametrize("url,ok", [
    ("https://sat.example.org/x", True),
    ("http://sat.example.org/x", True),
    ("https://ab.c", True),                                     # 12 chars, the floor
    ("https://a.b", False),                                     # 11 chars
    ("https://sat.example.org/" + "a" * 376, True),             # 400 chars, the cap
    ("https://sat.example.org/" + "a" * 377, False),            # 401 chars
    ("https://sat.example.org/x?q=1&r=2#frag", True),
    ("https://sat.example.org/~user/%20x", True),
    ("https://xn--bcher-kva.example/x", True),                  # punycode is ASCII
    ("sat.example.org/x", False),
    ("//sat.example.org/x", False),
    ("ftp://sat.example.org/x", False),
    ("HTTPS://sat.example.org/x", False),
    ("Https://sat.example.org/x", False),
    ("https://sat.example.org/café", False),
    ("https://sat.example.org/a b", False),
    ("https://sat.example.org/a\tb", False),
    ("https://sat.example.org/a\nb", False),
    ("https://sat.example.org/x'y", False),
    ('https://sat.example.org/x"y', False),
    ("https://sat.example.org/`x`", False),
    ("https://sat.example.org/<x>", False),
    ("https://sat.example.org/a|b", False),
    ("https://sat.example.org/a\\b", False),
    ("", False),
], ids=["https", "http", "floor", "below-floor", "cap", "above-cap", "query-fragment",
        "tilde-percent", "punycode", "no-scheme", "scheme-relative", "ftp", "upper-scheme",
        "mixed-scheme", "non-ascii", "space", "tab", "newline", "quote", "dquote",
        "backtick", "angle", "pipe", "backslash", "empty"])
def test_valid_url(module, url, ok):
    assert module._valid_url(url) is ok


@pytest.mark.parametrize("origin,ok", [
    ("sat.example.org", True),
    ("a.bc", True),                                # 4 chars, the floor
    ("a.b", False),                                # 3 chars
    ("a" * 116 + ".com", True),                    # 120 chars, the cap
    ("a" * 117 + ".com", False),                   # 121 chars
    ("ex-am.ple.org", True),
    ("x1.y2", True),
    ("192.168.0.1", True),
    ("localhost", False),                          # no dot
    (".example.org", False),
    ("example.org.", False),
    ("example..org", False),
    ("Example.org", False),                        # the helper lowercases nothing
    ("ex_ample.org", False),
    ("-ex.example.org", False),
    ("ex-.example.org", False),
    ("sat.example.org:443", False),
    ("https://sat.example.org", False),
    ("sat.example.org/", False),
    ("sat example.org", False),
    ("", False),
], ids=["plain", "floor", "below-floor", "cap", "above-cap", "hyphen", "digits", "ipv4",
        "no-dot", "leading-dot", "trailing-dot", "empty-label", "uppercase", "underscore",
        "label-leading-hyphen", "label-trailing-hyphen", "port", "scheme", "slash",
        "space", "empty"])
def test_valid_origin(module, origin, ok):
    assert module._valid_origin(origin) is ok
