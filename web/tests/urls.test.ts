/**
 * lib/urls.ts mirrors the contract's pure URL rules. Every table here is
 * lifted from tests/direct/test_evidence.py so the TypeScript and the Python
 * answer identically; a divergence means the composer would accept a package
 * the contract refuses, or refuse one it accepts.
 */
import { describe, expect, it } from "vitest";
import {
  distinctPublishers, hostOf, matchBasis, matchesOrigin, normalizeUrl,
  registrableDomain, validOrigin, validUrl,
} from "@/lib/urls";
import type { BasisEntry } from "@/lib/types";

const SAT_URL = "https://sat.example.org/observations/rv-7/2026-q3.txt";

describe("normalizeUrl — two spellings of one page are one page", () => {
  const table: Array<[string, string]> = [
    ["HTTPS://SAT.EXAMPLE.ORG/Obs/X", "https://sat.example.org/Obs/X"],
    ["https://sat.example.org:443/x", "https://sat.example.org/x"],
    ["http://sat.example.org:80/x", "http://sat.example.org/x"],
    ["https://sat.example.org:80/x", "https://sat.example.org:80/x"],
    ["http://sat.example.org:443/x", "http://sat.example.org:443/x"],
    ["https://sat.example.org:8443/x", "https://sat.example.org:8443/x"],
    ["https://sat.example.org/x#frag", "https://sat.example.org/x"],
    ["https://sat.example.org/x/", "https://sat.example.org/x"],
    ["https://sat.example.org/", "https://sat.example.org/"],
    ["https://sat.example.org", "https://sat.example.org/"],
    ["https://sat.example.org/x?b=2&a=1", "https://sat.example.org/x?b=2&a=1"],
    ["https://sat.example.org/x?", "https://sat.example.org/x"],
    ["https://sat.example.org/x?q=1#f", "https://sat.example.org/x?q=1"],
    ["https://sat.example.org/x/?q=1", "https://sat.example.org/x?q=1"],
    ["  https://sat.example.org/x  ", "https://sat.example.org/x"],
    ["https://user:pw@sat.example.org/x", "https://sat.example.org/x"],
    ["https://sat.example.org@evil.io/x", "https://evil.io/x"],
    ["https://sat.example.org/x@y", "https://sat.example.org/x@y"],
  ];
  for (const [raw, norm] of table) {
    it(`${JSON.stringify(raw)} → ${norm}, idempotently`, () => {
      expect(normalizeUrl(raw)).toBe(norm);
      expect(normalizeUrl(norm)).toBe(norm);
    });
  }

  it("folds every twin of the demo page onto the same spelling", () => {
    const twins = [
      SAT_URL,
      "  " + SAT_URL + "  ",
      "https://SAT.EXAMPLE.ORG/observations/rv-7/2026-q3.txt",
      "https://sat.example.org:443/observations/rv-7/2026-q3.txt",
      SAT_URL + "#summary",
      SAT_URL + "/",
      "https://viewer@sat.example.org/observations/rv-7/2026-q3.txt",
      "https://Sat.Example.ORG:443/observations/rv-7/2026-q3.txt/#top",
    ];
    for (const t of twins) expect(normalizeUrl(t)).toBe(SAT_URL);
  });

  it("drops exactly one trailing slash", () => {
    expect(normalizeUrl("https://sat.example.org/x//")).toBe("https://sat.example.org/x/");
    expect(normalizeUrl("https://sat.example.org/x/")).toBe("https://sat.example.org/x");
  });

  it("keeps the scheme and the path case", () => {
    expect(normalizeUrl("http://sat.example.org/x")).not.toBe(normalizeUrl("https://sat.example.org/x"));
    expect(normalizeUrl("https://sat.example.org/X")).not.toBe(normalizeUrl("https://sat.example.org/x"));
    expect(normalizeUrl("https://sat.example.org/x?Q=1")).not.toBe(normalizeUrl("https://sat.example.org/x?q=1"));
  });

  it("distinguishes a query string and a non-default port", () => {
    const norms = new Set([
      normalizeUrl(SAT_URL),
      normalizeUrl(SAT_URL + "?rev=2"),
      normalizeUrl(SAT_URL + "?REV=2"),
      normalizeUrl("https://sat.example.org:8443/observations/rv-7/2026-q3.txt"),
    ]);
    expect(norms.size).toBe(4);
    expect(normalizeUrl(SAT_URL + "?rev=2#x")).toBe(SAT_URL + "?rev=2");
  });
});

describe("hostOf — the authority ends at the first of / ? #", () => {
  const table: Array<[string, string]> = [
    ["https://sat.example.org/x", "sat.example.org"],
    ["https://SAT.Example.org/x", "sat.example.org"],
    ["https://sat.example.org:8443/x", "sat.example.org"],
    ["https://user@sat.example.org/x", "sat.example.org"],
    ["https://sat.example.org@evil.io/x", "evil.io"],
    ["https://sat.example.org/x@y", "sat.example.org"],
    ["https://sat.example.org/x?u=a@sat.example.org", "sat.example.org"],
    ["https://sat.example.org", "sat.example.org"],
    ["https://sat.example.org#@evil.io", "sat.example.org"],
    // the query-before-path smuggle: the host is evil.io, never the basis host
    ["https://evil.io?x=@sat.example.org", "evil.io"],
    ["https://evil.io/#@sat.example.org/observations", "evil.io"],
  ];
  for (const [url, host] of table) {
    it(`${url} → ${host}`, () => expect(hostOf(url)).toBe(host));
  }
});

describe("registrableDomain — the publisher behind a host", () => {
  const table: Array<[string, string]> = [
    ["data.example.org", "example.org"],
    ["sat.example.org", "example.org"],
    ["deep.tiles.sat.example.org", "example.org"],
    ["a.b.c.example.com", "example.com"],
    ["example.com", "example.com"],
    ["a.example.co.uk", "example.co.uk"],
    ["example.co.uk", "example.co.uk"],
    ["x.y.co.jp", "y.co.jp"],
    ["x.y.ac.uk", "y.ac.uk"],
    ["data.agency.gov.br", "agency.gov.br"],
    ["www.example.io", "example.io"],
    ["localhost", "localhost"],
    ["", ""],
    ["data.example.org:8443", "example.org"],
    ["DATA.Example.ORG", "example.org"],
  ];
  for (const [host, domain] of table) {
    it(`${JSON.stringify(host)} → ${JSON.stringify(domain)}`, () => expect(registrableDomain(host)).toBe(domain));
  }

  it("two hosts of one publisher share a registrable domain", () => {
    expect(registrableDomain("sat.example.org")).toBe(registrableDomain("gis.example.org"));
    expect(registrableDomain("sat.example.org")).toBe(registrableDomain("example.org"));
    expect(registrableDomain("sat.example.org")).not.toBe(registrableDomain("assessor.example.net"));
    expect(registrableDomain("sat.example.org")).not.toBe(registrableDomain("sat.example.com"));
  });
});

describe("matchesOrigin — inside an origin means equal or under it at a dot", () => {
  const table: Array<[string, string, boolean]> = [
    ["sat.example.org", "sat.example.org", true],
    ["tiles.sat.example.org", "sat.example.org", true],
    ["a.b.sat.example.org", "sat.example.org", true],
    ["sat.example.org", "example.org", true],
    ["notsat.example.org", "sat.example.org", false],
    ["sat.example.org.evil.io", "sat.example.org", false],
    ["example.org", "sat.example.org", false],
    ["sat.example.net", "sat.example.org", false],
    ["sat.example.org.", "sat.example.org", false],
    ["SAT.example.org", "sat.example.org", false],
    ["", "sat.example.org", false],
    ["sat.example.org", "", false],
  ];
  for (const [host, origin, ok] of table) {
    it(`${JSON.stringify(host)} in ${JSON.stringify(origin)} → ${ok}`, () => {
      expect(matchesOrigin(host, origin)).toBe(ok);
    });
  }
});

describe("validUrl — printable ASCII, http(s), no fence-forging characters, 12–400", () => {
  const table: Array<[string, boolean]> = [
    ["https://sat.example.org/x", true],
    ["http://sat.example.org/x", true],
    ["https://ab.c", true],
    ["https://a.b", false],
    ["https://sat.example.org/" + "a".repeat(376), true],
    ["https://sat.example.org/" + "a".repeat(377), false],
    ["https://sat.example.org/x?q=1&r=2#frag", true],
    ["https://sat.example.org/~user/%20x", true],
    ["https://xn--bcher-kva.example/x", true],
    ["sat.example.org/x", false],
    ["//sat.example.org/x", false],
    ["ftp://sat.example.org/x", false],
    ["HTTPS://sat.example.org/x", false],
    ["Https://sat.example.org/x", false],
    ["https://sat.example.org/café", false],
    ["https://sat.example.org/a b", false],
    ["https://sat.example.org/a\tb", false],
    ["https://sat.example.org/a\nb", false],
    ["https://sat.example.org/x'y", false],
    ['https://sat.example.org/x"y', false],
    ["https://sat.example.org/`x`", false],
    ["https://sat.example.org/<x>", false],
    ["https://sat.example.org/a|b", false],
    ["https://sat.example.org/a\\b", false],
    ["", false],
  ];
  for (const [url, ok] of table) {
    it(`${JSON.stringify(url.length > 60 ? url.slice(0, 40) + `…(${url.length})` : url)} → ${ok}`, () => {
      expect(validUrl(url)).toBe(ok);
    });
  }
  it("refuses a non-string", () => {
    expect(validUrl(12345)).toBe(false);
    expect(validUrl(undefined)).toBe(false);
  });
});

describe("validOrigin — a lowercase hostname with a dot", () => {
  const table: Array<[string, boolean]> = [
    ["sat.example.org", true],
    ["a.bc", true],
    ["a.b", false],
    ["a".repeat(116) + ".com", true],
    ["a".repeat(117) + ".com", false],
    ["ex-am.ple.org", true],
    ["x1.y2", true],
    ["192.168.0.1", true],
    ["localhost", false],
    [".example.org", false],
    ["example.org.", false],
    ["example..org", false],
    ["Example.org", false],
    ["ex_ample.org", false],
    ["-ex.example.org", false],
    ["ex-.example.org", false],
    ["sat.example.org:443", false],
    ["https://sat.example.org", false],
    ["sat.example.org/", false],
    ["sat example.org", false],
    ["", false],
  ];
  for (const [origin, ok] of table) {
    it(`${JSON.stringify(origin.length > 40 ? origin.slice(0, 20) + `…(${origin.length})` : origin)} → ${ok}`, () => {
      expect(validOrigin(origin)).toBe(ok);
    });
  }
});

describe("matchBasis — the longest matching origin wins; outside is null", () => {
  const NESTED: BasisEntry[] = [
    { kind: "OTHER", origin: "example.org", class: "INDEPENDENT" },
    { kind: "PROJECT_REPORT", origin: "ops.example.org", class: "OPERATOR" },
  ];
  const DEMO: BasisEntry[] = [
    { kind: "SATELLITE_OBSERVATION", origin: "sat.example.org", class: "INDEPENDENT" },
    { kind: "PROJECT_REPORT", origin: "operator.example.com", class: "OPERATOR" },
  ];

  it("nested origins take the longest match whatever the order", () => {
    for (const basis of [NESTED, [...NESTED].reverse()]) {
      expect(matchBasis("https://data.example.org/figures", basis)?.origin).toBe("example.org");
      expect(matchBasis("https://ops.example.org/report", basis)?.origin).toBe("ops.example.org");
      expect(matchBasis("https://deep.ops.example.org/annex", basis)?.class).toBe("OPERATOR");
    }
  });

  it("a subdomain inherits kind and class from its origin", () => {
    const m = matchBasis("https://tiles.sat.example.org/rv-7/2026-08.tif", DEMO);
    expect(m).toEqual(DEMO[0]);
    expect(matchBasis("https://cdn.operator.example.com/reports/rv-7.pdf", DEMO)).toEqual(DEMO[1]);
  });

  it("a host that merely ends with the origin text is outside", () => {
    expect(matchBasis("https://notsat.example.org/observations/rv-7", DEMO)).toBeNull();
  });

  it("nothing smuggles a basis host past the parser", () => {
    for (const url of [
      "https://example.org/observations/rv-7",
      "https://sat.example.org.evil.io/observations",
      "https://sat.example.net/observations/rv-7",
      "https://other.example.io/observations/rv-7",
      "https://sat.example.org@evil.io/observations",
      "https://sat.example.org%40evil.io/observations",
      "https://evil.io/#@sat.example.org/observations",
      "https://sat.example.org./observations/rv-7",
      "https://evil.io?x=@sat.example.org",
    ]) {
      expect(matchBasis(url, DEMO), url).toBeNull();
    }
  });
});

describe("distinctPublishers — two pages on one publisher are one voice", () => {
  it("counts registrable domains, not hosts or rows", () => {
    expect(distinctPublishers(["sat.example.org", "sat.example.org", "tiles.sat.example.org"])).toBe(1);
    expect(distinctPublishers(["sat.example.org", "assessor.example.net"])).toBe(2);
    expect(distinctPublishers(["api.registry.example.co.uk", "registry.example.co.uk"])).toBe(1);
    expect(distinctPublishers([])).toBe(0);
  });
});
