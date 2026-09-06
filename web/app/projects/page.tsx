"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatGen } from "../../lib/config";
import { formatCount, progressBps } from "../../lib/derive";
import { getAgreements } from "../../lib/read";
import { TERMINAL_STATUSES, type AgreementSummary } from "../../lib/types";
import { ProgressBar, StateNote, StatusChip } from "../components/bits";

const PAGE = 20;

/**
 * The discovery table. Comparable rows are a table; magnitude is the length
 * of the verified bar, never a hue. Newest first, twenty at a time, and the
 * next twenty are appended rather than swapped so the reader keeps their place.
 */
export default function Projects() {
  const router = useRouter();
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
      <div>
        <p className="eyebrow">Projects</p>
        <h1 className="heading-lg" style={{ marginTop: 12 }}>Every agreement on the contract.</h1>
        <p className="muted" style={{ marginTop: 16, maxWidth: "62ch" }}>
          {state === "ready"
            ? `${formatCount(total)} agreement${total === 1 ? "" : "s"}, newest first. Terminal states are filled; the verified bar's length is verified over target.`
            : "Newest first. Terminal states are filled; the verified bar's length is verified over target."}
        </p>
      </div>

      {state === "loading" && (
        <StateNote kind="loading">Reading the agreements from the contract…</StateNote>
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

      {state === "ready" && rows.length > 0 && (
        <div className="tablewrap">
          <table className="rows">
            <thead>
              <tr>
                <th>Title</th>
                <th>Outcome</th>
                <th className="num">Reward</th>
                <th>Status</th>
                <th className="num">Verified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const judged = a.judged_version > 0 && a.verdict !== "";
                return (
                  <tr
                    key={a.agreement_id}
                    className="rowlink"
                    onClick={() => router.push(`/projects/${a.agreement_id}`)}
                  >
                    <td>
                      <Link href={`/projects/${a.agreement_id}`} className="title">{a.title}</Link>
                      <div className="small muted">{a.region}</div>
                    </td>
                    <td>
                      <span className="figure">{formatCount(a.target)}</span>{" "}
                      <span className="small muted">{a.unit}</span>
                    </td>
                    <td className="num">{formatGen(a.max_reward_atto)} GEN</td>
                    <td>
                      <StatusChip status={a.status} terminal={TERMINAL_STATUSES.includes(a.status)} />
                    </td>
                    <td className="num" style={{ minWidth: 120 }}>
                      {judged ? formatCount(a.verified_impact) : "—"}
                      <div style={{ marginTop: 8 }}>
                        <ProgressBar
                          bps={judged ? progressBps(a.verified_impact, a.target) : 0}
                          label={`${a.agreement_id} verified over target`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {state === "ready" && rows.length < total && (
        <div>
          <button
            className="pill quiet"
            disabled={more}
            onClick={() => {
              setMore(true);
              void load(rows.length).finally(() => setMore(false));
            }}
          >
            {more ? "Reading…" : `Read the next ${Math.min(PAGE, total - rows.length)}`}
          </button>
          <span className="small muted" style={{ marginLeft: 16 }}>
            {formatCount(rows.length)} of {formatCount(total)} shown
          </span>
        </div>
      )}
    </main>
  );
}
