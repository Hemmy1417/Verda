# Deployment

## Deployments of record

| version | address | status |
|---|---|---|
| v0.1.1 | `0x3C30a664cc75FF19f3E63A11F59Ca23ec74491e3` | **current** — deployed 2026-09-10 (tx `0x967408fe7e0fd9c895cd0df303cb1adad699b97f4252e51ace43578718e5997c`), source byte-verified: live, repository and a clean-clone blob all hash to `659ede9311909ae185c039276efb617298ea642cfa5c8be4aacaf766ec15b853`. Carries the fresh-source provenance fix: a validator refuses any FETCHED excerpt that is not text it fetched itself. Carries its own live arc — [recorded below](#the-v011-live-record) |
| v0.1.0 | `0x397bd60cF62755C281a9a24C6398a316F7814a5e` | superseded 2026-09-10 — deployed 2026-09-06 (tx `0x39e327c1f1e6ca1c5a2631aa3432eff245d296b8f5934def6d24700f6cb81e3f`). Validators bound a FETCHED excerpt only by a digest over the leader's own bytes, so a challenge could inherit a fabricated but internally consistent dossier. **Every live act in the README ran on this address** and stays attributed to it: round zero, the payout, the appeal, and the fixture arc. Custody on it is zero |
| v0.1.0-pre | `0x4491182451E0Be4F34cdBd2ecFBdfC0cbE2E39A2` | superseded — preliminary cut deployed 2026-09-05 (tx `0x5eb7114140758d6fcc6ff2c001441e939344e686115c7b837142618a160d434e`) that ran the first live round and money loop; it lacks two fixes the suite found afterwards (`cancel_draft` reads the clock before writing; `_split_url` ends the authority at the first of `/`, `?`, `#`). Its one agreement `vrd-000001` sits at RECLAIMED, custody zero |

The row marked **current** is the address `web/.env.example`, the CI build
env and the README must all name; `npm run verify` (in `web/`) checks that
every surface agrees, so a clean checkout reproduces the judged deployment.

## The v0.1.1 live record

Run 2026-09-10 against `0x3C30a664cc75FF19f3E63A11F59Ca23ec74491e3`, the
evidence fixtures pinned to commit `442874f89a3703867f31a2234f74da996e8b0ea5`.
Three agreements, 23 transactions, custody zero at the end — read back from
`get_stats` afterwards, not taken from the arc's own log. Transcripts:
`web/arc.v011.stdout`, `web/arc.v011.resume.stdout`, `web/arc.v011.final.stdout`.

### Act I — the reviewer's scenario, with the fix active

Round one ran under the v0.1.1 rule: every validator refused any FETCHED
excerpt that was not text it had fetched itself. It passed, QUALIFIED at 463 —
which is also the answer to the rule's cost: corroborating the bytes did not
break honest consensus on real pages.

The funder then challenged with a bond and one new source, an independent
field assessment. The re-adjudication read round one's two rows as
**RECORDED** — byte-identical to round one's stored excerpts, fetch epoch
included, and asserted so by the arc — and the challenger's row as **NEW**. It
landed QUALIFIED at 460: two independent publishers within tolerance, the
lower figure verified. The figure changed, so the challenger's bond came back.
Settlement paid 460/500 of the reward to the operator and returned the rest.

This is the case the reviewer named — a later challenge re-reading an earlier
round's dossier — run with the rule that makes that dossier something the
validators observed, rather than something the leader asserted behind its own
digest.

### Act II — a claim the independent evidence did not support

The operator claimed 470 hectares. The only independent source, a satellite
observation, stated 410; the operator's own report offered a forecast rather
than an achieved figure. The panel held **INCONCLUSIVE · EVIDENCE_INSUFFICIENT**
and flagged `FIGURE_CONTRADICTION`.

A majority of validators agreed and one disagreed, with **no leader rotation**
— so the v0.1.1 rule rejected no leader here, and the verdict is the panel's
judgement, not a side effect of the fix. The v0.1.0 run of the same fixtures
reached NOT_QUALIFIED instead. Both pay the operator nothing: here the funder
reclaimed the whole reward.

### Act III — the uncorroborated floor

Only the operator's report was readable; the independent URL 404s. The panel
held INCONCLUSIVE · EVIDENCE_INSUFFICIENT with nothing verified, and the
reward was reclaimed to the funder.

**One refusal was not exercised on this run.** The check that a reclaim is
refused *inside* the submission grace ran about five hours late — the host
machine stalled between the deadline and that step — so it ran after the grace
had closed. The contract correctly allowed the reclaim, and the check, which
sends the write when it is not refused, sent it: that is the reclaim marked ¹
below. The refusal itself is pinned in the direct suite by
`test_reclaim_after_an_inconclusive_hold_waits_for_the_grace_and_a_resubmission`,
and the arc now attempts that check only while its window is open.

### Custody

The operator withdrew 0.046 GEN. The funder withdrew 0.154 GEN: the Act I
refund 0.004, the returned challenge bond 0.05, and 0.05 each from Acts II and
III. `get_stats` then reports `escrow_atto` 0 and both ledgers empty.

### Which refusal checks ran where

The arc skips a refusal check it has already recorded as proven. Four ran on
v0.1.1 — `reclaim-in-final`, `settle-twice`, `challenge-after-settlement`,
`claim-nothing`. The other fourteen ran on v0.1.0 on 2026-09-06 and are
credited there. v0.1.1 changed only the validator's excerpt comparison, which
none of them exercises, so they describe v0.1.1's behaviour too — but they were
not re-run against it, and this record does not claim they were.

| agreement | call | signer | transaction |
|---|---|---|---|
| vrd-000001 | `draft_agreement` | operator | `0xf8990f0f896985e511e18e3a9caf24385d215aafd789ce32240568ec4a151067` |
| vrd-000001 | `fund` | funder | `0xc4bc03e14c205f60fb36076b3a68ca88fc2a8d36edaf7734b069582a526722b7` |
| vrd-000001 | `submit_evidence` | operator | `0x252353c455840a7b6bd2776b815e43bac9f3513a57c511795ceb8fcb1bbab312` |
| vrd-000001 | `adjudicate` | stranger | `0xa33cf674490ff339307a6eed0807c05473b57127ddd6e52ee99dd08e757e4fa5` |
| vrd-000001 | `promote` | stranger | `0x5d07cdaab7dd4e25899d96fa387c8c1d51eb9d8dff023ab9be7c034dc73c9aa9` |
| vrd-000001 | `challenge` | funder | `0x2ef6cd711fab6947886b4f9311ce4e0495b0c891e53a499fb275b19d0f81450c` |
| vrd-000001 | `re_adjudicate` | stranger | `0xa81b86d5c9ae9b2e0e17490ac81d2f4eee7ce3115418c1ae975b0dbe4508b720` |
| vrd-000001 | `promote` | stranger | `0xabd461ce02d51f559cf7e4ec6d47d49ac52927a36302347f3ebe41127d3b208a` |
| vrd-000001 | `settle` | stranger | `0x05c311e3b2f275101714191d87d401f8637c6e16bca950825987b4b3e3509fd4` |
| vrd-000002 | `draft_agreement` | operator | `0x3ee3a72c180b764e5d18c4739ea4ab4653f01a559e7deb1a3a986840daf33f29` |
| vrd-000002 | `fund` | funder | `0x320a38bc428a6c34f4404229a859daa5f00422067303e6dafb6468bc3b9bef79` |
| vrd-000002 | `submit_evidence` | operator | `0x294e66d26895b7b42983d50fe5762e0ce443175c22845d6720d48216942f6447` |
| vrd-000002 | `adjudicate` | stranger | `0x743fd0ed30dd950c58a5609804f1e2712e92bf2919533151fc04a8d5015ddf67` |
| vrd-000002 | `promote` | stranger | `0xca08d160252b6a509fbfcb0e6bb099ae79ff7e595572844ec96098962d2eb4ce` |
| vrd-000002 | `reclaim` | stranger | `0x0424704220d9cff268d1471a52c6769474c5d2871ff1b26f9f008a1b66a22091` |
| vrd-000003 | `draft_agreement` | operator | `0x13ba20f91bb1cb192b17aaee3495da86b7bad61329ff3133bb1e2092b5cf2076` |
| vrd-000003 | `fund` | funder | `0xa56f3e9882a0af38caf7ff43de1092c6073bfa66b98b501a6f25ae51023ce230` |
| vrd-000003 | `submit_evidence` | operator | `0xbe13f52d286b94514330e13e5d20ddcc874901c7eb0fad2f8733d58b9c7b035e` |
| vrd-000003 | `adjudicate` | stranger | `0x923e1c4c45f93fadf092ae404038c442e5e5ca67ca2ab7f62d64a790fafc6a08` |
| vrd-000003 | `promote` | stranger | `0x161d6f39c1c12796077f2fd8899603877b4c132fdb907e0937dbf2947672096d` |
| vrd-000003 | `reclaim` ¹ | stranger | `0x88eb16e10fb3e16b1a0d1f63dfa9098f180687c46839747238678ae6a495b581` |
| — | `claim` | operator | `0xd025c7a650e005a4792282ab1205bcd4a68e0c1688a7cd7f2494085ced40c33c` |
| — | `claim` | funder | `0xaa843998f9c769de400d78cee9bd7a190668556428d56d8df7434d22329ffe4c` |

¹ sent by the `reclaim-before-grace` refusal check after the grace had already
closed; see Act III.

## Network: GenLayer Studio Next

| | |
|---|---|
| Studio | https://studio-next.genlayer.com |
| Explorer | https://explorer-studio-dev.genlayer.com (`/address/<addr>`, `/tx/<hash>`) |
| RPC | `https://studio-next.genlayer.com/api` |
| Chain id | 61997 (`0xf22d`) |
| GenVM | v0.6 — the contract pins runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`, the id the Studio's own example contracts pin |
| SDK | genlayer-js `2.0.0-rc.1` (its `studioDevnet` chain carries this chain id; the RPC url is swapped) |
| Fees | every transaction needs a fee distribution and a non-zero deposit; a write that emits a transfer (`claim`) also needs a message allocation — the scripts and the web app derive both by simulating the write |
| Faucet | RPC `sim_fundAccount(address, amountInAtto)` |

The contract header is load-bearing: line 1 `# v0.3.0`, line 2 the `Depends`
runner, then a blank line. Any other runner id this GenVM does not ship fails
the deploy with `invalid_contract runner malformed`.

## Deploy

```bash
cd web
node scripts/deploy.mjs
```

Signs with the CREATOR key in `web/.data/keys.json` (gitignored; never commit
a key), estimates the fee deposit, deploys `contracts/verda.py`, waits for
FINALIZED and prints `CONTRACT 0x…`. A deploy whose leader execution is not
SUCCESS prints the GenVM traceback and exits non-zero.

The genlayer CLI (0.39.2) has no Studio Next network alias, but its
read-only commands accept `--rpc`:

```bash
genlayer code   0x… --rpc https://studio-next.genlayer.com/api
genlayer schema 0x… --rpc https://studio-next.genlayer.com/api
```

## Verify the bytes

```bash
node scripts/deploy.mjs verify 0x3C30a664cc75FF19f3E63A11F59Ca23ec74491e3
```

Fetches the deployed source from the chain and compares it byte-for-byte with
`contracts/verda.py`; prints both sha256 digests and the first differing line
if any. `.gitattributes` forces LF on the contract, and `deploy.mjs` refuses to
deploy a file carrying CR bytes, so the comparison is never confused by line
endings.

## Point the web app at it

```
# web/.env.local (dev) — the same values live in web/.env.example
NEXT_PUBLIC_CONTRACT_ADDRESS=0x3C30a664cc75FF19f3E63A11F59Ca23ec74491e3
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio-next.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61997
NEXT_PUBLIC_GENLAYER_EXPLORER_URL=https://explorer-studio-dev.genlayer.com
```

The address compiles into the bundle at build time. On Vercel set the
environment variables BEFORE the first build, set **Root Directory** to
`web` (this monorepo layout cannot be declared in `vercel.json`), and
redeploy after any change to the address.

## SDK notes (genlayer-js 2.0.0-rc.1 on Studio Next), measured

- A `writeContract` without `fees` sends an all-zero distribution and a zero
  deposit — no RPC call, no warning — which is exactly the transaction the
  consensus contract reverts. The estimate step in `web/lib/tx.ts` is
  therefore mandatory, not an optimization.
- `estimateTransactionFeesForWrite` issues `sim_getFeeConfig` then
  `sim_estimateTransactionFees` (the Studio path; `gen_call` type=write is
  the non-Studio fallback). Everything except `eth_accounts`,
  `eth_requestAccounts`, `eth_sendTransaction`, `eth_signTransaction`,
  `personal_sign` and `eth_signTypedData_v4` goes to the chain's RPC url,
  never to the wallet — so the write client's chain must carry the real RPC,
  and the read proxy is a separate clone.
- The Studio's default `feeValue` is about 7.6e13 atto, below what the
  contract accepts in practice; the app floors the deposit at 0.001 GEN.
  Observed deposits are largely refunded; a transaction nets ≈ 0.0001 GEN.
- A write the contract refuses dies at the simulation as JSON-RPC error
  `-32000 "execution failed"`, and the contract's own sentence travels in
  `data.receipt.result` as base64 of one tag byte followed by the text
  (`\x01[EXPECTED] …`). The app decodes it and shows it verbatim.
- A write that emits a transfer (`claim`) fails inside the leader with
  `fee no_matching_allocation # external` unless the transaction carries the
  `messageAllocations` the simulation returns.
- `isStudio: true` (inherited from the SDK's `studioDevnet` chain) selects the
  `sim_*` fee path AND skips the SDK's own `eth_chainId` assertion; the
  wallet layer's network check is the only guard against signing on the
  wrong chain.
- `getTransaction` on an unknown hash returns a JSON-RPC error rather than
  null; the read layer maps it to "not seen yet".

## Lint and validation

`genvm-lint lint contracts/verda.py --json` (AST checks) runs locally and in
CI. `genvm-lint check` cannot validate this contract: the linter loads the SDK
of the GenVM releases it knows (v0.3.0-rc7) and this runner is not among
them. Semantic validation therefore happens on the deployment: the deployed
contract executes the full lifecycle on Studio Next (see the README's
verified end-to-end section), and the bytes are verified as above.

## Test wallets

`web/.data/keys.json` holds four throwaway Studio Next keys (`CREATOR` =
operator, `YES` = funder, `NO` = stranger, `THIRD`), funded through the
faucet RPC. The file is gitignored. Nothing in this repository holds a key
to any wallet of value.
