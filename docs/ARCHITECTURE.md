# Architecture

Verda is one Intelligent Contract (`contracts/verda.py`, class `Verda`) and a
Next.js reader/signer (`web/`). Everything that decides money runs inside the
contract; the web app reads state and asks a wallet to sign. References below
are to symbols, never to line numbers.

## 1. The separation that makes the design credible

```
                 the panel                          the code
        ┌───────────────────────────┐    ┌──────────────────────────────────┐
        │ fetch every source itself │    │ _derive_verdict                  │
        │ read: figure per source,  │ →  │   QUALIFIED / NOT_QUALIFIED /    │
        │   scope_ok, kind_matches, │    │   INCONCLUSIVE(hold_reason)      │
        │   record sufficiency      │    │   verified_impact                │
        └───────────────────────────┘    │ settle: verified/target × reward │
                                         └──────────────────────────────────┘
```

The model never returns a verdict and never sees an amount. It returns
READINGS — for each source, the whole-unit figure the page itself states for
this project (or null), whether the page is on scope, and whether the page is
what its agreed label says; for the record as a whole, a sufficiency flag, a
conflict list from a fixed vocabulary, and a confidence score.
`_derive_verdict` — pure code, run identically inside the leader and every
validator — composes the verdict and the verified figure from those readings.
`settle` converts the verified figure into payment with integer arithmetic.

## 2. Actors and lifecycle

| Actor | Writes | Signs with |
|---|---|---|
| Operator | `draft_agreement`, `cancel_draft`, `submit_evidence`, `challenge` | own wallet |
| Funder | `fund` (= assent), `challenge` | own wallet |
| Anyone | `adjudicate`, `promote`, `re_adjudicate`, `lapse_challenge`, `settle`, `reclaim` | any wallet |
| Payees | `claim` | own wallet |

```
DRAFT ─fund─▶ FUNDED ─submit_evidence─▶ FUNDED(v1) ─adjudicate (after the deadline)─▶ PENDING_FINALITY
  │cancel_draft                              ▲                                              │promote
  ▼                                          │ INCONCLUSIVE hold (resubmit, or reclaim      ▼
CANCELLED                                    └── after deadline + grace)          FINAL ─challenge (bond)─▶ challenge open
                                                                                    │                       │ re_adjudicate → PENDING_FINALITY
FUNDED ─reclaim (deadline + grace passed, nothing pending)─▶ RECLAIMED              │                       │ lapse_challenge → snapshot restored
                                                                                    └─settle (after the challenge window)─▶ SETTLED
```

There is no owner. `__init__` sets counters. Every non-terminal state has a
permissionless exit (`promote`, `settle`, `reclaim`, `lapse_challenge`), so no
agreement can be held hostage to one party's availability.

## 3. The agreement and its evidence basis

`draft_agreement` freezes, in one hash (`terms_sha256`): the outcome
(`metric`, `unit`, `target`), the money rule (`threshold_bps`, `max_reward`),
`min_independent`, the deadline and the three windows, the terms text, and the
**evidence basis** — 1–6 entries of `{kind, origin, class}` validated by
`_clean_basis`:

- `kind` from `SOURCE_KINDS`; `origin` a lowercase hostname (`_valid_origin`);
  `class` INDEPENDENT or OPERATOR.
- At least one INDEPENDENT origin, and `min_independent` may not exceed the
  number of distinct independent PUBLISHERS (`_registrable_domain`) — an
  agreement that could never be satisfied is refused at drafting.

`fund` is mutual assent: whoever deposits exactly `max_reward` becomes the
funder, and from then on the basis is what both wallets signed. The labels in
it are bilateral, and the panel is still told they are labels (section 6).

## 4. Evidence packages — independence, not diversity

`submit_evidence` files a complete package (a version): 1–6 `{url, label}`
rows and the operator's `claimed_impact`. `_clean_rows` enforces:

- **Origin membership.** A URL's host (`_host_of`, via `_split_url`) must
  equal an agreed origin or be a subdomain of it (`_matches_origin`); the
  longest matching origin wins. The row INHERITS that entry's kind and class —
  the submitter declares no label.
- **URL hygiene.** Printable ASCII, no quotes, backslash or `|` (`_valid_url`);
  the URL is interpolated into the contract's own pipe-delimited fence header,
  so `|` is refused rather than escaped. `_split_url` ends the authority at the
  first of `/`, `?`, `#` — cutting at `/` alone let a query-borne `@` smuggle a
  basis host.
- **One page is one source (S35).** `_normalize_url` lowercases scheme and
  host, drops the default port, the fragment and a trailing slash; a normalized
  duplicate — against the new rows and against the existing record — is
  refused.
- **At least one INDEPENDENT row**, because an operator-only record cannot
  carry a payout (section 5).

Versions are whole replacements, at most `MAX_VERSIONS`; earlier packages stay
readable (`get_package`). One judgment per version — `adjudicate` refuses a
version that already has a dossier.

## 5. The derivation (pure code, inside every validator)

`_usable_rows` keeps a row only if it is INDEPENDENT class, readable this
round, `scope_ok`, `kind_matches`, and states a sane figure. Then
`_derive_verdict(target, threshold_bps, min_independent, claimed, evidence_flag, rows)`:

```
evidence_flag != SUFFICIENT                       → INCONCLUSIVE · EVIDENCE_INSUFFICIENT
distinct publishers among usable < min_independent → INCONCLUSIVE · UNCORROBORATED
spread of usable figures > 15% of the highest      → INCONCLUSIVE · SOURCES_CONTRADICT
verified = min(lowest usable figure, claimed_impact, target)
verified × 10000 < target × threshold_bps          → NOT_QUALIFIED · verified
otherwise                                          → QUALIFIED · verified
```

Publishers are counted by registrable domain: two pages on `sat.example.org`
are one voice. Operator rows never enter the arithmetic — they may inform the
panel's reading of the independent pages, nothing more. The verified figure
is the LOWEST independent reading, never above the operator's own claim, never
above the target: a funder pays for what the least generous independent
reading supports.

`_payout_atto(verified, target, max_reward)` = `verified × max_reward // target`,
capped at the reward. `settle` credits it to the operator and the remainder to
the funder; NOT_QUALIFIED credits the whole reward to the funder. The
threshold is a cliff by agreement, stated in the terms both wallets signed.

## 6. The panel round (`_panel_round`)

One `gl.vm.run_nondet(judge, validator_fn)` call. `judge` runs on the leader
AND on every validator, each time from scratch:

1. For each row, FETCH the page itself (`gl.nondet.web.render`, text mode),
   defang fence delimiters (`_defang`), keep at most `MAX_EXCERPT_CHARS`, and
   record `readable`, `excerpt`, `digest = sha256(excerpt)`, `fetch_epoch`
   and a `basis` tag. Nobody relays a page to anybody.
2. Build the prompt: verified facts (target, threshold, `min_independent`,
   the operator's claim, the agreed basis table), the terms inside a fence,
   and one fence per source whose HEADER names the agreed kind and class, the
   publisher, how the bytes reached this round, and whether it was readable.
3. Parse the model's JSON and validate every field structurally (S16): a
   missing reading, a non-boolean, a figure out of range, an enum miss, a
   non-numeric score — each raises `[LLM_ERROR]`, so consensus never agrees on
   garbage. An unreadable row's figure is forced to null whatever the model
   said.
4. Derive the verdict (section 5) and return the readings, the verdict, the
   verified figure, the hold reason and the rows.

`validator_fn` reruns `judge` and compares:

| compared exactly | banded | free |
|---|---|---|
| verdict, verified_impact, hold_reason, evidence_flag | score (±1 bucket of 10) | reason prose, soft conflicts |
| per row: id, url, host, domain, kind, class, basis, basis_round, readable | | excerpt bytes of a FETCHED row (two honest fetches of a live page differ) |
| per INDEPENDENT row: figure, scope_ok, kind_matches | | readings on OPERATOR rows |
| every row's digest covers the bytes the leader STORED | | |
| RECORDED rows: excerpt and fetch_epoch byte-identical | | |
| the leader's own arithmetic: `_derive_verdict` over the leader's rows reproduces the leader's verdict, figure and hold reason | | |

A leader whose rows do not produce its verdict is refused regardless of
anything else. A validator whose own rerun fails returns False — the honest
answer of a node that learned nothing it can endorse — and the round rotates.

The prompt tells the panel that every label is a label the two parties agreed,
never a verified fact, and instructs it to judge the page as what it shows
itself to be, counting a mislabel against the case the label was chosen to
help (`kind_matches`, `SOURCE_MISLABELLED`). It also states that two pages on
one publisher are one voice, that an operator report is one interested voice,
and that an unreachable source is evidence against nobody.

## 7. Deferral, challenge, and snapshot continuity

A verdict assigns nothing when it lands. `adjudicate` stores the dossier and
arms `finality_window`; `promote` (anyone, after the window) makes it state:
FINAL with a `challenge_window`, or the INCONCLUSIVE hold that returns the
agreement to FUNDED with `hold_reason` set.

`challenge` (either party, FINAL, inside the window, exact bond
`_bond_for` = max(0.05 GEN, 5% of the reward)) freezes a snapshot of the
challenged state (`challenge_snapshot`) and appends ONE optional new source as
the next version, labelled `[CHALLENGER]`.

`re_adjudicate` (anyone) is where S36 lives. Before the round,
`_dossier_intact` re-hashes every stored excerpt of the challenged dossier
against its digest. In `judge`, a row that existed in the challenged round is
NOT refetched: its excerpt, `readable` and `fetch_epoch` are read from the
record and tagged `RECORDED`; only the challenger's row is fetched, tagged
`NEW`. The prompt says which is which per source and that the RECORDED rows
are exactly what the first panel read. Validators compare RECORDED excerpts
byte-for-byte (both nodes read the same stored bytes) and compare the basis
tag per row, so a leader cannot quietly refetch and present a changed page as
the record.

The bond routes deterministically: a changed verdict OR a changed verified
figure returns it to the challenger; otherwise it goes to the other party.
`lapse_challenge` (anyone, after `STALE_CHALLENGE_SECONDS`) restores the
snapshot exactly — status, verdict, figure, judged version, evidence version
and root — and returns the bond (S29).

## 8. Money

- `fund` locks exactly `max_reward`; `escrow_atto` tracks deposits minus
  claims; nothing is pooled across agreements (S23).
- `settle` is atomic (S24): status, ledger and counters move together, or the
  call refuses. It refuses inside the challenge window, with a challenge open,
  on anything but QUALIFIED/NOT_QUALIFIED, and over a non-SUFFICIENT record
  (S22, defense in depth — `promote` already coerces such a verdict to
  INCONCLUSIVE).
- `reclaim` (anyone) returns the reward to the funder once the submission
  grace after the deadline has passed with nothing pending or final; an
  unjudged submission gets a full finality window of patience first (S17).
- `_credit` is the only way value is allocated; `claim` is the only way it
  leaves — pull payments through the empty EVM proxy `_Payee`,
  `emit_transfer(value=…)`. The claimant's transaction budgets the outgoing
  transfer (Studio Next requires a message fee allocation; the web app and
  the arc derive it by simulating the write).
- Invariant, asserted by the suite after every money-moving path:
  `escrow_atto == Σ locked rewards (FUNDED/PENDING_FINALITY/FINAL) + Σ ledger + Σ open bonds`.

## 9. Time

Every window is wall-clock (S13) from `_utc_now`: three `cdn-cgi/trace`
edges (minimum taken, mutual divergence over 300s refused), an execution-layer
block as a floor that fails open, and two beacon heads as a fail-closed bound
in both directions (S20). No witness, no clock: every timed write refuses with
`[TRANSIENT]` and writes nothing — including `cancel_draft`, which reads the
clock before it changes state. Windows are at least 900s (three clock
tolerances). Adjudication is refused until the deadline has passed.

## 10. Error taxonomy

`[EXPECTED]` business refusals and `[EXTERNAL]` source answers are
deterministic and must match between leader and validator; `[TRANSIENT]`
agrees when both saw a blip; `[LLM_ERROR]` always disagrees, rotating the
round rather than settling on a malformed answer. A failed round writes
nothing and the permissionless crank turns again.

## 11. Views

`get_agreement` (with terms and basis), `get_agreements(offset, limit)`
(newest first, one bounded page — never a full scan), `get_agreements_for`,
`get_package`, `get_dossier`, `get_claimable`, `get_stats`, `get_config` (every
bound the writes enforce, so the frontend never guesses a limit).

## 12. Honest limitations

- The contract enforces WHERE evidence may come from and counts independence
  by publisher; it cannot verify that a publisher is in fact independent of
  the operator in the world. That judgement is made by the two parties when
  they sign the basis, and the README says so.
- Two honest fetches of a live page can differ; the record binds the bytes
  the leader stored (digest) and the readings the panel agreed, not a claim
  that every node saw identical bytes. A challenge round re-reads the stored
  bytes rather than the live page for exactly this reason.
- `_registrable_domain` is a small suffix heuristic (two labels, three for
  `co.uk`-style suffixes), stated rather than hidden; it is not the Public
  Suffix List.
- The demo fixtures are three CDN origins mirroring one commit of this
  repository (`evidence/README.md`); the mechanism is exercised exactly, the
  publishers' independence is not demonstrated by them.
