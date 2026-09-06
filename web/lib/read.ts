"use client";

/**
 * The typed read layer.
 *
 * Every contract view returns a JSON string, or "" when the thing does not
 * exist. Callers never see that: they get a parsed, typed object or null,
 * and a named error if the chain could not be reached.
 *
 * All reads travel through the same-origin proxy at /api/rpc rather than
 * straight to Studio Next, because Studio's RPC allowed ~30 reads per minute
 * per IP when that was measured on StudioNet — Studio Next runs the same
 * stack and is treated as sharing the ceiling until measured otherwise — and
 * a project page plus one confirming write exceeds that on its own. A small
 * client cache collapses a render tree's repeated questions into one request.
 *
 * READS ONLY. Writes and their fee estimates never come through here: the
 * SDK sends those to the write client's chain URL, which is the real RPC
 * (see STUDIO_NEXT in lib/chain.ts), and the proxy's allowlist would refuse
 * them anyway.
 */
import { createClient } from "genlayer-js";
import { isTransient, STUDIO_NEXT } from "./chain";
import { CONTRACT_ADDRESS, CONTRACT_CONFIGURED } from "./config";
import type {
  Agreement, AgreementSummary, ChainConfig, Dossier, Package, Stats,
} from "./types";

export type AgreementPage = { total: number; agreements: AgreementSummary[] };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any;

/** Thrown when the chain could not be read. Carries text a user can act on. */
export class ReadError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = "ReadError";
    this.transient = transient;
  }
}

let client: Client | null = null;

/**
 * A private copy of the chain pointed at our proxy.
 *
 * NOT `createClient({chain: STUDIO_NEXT, endpoint})`: the SDK implements that
 * option by assigning into the chain object it was handed, and STUDIO_NEXT is
 * shared with the wallet's write client — passing an endpoint would rewrite
 * the RPC URL process-wide, retroactively, and send that client's fee
 * estimates and gas reads into a proxy that refuses them. So the chain is
 * cloned and the endpoint option is never used.
 */
const PROXY_CHAIN = {
  ...STUDIO_NEXT,
  rpcUrls: {
    ...STUDIO_NEXT.rpcUrls,
    default: { ...STUDIO_NEXT.rpcUrls.default, http: ["/api/rpc"] as const },
  },
};

function readClient(): Client {
  if (!CONTRACT_CONFIGURED) {
    throw new ReadError(
      "No contract is configured for this build, so there is nothing to read.",
      false,
    );
  }
  if (!client) {
    // No account: reads are unsigned. Requiring a wallet to LOOK at a
    // project would make the record private to participants.
    client = createClient({ chain: PROXY_CHAIN });
  }
  return client;
}

function asReadError(err: unknown): ReadError {
  if (err instanceof ReadError) return err;
  const msg =
    err instanceof Error ? err.message :
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err ?? "");
  if (/rate limit|-32029|read_budget/i.test(msg)) {
    return new ReadError(
      "Studio Next is limiting how fast this page can read. It recovers on its own.",
      true,
    );
  }
  return new ReadError(
    isTransient(err)
      ? "The chain could not be reached just now. Retrying usually works."
      : msg.slice(0, 200) || "The chain refused this read.",
    isTransient(err),
  );
}

// ── caching ─────────────────────────────────────────────────────────────────

type Entry = { at: number; value: unknown; ttl: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** Chain limits cannot change without a redeploy, so they are read once. */
export const TTL_IMMUTABLE = Number.POSITIVE_INFINITY;
/** Everything else: long enough to collapse a render, not to go stale. */
export const TTL_LIVE = 5_000;

/** Drop cached reads so the next call goes to the chain. Entries cached as
 *  immutable survive: they cannot have changed. */
export function invalidateReads(): void {
  for (const [k, e] of cache) if (e.ttl !== TTL_IMMUTABLE) cache.delete(k);
}

/**
 * One contract view, cached and de-duplicated. The typed views below are thin
 * wrappers over this: name the method, hand it the arguments and a parser,
 * and say how long the answer may be trusted.
 *
 * `ttl` may be a function of the parsed value, because for some views the
 * answer decides its own lifetime: a dossier that does not exist yet must be
 * re-asked, and a dossier that exists never changes. A cached entry carries
 * the TTL it was stored under, so a hit is judged by that, not by the caller's
 * rule — the two agree by construction.
 */
export async function call<T>(
  functionName: string,
  args: unknown[],
  parse: (raw: string) => T,
  ttl: number | ((value: T) => number),
  force = false,
): Promise<T> {
  const key = `${functionName}(${JSON.stringify(args)})`;

  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const p = (async () => {
    let raw: unknown;
    try {
      raw = await readClient().readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName,
        args,
      });
    } catch (err) {
      throw asReadError(err);
    } finally {
      inflight.delete(key);
    }
    const value = parse(typeof raw === "string" ? raw : JSON.stringify(raw));
    cache.set(key, { at: Date.now(), value, ttl: typeof ttl === "function" ? ttl(value) : ttl });
    return value;
  })();
  inflight.set(key, p);
  return p;
}

/** A view that answers "" for a missing record → null, otherwise the object. */
export const asObj = <T,>(raw: string): T | null =>
  raw && raw !== '""' ? (JSON.parse(raw) as T) : null;

// ── typed views ─────────────────────────────────────────────────────────────
// Each is one line over `call`. Shapes: lib/types.ts, read from the contract.

/** Immutable once it exists, live while it does not: a record the contract
 *  writes exactly once per version and never edits. */
const onceWritten = <T,>(value: T | null) => (value === null ? TTL_LIVE : TTL_IMMUTABLE);

export function getAgreement(id: string, force = false): Promise<Agreement | null> {
  return call("get_agreement", [id], asObj<Agreement>, TTL_LIVE, force);
}

/** Newest first, one bounded page; `limit` is capped at 50 by the contract. */
export function getAgreements(offset: number, limit: number, force = false): Promise<AgreementPage> {
  return call(
    "get_agreements", [offset, limit],
    (raw) => asObj<AgreementPage>(raw) ?? { total: 0, agreements: [] },
    TTL_LIVE, force,
  );
}

/** Every agreement this wallet drafted or funded, oldest first (the contract
 *  appends to the actor's index). */
export function getAgreementsFor(addr: string, force = false): Promise<AgreementSummary[]> {
  return call(
    "get_agreements_for", [addr],
    (raw) => asObj<AgreementSummary[]>(raw) ?? [],
    TTL_LIVE, force,
  );
}

/** A package is stored once per version and never rewritten, so a non-null
 *  answer for version > 0 is cached forever; version 0 never exists. */
export function getPackage(id: string, version: number, force = false): Promise<Package | null> {
  return call(
    "get_package", [id, version], asObj<Package>,
    (v) => (version > 0 ? onceWritten(v) : TTL_LIVE), force,
  );
}

/** A dossier is one consensus round's record; it exists after the round
 *  lands and is never edited, so it is immutable once non-null. */
export function getDossier(id: string, version: number, force = false): Promise<Dossier | null> {
  return call("get_dossier", [id, version], asObj<Dossier>, onceWritten, force);
}

/** The wallet's pull-payment balance in atto, as the decimal string the
 *  contract returns. "0" means nothing to claim. Never JSON.parse'd into a
 *  number: 0.05 GEN is 5×10^16 atto, past the range a double keeps exactly. */
export function getClaimable(addr: string, force = false): Promise<string> {
  return call(
    "get_claimable", [addr],
    (raw) => {
      const digits = raw.trim().replace(/^"|"$/g, "");
      return /^\d+$/.test(digits) ? digits : "0";
    },
    TTL_LIVE, force,
  );
}

export function getStats(force = false): Promise<Stats> {
  return call("get_stats", [], (raw) => JSON.parse(raw) as Stats, TTL_LIVE, force);
}

/** Chain limits cannot change without a redeploy: read once per session. */
export function getConfig(): Promise<ChainConfig> {
  return call("get_config", [], (raw) => JSON.parse(raw) as ChainConfig, TTL_IMMUTABLE);
}

// ── transaction finality ────────────────────────────────────────────────────

export type TxFinalityView = {
  /** The chain's own word for where the transaction is: "ACCEPTED",
   *  "FINALIZED", … — "UNKNOWN" when the answer named no status. */
  statusName: string;
  /** True once the chain reports FINALIZED: it will not walk this back. */
  finalized: boolean;
  /** What the deciding execution did. Measured against live StudioNet, and
   *  unchanged in the SDK's Studio path under 2.0.0-rc.1: the
   *  consensus-level result is MAJORITY_AGREE for a refused write too (the
   *  panel agreed it errored), so success is read from the leader receipt,
   *  never from the consensus result. */
  executed: "SUCCESS" | "ERROR" | "UNKNOWN";
};

/**
 * Numeric status → name, pinned from the SDK's enum declaration order and
 * verified against live StudioNet (a FINALIZED transaction reports 7).
 */
const STATUS_BY_NUMBER: Record<number, string> = {
  0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING",
  4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED",
  8: "CANCELED", 9: "APPEAL_REVEALING", 10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE", 12: "VALIDATORS_TIMEOUT", 13: "LEADER_TIMEOUT",
};

/**
 * Normalize whatever the RPC returned for a transaction into the three facts
 * lib/tx.ts acts on. Exported for tests: this function decides whether a
 * user is told their write is irreversible, so it is exercised against
 * fixtures of every shape the chain has actually produced.
 *
 * Two shapes were measured live rather than assumed:
 *
 *   a write that TOOK EFFECT    → statusName FINALIZED, result_name
 *     MAJORITY_AGREE, leader_receipt [SUCCESS, ERROR] — the trailing ERROR
 *     is a rotated round, and the DECIDING receipt is entry 0
 *   a write the contract REFUSED → statusName FINALIZED, result_name
 *     MAJORITY_AGREE again — agreement that it errored — with
 *     leader_receipt [ERROR, ERROR]
 *
 * So entry 0 of the leader receipt decides, and the consensus result is
 * never consulted. The SDK's enum spells success FINISHED_WITH_RETURN while
 * the wire says SUCCESS; both are accepted.
 */
export function normalizeTxView(t: unknown): TxFinalityView {
  const tx = (typeof t === "object" && t !== null ? t : {}) as Record<string, unknown>;

  let statusName = "UNKNOWN";
  if (typeof tx.statusName === "string" && tx.statusName) {
    statusName = tx.statusName;
  } else if (typeof tx.status === "number" && STATUS_BY_NUMBER[tx.status]) {
    statusName = STATUS_BY_NUMBER[tx.status];
  } else if (typeof tx.status === "string" && tx.status) {
    statusName = tx.status;
  }

  let executed: TxFinalityView["executed"] = "UNKNOWN";
  const consensus = tx.consensus_data as
    | { leader_receipt?: Array<{ execution_result?: unknown }> }
    | undefined;
  const deciding = consensus?.leader_receipt?.[0]?.execution_result;
  if (deciding === "SUCCESS" || deciding === "FINISHED_WITH_RETURN") {
    executed = "SUCCESS";
  } else if (deciding === "ERROR" || deciding === "FINISHED_WITH_ERROR") {
    executed = "ERROR";
  }

  return { statusName, finalized: statusName === "FINALIZED", executed };
}

const NOT_SEEN: TxFinalityView = { statusName: "UNKNOWN", finalized: false, executed: "UNKNOWN" };

/**
 * Is this the chain saying it has never seen the hash?
 *
 * genlayer-js 1.1.8 answered an unknown hash with null. Under 2.0.0-rc.1 the
 * Studio path hands the lookup to viem, and Studio Next was measured to
 * answer it with a JSON-RPC error, which viem raises as
 * ResourceNotFoundRpcError; a null result would raise TransactionNotFoundError
 * instead. Both are matched, by name and by the sentence, because this
 * classification is what keeps a poll going.
 */
function isNotSeen(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | undefined;
  if (e?.name === "ResourceNotFoundRpcError" || e?.name === "TransactionNotFoundError") return true;
  return /could not be found|resource not found/i.test(String(e?.message ?? ""));
}

/**
 * One status poll of a submitted transaction, through the same proxy and
 * pacing as every other read. Never cached: the point is to see change.
 *
 * The SDK's Studio path issues exactly one RPC for this, eth_getTransactionByHash,
 * which is the second of the two methods the proxy forwards; the shape it
 * returns was measured on Studio Next and is the one normalizeTxView pins.
 */
export async function getTransactionStatus(hash: string): Promise<TxFinalityView> {
  let raw: unknown;
  try {
    raw = await readClient().getTransaction({ hash: hash as `0x${string}` });
  } catch (err) {
    // An unknown hash is an answer, not an error: the transaction has not
    // been seen yet. Callers keep polling rather than failing.
    if (isNotSeen(err)) return NOT_SEEN;
    throw asReadError(err);
  }
  if (raw === null || raw === undefined) return NOT_SEEN;
  return normalizeTxView(raw);
}
