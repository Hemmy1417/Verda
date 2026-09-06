# Evidence fixtures

These files are the pages the live arc puts in front of the panel. They are
stand-ins, and this file says so: a real agreement would name a satellite
provider, an assessor and the operator's own site as its three origins. The
arc names three CDN origins that mirror one commit of this repository —

| agreed class | agreed kind             | origin                     |
|--------------|-------------------------|----------------------------|
| INDEPENDENT  | SATELLITE_OBSERVATION   | raw.githubusercontent.com  |
| INDEPENDENT  | INDEPENDENT_ASSESSMENT  | cdn.jsdelivr.net           |
| OPERATOR     | PROJECT_REPORT          | rawcdn.githack.com         |

— so that every rule the contract enforces on origins, publishers and
snapshots runs exactly as it would against real publishers: URLs must fall
inside the agreed origins, two pages on one publisher count once, the panel
fetches each page itself under consensus, and a challenge round re-reads the
recorded bytes. What the fixtures cannot demonstrate is the independence of
the publishers themselves; that is the agreement's job in the world, not the
contract's.

URLs are pinned to the full commit SHA, so the bytes cannot drift after the
agreement is drafted.

| file | what it plays | figure it states |
|------|---------------|------------------|
| `rv-7/satellite-observation-2026q3.txt` | satellite canopy-cover summary | 463 ha |
| `rv-7/independent-assessment-final.txt` | third-party field audit | 460 ha |
| `rv-7/operator-completion-report.txt` | the operator's own report | 480 ha planted (operator claim) |
| `rv-7/assessment-contradicting.txt` | a second audit that disagrees materially | 300 ha |
| `rv-7/planting-plan-2025.txt` | a plan, not a result | none (forecasts do not count) |
| `rv-12/satellite-observation-2026q3.txt` | a block that fell short | 410 ha of 500 |
| `rv-12/operator-completion-report.txt` | the operator's account of RV-12 | 470 ha planted (operator claim) |
