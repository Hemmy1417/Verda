# Verda — build specification

> Outcome-based environmental funding, adjudicated by GenLayer.
> Funding is locked against a predefined outcome; a validator panel reads the
> evidence the contract fetches itself; deterministic code converts verified
> impact into payment. The panel answers "what happened"; the contract answers
> "what is owed".

This document is the briefing the build executes. Every judge standard S1–S38
in the portfolio ledger is folded in below by construction, not bolted on.

---

## 1. The product in one paragraph

A project operator drafts an **Impact Agreement**: one measurable outcome (a
metric, a unit, a target), a deadline, a qualification threshold, a maximum
reward in GEN, the agreement text, and an **evidence basis** — the source
classes the panel may read, each with the web origin it must come from and
whether the two parties regard it as independent of the operator. A funder
counter-signs by depositing exactly the maximum reward. The work happens in the
world. After the deadline, the operator submits an evidence package of URLs
that fall inside the frozen basis. Anyone triggers adjudication: leader and
validators each fetch every source themselves, record a snapshot, extract the
figure each source states for this project, and deterministic code — run
identically inside every validator — derives QUALIFIED / NOT_QUALIFIED /
INCONCLUSIVE and the verified impact. After a deferral window and a bonded
challenge window, settlement pays `verified / target × max_reward` to the
operator and returns the remainder to the funder.

## 2. Actors

| Actor | Does | Signs |
|---|---|---|
| Operator | drafts the agreement, submits evidence packages, may challenge | own wallet |
| Funder | funds (= assent), may challenge, reclaims on lapse | own wallet |
| Anyone | adjudicate, promote, re-adjudicate, lapse, settle, reclaim (keeper calls) | any wallet |

No owner. `__init__` sets counters only.

## 3. Lifecycle

```
DRAFT ──fund (exact max_reward, funder ≠ operator)──▶ FUNDED
  │ cancel_draft (operator)                            │ submit_evidence (operator; before deadline+grace)
  ▼                                                    │ adjudicate (anyone; only AFTER the deadline)
CANCELLED                                              ▼
                                                PENDING_FINALITY ──promote (anyone, after finality window)──▶
                                                       │
                       INCONCLUSIVE ◀──────────────────┼──────────────────▶ QUALIFIED / NOT_QUALIFIED
                       (hold: back to FUNDED,                                        │ FINAL
                        operator may resubmit; funder                                │ challenge (bond, ≤ window)
                        reclaims after deadline+grace)                               ▼
                                                                      re_adjudicate / lapse_challenge
                                                                                     │
                                                                      settle (anyone, after challenge window)
                                                                                     ▼
                                                                                  SETTLED
FUNDED ──reclaim (anyone; after deadline+grace, no verdict pending/final, no open challenge)──▶ RECLAIMED
```

Every non-terminal state names who moves it and what happens if nobody does
(S26): DRAFT — operator cancels, or it sits unfunded holding nothing.
FUNDED — operator submits; if never, the funder reclaims after the grace.
PENDING_FINALITY — anyone promotes. FINAL — anyone settles after the window.
Challenge open — anyone re-adjudicates; after the stale window anyone lapses it.

## 4. The evidence model (the reviewer-shaped part)

**Basis, frozen at draft and accepted by funding (S18).** 1–6 entries of
`{kind, origin, class}`:

- `kind` ∈ SATELLITE_OBSERVATION · INDEPENDENT_ASSESSMENT · GOVERNMENT_REGISTRY ·
  FIELD_MEASUREMENT · PROJECT_REPORT · PHOTOGRAPHIC_RECORD · OTHER
- `origin` = a hostname (lowercase ASCII, one dot at least). A submitted URL
  matches an origin when its host equals it or is a subdomain of it.
- `class` ∈ INDEPENDENT | OPERATOR — whether both parties regard sources from
  this origin as independent of the operator. This label is bilateral (both
  wallets signed the hash it lives in), and the panel is still told it is a
  label, not a verified fact, and is instructed to judge the page as what it
  shows itself to be (S31 mislabel guardrail: `kind_matches` per source).

**Package (an evidence version).** 1–6 `{url, label}` rows plus
`claimed_impact`. Each URL must be printable ASCII, no `|`, must match a basis
origin — the row **inherits** kind and class from the basis entry; the
operator declares no label at all. Rules enforced at intake, in code:

- **S35 independence ≠ diversity.** URLs are normalized (lowercase scheme and
  host, default port dropped, fragment dropped, trailing slash dropped);
  duplicates are refused. The number of DISTINCT registrable domains among
  INDEPENDENT-class rows is what corroboration counts — two pages on one
  publisher are one voice. The agreement's `min_independent` (1–3) says how
  many independent domains must state a usable figure before money can move.
- At least one INDEPENDENT-class row per package.
- One judgment per version; a new version is a full replacement package
  (max 4 versions); prior versions stay on-chain.

**Snapshot (S8/S21/S36).** At each judged round every row records `url`,
`basis` (FETCHED_THIS_ROUND | RECORDED_AT_ROUND_n | NEW_BY_CHALLENGER),
`fetch_epoch`, `readable`, `excerpt` (defanged text, ≤ 6000 chars — the bytes
STORED) and `digest = sha256(excerpt)`. The digest covers exactly the stored
bytes so anyone can re-check it forever.

**Appeal continuity (S14/S28/S36).** A challenge round does NOT refetch the
original sources: it reads the recorded excerpts of the challenged round after
verifying every digest (`_dossier_intact`), and fetches live ONLY the
challenger's new source. Each fence header names which it is, so the appeal
model states explicitly what is reconsidered and what is newly introduced.

## 5. What the model returns, and what code derives

The model returns per-source readings and a record-level sufficiency flag —
never a verdict, never an amount (the Factora/Adjudex move):

```json
{"sources": [{"id": "EV-001", "figure": 463, "scope_ok": true, "kind_matches": true}, …],
 "evidence": "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT",
 "conflicts": ["FABRICATION_INDICATED", …],
 "score": 0-100,
 "reason": "…"}
```

`figure` = the whole-unit quantity the source ITSELF states for this project,
geography and period, or null. `scope_ok` = the source addresses this project
and period. `kind_matches` = the page is what the agreed kind says it is.

`_derive_verdict` (pure code, inside every validator):

```
evidence != SUFFICIENT                                  → INCONCLUSIVE · EVIDENCE_INSUFFICIENT   (S22)
usable = INDEPENDENT ∧ readable ∧ scope_ok ∧ kind_matches ∧ 0 ≤ figure ≤ MAX_FIGURE
distinct registrable domains among usable < min_independent → INCONCLUSIVE · UNCORROBORATED     (S34/S35)
spread of usable figures > 15% of the highest             → INCONCLUSIVE · SOURCES_CONTRADICT
verified = min(lowest usable figure, claimed_impact, target)
verified × 10000 < target × threshold_bps                 → NOT_QUALIFIED · verified
otherwise                                                → QUALIFIED · verified
```

Operator-class sources never raise the verified figure; they may only inform.
Payout at settle: `verified × max_reward // target` to the operator,
remainder to the funder; NOT_QUALIFIED returns everything to the funder (the
threshold is a cliff by agreement — a funder pays for the outcome).

**Equivalence (S7/S16/S21/S28/S39).** Exact: verdict, verified_impact, hold
reason, evidence flag, per-row url/class/kind/basis/readable, per-row figure /
scope_ok / kind_matches for INDEPENDENT rows, digest-covers-own-excerpt, and —
on every readable FETCHED or NEW row — **the excerpt itself, corroborated by
this validator's own fetch**. Re-derived: the leader's verdict from the
leader's own rows (a leader whose rows do not produce its verdict is refused).
Banded: score ±1 bucket of 10. Free: reason prose, soft conflicts,
operator-row readings.

**Fresh-source provenance.** An earlier version of this spec left excerpt
bytes free on FETCHED rows, reasoning that honest fetches of a live page differ
and that the digest binds the record. The digest binds the record only to the
bytes the LEADER chose: it proves self-consistency and certifies nothing about
the page. Since a challenge re-reads those bytes as RECORDED, a leader could
store a passage no other node saw and every later challenge would inherit a
fabricated but internally consistent dossier.

So the bytes are bound where they enter the record. Both nodes build the
excerpt as the leading 6000 characters of the same defanged page, so on the
same page one is necessarily a prefix of the other — equal when the renders
agree, prefix-compatible when one ran longer. Text the validator did not fetch
satisfies neither. A readable row must carry bytes: the empty string is a
prefix of every page and would otherwise pass for free.

The trade-off, stated rather than hidden: a page whose TEXT genuinely changes
between two nodes' fetches now refuses the round instead of recording one
node's version. That is the safe direction — a refused round moves nothing and
can be re-run — and it is the price of a record that proves what was read.

## 6. Money (S3/S4/S9/S17/S23/S24/S32)

- Funding is exact and per agreement: nothing pooled, nothing shared.
- A verdict assigns nothing when it lands; promote after the finality window
  makes it state; settle after the challenge window moves money — atomically.
- Challenge bond = max(0.05 GEN, 5% of max_reward). Changed verdict → bond back
  to the challenger; unchanged → bond to the other party.
- `claim()` is the only external value path (pull payments, `_Payee` proxy,
  `on="finalized"`).
- Reclaim: after `deadline + submission_grace` AND `last_submit + finality_window`,
  with no verdict pending or final and no open challenge, anyone returns the
  reward to the funder's ledger. Unilateral, permissionless, wall-clock (S13/S17).
- Wei conservation invariant in the suite: escrow == Σ locked rewards +
  Σ ledger + Σ undecided bonds.

## 7. Clock, windows, fail-safe (S5/S13/S20)

Adjudex's consensus clock verbatim: three cdn-cgi/trace edges (min, mutual
divergence refused), execution-layer floor, two beacon heads as the bound in
both directions, fail closed to 0. Every window ≥ 900s (3× tolerance). The
deadline must sit at least one window past drafting. Error taxonomy
`[EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]`; a failed round writes
nothing and is retried by anyone.

## 8. Walls the contract refuses (tested + live-proven)

fund wrong amount · operator funds own draft · submit before funding · submit by
stranger · submit after grace · duplicate URL (normalized) · off-basis origin ·
package without an independent source · adjudicate before the deadline ·
adjudicate a judged version · promote inside finality · challenge wrong bond ·
challenge outside window · settle inside challenge window · settle with open
challenge · reclaim while a verdict is pending · reclaim before grace · double
settle · double claim · basis without an independent origin · deadline too
soon.

## 9. Web (Structured style — Renaissance gallery on putty paper)

Routes: `/` (hero wordmark + live chain stats + dark "how it works" room),
`/projects` (discovery table), `/projects/[id]` (project page: promised /
proven / paid; agreement; evidence versions; adjudication; funding math;
one legal action), `/create` (review-before-sign), `/rules`, `/api/rpc`.

Tokens: putty #c4c3b6 canvas, ink #000, bone #e7e5e4, chalk #ebebeb, vellum
#dfdcd5 hairlines, graphite #595855 muted, paper #fff on dark. No gradients,
no shadows, no saturated color. Fonts: Playfair Display (display serif, 400/500,
52px+ headings, monumental cropped wordmark) · Hanken Grotesk (utility 12–16px,
never above 26px) · DM Mono (the record: hashes, figures). Radii 9px cards /
28.8px pills. Header = logo mark + one text link. Sections alternate putty /
ink with hard cuts. Logo: thin-stroke circle with a serif V and a leaf vein in
moss #56613f (the only non-neutral, logo only).

Finality ladder (S32): accepted (state visible) vs finalized (tx FINALIZED +
deciding receipt SUCCESS / FINISHED_WITH_RETURN). Three read states. One
address in every config surface (S37). Proof paragraphs claim only what the
arc asserts (S38).

## 10. Gates

pytest direct suite (every branch, every wall, conservation, tampered-leader
white-box, S35 normalization, S36 snapshot continuity) · mutation sweep with
dual-layer MULTI mutants · genvm-lint check · web tsc / eslint / vitest /
build · byte-verified deployment · resumable live arc, custody zero · README
per the ShipBond template · `npm run verify` reconciles every address surface.
