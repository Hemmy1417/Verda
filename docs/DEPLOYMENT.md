# Deployment

## Deployments of record

| version | address | status |
|---|---|---|
| v0.1.0 | `0x397bd60cF62755C281a9a24C6398a316F7814a5e` | **current** — deployed 2026-09-06 (tx `0x39e327c1f1e6ca1c5a2631aa3432eff245d296b8f5934def6d24700f6cb81e3f`), source byte-verified against `contracts/verda.py` |
| v0.1.0-pre | `0x4491182451E0Be4F34cdBd2ecFBdfC0cbE2E39A2` | superseded — preliminary cut deployed 2026-09-05 (tx `0x5eb7114140758d6fcc6ff2c001441e939344e686115c7b837142618a160d434e`) that ran the first live round and money loop; it lacks two fixes the suite found afterwards (`cancel_draft` reads the clock before writing; `_split_url` ends the authority at the first of `/`, `?`, `#`). Its one agreement `vrd-000001` sits at RECLAIMED, custody zero |

The row marked **current** is the address `web/.env.example`, the CI build
env and the README must all name; `npm run verify` (in `web/`) checks that
every surface agrees, so a clean checkout reproduces the judged deployment.

## Network: GenLayer Studio Next

| | |
|---|---|
| Studio | https://studio-next.genlayer.com (also the only explorer — there is no public block explorer) |
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
node scripts/deploy.mjs verify 0x397bd60cF62755C281a9a24C6398a316F7814a5e
```

Fetches the deployed source from the chain and compares it byte-for-byte with
`contracts/verda.py`; prints both sha256 digests and the first differing line
if any. `.gitattributes` forces LF on the contract, and `deploy.mjs` refuses to
deploy a file carrying CR bytes, so the comparison is never confused by line
endings.

## Point the web app at it

```
# web/.env.local (dev) — the same values live in web/.env.example
NEXT_PUBLIC_CONTRACT_ADDRESS=0x397bd60cF62755C281a9a24C6398a316F7814a5e
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio-next.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61997
NEXT_PUBLIC_GENLAYER_EXPLORER_URL=https://studio-next.genlayer.com
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
