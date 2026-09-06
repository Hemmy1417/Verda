"use client";

import { formatRelative, formatStamp } from "../../lib/config";
import type { TimelineEvent } from "../../lib/timeline";

/**
 * The activity timeline: one row per event, a hexagon per row. Filled for
 * something that happened, hollow for a boundary the contract still waits
 * for. Dates are stamps with their distance from now.
 */
export function Timeline({ events, now }: { events: TimelineEvent[]; now: number }) {
  if (events.length === 0) return <p>Nothing has happened on this agreement yet.</p>;
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.key} className={e.future ? "tl future" : "tl"}>
          <i className={e.boundary && e.future ? "hex" : "hex fill"} aria-hidden />
          <div className="tl-body">
            <div className="tl-head">
              <span className="tl-title">{e.title}</span>
              <span className="small tl-when">
                {formatStamp(e.at)} ({formatRelative(e.at, now)})
              </span>
            </div>
            <p className="tl-detail">{e.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
