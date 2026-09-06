"""Direct-mode harness: the real contract module run against a stub
`genlayer` that is AS STRICT AS the runtime where it matters — DynArray
refuses user construction, unknown gl attributes raise, validator functions
actually run, and a validator returning False surfaces as a failed round
rather than a settled state.

The stub mirrors the v0.6 SDK the contract targets (`import genlayer as gl`,
`gl.contract.Contract`, `gl.storage.allow`, `gl.vm.run_nondet`, UserError
carrying its text in `.data`).

Two things are mocked with intent:

  THE WEB. `gl.nondet.web.render(url)` answers the consensus clock sources
  from a controllable test clock, and every other URL from a page table the
  test fills (`page(url, text)`). A URL not in the table is unreachable. Every
  fetch is LOGGED (`fetches()`), so a test can prove that a challenge round
  re-read the recorded snapshot and did NOT refetch the original sources.

  THE PANEL. Successive exec_prompt calls walk a queue and the last entry
  repeats, so a test can hand the leader and the validator different answers
  and prove the comparison logic notices.
"""

import importlib.util
import json
import pathlib
import sys
import types

import pytest

CONTRACT_PATH = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "verda.py"

OPERATOR = "0x1111111111111111111111111111111111111111"
FUNDER = "0x2222222222222222222222222222222222222222"
STRANGER = "0x5555555555555555555555555555555555555555"

GEN = 10**18
REWARD = 10**17             # the canonical test reward: 0.1 GEN
BOND = 5 * 10**16           # bond floor dominates at this reward size
TARGET = 500                # hectares
THRESHOLD = 9_000           # 90.00%
W = 900                     # every window at the enforced minimum
DEADLINE_IN = 1_000         # seconds after drafting

TERMS = (
    "IMPACT AGREEMENT — Rio Verde restoration block, Para, Brazil. OUTCOME: "
    "hectares of degraded forest restored by active planting or assisted "
    "natural regeneration inside polygon RV-7 (the block described in the "
    "restoration plan of record). A hectare counts as restored when canopy "
    "cover exceeds 30 percent as read from satellite imagery, or when an "
    "independent field assessor certifies survival of at least 1,100 stems "
    "per hectare. Work outside polygon RV-7 does not count. Forecasts, plans "
    "and planted-but-unverified areas do not count. TARGET: 500 hectares by "
    "the deadline. REWARD: pro rata to verified hectares over the target, "
    "payable only if verified hectares reach 90 percent of the target."
)

BASIS = [
    {"kind": "SATELLITE_OBSERVATION", "origin": "sat.example.org", "class": "INDEPENDENT"},
    {"kind": "INDEPENDENT_ASSESSMENT", "origin": "assessor.example.net", "class": "INDEPENDENT"},
    {"kind": "PROJECT_REPORT", "origin": "operator.example.com", "class": "OPERATOR"},
]

SAT_URL = "https://sat.example.org/observations/rv-7/2026-q3.txt"
ASSESSOR_URL = "https://assessor.example.net/audits/rv-7-final.html"
OPERATOR_URL = "https://operator.example.com/reports/rv-7-completion"
SAT_URL_TWIN = "https://sat.example.org/observations/rv-7/2026-q3-summary.txt"

SAT_PAGE = (
    "SATELLITE OBSERVATION SUMMARY — polygon RV-7, Para, Brazil. Sentinel-2 "
    "composite, acquisition window 2026-08-01 to 2026-08-28. Canopy cover "
    "above 30 percent detected on 463 hectares of the 500-hectare polygon. "
    "Method: NDVI threshold classification, 10 m resolution, cloud-masked."
)
ASSESSOR_PAGE = (
    "INDEPENDENT FIELD ASSESSMENT — RV-7 restoration block. Field survey of "
    "40 plots, 2026-08-20 to 2026-08-24. Stem survival at or above 1,100 per "
    "hectare certified on 460 hectares. Assessor: Instituto Verde Campo."
)
OPERATOR_PAGE = (
    "PROJECT COMPLETION REPORT — Rio Verde restoration, block RV-7. The team "
    "planted and maintained 480 hectares across the polygon between "
    "2025-10 and 2026-08. Survival monitoring continues."
)

# Test wall-clock. Tests advance it to pass real time.
_NOW = [1_760_000_000]
_SKEW = {}
_DEAD = set()
_PAGES = {}
_FETCHES = []
_PANEL = []
_PANEL_CALLS = [0]
_SENT = []
_PROMPTS = []
_RUN_DRIFT = []
_RUN_INDEX = [-1]


class _UserError(Exception):
    """v0.6 shape: the text lives in .data; str() returns it so that
    pytest.raises(match=...) reads the message."""
    def __init__(self, data):
        super().__init__(data)
        self.data = data

    def __str__(self):
        return str(self.data)


class _VMError:
    def __init__(self, message):
        self.message = message


class _Return:
    def __init__(self, calldata):
        self.calldata = calldata


def _run_nondet(leader_fn, validator_fn):
    """gl.vm.run_nondet: the leader runs; the validator sees Return(value)
    or the leader's UserError instance and answers a bool. False (or an
    escaping exception) is a disagreement — the round fails and nothing is
    written. A leader failure the validator endorses propagates as that
    same error."""
    try:
        value = leader_fn()
    except _UserError as e:
        try:
            agreed = validator_fn(e)
        except Exception:
            agreed = False
        if agreed:
            raise _UserError(e.data)
        raise _UserError("[LLM_ERROR] validators disagreed with the leader's failure")
    except Exception as e:
        try:
            agreed = validator_fn(_VMError(str(e)))
        except Exception:
            agreed = False
        if agreed:
            raise _UserError(str(e))
        raise _UserError("[LLM_ERROR] validators disagreed with the leader's failure")
    try:
        ok = validator_fn(_Return(value))
    except Exception:
        ok = False
    if not ok:
        raise _UserError("[LLM_ERROR] validators did not agree with the leader")
    return value


class _TreeMap(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class _U256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


class _DynArrayMeta(type):
    def __getitem__(cls, item):
        return cls


class _DynArray(list, metaclass=_DynArrayMeta):
    """Refuses user construction exactly like the runtime."""

    def __init__(self, *args, **kwargs):
        raise TypeError("this class can't be instantiated by user")

    @classmethod
    def _from_storage(cls, items=()):
        obj = list.__new__(cls)
        list.__init__(obj, items)
        return obj


class _TreeMapType(_TreeMap):
    """gl.TreeMap[K, V] in an annotation and gl.TreeMap() in a fixture."""
    def __class_getitem__(cls, item):
        return cls


class _Address(str):
    def __new__(cls, v):
        return super().__new__(cls, str(v))

    @property
    def as_hex(self):
        return str(self)


class _CliAddress:
    """What the genlayer CLI delivers for a 40-hex argument: an Address
    OBJECT with .as_hex and no str methods."""
    def __init__(self, hex_str):
        self.as_hex = hex_str

    def __repr__(self):
        return f"<Address {self.as_hex}>"


class _ViewDeco:
    def __call__(self, fn):
        return fn


class _WriteDeco:
    payable = staticmethod(lambda fn: fn)

    def __call__(self, fn):
        return fn


class _Public:
    view = _ViewDeco()
    write = _WriteDeco()


class _EvmProxyInstance:
    """The v0.6 runner's EVM proxy: emit_transfer(value) and nothing else —
    an `on=` keyword is a TypeError on-chain, so it is one here too."""
    def __init__(self, addr):
        self._addr = addr

    def emit_transfer(self, value):
        _SENT.append((str(self._addr).lower(), int(value)))


def _contract_interface(cls):
    return lambda addr: _EvmProxyInstance(addr)


class _NondetWeb:
    @staticmethod
    def post(url, body=None, headers=None):
        raise AssertionError(f"unexpected POST: {url}")

    @staticmethod
    def get(url, **kw):
        raise AssertionError(f"unexpected GET: {url}")

    @staticmethod
    def render(url, mode="text"):
        for dead in _DEAD:
            if dead in url:
                raise RuntimeError("source unreachable")
        is_clock = ("cdn-cgi/trace" in url or "blockscout" in url
                    or "headers/head" in url)
        if not is_clock:
            _FETCHES.append(url)
            if url in _PAGES:
                return _PAGES[url]
            raise RuntimeError("source unreachable")
        skew = next((v for k, v in _SKEW.items() if k in url), 0)
        if "cloudflare.com/cdn-cgi/trace" in url:
            _RUN_INDEX[0] += 1
        drift = 0
        if _RUN_DRIFT:
            drift = _RUN_DRIFT[min(max(_RUN_INDEX[0], 0), len(_RUN_DRIFT) - 1)]
        if drift == "DEAD":
            raise RuntimeError("source unreachable")
        now = _NOW[0] + skew + (drift if isinstance(drift, int) else 0)
        if "cdn-cgi/trace" in url:
            return f"fl=1\nts={now}.000\n"
        if "blockscout" in url:
            import datetime as _dt
            t = _dt.datetime.fromtimestamp(now, _dt.timezone.utc)
            return json.dumps([{"timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.000000Z")}])
        if "headers/head" in url:
            slot = (now - 1606824023) // 12
            return json.dumps({"data": {"header": {"message": {"slot": str(slot)}}}})
        return ""


def _exec_prompt(prompt, response_format=None):
    _PROMPTS.append(prompt)
    if not _PANEL:
        raise AssertionError("test ran the panel without panel_says()")
    idx = min(_PANEL_CALLS[0], len(_PANEL) - 1)
    _PANEL_CALLS[0] += 1
    answer = _PANEL[idx]
    if isinstance(answer, BaseException):
        raise answer
    return answer


def _install():
    """Build the `genlayer` package the contract imports: `import genlayer as
    gl` plus `from genlayer.types import *`."""
    gl = types.ModuleType("genlayer")
    gl.IS_IN_VM = False
    gl.TreeMap = _TreeMapType
    gl.DynArray = _DynArray
    gl.public = _Public()

    gl.contract = types.SimpleNamespace(Contract=type("Contract", (), {}))
    gl.storage = types.SimpleNamespace(allow=lambda cls: cls, TreeMap=_TreeMapType,
                                       DynArray=_DynArray)
    gl.vm = types.SimpleNamespace(UserError=_UserError, VMError=_VMError,
                                  Return=_Return, run_nondet=_run_nondet)
    gl.nondet = types.SimpleNamespace(web=_NondetWeb(), exec_prompt=_exec_prompt)
    gl.evm = types.SimpleNamespace(contract_interface=_contract_interface)
    gl.message = types.SimpleNamespace(sender_address=OPERATOR, value=0)

    gl_types = types.ModuleType("genlayer.types")
    gl_types.u256 = _U256
    gl_types.Address = _Address
    gl_types.__all__ = ["u256", "Address"]
    gl.types = gl_types

    sys.modules["genlayer"] = gl
    sys.modules["genlayer.types"] = gl_types
    return gl


def _load():
    _install()
    spec = importlib.util.spec_from_file_location("verda_contract", CONTRACT_PATH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def module():
    return _load()


@pytest.fixture
def c(module):
    _NOW[0] = 1_760_000_000
    _SKEW.clear()
    _DEAD.clear()
    _PAGES.clear()
    _FETCHES.clear()
    _SENT.clear()
    _PROMPTS.clear()
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _RUN_DRIFT.clear()
    _RUN_INDEX[0] = -1

    page(SAT_URL, SAT_PAGE)
    page(ASSESSOR_URL, ASSESSOR_PAGE)
    page(OPERATOR_URL, OPERATOR_PAGE)
    page(SAT_URL_TWIN, SAT_PAGE)

    as_(module, OPERATOR, 0)
    inst = module.Verda()
    for name in ("agreements", "terms_store", "basis_store", "packages",
                 "dossiers", "actor_index", "claimable"):
        setattr(inst, name, module.gl.TreeMap())
    inst.agreement_ids = _DynArray._from_storage()
    return inst


# ── helpers ──────────────────────────────────────────────────────────────────

def as_(module, who, value=0):
    module.gl.message.sender_address = who
    module.gl.message.value = value


def now():
    return _NOW[0]


def advance(seconds):
    _NOW[0] += seconds


def sent():
    return list(_SENT)


def prompts():
    return list(_PROMPTS)


def fetches():
    """Every non-clock URL the panel fetched, in order, across all rounds."""
    return list(_FETCHES)


def clear_fetches():
    _FETCHES.clear()


def page(url, text):
    _PAGES[url] = text


def clock_drift(*offsets):
    _RUN_DRIFT.clear()
    _RUN_INDEX[0] = -1
    _RUN_DRIFT.extend(offsets)


def skew(fragment, seconds):
    _SKEW[fragment] = seconds


def dead(fragment):
    _DEAD.add(fragment)


def err(module):
    return module.gl.vm.UserError


def conserve(module, c):
    """The wei invariant: everything the contract physically holds is either
    a locked reward (funded, pending or final), an unclaimed ledger balance,
    or an undecided challenge bond."""
    locked = sum(int(ag.max_reward) for ag in c.agreements.values()
                 if ag.status in ("FUNDED", "PENDING_FINALITY", "FINAL"))
    ledger = sum(int(v) for v in c.claimable.values())
    bonds = sum(int(ag.challenge_bond_atto) for ag in c.agreements.values())
    assert int(c.escrow_atto) == locked + ledger + bonds, (
        f"conservation broken: escrow={int(c.escrow_atto)} "
        f"locked={locked} ledger={ledger} bonds={bonds}")


def source(url, label="Source"):
    return {"url": url, "label": label}


def demo_sources():
    """The canonical package: one independent satellite page (463 ha) and
    the operator's own report (480 ha). Verified rests on the satellite."""
    return [source(SAT_URL, "Satellite observation summary"),
            source(OPERATOR_URL, "Project completion report")]


def answer(figures=None, evidence="SUFFICIENT", conflicts=None, score=88,
           reason="the satellite page states the figure for the polygon",
           scope_ok=True, kind_matches=True, **over):
    """A complete, valid panel answer. Defaults describe demo_sources():
    EV-001 (satellite, independent) states 463, EV-002 (operator) states 480
    -> verified 463 of 500 = 92.6% -> QUALIFIED. A figure given as a dict
    overrides scope_ok / kind_matches for that one source."""
    figures = figures if figures is not None else {"EV-001": 463, "EV-002": 480}
    srcs = []
    for sid, fig in figures.items():
        entry = {"id": sid, "figure": fig, "scope_ok": scope_ok,
                 "kind_matches": kind_matches}
        if isinstance(fig, dict):
            entry = {"id": sid, "figure": fig.get("figure"),
                     "scope_ok": fig.get("scope_ok", scope_ok),
                     "kind_matches": fig.get("kind_matches", kind_matches)}
        srcs.append(entry)
    ans = {"sources": srcs, "evidence": evidence, "conflicts": conflicts or [],
           "score": score, "reason": reason}
    ans.update(over)
    return ans


def panel_says(ans):
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _PANEL.append(ans)


def panel_sequence(*answers):
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _PANEL.extend(answers)


# ── lifecycle helpers ────────────────────────────────────────────────────────

def drafted(module, c, reward=REWARD, target=TARGET, threshold=THRESHOLD,
            min_independent=1, deadline_in=DEADLINE_IN, grace=W,
            windows=(W, W), terms=TERMS, basis=None, title="Rio Verde restoration",
            region="Para, Brazil", metric="hectares of degraded forest restored",
            unit="hectares"):
    as_(module, OPERATOR, 0)
    return c.draft_agreement(
        title, region, metric, unit, target, threshold, min_independent,
        str(reward), now() + deadline_in, grace, windows[0], windows[1],
        terms, json.dumps(basis if basis is not None else BASIS))


def funded(module, c, **kw):
    reward = kw.get("reward", REWARD)
    aid = drafted(module, c, **kw)
    as_(module, FUNDER, reward)
    c.fund(aid)
    return aid


def submitted(module, c, sources=None, claimed=463, **kw):
    aid = funded(module, c, **kw)
    as_(module, OPERATOR, 0)
    c.submit_evidence(aid, claimed, json.dumps(sources or demo_sources()))
    return aid


def past_deadline(deadline_in=DEADLINE_IN):
    """Move the clock just past the default deadline."""
    advance(deadline_in + 1)


def adjudicated(module, c, ans=None, sources=None, claimed=463, **kw):
    aid = submitted(module, c, sources=sources, claimed=claimed, **kw)
    past_deadline(kw.get("deadline_in", DEADLINE_IN))
    panel_says(ans or answer())
    as_(module, STRANGER, 0)
    c.adjudicate(aid)
    return aid


def final(module, c, **kw):
    aid = adjudicated(module, c, **kw)
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.promote(aid)
    return aid


def settled(module, c, **kw):
    aid = final(module, c, **kw)
    advance(W + 1)
    as_(module, STRANGER, 0)
    c.settle(aid)
    return aid


def agreement(c, aid):
    return json.loads(c.get_agreement(aid))


def dossier(c, aid, version):
    raw = c.get_dossier(aid, version)
    return json.loads(raw) if raw else None


def package(c, aid, version):
    raw = c.get_package(aid, version)
    return json.loads(raw) if raw else None
