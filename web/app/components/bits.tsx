"use client";

import { formatGen, formatRelative, formatStamp } from "../../lib/config";
import { formatCount } from "../../lib/derive";
import { TERMINAL_STATUSES, type SourceClass, type SourceKind } from "../../lib/types";
import { classWord, kindWord, statusWord, verdictWord } from "../../lib/words";

/** The hexagon indicator: outlined by default, `fill` closes it. */
export function Hex({ fill = false }: { fill?: boolean }) {
  return <i className={fill ? "hex fill" : "hex"} aria-hidden />;
}

/** A lifecycle state as a labelled hexagon, in words. A terminal state fills
 *  it: the record has stopped moving. */
export function StatusChip({ status, terminal }: { status: string; terminal?: boolean }) {
  const filled = terminal ?? (TERMINAL_STATUSES as readonly string[]).includes(status);
  return (
    <span className="chip">
      <Hex fill={filled} />
      {statusWord(status)}
    </span>
  );
}

/** The agreed kind of an origin, as words. */
export function KindChip({ kind }: { kind: SourceKind | string }) {
  return <span className="chip">{kindWord(kind)}</span>;
}

/** The agreed class of an origin: filled hexagon for independent, hollow for
 *  the operator's own. A label both wallets signed, shown as one. */
export function ClassChip({ cls }: { cls: SourceClass | string }) {
  return (
    <span className="chip">
      <Hex fill={cls === "INDEPENDENT"} />
      {classWord(cls)}
    </span>
  );
}

/**
 * A full value (address, hash, id, url) whole in the DOM, truncated by CSS,
 * with one-click copy and, for a url, an open link. This is the only way a
 * raw value reaches a page, and it lives inside technical folds and the
 * footer.
 */
export function CopyValue({
  value, label = "Copy", wide = false, href,
}: {
  value: string;
  label?: string;
  wide?: boolean;
  href?: string;
}) {
  if (!value) return <span>none</span>;
  return (
    <span className="copyval" title={value}>
      <span className={wide ? "url" : "addr"}>{value}</span>
      <button
        className="copy-btn"
        onClick={() => void navigator.clipboard?.writeText(value)}
        aria-label={label}
      >
        copy
      </button>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="ghost open-link">open</a>
      ) : null}
    </span>
  );
}

/** An address or hash with copy; the footer and the transaction flow use it. */
export function Addr({ value, label = "Copy address" }: { value: string; label?: string }) {
  return <CopyValue value={value} label={label} />;
}

/** GEN figure: the number always outweighs its label. */
export function Gen({ atto, big = false }: { atto: string | bigint; big?: boolean }) {
  return (
    <span className={big ? "big-figure" : "figure"}>
      {formatGen(atto)} <span className="small unit">GEN</span>
    </span>
  );
}

/** The stat pair: an uppercase label over a value. `mono` for figures and
 *  hashes (the record) and the default grotesk for everything else. */
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

/** loading / empty / unreachable: three states, three sentences. */
export function StateNote({
  kind,
  children,
}: {
  kind: "loading" | "empty" | "unreachable";
  children: React.ReactNode;
}) {
  return <div className={`note${kind === "unreachable" ? " error" : ""}`} role={kind === "unreachable" ? "alert" : undefined}>{children}</div>;
}

/** The verdict as a stamp: the word in the display serif with a hexagon,
 *  filled for a conclusive verdict and hollow for a hold. No colour: the word
 *  carries the meaning. */
export function VerdictStamp({ verdict }: { verdict: string }) {
  const conclusive = verdict === "QUALIFIED" || verdict === "NOT_QUALIFIED";
  return (
    <span className="stamp">
      <Hex fill={conclusive} />
      <span className="heading">{verdictWord(verdict)}</span>
    </span>
  );
}

/** A whole-unit figure with its unit. `value` null renders `fallback` in
 *  words, in the utility face: nothing is known yet, and a dash would say
 *  less. */
export function Figure({
  value,
  unit,
  big = false,
  fallback = "not yet known",
}: {
  value: number | null;
  unit: string;
  big?: boolean;
  fallback?: string;
}) {
  if (value === null) {
    return <span className={big ? "big-word" : undefined}>{fallback}</span>;
  }
  return (
    <span className={big ? "big-figure" : "figure"}>
      {formatCount(value)} <span className="small unit">{unit}</span>
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

/** The seal: the agreement's ordinal in a bone circle, in the display serif.
 *  The same motif the home page uses for 1, 2 and 3. */
export function Seal({ n, size = "sm" }: { n: number; size?: "sm" | "lg" }) {
  return (
    <span className={`seal ${size}`} aria-label={`Agreement ${n}`}>
      <span className="seal-num">{n}</span>
    </span>
  );
}

/** A moment: the stamp and its distance from now. */
export function When({ epoch, now }: { epoch: number; now: number }) {
  if (!epoch) return <span>not recorded</span>;
  return (
    <span>
      {formatStamp(epoch)} <span className="small">({formatRelative(epoch, now)})</span>
    </span>
  );
}

export type TechRow = {
  label: string;
  value: string;
  /** For a url: an open link beside the copy button. */
  href?: string;
  /** Wider truncation for urls and long ids. */
  wide?: boolean;
};

/**
 * The technical record: a collapsed fold holding the full ids, hashes,
 * addresses, urls and epochs of one section. Each value is whole in the DOM,
 * CSS-truncated, with a copy button. Primary content never shows these.
 */
export function Technical({ title = "Technical record", rows }: { title?: string; rows: TechRow[] }) {
  return (
    <details className="technical">
      <summary>{title}</summary>
      <dl className="tech">
        {rows.map((r) => (
          <div key={r.label} className="tech-row">
            <dt>{r.label}</dt>
            <dd>
              <CopyValue value={r.value} label={`Copy ${r.label.toLowerCase()}`} wide={r.wide} href={r.href} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * Numbered step chips. With `onSelect` the chips are buttons (the drafting
 * form); without it they are a static list (persona cards, the lifecycle).
 * `current` marks the active step and every earlier step reads as done.
 */
export function StepChips({
  steps, current, onSelect,
}: {
  steps: string[];
  current?: number;
  onSelect?: (i: number) => void;
}) {
  return (
    <ol className="stepchips">
      {steps.map((s, i) => {
        const state = current === undefined ? "" : i === current ? " on" : i < current ? " done" : "";
        const cls = `stepchip${state}${onSelect ? " has-btn" : ""}`;
        return (
          <li key={s} className={cls}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(i)} aria-current={i === current ? "step" : undefined}>
                <span className="n">{i + 1}</span>
                {s}
              </button>
            ) : (
              <>
                <span className="n">{i + 1}</span>
                {s}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
