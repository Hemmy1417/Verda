"use client";

import { formatGen } from "../../lib/config";
import { formatCount } from "../../lib/derive";
import type { SourceClass } from "../../lib/types";

/** The hexagon indicator: outlined by default, `fill` closes it. */
export function Hex({ fill = false }: { fill?: boolean }) {
  return <i className={fill ? "hex fill" : "hex"} aria-hidden />;
}

/** A lifecycle state as a labelled hexagon. `terminal` fills it: the record
 *  has stopped moving. */
export function StatusChip({ status, terminal = false }: { status: string; terminal?: boolean }) {
  return (
    <span className={`chip ${status.toLowerCase()}`}>
      <Hex fill={terminal} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Whole value in the DOM, truncated by CSS, one-click copy. An address by
 *  default; `label` names the copy control when it holds a transaction hash. */
export function Addr({ value, label = "Copy address" }: { value: string; label?: string }) {
  if (!value) return <span className="faint">—</span>;
  return (
    <span title={value} style={{ whiteSpace: "nowrap" }}>
      <span className="addr">{value}</span>
      <button
        className="copy-btn"
        onClick={() => void navigator.clipboard?.writeText(value)}
        aria-label={label}
      >
        copy
      </button>
    </span>
  );
}

/** GEN figure — the number always outweighs its label. */
export function Gen({ atto, big = false }: { atto: string; big?: boolean }) {
  return (
    <span className={big ? "big-figure" : "figure"}>
      {formatGen(atto)} <span className="small muted">GEN</span>
    </span>
  );
}

/** The stat pair: an uppercase label over a value. `mono` for figures and
 *  hashes — the record — and the default grotesk for everything else. */
export function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={mono ? "stat-value mono" : "stat-value"}>{value}</span>
    </div>
  );
}

/** loading / empty / unreachable — three states, three sentences. */
export function StateNote({
  kind,
  children,
}: {
  kind: "loading" | "empty" | "unreachable";
  children: React.ReactNode;
}) {
  return <div className={`note${kind === "unreachable" ? " error" : ""}`}>{children}</div>;
}

/** The verdict as a stamp: the word at heading-sm with a hexagon — filled for
 *  a conclusive verdict, hollow for a hold — and the hold reason beside it.
 *  No colour: the word carries the meaning. */
export function VerdictStamp({ verdict, hold = "" }: { verdict: string; hold?: string }) {
  if (!verdict) return <span className="faint">—</span>;
  const conclusive = verdict === "QUALIFIED" || verdict === "NOT_QUALIFIED";
  return (
    <span className="stamp">
      <Hex fill={conclusive} />
      <span className="heading-sm">{verdict.replace(/_/g, " ")}</span>
      {hold ? <span className="small muted">{hold.replace(/_/g, " ").toLowerCase()}</span> : null}
    </span>
  );
}

/** A whole-unit figure with its unit — the number never smaller or lighter
 *  than its label. `value` null renders the dash: nothing is known yet. */
export function Figure({
  value,
  unit,
  big = false,
}: {
  value: number | null;
  unit: string;
  big?: boolean;
}) {
  return (
    <span className={big ? "big-figure" : "figure"}>
      {value === null ? "—" : formatCount(value)}{" "}
      <span className="small muted">{unit}</span>
    </span>
  );
}

/** Magnitude is LENGTH, never hue: a 2px rule-coloured track and an ink fill
 *  bps/100 percent wide. */
export function ProgressBar({ bps, label = "progress toward the target" }: { bps: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, bps / 100));
  return (
    <div
      className="bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The agreed class of a source origin as a chip: filled hexagon for
 *  INDEPENDENT, hollow for OPERATOR. A label both wallets signed, shown as one. */
export function BasisClass({ cls }: { cls: SourceClass | string }) {
  return (
    <span className="chip">
      <Hex fill={cls === "INDEPENDENT"} />
      {cls}
    </span>
  );
}
