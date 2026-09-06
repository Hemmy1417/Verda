/**
 * The contract's view shapes, typed once.
 *
 * Every field here is read from contracts/verda.py: `_agreement_view` (plus
 * the two fields `get_agreement` adds), `_store_package`, the final return of
 * `_panel_round`, `get_stats` and `get_config`. Atto amounts travel as decimal
 * STRINGS because the contract serialises them that way — a u256 does not
 * survive JSON as a number — and every caller turns them into BigInt itself.
 * Epochs, versions, counts and figures are plain integers and arrive as
 * numbers.
 */

export type Status =
  | "DRAFT" | "FUNDED" | "PENDING_FINALITY" | "FINAL" | "SETTLED" | "RECLAIMED" | "CANCELLED";

/** The record has stopped moving in these states; the chip fills. */
export const TERMINAL_STATUSES: readonly Status[] = ["SETTLED", "RECLAIMED", "CANCELLED"];

export type Verdict = "QUALIFIED" | "NOT_QUALIFIED" | "INCONCLUSIVE";
export type HoldReason = "EVIDENCE_INSUFFICIENT" | "UNCORROBORATED" | "SOURCES_CONTRADICT";
export type EvidenceFlag = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";

/** Where a dossier row's bytes came from in its round. */
export type BasisTag = "FETCHED" | "RECORDED" | "NEW";

export type SourceKind =
  | "SATELLITE_OBSERVATION" | "INDEPENDENT_ASSESSMENT" | "GOVERNMENT_REGISTRY"
  | "FIELD_MEASUREMENT" | "PROJECT_REPORT" | "PHOTOGRAPHIC_RECORD" | "OTHER";

/** Whether both parties regard an origin as independent of the operator. A
 *  label both wallets signed, not a verified fact. */
export type SourceClass = "INDEPENDENT" | "OPERATOR";

export type ConflictCode =
  | "FABRICATION_INDICATED" | "PERIOD_MISMATCH" | "SCOPE_MISMATCH"
  | "FIGURE_CONTRADICTION" | "SOURCE_MISLABELLED" | "OTHER_CONFLICT";

export type BasisEntry = { kind: SourceKind; origin: string; class: SourceClass };

/** `_agreement_view` — what `get_agreements` and `get_agreements_for` return
 *  per row. Empty strings stand for "not yet": funder before funding, verdict
 *  before promotion, hold_reason unless INCONCLUSIVE. */
export type AgreementSummary = {
  agreement_id: string;
  operator: string;
  funder: string;
  status: Status;
  title: string;
  region: string;
  metric: string;
  unit: string;
  target: number;
  threshold_bps: number;
  min_independent: number;
  max_reward_atto: string;
  /** max(0.05 GEN, 5% of the reward) — computed by the view, exact. */
  challenge_bond_atto: string;
  terms_sha256: string;
  deadline_epoch: number;
  submission_grace: number;
  finality_window: number;
  challenge_window: number;
  created_epoch: number;
  funded_epoch: number;
  evidence_version: number;
  evidence_root: string;
  last_submit_epoch: number;
  claimed_impact: number;
  judged_version: number;
  pending_version: number;
  pending_until_epoch: number;
  verdict: Verdict | "";
  verified_impact: number;
  score: number;
  evidence_flag: EvidenceFlag | "";
  hold_reason: HoldReason | "";
  final_epoch: number;
  challenge_until_epoch: number;
  challenge_open: boolean;
  challenger: string;
  challenge_grounds: string;
  challenge_new_version: number;
  challenged_version: number;
  challenge_filed_epoch: number;
  settled_epoch: number;
  payout_atto: string;
  refund_atto: string;
  reclaimed_epoch: number;
  cancelled_epoch: number;
};

/** `get_agreement` — the summary plus the frozen text and basis. */
export type Agreement = AgreementSummary & {
  terms_text: string;
  basis: BasisEntry[];
};

/** One row of an evidence package, as `_clean_rows` stores it. `kind` and
 *  `cls` are INHERITED from the basis entry the host matched; the submitter
 *  declared only `url` and `label`. */
export type PackageRow = {
  id: string;
  url: string;
  norm_url: string;
  host: string;
  domain: string;
  origin: string;
  kind: SourceKind;
  cls: SourceClass;
  label: string;
  added_version: number;
};

/** `_store_package`. `added_by` is "operator" or "challenger:funder" /
 *  "challenger:operator"; `root` is sha256 of the canonical package without it. */
export type Package = {
  agreement_id: string;
  version: number;
  claimed_impact: number;
  added_by: string;
  rows: PackageRow[];
  root: string;
};

/** One row of a dossier: the package row plus what THIS round read. `figure`
 *  is the whole-unit quantity the page itself states, or null. */
export type DossierRow = {
  id: string;
  url: string;
  host: string;
  domain: string;
  origin: string;
  kind: SourceKind;
  cls: SourceClass;
  label: string;
  added_version: number;
  basis: BasisTag;
  basis_round: number;
  fetch_epoch: number;
  readable: boolean;
  excerpt: string;
  digest: string;
  figure: number | null;
  scope_ok: boolean;
  kind_matches: boolean;
};

/** The final return of `_panel_round`: one consensus judgment over one
 *  evidence version. `reconsidered_round` is 0 for a first adjudication. */
export type Dossier = {
  dossier_id: string;
  agreement_id: string;
  evidence_version: number;
  evidence_root: string;
  round_kind: "ADJUDICATION" | "RE_ADJUDICATION";
  reconsidered_round: number;
  observed_epoch: number;
  target: number;
  threshold_bps: number;
  min_independent: number;
  claimed_impact: number;
  verdict: Verdict;
  verified_impact: number;
  hold_reason: HoldReason | "";
  score: number;
  evidence_flag: EvidenceFlag;
  conflicts: ConflictCode[];
  reason: string;
  rows: DossierRow[];
};

export type Stats = {
  agreements: number;
  funded: number;
  settled: number;
  qualified: number;
  paid_atto: string;
  escrow_atto: string;
};

/** `get_config` — every bound the writes enforce, so the forms never guess. */
export type ChainConfig = {
  version: string;
  min_reward_atto: string;
  max_reward_atto: string;
  threshold_bps: [number, number];
  target: [number, number];
  min_independent: [number, number];
  terms_chars: [number, number];
  title_chars: [number, number];
  region_chars: [number, number];
  metric_chars: [number, number];
  unit_chars: [number, number];
  label_chars: [number, number];
  url_chars: [number, number];
  grounds_chars: [number, number];
  basis_entries: [number, number];
  sources: [number, number];
  versions_max: number;
  window_seconds: [number, number];
  submission_grace_seconds: [number, number];
  default_windows: { submission_grace: number; finality: number; challenge: number };
  stale_challenge_seconds: number;
  challenge_bond_bps: number;
  challenge_bond_floor_atto: string;
  contradiction_tolerance_bps: number;
  excerpt_chars: number;
  source_kinds: SourceKind[];
  source_classes: SourceClass[];
  basis_tags: BasisTag[];
  conflict_codes: ConflictCode[];
  verdicts: Verdict[];
  hold_reasons: HoldReason[];
  evidence_flags: EvidenceFlag[];
  statuses: Status[];
};
