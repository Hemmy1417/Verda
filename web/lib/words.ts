/**
 * Human words for every machine-shaped value the contract returns.
 *
 * The pages render nothing as it is spelled on-chain: no enum, no null, no
 * bare boolean. Each mapper here takes the contract's exact value (lib/types.ts)
 * and returns the word or sentence a reader needs. Unknown values fall back
 * to a lowercased, de-underscored spelling rather than throwing, so a newer
 * contract cannot blank a page. Unit-tested in tests/words.test.ts.
 */
import { formatCount } from "./derive";
import { sameAddress } from "./chain";
import type {
  AgreementSummary, BasisTag, ConflictCode, EvidenceFlag, SourceClass, SourceKind, Status, Verdict,
} from "./types";

const fallbackWord = (v: string) => v.replace(/_/g, " ").toLowerCase();

const KIND: Record<SourceKind, string> = {
  SATELLITE_OBSERVATION: "satellite observation",
  INDEPENDENT_ASSESSMENT: "independent assessment",
  GOVERNMENT_REGISTRY: "government registry",
  FIELD_MEASUREMENT: "field measurement",
  PROJECT_REPORT: "project report",
  PHOTOGRAPHIC_RECORD: "photographic record",
  OTHER: "other source",
};

/** The agreed kind of a source origin, as words. */
export function kindWord(kind: SourceKind | string): string {
  return (KIND as Record<string, string>)[kind] ?? fallbackWord(kind);
}

/** The agreed class: whether both parties regard the origin as independent. */
export function classWord(cls: SourceClass | string): string {
  if (cls === "INDEPENDENT") return "independent";
  if (cls === "OPERATOR") return "operator's own";
  return fallbackWord(cls);
}

/** What the class means for the money. */
export function classSentence(cls: SourceClass | string): string {
  return cls === "INDEPENDENT"
    ? "counts toward the verified figure"
    : "informs the panel and never raises the figure";
}

/** Where a dossier row's bytes came from in its round. */
export function basisWord(basis: BasisTag | string, round: number): string {
  if (basis === "FETCHED") return "fetched this round";
  if (basis === "RECORDED") return `recorded at round ${round}, re-read`;
  if (basis === "NEW") return "added by the challenger";
  return fallbackWord(basis);
}

export function readWord(readable: boolean): string {
  return readable ? "read" : "unreachable";
}

export function scopeWord(readable: boolean, scopeOk: boolean): string {
  if (!readable) return "not read";
  return scopeOk ? "on scope" : "not about this project";
}

export function labelWord(readable: boolean, kindMatches: boolean): string {
  if (!readable) return "not read";
  return kindMatches ? "matches its label" : "not what the label says";
}

/** The figure a source states, or the words for none. */
export function figureWord(figure: number | null | undefined, unit: string): string {
  if (figure === null || figure === undefined) return "no figure stated";
  return `${formatCount(figure)} ${unit}`;
}

const EVIDENCE: Record<EvidenceFlag, string> = {
  SUFFICIENT: "sufficient",
  PARTIAL: "partial",
  INSUFFICIENT: "insufficient",
};

export function evidenceWord(flag: EvidenceFlag | "" | string): string {
  if (!flag) return "not judged";
  return (EVIDENCE as Record<string, string>)[flag] ?? fallbackWord(flag);
}

const EVIDENCE_SENTENCE: Record<EvidenceFlag, string> = {
  SUFFICIENT: "the record suffices to establish the outcome",
  PARTIAL: "the record only partly establishes the outcome",
  INSUFFICIENT: "the record does not establish the outcome",
};

export function evidenceSentence(flag: EvidenceFlag | "" | string): string {
  if (!flag) return "the record has not been judged";
  return (EVIDENCE_SENTENCE as Record<string, string>)[flag] ?? fallbackWord(flag);
}

const CONFLICT: Record<ConflictCode, string> = {
  FABRICATION_INDICATED: "a source shows signs of fabrication",
  PERIOD_MISMATCH: "a source covers a different period",
  SCOPE_MISMATCH: "a source is about something else",
  FIGURE_CONTRADICTION: "the figures contradict each other",
  SOURCE_MISLABELLED: "a source is not what its label says",
  OTHER_CONFLICT: "another conflict the panel named",
};

export function conflictWord(code: ConflictCode | string): string {
  return (CONFLICT as Record<string, string>)[code] ?? fallbackWord(code);
}

const STATUS: Record<Status, string> = {
  DRAFT: "Draft",
  FUNDED: "Funded",
  PENDING_FINALITY: "Verdict pending",
  FINAL: "Verdict final",
  SETTLED: "Settled",
  RECLAIMED: "Reclaimed",
  CANCELLED: "Cancelled",
};

export function statusWord(status: Status | string): string {
  return (STATUS as Record<string, string>)[status] ?? fallbackWord(status);
}

const VERDICT: Record<Verdict, string> = {
  QUALIFIED: "Qualified",
  NOT_QUALIFIED: "Not qualified",
  INCONCLUSIVE: "Inconclusive",
};

export function verdictWord(verdict: Verdict | "" | string): string {
  if (!verdict) return "No verdict";
  return (VERDICT as Record<string, string>)[verdict] ?? fallbackWord(verdict);
}

/** "Adjudication of evidence version 1" / "Re-adjudication of evidence
 *  version 2, reconsidering round 1". */
export function roundWord(kind: string, version: number, reconsidered: number): string {
  if (kind === "RE_ADJUDICATION") {
    return `Re-adjudication of evidence version ${version}, reconsidering round ${reconsidered}`;
  }
  return `Adjudication of evidence version ${version}`;
}

/** `_store_package` added_by → who filed the package. */
export function filedByWord(addedBy: string): string {
  if (addedBy === "operator") return "the operator";
  const role = addedBy.split(":")[1];
  if (role === "funder") return "the funder, as challenger";
  if (role === "operator") return "the operator, as challenger";
  return "the challenger";
}

/** Which party a wallet is on this agreement, in words. */
export function partyWord(addr: string, ag: Pick<AgreementSummary, "operator" | "funder">): string {
  if (sameAddress(addr, ag.operator)) return "the operator";
  if (sameAddress(addr, ag.funder)) return "the funder";
  return "a third party";
}

/** The contract prefixes a challenger's source label with "[CHALLENGER] ". */
export function splitLabel(label: string): { text: string; challenger: boolean } {
  const m = /^\[CHALLENGER\]\s*/.exec(label);
  return m ? { text: label.slice(m[0].length), challenger: true } : { text: label, challenger: false };
}

/**
 * The outcome as a sentence fragment built from the data: "500 hectares of
 * degraded forest restored". When the metric already opens with the unit
 * ("hectares of degraded forest restored") the unit is not repeated.
 */
export function outcomeTitle(ag: Pick<AgreementSummary, "target" | "unit" | "metric">): string {
  const count = formatCount(ag.target);
  const unit = ag.unit.trim();
  const metric = ag.metric.trim();
  const lower = metric.toLowerCase();
  const u = unit.toLowerCase();
  if (u && (lower === u || lower.startsWith(u + " "))) {
    const rest = metric.slice(unit.length).trim();
    return rest ? `${count} ${unit} ${rest}` : `${count} ${unit}`;
  }
  if (!metric) return `${count} ${unit}`;
  return `${count} ${unit} of ${metric}`;
}

/** "500 hectares of degraded forest restored in Para, Brazil" */
export function humanTitle(ag: Pick<AgreementSummary, "target" | "unit" | "metric" | "region">): string {
  const region = ag.region.trim();
  return region ? `${outcomeTitle(ag)} in ${region}` : outcomeTitle(ag);
}

/** "vrd-000012" → 12: the agreement's ordinal, for the seal glyph. */
export function ordinalOf(agreementId: string): number {
  const m = /(\d+)\s*$/.exec(agreementId);
  return m ? Number(m[1]) : 0;
}
