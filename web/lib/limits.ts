/**
 * The contract's bounds, mirrored, and the small pure helpers the drafting
 * form needs. `FALLBACK` lets the form validate before `get_config` answers;
 * the live config replaces it the moment it arrives. Every enum here is the
 * contract's exact spelling because these values are SENT, never shown.
 */
import type { ChainConfig } from "./types";

export const FALLBACK: ChainConfig = {
  version: "0.1.0",
  min_reward_atto: "10000000000000000",
  max_reward_atto: "1000000000000000000000",
  threshold_bps: [5000, 10000],
  target: [1, 1_000_000_000],
  min_independent: [1, 3],
  terms_chars: [100, 12000],
  title_chars: [1, 120],
  region_chars: [1, 80],
  metric_chars: [1, 80],
  unit_chars: [1, 24],
  label_chars: [1, 80],
  url_chars: [12, 400],
  grounds_chars: [20, 600],
  basis_entries: [1, 6],
  sources: [1, 6],
  versions_max: 4,
  window_seconds: [900, 2_592_000],
  submission_grace_seconds: [900, 7_776_000],
  default_windows: { submission_grace: 1_209_600, finality: 86_400, challenge: 86_400 },
  stale_challenge_seconds: 3600,
  challenge_bond_bps: 500,
  challenge_bond_floor_atto: "50000000000000000",
  contradiction_tolerance_bps: 1500,
  excerpt_chars: 6000,
  source_kinds: [
    "SATELLITE_OBSERVATION", "INDEPENDENT_ASSESSMENT", "GOVERNMENT_REGISTRY",
    "FIELD_MEASUREMENT", "PROJECT_REPORT", "PHOTOGRAPHIC_RECORD", "OTHER",
  ],
  source_classes: ["INDEPENDENT", "OPERATOR"],
  basis_tags: ["FETCHED", "RECORDED", "NEW"],
  conflict_codes: [
    "FABRICATION_INDICATED", "PERIOD_MISMATCH", "SCOPE_MISMATCH",
    "FIGURE_CONTRADICTION", "SOURCE_MISLABELLED", "OTHER_CONFLICT",
  ],
  verdicts: ["QUALIFIED", "NOT_QUALIFIED", "INCONCLUSIVE"],
  hold_reasons: ["EVIDENCE_INSUFFICIENT", "UNCORROBORATED", "SOURCES_CONTRADICT"],
  evidence_flags: ["SUFFICIENT", "PARTIAL", "INSUFFICIENT"],
  statuses: ["DRAFT", "FUNDED", "PENDING_FINALITY", "FINAL", "SETTLED", "RECLAIMED", "CANCELLED"],
};

/** The deadline must sit at least one window past the contract's clock. */
export const MIN_DEADLINE_AHEAD = 900;

/** The windows a drafter may pick, in seconds. Every value sits inside both
 *  the grace bounds and the window bounds the contract enforces. */
export const WINDOW_OPTIONS: readonly number[] = [
  900, 3_600, 86_400, 259_200, 604_800, 1_209_600, 2_592_000,
];

/** The option list for one window select: the standard options plus the
 *  current value if it is not one of them (a config default may not be). */
export function windowChoices(current: number, bounds: [number, number]): number[] {
  const inRange = (s: number) => s >= bounds[0] && s <= bounds[1];
  const set = new Set(WINDOW_OPTIONS.filter(inRange));
  if (Number.isFinite(current) && current > 0) set.add(current);
  return [...set].sort((a, b) => a - b);
}

const GEN = 10n ** 18n;

/** "0.05" → 5×10^16 atto; null for anything that is not a GEN amount. */
export function parseGen(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * GEN + BigInt((f + "0".repeat(18)).slice(0, 18));
}

/** `_bond_for`: max(floor, reward × bps / 10000). */
export function bondFor(rewardAtto: bigint, cfg: Pick<ChainConfig, "challenge_bond_bps" | "challenge_bond_floor_atto">): bigint {
  const pct = (rewardAtto * BigInt(cfg.challenge_bond_bps)) / 10_000n;
  const floor = BigInt(cfg.challenge_bond_floor_atto);
  return pct > floor ? pct : floor;
}

/** Epoch → the value a datetime-local input takes, in the browser's zone. */
export function toLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
