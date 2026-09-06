"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCount } from "../../lib/derive";
import { getAgreements } from "../../lib/read";
import type { AgreementSummary } from "../../lib/types";
import { AgreementRows } from "../components/AgreementRows";
import { StateNote } from "../components/bits";

const PAGE = 20;

/**
 * Every agreement on the contract as row-cards, newest first, twenty at a
 * time. The next twenty are appended rather than swapped so the reader keeps
 * their place. Three read states, three sentences.
 */
export default function Projects() {
  const [rows, setRows] = useState<AgreementSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "unreachable">("loading");
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);

  const load = useCallback(async (offset: number) => {
    try {
      const page = await getAgreements(offset, PAGE);
      setTotal(page.total);
      setRows((prev) => (offset === 0 ? page.agreements : [...prev, ...page.agreements]));
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState((s) => (s === "ready" ? s : "unreachable"));
    }
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => void load(0), 0);
    return () => clearTimeout(kick);
  }, [load]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Agreements</p>
          <h1 className="heading-lg">Every outcome on the contract.</h1>
          <p className="lede">
            Newest first. The verified bar is the share of the target the panel confirmed.
            {state === "ready" && ` ${formatCount(total)} agreement${total === 1 ? "" : "s"} so far.`}
          </p>
        </div>
        <Link href="/create" className="pill">Draft an agreement</Link>
      </div>

      {state === "loading" && (
        <StateNote kind="loading">Reading the agreements from the contract.</StateNote>
      )}
      {state === "unreachable" && (
        <StateNote kind="unreachable">
          The agreements could not be read just now, so nothing is shown rather than something
          stale. Retrying in a moment usually works. {error}
        </StateNote>
      )}
      {state === "ready" && rows.length === 0 && (
        <StateNote kind="empty">
          No agreement has been drafted on this contract yet.{" "}
          <Link href="/create" className="inline-link">Draft the first.</Link>
        </StateNote>
      )}

      {state === "ready" && rows.length > 0 && <AgreementRows rows={rows} />}

      {state === "ready" && rows.length < total && (
        <div className="action-row">
          <button
            className="pill quiet"
            disabled={more}
            onClick={() => {
              setMore(true);
              void load(rows.length).finally(() => setMore(false));
            }}
          >
            {more ? "Reading" : `Read the next ${Math.min(PAGE, total - rows.length)}`}
          </button>
          <span className="small">
            {formatCount(rows.length)} of {formatCount(total)} shown
          </span>
        </div>
      )}
    </main>
  );
}
