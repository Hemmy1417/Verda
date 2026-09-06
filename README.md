<p align="center">
  <img src="https://raw.githubusercontent.com/Hemmy1417/Verda/main/web/app/icon.svg" width="140" alt="Verda mark" />
</p>

# Verda - Outcome-Based Environmental Funding

**Fund outcomes. Verify impact. Pay for what actually happened.**

Environmental money is committed before anyone can verify the outcome, and afterwards "did they restore 500 hectares?" means reading satellite summaries, field audits and project reports that disagree. Verda locks funding against a predefined outcome, has a GenLayer validator panel fetch and read the evidence itself, and lets deterministic contract code turn the verified figure into payment. The panel answers what happened; the contract answers what is owed.

**Contract** v0.1.0: `0x397bd60cF62755C281a9a24C6398a316F7814a5e` on GenLayer Studio Next (chain 61997; deployed source byte-verified against this repository with `node web/scripts/deploy.mjs verify`; the preliminary cut `0x4491…39A2` that ran the first live round is archived in `docs/DEPLOYMENT.md`). Live app: pending the Vercel deployment.

## What it is

- **An Impact Agreement as an instrument** - an operator drafts one measurable outcome (metric, unit, target), a deadline, a qualification threshold, a maximum reward in GEN, the agreement text, and an evidence basis. A funder counter-signs by depositing exactly the reward. Everything freezes under one sha256 at that moment.
- **An evidence basis, not an evidence list** - the basis names the web origins the panel may read, what kind of source each origin is, and whether both parties regard it as independent of the operator. The operator later submits URLs inside those origins; kind and class are inherited from the basis, never declared by the submitter.
- **Independence counted per publisher** - two pages on one publisher are one voice. The agreement says how many independent publishers must state a usable figure before money can move, and normalized-URL duplicates are refused at intake.
- **A panel that reads and code that decides** - the leader and every validator fetch each page themselves and return readings only: the figure the page states, whether it is on scope, whether it is what its label says, whether the record suffices. Pure code inside every validator derives QUALIFIED, NOT_QUALIFIED or INCONCLUSIVE and the verified figure; the model never returns a verdict and never touches an amount.
- **A record a later panel re-reads** - every round stores the bytes it read with their digest and fetch time. A bonded challenge is judged on those recorded bytes plus, at most, one new source the challenger adds; the second panel is told which is which. Settlement pays verified/target of the reward to the operator and returns the rest to the funder; every hold state has a permissionless exit.

## How it works

**For a project operator**

1. Draft the agreement: outcome, deadline, threshold, reward, terms, and the evidence basis (origins with agreed kinds and classes). Cancel it freely until someone funds it.
2. Do the work. After the deadline, submit an evidence package: URLs inside the agreed origins plus your own claimed figure (a ceiling on what can be verified, never a floor).
3. If the panel finds the record insufficient or uncorroborated, the agreement returns to funded and you may submit a better package inside the grace.
4. After promotion and the challenge window, anyone settles; claim your payout.

**For a funder**

1. Fund a draft you agree with by depositing exactly its maximum reward. Your deposit is the counter-signature; the basis you signed is the only evidence the panel will ever read.
2. Watch the adjudication. If the verdict is wrong, challenge inside the window with a bond and, if you have one, a new source from inside the basis.
3. If the operator never proves the outcome, reclaim the reward after the deadline and grace - anyone can trigger it, nobody can block it.
4. Claim whatever settlement returns to you.

## Verdicts

| Verdict | Meaning | Money |
|---|---|---|
| `QUALIFIED` | Independent publishers (as many as the agreement requires) state a usable figure, the figures agree within tolerance, and the lowest of them reaches the threshold share of the target | `verified / target x reward` to the operator; the remainder to the funder |
| `NOT_QUALIFIED` | The verified figure is below the threshold share of the target | The whole reward returns to the funder |
| `INCONCLUSIVE` | `EVIDENCE_INSUFFICIENT` (the record does not establish the outcome), `UNCORROBORATED` (too few independent publishers state a usable figure), or `SOURCES_CONTRADICT` (independent figures spread beyond 15%) | Nothing moves; the agreement returns to funded for a new package, or the funder reclaims after the grace |

The verified figure is the lowest usable independent reading, never above the operator's claim, never above the target. Operator-class pages inform the panel and can never raise it.

## Lifecycle

```text
DRAFT --fund (exact reward)--> FUNDED --submit_evidence--> FUNDED(v1) --adjudicate (after the deadline)--> PENDING_FINALITY
  \--cancel_draft--> CANCELLED             ^                                                                    |--promote
                                           | INCONCLUSIVE hold (new package inside the grace)                   v
FUNDED --reclaim (after deadline + grace)--> RECLAIMED                                                  FINAL --settle (after the challenge window)--> SETTLED
                                                                                                          |--challenge (bond, one new source)--> re_adjudicate --> PENDING_FINALITY
                                                                                                          \--lapse_challenge (stale) --> FINAL, snapshot restored
```

| Status | Who moves it on | If nobody does |
|---|---|---|
| `DRAFT` | any funder, or the operator cancels | holds nothing |
| `FUNDED` | the operator submits; anyone adjudicates after the deadline | anyone reclaims for the funder after deadline + grace |
| `PENDING_FINALITY` | anyone promotes after the finality window | - |
| `FINAL` | anyone settles after the challenge window; a party may challenge inside it | - |
| challenge open | anyone re-adjudicates; anyone lapses it after the stale window | - |
| `SETTLED` / `RECLAIMED` / `CANCELLED` | terminal; payees claim | - |

## GenLayer consensus functions

| Function | Kind | What runs under consensus |
|---|---|---|
| `adjudicate` / `re_adjudicate` | non-deterministic write | Every validator fetches each source itself (a re-adjudication reads the recorded bytes of the challenged round and fetches only the challenger's new source), rebuilds the prompt from the frozen terms and basis, runs the model for readings, validates every field structurally, derives the verdict and figure in pure code, and compares against the leader's packet |
| `_utc_now` (internal) | non-deterministic read | Three `cdn-cgi/trace` hosts (minimum, mutual divergence refused), an execution-layer block as a floor, two beacon heads as an independent bound in both directions; fails closed to 0, and every timed write refuses without it |

**The equivalence rule.** Pinned exactly: the code-derived verdict, verified figure and hold reason, the evidence flag, every row's url, publisher, kind, class, provenance tag and readability, every independent row's figure, scope and label readings, each row's sha256 covering the exact bytes the leader stored, and the leader's own arithmetic (every validator re-derives the leader's verdict from the leader's rows; a leader whose readings do not produce its verdict is refused). Recorded rows of a challenged round must be byte-identical. Pinned to a bucket: the score (10 points, one adjacent bucket). Free to differ: the reasoning prose, soft conflict codes, readings on operator-class rows, and the excerpt bytes of a freshly fetched page (two honest fetches of a live page differ; the digest binds the record).

**Fail-safe.** A missing reading, a non-boolean, an out-of-range figure, an enum miss or a non-numeric score raises inside the judged block and the round rotates instead of settling. A non-SUFFICIENT record derives INCONCLUSIVE inside the compared block, and the promoter coerces any conclusive verdict over a thin record again at the boundary. A failed round writes nothing; the crank is permissionless.

## Contract

| | |
|---|---|
| Network | GenLayer Studio Next |
| Chain id | 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Explorer | [studio-next.genlayer.com](https://studio-next.genlayer.com) (the Studio is the explorer; no public block explorer exists) |
| Address | `0x397bd60cF62755C281a9a24C6398a316F7814a5e` (v0.1.0; preliminary cut `0x4491182451E0Be4F34cdBd2ecFBdfC0cbE2E39A2` archived) |
| Source | [`contracts/verda.py`](contracts/verda.py) - deployed source byte-verified against this file |
| Runner | GenVM v0.6, `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |

### Write methods

| Method | Who | Payable | Notes |
|---|---|---|---|
| `draft_agreement` | operator | - | outcome, deadline, threshold, reward, windows, terms, evidence basis - hashed together |
| `cancel_draft` | operator | - | DRAFT only |
| `fund` | anyone but the operator | exactly the reward | mutual assent; DRAFT -> FUNDED; refused after the deadline |
| `submit_evidence` | operator | - | a whole package (1-6 URLs inside the basis, claimed figure); at most 4 versions; inside deadline + grace |
| `adjudicate` | anyone | - | after the deadline; one judgment per version; arms the finality window |
| `promote` | anyone | - | after the finality window; INCONCLUSIVE returns the agreement to FUNDED |
| `challenge` | either party | exact bond | 5% of the reward, 0.05 GEN floor; one optional new source inside the basis; snapshots state |
| `re_adjudicate` | anyone | - | judges recorded bytes + the new source; routes the bond by whether verdict or figure changed |
| `lapse_challenge` | anyone | - | after 1h stale; restores the snapshot exactly; returns the bond |
| `settle` | anyone | - | after the challenge window; atomic; pays verified/target of the reward |
| `reclaim` | anyone | - | after deadline + grace with nothing pending; an unjudged submission gets one finality window of patience |
| `claim` | anyone with a balance | - | the only external value path; ledger zeroed, then the transfer is emitted |

### Read methods

`get_config` · `get_stats` · `get_agreement` · `get_agreements` (paged, newest first) · `get_agreements_for` · `get_package` · `get_dossier` · `get_claimable`

### Consensus guarantees

- The verdict and the verified figure are derived by identical code inside every validator from readings the equivalence rule constrains - never taken from a model.
- No model-produced number is multiplied into a transfer: the payout is `verified x reward // target`, with `verified` an agreed integer capped by the claim and the target.
- The bytes a later panel relies on are digest-bound at judgment time and re-verified before the second round reads them.
- Wei conservation is a tested invariant: custody always equals locked rewards plus unclaimed ledger balances plus undecided bonds.

## Verified end-to-end

**Round zero on the deployment of record**, `0x397bd60cF62755C281a9a24C6398a316F7814a5e`, 2026-09-06, three wallets (operator `0x86dD…18b5`, funder `0x57a7…657C`, a stranger for every permissionless call). The operator filed three readable pages that were not evidence at all (a sibling project's documentation, mirrored on the three agreed origins) under the agreed labels:

```text
draft_agreement    vrd-000001 "Rio Verde restoration, block RV-7 (round zero)" · 500 hectares · 90% · 0.05 GEN
fund               0.05 GEN locked by the funder wallet
submit_evidence    v1 · three pages on the agreed origins, labelled satellite / assessment / report · claimed 463
adjudicate         tx 0x50cac9c8…b5ff · MAJORITY_AGREE · leader SUCCESS
                   EV-001 independent · read · no figure · not on scope · not what its label says
                   EV-002 independent · read · no figure · not on scope · not what its label says
                   EV-003 operator's own · read · no figure · not on scope · not what its label says
                   evidence INSUFFICIENT · conflicts SCOPE_MISMATCH, SOURCE_MISLABELLED · score 0
                   derived: INCONCLUSIVE · EVIDENCE_INSUFFICIENT · verified 0
promote            after the finality window, by a stranger: the hold returned the agreement to FUNDED; nothing moved
```

> "All sources provided are technical documentation and source code for a financial adjudication software project named 'Adjudex' and contain no data regarding forest restoration in Para, Brazil. The sources are entirely unrelated to the project defined in the terms, resulting in a total failure to establish the outcome."

That round asserts one thing: pages that are not what their agreed labels say get null figures, `scope_ok` and `kind_matches` false, and the code holds the money. The three-agreement live arc (a QUALIFIED outcome challenged and settled at the lower independent figure, a NOT_QUALIFIED shortfall returning the reward, and an uncorroborated record held and reclaimed) is driven by `web/scripts/arc.mjs` against this contract and is recorded here when it completes.

**Wall sweep and money loop, 2026-09-06, same deployment, three wallets.** Thirteen refusals were driven on-chain; every one finalized as a leader ERROR carrying the contract's own `[EXPECTED]` sentence, read back from the receipts:

```text
funding is exactly the maximum reward: send 10000000000000000 atto
an agreement needs two parties — the operator cannot fund its own draft
nothing to fund in FUNDED · nothing to fund in CANCELLED
threshold must be 5000-10000 basis points
the basis needs at least one INDEPENDENT origin — an outcome the operator
  alone attests cannot be paid
min_independent is 3 but the basis has only 1 independent publisher(s) —
  the agreement could never be satisfied
only the operator cancels a draft · only the operator submits evidence
source 0: evil.io is outside the agreed evidence basis — the panel reads
  only the origins both parties signed        (tx 0x212ba3df…1ff42 — the
  query-borne-@ URL that once fooled _split_url, refused live)
source 1: https://sat.example.org/report is already in the record — one
  page is one source, however it is spelled   (tx 0x3530b88c…48a63, S35)
this evidence version was already judged — submit a new version
nothing is pending finality · nothing to settle in FUNDED
only a party challenges · the submission grace runs until 1788684355
```

(Walls check in order, so two calls were answered by an earlier wall than the one they aimed at — the pre-deadline adjudication by "submit evidence first", the stranger's bonded challenge by the party wall; the deadline and status variants are pinned in the direct suite.)

**The payout act, 2026-09-06, same deployment.** An agreement whose one independent source is a real public page: 400,000 hectares promised under the Billion Tree Tsunami programme, threshold 80%, reward 0.02 GEN, basis `en.wikipedia.org` as kind `other`. The operator filed the page and claimed 350,000. The panel fetched it itself and returned readings — figure 350,000, on scope, matching its label, record SUFFICIENT, score 90 — and code derived QUALIFIED at the verified figure:

> "The Wikipedia page (EV-001) explicitly states 'Pakistan's Billion Tree Tsunami restores 350,000 hectares of forests and degraded land,' which directly matches the project, region, and period."

Mid-act, the RPC connection dropped after adjudication; promotion, settlement and both claims were then executed by a stranger wallet and the parties **hours later** — the permissionless crank recovering an interrupted lifecycle is itself one of the design's claims. Settlement (tx `0xfe774dc1…3f65`) split pro-rata: **0.0175 GEN to the operator** (350,000/400,000 × 0.02, claimed out in tx `0xf93a06e4…9a245`), 0.0025 GEN back to the funder. Stats after: `qualified: 1, paid_atto: 17500000000000000, escrow_atto: 0`.

**The appeal act, 2026-09-06, same deployment.** A twin agreement driven to FINAL (round one QUALIFIED at 350,000, score 95, its source row tagged `FETCHED · round 1`), then the **funder filed a bonded challenge** (exactly 0.05 GEN, tx `0x85ce79ce…9fa9c`) adding one page from the same agreed publisher. Anyone ran the second panel (tx `0x92779699…b3cfb`), and its dossier is the artifact the appeal model promises — every row names what is historical and what is new:

```text
round_kind RE_ADJUDICATION · reconsidered_round 1
EV-001 independent · RECORDED round 1 · figure 350000 · on scope · label fits
EV-002 independent · NEW round 2      · no figure · not on scope · label fits
```

> "EV-002 (the Bonn Challenge page) does not state a figure for the project and is about the global initiative, not the specific outcome under adjudication."

The verdict and figure stood, so the bond routed deterministically to the operator; settlement at the second ruling (tx `0x1f5e92ce…8dfd7`) paid the same 0.0175 GEN pro-rata, and both parties claimed out. Stats after both acts: `{"agreements": 5, "funded": 4, "settled": 2, "qualified": 2, "paid_atto": "35000000000000000", "escrow_atto": "0"}` — **custody zero for the third time on this deployment.**

The same run drove the lifecycle verbs that need no hosted evidence: `vrd-000003` drafted and cancelled by its operator after a stranger's cancel was refused; a stranger reclaimed `vrd-000001`'s held reward to the funder's ledger (tx `0x30d4cd01…9f56d`) and the funder claimed it out through the EOA proxy (tx `0xa14ecf39…1532a`); after the bench's grace lapsed, the bench was reclaimed and claimed the same way. Final stats on the deployment of record: `{"agreements": 3, "funded": 2, "settled": 0, "qualified": 0, "paid_atto": "0", "escrow_atto": "0"}` — **every atto that entered the contract left through `claim()`; custody zero.**

**The preliminary cut**, `0x4491182451E0Be4F34cdBd2ecFBdfC0cbE2E39A2` (archived in `docs/DEPLOYMENT.md`), ran the first panel round and the full money loop on 2026-09-05:

```text
draft_agreement    vrd-000001 · 500 hectares · 90.00% threshold · 0.05 GEN reward · deadline set
                   (the consensus clock's nondeterministic round: three trace edges, a chain floor, two beacon heads)
fund               0.05 GEN locked by the funder wallet · status FUNDED
submit_evidence    v1: two URLs on the agreed independent origins that were NOT evidence about the project,
                   one operator URL that did not resolve · claimed 463
adjudicate         16 validators · MAJORITY_AGREE · leader SUCCESS
                   EV-001 readable · figure null · scope false · label false
                   EV-002 readable · figure null · scope false · label false
                   EV-003 unreachable
                   evidence INSUFFICIENT · conflicts SOURCE_MISLABELLED · score 4
                   derived: INCONCLUSIVE · EVIDENCE_INSUFFICIENT · verified 0
promote            after the finality window, by a stranger: the hold returned the agreement to FUNDED
                   (verdict INCONCLUSIVE, hold_reason EVIDENCE_INSUFFICIENT, judged_version 1) — nothing moved
reclaim            after deadline + grace, by a stranger: RECLAIMED · refund 0.05 GEN to the funder's ledger
claim              the funder's wallet: claimed_atto 50000000000000000 · ledger 0 · contract custody 0
                   (the claim transaction carried the simulation-derived allocation for the outgoing transfer)
```

> "EV-001 and EV-002 are Adjudex product/specification documents, not evidence about Rio Verde restoration block RV-7 in Para, Brazil, and they state no achieved hectares for this project by the deadline. EV-001 is not a satellite-derived measurement and EV-002 is not a third-party assessment of restoration outcomes, so the record does not establish the outcome; EV-003 was unreachable and adds no usable evidence."

The claims that run asserts: the consensus clock's nondeterministic round produced an agreed epoch; a payable deposit was recorded exactly; a 16-validator panel agreed on readings that held the money; the permissionless reclaim credited the funder; and `claim()` paid an externally owned wallet from the contract with custody ending at zero.

## Tests

`python -m pytest tests/direct -q` runs **496 direct-mode tests** against a strict stub of the GenVM SDK: every wall in the contract, every derivation branch, the structural validation of malformed panel answers, the tampered-leader white-box (a wrapped `run_nondet` mutates the leader's packet before the validator sees it), snapshot continuity across a challenge, the clock, and a wei-conservation invariant after every money-moving path. Two of those tests exist because the contract was wrong when first written: `cancel_draft` changed state before reading the clock, and `_split_url` read `https://evil.io?x=@sat.example.org` as an on-basis host. `tests/mutation_sweep.py` breaks one guard at a time in a scratch copy and requires the suite to fail for each — **139 mutants, 139 killed**; rules guarded twice get a mutant that removes both layers, so a redundant guard cannot masquerade as a pinned one, and the two mutants that survived the first run (an inclusive tolerance boundary, a redundant evidence-flag compare) each got the test that kills them. The web app carries **204 vitest tests**, including the URL and publisher rules mirrored from the contract and the wallet's handling of MetaMask's nested "unknown chain" error.

## Tech stack

| Layer | Choice |
|---|---|
| Contract | Python Intelligent Contract on GenVM v0.6 (`gl.vm.run_nondet`, `gl.nondet.web.render`, `gl.nondet.exec_prompt`) |
| Chain | GenLayer Studio Next, chain 61997 |
| Web | Next.js 16 App Router, TypeScript, plain CSS; genlayer-js 2.0.0-rc.1; EIP-6963 wallet discovery |
| Reads | same-origin `/api/rpc` proxy, allowlisted to one contract's reads and transaction lookups |
| Writes | wallet-signed; every write simulates first to derive its fee distribution and message allocations |
| Tests | pytest (direct mode), a mutation sweep, vitest for the web |

## Repository

```text
contracts/verda.py          the contract
tests/direct/               direct-mode pytest suite (conftest = the strict SDK stub)
tests/mutation_sweep.py     guard-by-guard mutation sweep
evidence/                   the fixture pages the live arc serves (see evidence/README.md)
web/                        Next.js app, scripts (deploy, verify, arc)
docs/ARCHITECTURE.md        the mechanism, anchored by symbol
docs/SECURITY.md            attacks and the symbol that stops each
docs/DEPLOYMENT.md          the deployment ledger and procedure
docs/STANDARDS.md           the judge-standards pre-check (S1-S38), by symbol and test
SPEC.md                     the build specification
```

## Getting started

```bash
python -m pytest tests/direct -q
python tests/mutation_sweep.py
```

```bash
cd web
npx npm@10 install
cp .env.example .env.local        # the contract address, RPC, chain id, explorer
npm run dev -- -p 3104
npm run verify                    # every address surface names the same deployment
```

Deploying and verifying a contract: `docs/DEPLOYMENT.md`.

## Security

- No owner and no admin key: nobody can move a locked atto, alter a dossier or unblock a settlement.
- Funding is per agreement, exact, and never pooled; `claim` is the only external value path.
- The panel reads only origins both wallets signed; URLs are printable ASCII with no fence-forging characters; kind and class are inherited, never declared.
- Every panel answer is validated structurally before it can touch state, and the verdict is derived in code inside every validator.
- Details and the test that pins each item: `docs/SECURITY.md`.

## Design notes

- The web app is a gallery on putty paper: a warm `#c4c3b6` canvas, ink and bone surfaces, Playfair Display for the voice and Hanken Grotesk for the utility, DM Mono for the record; no gradients, no shadows, no colour except a moss mark. Sections alternate light rooms and black rooms with hard cuts; the monumental wordmark crops at the viewport.
- The app follows the anatomy of Base-ecosystem apps: a persistent navbar with the network state and wallet, a data-first hero with the live contract card and a Start card, persona cards with numbered steps, row-cards with a numbered seal and a human title, and a detail page with a sticky next-step rail and an activity timeline. Machine values (ids, hashes, URLs, epochs) live only in copy-button technical folds; everything else is a word or a sentence.
- Comparable rows are tables, numbers outweigh their labels, and every deadline is stated with its consequence.
- "Finalized" appears only when the transaction reports FINALIZED with a successful deciding execution; acceptance is shown as acceptance.

## Honest limitations

- The contract enforces where evidence may come from and counts independence by publisher; it cannot verify that a publisher is independent of the operator in the world. That is what the two parties assert when they sign the basis.
- The demo's three origins are three CDNs mirroring one commit of this repository, standing in for a satellite provider, an assessor and the operator's site (`evidence/README.md`). The rules run exactly as they would against real publishers; the publishers' independence is not demonstrated by the fixtures.
- Excerpts are capped at 6000 characters per source; a figure stated only deeper in a very long page is not read.
- `genvm-lint check` cannot load this runner's SDK; the contract is lint-checked at the AST level and validated by executing on Studio Next.

## Disclaimer

Verda is a hackathon build on a development network. Nothing here is financial, legal or environmental advice, and no real funding has moved through it.
