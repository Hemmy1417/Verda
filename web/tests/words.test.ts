/**
 * lib/words.ts turns every machine-shaped contract value into words. The
 * pages render only what these return, so each mapper is pinned here, with
 * the live vrd-000001 record's values (the preliminary deployment) as the
 * fixtures: an unreachable operator page, two readable pages that were not
 * what their labels said, a null figure on every row.
 */
import { describe, expect, it } from "vitest";
import {
  basisWord, classSentence, classWord, conflictWord, evidenceSentence, evidenceWord, figureWord,
  filedByWord, humanTitle, kindWord, labelWord, ordinalOf, outcomeTitle, partyWord, readWord,
  roundWord, scopeWord, splitLabel, statusWord, verdictWord,
} from "@/lib/words";

const RAW = /[A-Z]{3,}_[A-Z]/; // an on-chain enum spelling leaking through

describe("kinds and classes", () => {
  it("names every agreed kind in words", () => {
    expect(kindWord("SATELLITE_OBSERVATION")).toBe("satellite observation");
    expect(kindWord("INDEPENDENT_ASSESSMENT")).toBe("independent assessment");
    expect(kindWord("GOVERNMENT_REGISTRY")).toBe("government registry");
    expect(kindWord("FIELD_MEASUREMENT")).toBe("field measurement");
    expect(kindWord("PROJECT_REPORT")).toBe("project report");
    expect(kindWord("PHOTOGRAPHIC_RECORD")).toBe("photographic record");
    expect(kindWord("OTHER")).toBe("other source");
  });
  it("falls back to lowercased words for a kind it has never seen", () => {
    expect(kindWord("DRONE_SURVEY")).toBe("drone survey");
  });
  it("names the class and what it means for the money", () => {
    expect(classWord("INDEPENDENT")).toBe("independent");
    expect(classWord("OPERATOR")).toBe("operator's own");
    expect(classSentence("INDEPENDENT")).toBe("counts toward the verified figure");
    expect(classSentence("OPERATOR")).toBe("informs the panel and never raises the figure");
  });
});

describe("dossier row readings", () => {
  it("says where the bytes came from", () => {
    expect(basisWord("FETCHED", 1)).toBe("fetched this round");
    expect(basisWord("RECORDED", 1)).toBe("recorded at round 1, re-read");
    expect(basisWord("NEW", 2)).toBe("added by the challenger");
  });
  it("renders the booleans as words, and an unread row as not read", () => {
    expect(readWord(true)).toBe("read");
    expect(readWord(false)).toBe("unreachable");
    expect(scopeWord(true, true)).toBe("on scope");
    expect(scopeWord(true, false)).toBe("not about this project");
    expect(scopeWord(false, false)).toBe("not read");
    expect(labelWord(true, true)).toBe("matches its label");
    expect(labelWord(true, false)).toBe("not what the label says");
    expect(labelWord(false, true)).toBe("not read");
  });
  it("renders a null figure as words and a figure with its unit", () => {
    expect(figureWord(null, "hectares")).toBe("no figure stated");
    expect(figureWord(undefined, "hectares")).toBe("no figure stated");
    expect(figureWord(463, "hectares")).toBe("463 hectares");
    expect(figureWord(1_000_000, "trees")).toBe("1,000,000 trees");
  });
});

describe("record-level words", () => {
  it("evidence sufficiency", () => {
    expect(evidenceWord("SUFFICIENT")).toBe("sufficient");
    expect(evidenceWord("PARTIAL")).toBe("partial");
    expect(evidenceWord("INSUFFICIENT")).toBe("insufficient");
    expect(evidenceWord("")).toBe("not judged");
    expect(evidenceSentence("INSUFFICIENT")).toBe("the record does not establish the outcome");
    expect(evidenceSentence("SUFFICIENT")).toBe("the record suffices to establish the outcome");
  });
  it("conflicts as sentences", () => {
    expect(conflictWord("SOURCE_MISLABELLED")).toBe("a source is not what its label says");
    expect(conflictWord("FABRICATION_INDICATED")).toBe("a source shows signs of fabrication");
    expect(conflictWord("PERIOD_MISMATCH")).toBe("a source covers a different period");
    expect(conflictWord("SCOPE_MISMATCH")).toBe("a source is about something else");
    expect(conflictWord("FIGURE_CONTRADICTION")).toBe("the figures contradict each other");
    expect(conflictWord("OTHER_CONFLICT")).toBe("another conflict the panel named");
  });
  it("statuses and verdicts in sentence case", () => {
    expect(statusWord("DRAFT")).toBe("Draft");
    expect(statusWord("PENDING_FINALITY")).toBe("Verdict pending");
    expect(statusWord("FINAL")).toBe("Verdict final");
    expect(statusWord("RECLAIMED")).toBe("Reclaimed");
    expect(verdictWord("QUALIFIED")).toBe("Qualified");
    expect(verdictWord("NOT_QUALIFIED")).toBe("Not qualified");
    expect(verdictWord("INCONCLUSIVE")).toBe("Inconclusive");
    expect(verdictWord("")).toBe("No verdict");
    for (const w of ["DRAFT", "FUNDED", "PENDING_FINALITY", "FINAL", "SETTLED", "RECLAIMED", "CANCELLED"]) {
      expect(statusWord(w)).not.toMatch(RAW);
    }
  });
  it("names a round and who filed a package", () => {
    expect(roundWord("ADJUDICATION", 1, 0)).toBe("Adjudication of evidence version 1");
    expect(roundWord("RE_ADJUDICATION", 2, 1)).toBe("Re-adjudication of evidence version 2, reconsidering round 1");
    expect(filedByWord("operator")).toBe("the operator");
    expect(filedByWord("challenger:funder")).toBe("the funder, as challenger");
    expect(filedByWord("challenger:operator")).toBe("the operator, as challenger");
  });
  it("strips the challenger tag off a label", () => {
    expect(splitLabel("[CHALLENGER] Satellite pass 2")).toEqual({ text: "Satellite pass 2", challenger: true });
    expect(splitLabel("Satellite observation summary")).toEqual({ text: "Satellite observation summary", challenger: false });
  });
  it("names the party a wallet is, whatever the address case", () => {
    const ag = { operator: "0x86ddeafc53b2e194aad4d74d265ab7cb741118b5", funder: "0x57a7dc8ea2d2de0a5906eb28902b8d677dfc657c" };
    expect(partyWord("0x86dDEAfC53b2E194aaD4D74d265Ab7Cb741118b5", ag)).toBe("the operator");
    expect(partyWord(ag.funder, ag)).toBe("the funder");
    expect(partyWord("0x1111111111111111111111111111111111111111", ag)).toBe("a third party");
  });
});

describe("the human title", () => {
  it("does not repeat a unit the metric already opens with", () => {
    const live = { target: 500, unit: "hectares", metric: "hectares of degraded forest restored", region: "Para, Brazil" };
    expect(outcomeTitle(live)).toBe("500 hectares of degraded forest restored");
    expect(humanTitle(live)).toBe("500 hectares of degraded forest restored in Para, Brazil");
  });
  it("joins a bare metric with 'of'", () => {
    const ag = { target: 500, unit: "hectares", metric: "native vegetation restored", region: "Pará, Brazil" };
    expect(humanTitle(ag)).toBe("500 hectares of native vegetation restored in Pará, Brazil");
  });
  it("handles a metric that is the unit plus a verb, or nothing at all", () => {
    expect(outcomeTitle({ target: 12000, unit: "trees", metric: "trees planted" })).toBe("12,000 trees planted");
    expect(outcomeTitle({ target: 12000, unit: "trees", metric: "Trees" })).toBe("12,000 trees");
    expect(outcomeTitle({ target: 3, unit: "wells", metric: "" })).toBe("3 wells");
    expect(humanTitle({ target: 3, unit: "wells", metric: "", region: "" })).toBe("3 wells");
  });
  it("reads the ordinal off the agreement id", () => {
    expect(ordinalOf("vrd-000001")).toBe(1);
    expect(ordinalOf("vrd-000042")).toBe(42);
    expect(ordinalOf("nonsense")).toBe(0);
  });
});
