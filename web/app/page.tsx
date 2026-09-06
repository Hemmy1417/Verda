"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatGen } from "../lib/config";
import { formatCount } from "../lib/derive";
import { getAgreements, getStats } from "../lib/read";
import type { AgreementSummary, Stats } from "../lib/types";
import { AgreementRows } from "./components/AgreementRows";
import { Hex, Seal, Stat, StateNote, StepChips } from "./components/bits";

type Read<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "unreachable"; error: string };

const OPERATOR_STEPS = [
  "Draft the outcome, deadline, reward and evidence basis",
  "Do the work, then file pages from the agreed origins",
  "If the panel holds the record, file a better package inside the grace",
  "After promotion and the challenge window, settle and claim",
];

const FUNDER_STEPS = [
  "Fund a draft you agree with by depositing exactly its reward",
  "Watch the adjudication; challenge a wrong verdict with a bond",
  "If nothing is proven, reclaim the reward after the grace",
  "Claim whatever settlement returns to you",
];

/**
 * The front door. The hero is data first: the live stat card and the Start
 * card sit beside the headline, not under it. Then a dark room for the three
 * steps, persona cards with step chips, the newest agreements as row-cards,
 * and the monumental wordmark as the last room so the page ends on the crop.
 */
export default function Home() {
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
  const blank = stats.state === "loading" ? "reading" : "unavailable";

  return (
    <main>
      <section className="room-light">
        <div className="room-inner hero">
          <div className="hero-copy">
            <p className="eyebrow">Outcome-based environmental funding</p>
            <h1 className="heading-lg">Pay for what actually happened.</h1>
            <p className="hero-lede">
              Funding is locked against one measurable outcome. A GenLayer panel reads the
              evidence itself, and code turns the verified figure into payment.
            </p>
          </div>
          <div className="hero-cards">
            <div className="card hero-card">
              <p className="eyebrow">On the contract now</p>
              <div className="stat-grid">
                <Stat label="In custody" value={s ? `${formatGen(s.escrow_atto)} GEN` : blank} mono={!!s} />
                <Stat label="Agreements" value={s ? formatCount(s.agreements) : blank} mono={!!s} />
                <Stat label="Settled" value={s ? formatCount(s.settled) : blank} mono={!!s} />
                <Stat label="Paid to operators" value={s ? `${formatGen(s.paid_atto)} GEN` : blank} mono={!!s} />
              </div>
              {stats.state === "loading" && (
                <p className="small">Reading the contract on Studio Next.</p>
              )}
              {stats.state === "unreachable" && (
                <p className="small">
                  The contract could not be read just now, so the figures are blank rather than
                  stale. {stats.error}
                </p>
              )}
              {stats.state === "ready" && (
                <p className="small">Live from GenLayer Studio Next. Custody is every locked reward and unclaimed balance.</p>
              )}
            </div>
            <div className="card start-card">
              <p className="eyebrow">Start</p>
              <div className="start-row">
                <span>I run a project</span>
                <Link href="/create" className="pill">Draft an agreement</Link>
              </div>
              <hr className="hairline" />
              <div className="start-row">
                <span>I fund outcomes</span>
                <Link href="/projects" className="pill quiet">Explore projects</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="room-dark">
        <div className="room-inner">
          <p className="eyebrow">How it works</p>
          <div className="how">
            <div>
              <Seal n={1} size="lg" />
              <h2 className="subheading">Fund</h2>
              <p>
                An operator drafts one outcome, a deadline, a reward and the web origins the
                panel may read. A funder deposits exactly the reward, and everything freezes.
              </p>
              <Hex />
            </div>
            <div>
              <Seal n={2} size="lg" />
              <h2 className="subheading">Prove</h2>
              <p>
                After the deadline the operator files pages inside the agreed origins. Every
                validator fetches each page itself and returns readings, never a verdict.
              </p>
              <Hex />
            </div>
            <div>
              <Seal n={3} size="lg" />
              <h2 className="subheading">Pay</h2>
              <p>
                Code inside every validator derives the verdict from the lowest usable
                independent figure. Settlement pays that share of the reward and returns the rest.
              </p>
              <Hex fill />
            </div>
          </div>
        </div>
      </section>

      <section className="room-light">
        <div className="room-inner">
          <p className="eyebrow">Who it is for</p>
          <div className="grid two persona-grid">
            <div className="card persona">
              <h2 className="heading-sm">For operators</h2>
              <p>
                You commit to one measurable outcome and prove it only through pages on the
                origins you name. Money follows the lowest usable independent figure, never your own claim.
              </p>
              <StepChips steps={OPERATOR_STEPS} />
              <Link href="/create" className="pill">Draft an agreement</Link>
            </div>
            <div className="card persona">
              <h2 className="heading-sm">For funders</h2>
              <p>
                Your deposit is the counter-signature. The basis you signed is the only evidence
                the panel will ever read, and every hold state has an exit that returns your money.
              </p>
              <StepChips steps={FUNDER_STEPS} />
              <Link href="/projects" className="pill quiet">Explore projects</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="room-light">
        <div className="room-inner room-continued">
          <div className="section-head">
            <p className="eyebrow">Latest agreements</p>
            <Link href="/projects" className="ghost">All agreements</Link>
          </div>
          {latest.state === "loading" && (
            <StateNote kind="loading">Reading the newest agreements from the contract.</StateNote>
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
            <AgreementRows rows={latest.value} />
          )}
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
