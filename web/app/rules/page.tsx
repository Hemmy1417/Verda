import Link from "next/link";
import { holdSentence } from "../../lib/derive";
import { StepChips } from "../components/bits";

const DOCS = "https://github.com/Hemmy1417/Verda/blob/main/docs";

const LIFECYCLE = [
  "Draft",
  "Funded",
  "Evidence filed",
  "Judged",
  "Verdict pending",
  "Verdict final",
  "Settled",
];

/**
 * The rules, lean: what the panel reads, the verdict table, the lifecycle as
 * step chips, who moves each state, fees and finality. The essays live in the
 * repository's docs, linked at the end. Static: nothing here reads the chain.
 */
export default function Rules() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Rules</p>
          <h1 className="heading-lg">What the contract does, and does not.</h1>
        </div>
      </div>

      <section className="card rule-card">
        <h2 className="heading-sm">What the panel reads</h2>
        <p>
          Only pages on the origins both wallets signed into the evidence basis. Each origin
          carries an agreed kind (satellite observation, independent assessment, government
          registry, field measurement, project report, photographic record, other) and an
          agreed class: independent, or the operator&apos;s own. These are labels the two parties
          signed, not verified facts. The panel is told so, judges each page as what it shows
          itself to be, and a page that does not live up to its label counts against the case
          the label was chosen to help.
        </p>
        <p>
          Independence is counted per publisher. Two pages on one publisher are one voice, and
          the agreement says how many independent publishers must state a usable figure before
          money can move. The operator&apos;s own pages inform the panel and can never raise the figure.
        </p>
        <p>
          The model returns readings only: the figure each page itself states, whether it is on
          scope, whether it is what its label says, and whether the record suffices. Pure code
          inside every validator derives the verdict. The model never returns one and never
          touches an amount.
        </p>
      </section>

      <section className="card rule-card">
        <h2 className="heading-sm">Verdicts</h2>
        <div className="tablewrap">
          <table className="rows">
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Meaning</th>
                <th>Money</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="nowrap">Qualified</td>
                <td>
                  As many independent publishers as the agreement requires state a usable
                  figure, the figures agree within 15 percent, and the lowest reaches the
                  threshold share of the target.
                </td>
                <td>Verified over target of the reward to the operator; the remainder to the funder.</td>
              </tr>
              <tr>
                <td className="nowrap">Not qualified</td>
                <td>The verified figure is below the threshold share of the target.</td>
                <td>The whole reward returns to the funder.</td>
              </tr>
              <tr>
                <td className="nowrap">Inconclusive</td>
                <td>
                  One of three holds: {holdSentence("EVIDENCE_INSUFFICIENT")};{" "}
                  {holdSentence("UNCORROBORATED")}; or {holdSentence("SOURCES_CONTRADICT")}.
                </td>
                <td>
                  Nothing moves. The agreement returns to funded for a new package, or the
                  funder reclaims after the grace.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The verified figure is the lowest usable independent reading, never above the
          operator&apos;s claim, never above the target.
        </p>
      </section>

      <section className="card rule-card">
        <h2 className="heading-sm">Lifecycle</h2>
        <StepChips steps={LIFECYCLE} />
        <p>
          Three side exits. A draft nobody funds is cancelled by the operator. A funded
          agreement with nothing proven inside the grace is reclaimed for the funder. A final
          verdict may be challenged inside its window with a bond and one new source; the
          second panel re-reads the recorded bytes and the agreement walks back through
          verdict pending.
        </p>
      </section>

      <section className="card rule-card">
        <h2 className="heading-sm">Who moves each state</h2>
        <div className="tablewrap">
          <table className="rows">
            <thead>
              <tr>
                <th>Status</th>
                <th>Who moves it on</th>
                <th>If nobody does</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="nowrap">Draft</td><td>Any funder, or the operator cancels.</td><td>It holds nothing.</td></tr>
              <tr><td className="nowrap">Funded</td><td>The operator submits; anyone adjudicates after the deadline.</td><td>Anyone reclaims for the funder after the deadline and grace.</td></tr>
              <tr><td className="nowrap">Verdict pending</td><td>Anyone promotes after the finality window.</td><td>It waits.</td></tr>
              <tr><td className="nowrap">Verdict final</td><td>Anyone settles after the challenge window; a party may challenge inside it.</td><td>It waits.</td></tr>
              <tr><td className="nowrap">Challenge open</td><td>Anyone re-adjudicates; anyone lapses it after an hour.</td><td>It waits.</td></tr>
              <tr><td className="nowrap">Settled, reclaimed, cancelled</td><td>Terminal; payees claim.</td><td>Balances stay claimable.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card rule-card">
        <h2 className="heading-sm">Fees and finality</h2>
        <p>
          Every write simulates first. The simulation sizes the fee deposit and runs the method,
          so a write the contract would refuse stops there with the contract&apos;s own sentence and
          nothing is sent. Funding is exactly the maximum reward. A challenge bond is 5 percent of
          the reward with a 0.05 GEN floor; it returns to the challenger if the verdict or figure
          changes and goes to the other party if not. Money leaves the contract only through claim.
        </p>
        <p>
          A write is accepted when a contract read shows the new state, and finalized only when
          the transaction itself reports finalized with a successful deciding execution, usually
          within a minute. The word finalized is never used before that. The contract keeps its
          own consensus clock, and a boundary this app shows from the browser&apos;s clock may be a
          few minutes off.
        </p>
      </section>

      <section className="card rule-card">
        <h2 className="heading-sm">Further reading</h2>
        <ul className="doclist">
          <li><a href={`${DOCS}/ARCHITECTURE.md`} target="_blank" rel="noreferrer">Architecture</a>: the mechanism, anchored by symbol.</li>
          <li><a href={`${DOCS}/SECURITY.md`} target="_blank" rel="noreferrer">Security</a>: attacks and the symbol that stops each.</li>
          <li><a href={`${DOCS}/DEPLOYMENT.md`} target="_blank" rel="noreferrer">Deployment</a>: the deployment ledger and procedure.</li>
        </ul>
        <p>
          <Link href="/projects" className="inline-link">Back to the agreements.</Link>
        </p>
      </section>
    </main>
  );
}
