# Standards pre-check

Every review letter the GenLayer judges have written across the portfolio
generalizes to a standard. This is Verda checked against all of them before
submission, by symbol and by test. "n/a" is stated where a standard has no
subject in this design, rather than claimed.

| # | Standard | Verda | Where |
|---|---|---|---|
| S1 | A recorded window is an enforced window | Every window is wall-clock from the consensus clock and checked at the boundary: deadline (`adjudicate`, `fund`), finality (`promote`), challenge (`challenge`, `settle`), grace (`submit_evidence`, `reclaim`), stale (`lapse_challenge`) | `test_settlement.py`, `test_challenge.py`, `test_adjudication.py` (boundary cases) |
| S2 | Rulings rest on contract-fetched evidence; no instant default | The panel fetches every page itself; an unreachable page is null, never evidence against anyone; no default judgment exists — an unsubmitted agreement is reclaimed, not ruled | `_panel_round`, `reclaim` |
| S3 | Pooled deposits are tracked and exitable | Nothing is pooled: one deposit per agreement, returned by `settle`/`reclaim`, exited by `claim` | `conserve()` |
| S4 | Armed window before an adverse drain; bonded appeal | `adjudicate` arms finality, `promote` arms the challenge window, `settle` moves money only after both; `challenge` is bonded | lifecycle tests |
| S5 | Nondeterministic failure fails safe | `[LLM_ERROR]` rotates; a failed round writes nothing; unreadable pages null their figure; INSUFFICIENT derives INCONCLUSIVE | `test_adjudication.py` (structural validation, dead sources) |
| S6 | Provider-backed signed writes + a repo signed-write test | `lib/wallet.tsx` creates the write client with the EIP-6963 provider; `tests/signed-write.test.ts` | web tests |
| S7 | Every economically decisive field is pinned | verdict, verified_impact, hold_reason, evidence_flag exact; per-independent-row readings exact; leader arithmetic re-derived | `validator_fn` in `_panel_round`; tampered-leader tests |
| S8 | Evidence independent and integrity-bound at the contract boundary | Origins frozen at assent; every fetch stored with sha256 + epoch; a challenge re-reads recorded bytes after `_dossier_intact` | `test_challenge.py` |
| S9 | Economic substance | Real GEN locked per agreement; the panel's readings decide who is paid | by design |
| S10 | No unbounded view scans | `get_agreements` pages from a maintained id array; `get_agreements_for` reads a per-actor index | `test_agreements.py` (pagination) |
| S11 | A test suite ships | `tests/direct` (422+), `tests/mutation_sweep.py`, `web/tests` | CI |
| S12 | Narrative honesty | README and docs claim only what the contract does; limitations stated (publisher independence, suffix heuristic, excerpt cap, lint scope, fixture origins) | README "Honest limitations" |
| S13 | Wall-clock windows, never action-counted | `_utc_now` everywhere; no counters gate time | `test_clock.py` |
| S14 | An appeal judges the recorded snapshot | `re_adjudicate` reads RECORDED excerpts; only the challenger's source is fetched | `test_challenge.py` (page changed after round one → RECORDED excerpt unchanged) |
| S15 | Every path into a live instrument posts the same stake; a timed window is judged after it elapses | One funding path, exact amount; `adjudicate` refused until the deadline has passed | `test_agreements.py`, `test_adjudication.py` |
| S16 | Every ruling field validated structurally before touching state | `judge` raises `[LLM_ERROR]` on a missing reading, non-boolean, out-of-range figure, enum miss, non-numeric score | `test_adjudication.py` |
| S17 | Unilateral recovery after an unresolved appeal / stranded funds | `lapse_challenge` (anyone, after the stale window) restores the snapshot and returns the bond; `reclaim` (anyone) returns the reward after grace | `test_challenge.py`, `test_settlement.py` |
| S18 | Evidence basis bound at assent | The basis is inside `terms_sha256`; `fund` is the signature over it | `test_agreements.py` (hash commits to the basis) |
| S19 | Sanitize every string entering the prompt; unforgeable fences | `_defang` on terms, labels, pages and grounds; `_valid_url` refuses `\|` and non-printable ASCII for the pipe-delimited header | `test_adjudication.py`, `test_evidence.py` |
| S20 | Independent-mechanism clock ceiling | Two beacon heads bound both directions, fail closed | `test_clock.py` |
| S21 | Consensus binds the record, not only the verdict | Rows compared: url, host, domain, kind, class, basis, readable, digest-covers-excerpt; RECORDED rows byte-identical | tampered-leader tests |
| S22 | Insufficiency gates every conclusive verdict | `_derive_verdict` first branch; `promote` coerces; `settle` refuses | `test_adjudication.py`, `test_settlement.py` |
| S23 | Reserve the full obligation at acceptance | `fund` locks exactly the reward; nothing shared to over-commit | `test_settlement.py` (two agreements settle independently) |
| S24 | Atomic finalization | `settle` moves ledger, status and counters in one call or refuses | `test_settlement.py` |
| S25 | A case binds to one adjudicator | The GenLayer panel is the only adjudicator; no re-routing exists | by design |
| S26 | Every hold state has a reachable exit | INCONCLUSIVE → FUNDED (resubmit or reclaim); FINAL → settle (anyone); challenge → re_adjudicate or lapse (anyone) | lifecycle tests; README status table |
| S27 | The judged party controls neither identity nor sources | The operator picks URLs only inside origins the FUNDER also signed, inherits labels, and cannot raise the figure with its own pages; identity = wallets | `test_evidence.py`, `test_adjudication.py` |
| S28 | Consensus compares the exact persisted bytes, including appeal evidence | Digests over stored excerpts; `_dossier_intact` before a second round; RECORDED rows exact | `test_challenge.py` |
| S29 | Appeal reversal restores the appealed state | `challenge_snapshot` taken at filing; `lapse_challenge` restores it verbatim | `test_challenge.py` |
| S30 | Invariant tests for concurrency and post-terminal actions | Two funders racing; post-SETTLED / RECLAIMED / CANCELLED actions refused; conservation after every write | `test_agreements.py`, `test_settlement.py` |
| S31 | Party-declared labels disclosed as claims, with a mislabel guardrail | Labels are bilateral (in the signed basis) AND disclosed to the panel as labels; `kind_matches` + `SOURCE_MISLABELLED` | prompt text; live probe round |
| S32 | "Irreversible" only at FINALIZED with a successful deciding execution | `lib/tx.ts` finality ladder: accepted vs finalized | `web/tests/tx.test.ts` |
| S33 | No unread post-assessment repudiation | The only post-verdict objection is the bonded challenge, judged before settlement; `submit_evidence` is refused outside FUNDED | `test_evidence.py`, `test_challenge.py` |
| S34 | An uncorroborated adverse finding cannot move money | `UNCORROBORATED` hold when fewer independent publishers than `min_independent` state a usable figure | `test_adjudication.py` |
| S35 | Source independence, not source-kind diversity | Normalized-URL dedup at intake; independence counted per registrable domain; `min_independent` in the terms | `test_evidence.py`, `test_adjudication.py` |
| S36 | Commitment-bind the adjudication-time snapshot; appeal names historical vs new | Per-row excerpt + sha256 + fetch_epoch; `basis` tag RECORDED / NEW in the record and in every fence header | `test_challenge.py` |
| S37 | A clean checkout reproduces the judged deployment | One address in DEPLOYMENT.md, `.env.example`, CI, README; `npm run verify` | `web/scripts/verify.mjs` |
| S38 | Proofs claim only what the script asserts | The README's verified section states per line what was asserted; the arc's `expect()` calls are the claims | `web/scripts/arc.mjs` |

Residuals, stated: publisher independence is asserted by the parties, not
verified by the contract; `_registrable_domain` is a heuristic; excerpts are
capped; `genvm-lint check` cannot load this runner's SDK (AST lint + on-chain
execution stand in).
