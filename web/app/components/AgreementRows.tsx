"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate, formatGen } from "../../lib/config";
import { formatCount, progressBps } from "../../lib/derive";
import type { AgreementSummary } from "../../lib/types";
import { ordinalOf, outcomeTitle } from "../../lib/words";
import { ProgressBar, Seal, StatusChip } from "./bits";

/**
 * Row-cards: one bone card per agreement inside a table, so comparable
 * values stay columns (right-aligned, mono) and the whole list scrolls
 * inside .tablewrap on a narrow screen. The row title is built from the
 * data, never the id; the operator's own title and the region sit under it.
 */
export function AgreementRows({ rows }: { rows: AgreementSummary[] }) {
  const router = useRouter();
  return (
    <div className="tablewrap">
      <table className="rowcards">
        <thead>
          <tr>
            <th className="seal-col"><span className="visually-hidden">Number</span></th>
            <th>Agreement</th>
            <th>Status</th>
            <th className="num">Reward</th>
            <th className="num">Verified</th>
            <th className="num">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const judged = a.judged_version > 0 && a.verdict !== "";
            const href = `/projects/${a.agreement_id}`;
            return (
              <tr key={a.agreement_id} className="rowcard rowlink" onClick={() => router.push(href)}>
                <td className="seal-col"><Seal n={ordinalOf(a.agreement_id)} /></td>
                <td className="rc-title">
                  <Link href={href} className="title">{outcomeTitle(a)}</Link>
                  <div className="small caption">{a.title} · {a.region}</div>
                </td>
                <td><StatusChip status={a.status} /></td>
                <td className="num">{formatGen(a.max_reward_atto)} GEN</td>
                <td className="num rc-verified">
                  {judged ? (
                    <>{formatCount(a.verified_impact)} {a.unit}</>
                  ) : (
                    <span className="sans">not yet judged</span>
                  )}
                  <ProgressBar
                    bps={judged ? progressBps(a.verified_impact, a.target) : 0}
                    label={`verified over target for agreement ${ordinalOf(a.agreement_id)}`}
                  />
                </td>
                <td className="num">{formatDate(a.deadline_epoch)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
