import Link from "next/link";

const DOCS = "https://github.com/Hemmy1417/Verda/blob/main/docs";

/**
 * The rules, lean: what the panel reads, the verdict table, the lifecycle,
 * who moves each state, fees, and the finality ladder. The essays live in the
 * repository's docs, linked at the end.
 */
export default function Rules() {
  return (
    <main className="page prose">
      <div>
        <p className="eyebrow">Rules</p>
        <h1 className="heading-lg" style={{ marginTop: 12 }}>What the contract does, and does not.</h1>
      </div>

      <h2 className="heading-sm">What the panel reads</h2>
      <p>
        Only pages on the origins both wallets signed into the evidence basis. Each origin
        carries an agreed kind (satellite observation, independent assessment, government
        registry, field measurement, project report, photographic record, other) and an
        agreed class: INDEPENDENT or OPERATOR. These are labels the two parties signed, not
        verified facts, and the panel is told so — it judges each page as what it shows
        itself to be, and a page that does not live up to its label counts against the case
        the label was chosen to help.
      </p>
      <p>
        Independence is counted per publisher. Two pages on one publisher are one voice, and
        the agreement says how many independent publishers must state a usable figure before
        money can move. Operator-class pages inform the panel and can never raise the figure.
      </p>
      <p>
        The model returns readings only: the figure each page itself states, whether it is on
        scope, whether it is what its label says, and whether the record suffices. Pure code
        inside every validator derives the verdict; the model never returns one and never
        touches an amount.
      </p>

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
              <td className="mono">QUALIFIED</td>
              <td>
                As many independent publishers as the agreement requires state a usable
                figure, the figures agree within 15 percent, and the lowest reaches the
                threshold share of the target.
              </td>
              <td>verified / target × reward to the operator; the remainder to the funder</td>
            </tr>
            <tr>
              <td className="mono">NOT_QUALIFIED</td>
              <td>The verified figure is below the threshold share of the target.</td>
              <td>the whole reward returns to the funder</td>
            </tr>
            <tr>
              <td className="mono">INCONCLUSIVE</td>
              <td>
                EVIDENCE_INSUFFICIENT — the record does not establish the outcome;
                UNCORROBORATED — too few independent publishers state a usable figure;
                SOURCES_CONTRADICT — the independent figures spread beyond 15 percent.
              </td>
              <td>
                nothing moves; the agreement returns to funded for a new package, or the
                funder reclaims after the grace
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The verified figure is the lowest usable independent reading, never above the
        operator&apos;s claim, never above the target.
      </p>

      <h2 className="heading-sm">Lifecycle</h2>
      <div className="tablewrap">
        <pre>{`DRAFT --fund (exact reward)--> FUNDED --submit_evidence--> FUNDED(v1) --adjudicate (after the deadline)--> PENDING_FINALITY
  \\--cancel_draft--> CANCELLED             ^                                                                    |--promote
                                           | INCONCLUSIVE hold (new package inside the grace)                   v
FUNDED --reclaim (after deadline + grace)--> RECLAIMED                                                  FINAL --settle (after the challenge window)--> SETTLED
                                                                                                          |--challenge (bond, one new source)--> re_adjudicate --> PENDING_FINALITY
                                                                                                          \\--lapse_challenge (stale) --> FINAL, snapshot restored`}</pre>
      </div>

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
            <tr><td className="mono">DRAFT</td><td>any funder, or the operator cancels</td><td>holds nothing</td></tr>
            <tr><td className="mono">FUNDED</td><td>the operator submits; anyone adjudicates after the deadline</td><td>anyone reclaims for the funder after deadline + grace</td></tr>
            <tr><td className="mono">PENDING_FINALITY</td><td>anyone promotes after the finality window</td><td>—</td></tr>
            <tr><td className="mono">FINAL</td><td>anyone settles after the challenge window; a party may challenge inside it</td><td>—</td></tr>
            <tr><td className="mono">challenge open</td><td>anyone re-adjudicates; anyone lapses it after an hour</td><td>—</td></tr>
            <tr><td className="mono">SETTLED · RECLAIMED · CANCELLED</td><td>terminal; payees claim</td><td>—</td></tr>
          </tbody>
        </table>
      </div>

      <h2 className="heading-sm">Fees and bonds</h2>
      <p>
        Every write simulates first. The simulation sizes the fee deposit and runs the method,
        so a write the contract would refuse dies there with the contract&apos;s own sentence
        and nothing is sent. The deposit shown before signing is mostly refunded; a write
        nets a fraction of it.
      </p>
      <p>
        Funding is exactly the maximum reward. A challenge bond is 5 percent of the reward
        with a 0.05 GEN floor; it returns to the challenger if the verdict or figure changes
        and goes to the other party if not. Money leaves the contract only through claim.
      </p>

      <h2 className="heading-sm">The finality ladder</h2>
      <p>
        A write is <strong>accepted</strong> when a contract read shows the new state; every
        read from then on sees it, and the page moves on. It is <strong>finalized</strong>
        only when the transaction itself reports FINALIZED with a successful deciding
        execution — usually within a minute of acceptance. The word finalized is never used
        before that, and a write is irreversible only once it appears.
      </p>
      <p>
        The contract keeps its own consensus clock (three edge witnesses, a chain floor, two
        beacon heads); every window it enforces is measured by that clock, and a boundary
        this app shows from the browser&apos;s clock may be a few minutes off.
      </p>

      <h2 className="heading-sm">Further reading</h2>
      <ul>
        <li><a href={`${DOCS}/ARCHITECTURE.md`} target="_blank" rel="noreferrer">ARCHITECTURE.md</a> — the mechanism, anchored by symbol</li>
        <li><a href={`${DOCS}/SECURITY.md`} target="_blank" rel="noreferrer">SECURITY.md</a> — attacks and the symbol that stops each</li>
        <li><a href={`${DOCS}/DEPLOYMENT.md`} target="_blank" rel="noreferrer">DEPLOYMENT.md</a> — the deployment ledger and procedure</li>
      </ul>
      <p>
        <Link href="/projects" className="inline-link">Back to the projects.</Link>
      </p>
    </main>
  );
}
