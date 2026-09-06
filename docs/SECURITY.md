# Security notes

What an adversary can try, and what stands in the way. Each item names the
symbol that enforces it in `contracts/verda.py` and the test that pins it.

## Money

| Attack | Defence | Pinned by |
|---|---|---|
| Fund less (or more) than the reward and become the funder | `fund` requires `value == max_reward` exactly | `test_agreements.py` (wrong amounts) |
| Operator funds its own draft to control both sides | `fund` refuses the operator's wallet | `test_agreements.py` |
| Two funders race one draft | the first `fund` moves status off DRAFT; the second is refused | `test_agreements.py` (S30 race) |
| Drain another agreement's deposit | nothing is pooled: every reward is locked to its agreement; `escrow_atto == Σ locked + Σ ledger + Σ bonds` after every write | `conserve()` in every module |
| Pay out before the challenge window | `settle` refuses until `challenge_until_epoch` has passed and no challenge is open | `test_settlement.py` |
| Settle twice, claim twice | `settle` requires FINAL; `claim` zeroes the ledger before emitting | `test_settlement.py` |
| Strand the funder's money | `reclaim` is permissionless after deadline + grace (plus a finality window of patience for an unjudged submission); every hold state has an exit | `test_settlement.py` |
| Get paid on the operator's own word | `_usable_rows` admits INDEPENDENT rows only; `_derive_verdict` holds UNCORROBORATED when fewer independent publishers than `min_independent` state a usable figure | `test_adjudication.py` |
| Inflate the figure above the claim or the target | `verified = min(lowest usable figure, claimed_impact, target)` | `test_adjudication.py` |
| Settle a verdict over an insufficient record | `promote` coerces any non-SUFFICIENT conclusive verdict to INCONCLUSIVE; `settle` refuses a non-SUFFICIENT flag | `test_adjudication.py`, `test_settlement.py` |

## Evidence

| Attack | Defence | Pinned by |
|---|---|---|
| Point the panel at a page outside the agreed basis | `_clean_rows` matches the URL's host to an agreed origin (exact or subdomain, `_matches_origin`) and refuses otherwise | `test_evidence.py` |
| Smuggle a host with `userinfo@`, a query-borne `@`, a look-alike host, an encoded `@` | `_split_url` ends the authority at the first of `/`, `?`, `#`, then strips userinfo; `notsat.example.org` does not match `sat.example.org` | `test_evidence.py` (the `evil.io?x=@…` case was a found defect) |
| Count one page twice by spelling it differently | `_normalize_url` + the duplicate refusal, against new rows and the existing record | `test_evidence.py` (eight twin spellings) |
| Count one publisher twice with two pages | independence is counted per `_registrable_domain`, not per URL | `test_adjudication.py` (`min_independent=2` with two pages on one host → UNCORROBORATED) |
| Declare a flattering source kind or class | the submitter declares nothing: kind and class are INHERITED from the basis entry the host matches; the basis was signed by both wallets | `test_evidence.py` |
| A page that is not what its agreed label says | the panel is told every label is a label and reads `kind_matches`; a false one drops the row from `_usable_rows` and is named `SOURCE_MISLABELLED` | `test_adjudication.py`; live: the probe round on Studio Next |
| Forge a fence inside a page or the terms | `_defang` rewrites both delimiters before interpolation; the prompt says any intact fence was emitted by the contract | `test_adjudication.py` |
| Forge a fence HEADER through the URL | `_valid_url` refuses `|` and every non-printable-ASCII character; the header is pipe-delimited | `test_evidence.py` |
| Re-roll a judged record until a kinder panel appears | one dossier per version: `adjudicate` refuses a version that already has one | `test_adjudication.py` |
| Change the page between the ruling and the appeal | `re_adjudicate` re-reads the RECORDED excerpt (digest-verified by `_dossier_intact`) and fetches only the challenger's new row; validators compare RECORDED excerpts byte-for-byte and every row's `basis` tag | `test_challenge.py` |

## Consensus

| Attack | Defence | Pinned by |
|---|---|---|
| A leader returns a verdict its own readings do not support | `validator_fn` re-derives `_derive_verdict` from the leader's rows and refuses a mismatch | tampered-leader tests in `test_adjudication.py` |
| A leader forges a figure, a reading, a readable flag, a basis tag, a digest | each is compared exactly (independent rows) or recomputed (digest over the stored excerpt) | tampered-leader tests |
| A leader claims a hold reason or evidence flag that differs from the validator's | compared exactly | `test_adjudication.py` |
| The model returns garbage the panel would "agree" on | S16 structural validation inside `judge`: missing reading, non-boolean, out-of-range figure, enum miss, non-numeric score → `[LLM_ERROR]`, round rotates, nothing written | `test_adjudication.py` |
| Validators disagree honestly | the round fails and the permissionless crank turns again; a failed round writes nothing | conftest `_run_nondet` semantics |

## Time

| Attack | Defence | Pinned by |
|---|---|---|
| Judge the outcome before the period is over | `adjudicate` refuses until `now > deadline_epoch` | `test_adjudication.py` (boundary) |
| Close a window early through a skewed edge | three trace edges, minimum taken, mutual divergence refused; beacon heads bound both directions; explorer floor | `test_clock.py` |
| Act while the clock is down | `_require_clock` refuses with `[TRANSIENT]` before any state changes — including `cancel_draft` | `test_agreements.py`, `test_clock.py` |
| Count windows in protocol actions | every window is wall-clock from `_utc_now` | by construction |

## Web

- Reads travel through `/api/rpc`, an allowlisted same-origin proxy that
  forwards only `gen_call` reads for the configured contract and
  `eth_getTransactionByHash`; it cannot submit transactions or reach another
  contract.
- Writes are signed by the user's wallet through an EIP-6963 provider-backed
  client; every write first simulates to derive its fee distribution and
  message allocations, and a refused simulation is shown with the contract's
  own `[EXPECTED]` message — nothing unfunded is ever sent.
- "Finalized" is claimed only when the transaction reports FINALIZED with a
  successful deciding execution (S32); acceptance is shown as acceptance.

## Known residuals

- Publisher independence is asserted by the two parties in the basis, not
  verified by the contract.
- `_registrable_domain` is a heuristic, not the Public Suffix List.
- Excerpts are capped at `MAX_EXCERPT_CHARS`; a figure stated only past that
  point in a very long page is not read. Sources should be the summary pages a
  publisher intends to be cited.
