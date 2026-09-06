"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatGen } from "../lib/config";
import { formatCount } from "../lib/derive";
import { getAgreements, getStats } from "../lib/read";
import { TERMINAL_STATUSES, type AgreementSummary, type Stats } from "../lib/types";
import { Hex, Stat, StateNote, StatusChip } from "./components/bits";

type Read<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "unreachable"; error: string };

/**
 * The front door. The stat row and the latest-agreements table read the
 * chain; everything else is composition. The monumental wordmark is the LAST
 * room so the page ends on the crop rather than opening on it.
 */
export default function Home() {
  const router = useRouter();
  const [stats, setStats] = useState<Read<Stats>>({ state: "loading" });
  const [latest, setLatest] = useState<Read<AgreementSummary[]>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    getStats()
      .then((s) => live && setStats({ state: "ready", value: s }))
      .catch((e: Error) => live && setStats({ state: "unreachable", error: e.message }));
    getAgreements(0, 6)
      .then((p) => live && setLatest({ state: "ready", value: p.agreements }))
      .catch((e: Error) => live && setLatest({ state: "unreachable", error: e.message }));
    return () => {
      live = false;
    };
  }, []);

  const s = stats.state === "ready" ? stats.value : null;
  const dash = stats.state === "loading" ? "…" : "—";

  return (
    <main>
      <section className="room-light">
        <div className="room-inner hero-top">
          <p className="eyebrow">Outcome-based environmental funding</p>
          <h1 className="heading-lg">Pay for what actually happened.</h1>
          <div>
            <div className="stat-row">
              <Stat label="In custody" value={s ? `${formatGen(s.escrow_atto)} GEN` : dash} mono />
              <Stat label="Agreements" value={s ? formatCount(s.agreements) : dash} mono />
              <Stat label="Settled" value={s ? formatCount(s.settled) : dash} mono />
              <Stat label="Paid to operators" value={s ? `${formatGen(s.paid_atto)} GEN` : dash} mono />
            </div>
            {stats.state === "loading" && (
              <p className="small muted" style={{ marginTop: 12 }}>Reading the contract on Studio Next…</p>
            )}
            {stats.state === "unreachable" && (
              <p className="small" style={{ marginTop: 12 }}>
                The contract could not be read just now, so the figures are blank rather than
                stale. {stats.error}
              </p>
            )}
          </div>
          <div className="hero-actions">
            <Link href="/projects" className="pill">
              Explore projects
            </Link>
            <Link href="/create" className="pill quiet">
              Draft an agreement
            </Link>
          </div>
        </div>
      </section>

      <section className="room-dark">
        <div className="room-inner">
          <p className="eyebrow">How Verda works</p>
          <div className="how" style={{ marginTop: 40 }}>
            <div>
              <div className="numeral"><span className="heading-lg">1</span></div>
              <h2 className="subheading">Fund</h2>
              <p>
                An operator drafts one measurable outcome, a deadline, a reward and the web
                origins the panel may read. A funder deposits exactly the reward: that
                deposit is the counter-signature, and it freezes everything under one hash.
              </p>
              <Hex />
            </div>
            <div>
              <div className="numeral"><span className="heading-lg">2</span></div>
              <h2 className="subheading">Prove</h2>
              <p>
                After the deadline the operator files URLs inside the agreed origins. Every
                validator fetches each page itself and returns readings only — the figure
                the page states, whether it is on scope, whether it is what its label says.
              </p>
              <Hex />
            </div>
            <div>
              <div className="numeral"><span className="heading-lg">3</span></div>
              <h2 className="subheading">Pay</h2>
              <p>
                Code inside every validator derives the verdict from the lowest usable
                independent figure. Settlement pays verified over target of the reward to
                the operator and returns the rest; a hold pays nobody and keeps every exit.
              </p>
              <Hex fill />
            </div>
          </div>
        </div>
      </section>

      <section className="room-light">
        <div className="room-inner">
          <p className="eyebrow">Latest agreements</p>
          <div style={{ marginTop: 24 }}>
            {latest.state === "loading" && (
              <StateNote kind="loading">Reading the newest agreements from the contract…</StateNote>
            )}
            {latest.state === "unreachable" && (
              <StateNote kind="unreachable">
                The agreements could not be read just now; the record has not gone anywhere.{" "}
                {latest.error}
              </StateNote>
            )}
            {latest.state === "ready" && latest.value.length === 0 && (
              <StateNote kind="empty">
                No agreement has been drafted on this contract yet.{" "}
                <Link href="/create" className="inline-link">Draft the first.</Link>
              </StateNote>
            )}
            {latest.state === "ready" && latest.value.length > 0 && (
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
                    {latest.value.map((a) => (
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
                        <td className="num">
                          {a.judged_version > 0 && a.verdict ? formatCount(a.verified_impact) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <Link href="/projects" className="ghost">All projects</Link>
          </div>
        </div>
      </section>

      <section className="room-dark">
        <div className="wordmark-hero" aria-hidden="true">
          <span className="display">Verda</span>
        </div>
      </section>
    </main>
  );
}
