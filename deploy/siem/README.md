# SIEM examples

The app has no live SIEM connector (plan section 3). Instead the SIEM side pushes two things
to the app with an API token (*Integrations → API tokens*, role analyst):

| What | Call | Effect |
|---|---|---|
| Rule inventory | `PUT /api/integrations/siem/<source>/rules` | Compared with the use cases: SIEM rules without a use case, rules disabled in the SIEM but operational in the app, linked ids no SIEM reports |
| Alert counts | `POST /api/integrations/siem/<source>/alerts` | Stored as output metrics per rule and month (`mode` `replace` or `add`) |

A SIEM rule is linked to an L3 rule through the field *SIEM rule IDs* on the rule page, or by
using the L3 code (e.g. `AO-CRE-01`) as the SIEM rule id.

Files here:

- `magma_push.py`: small client without dependencies. Reads a CSV (alert counts) or JSON
  (inventory) and pushes it. Run it from cron, a Splunk alert action or an Azure Automation job.
- `splunk_monthly_counts.spl`: monthly counts per correlation search from Enterprise Security
  notables, with false positives from the notable disposition.
- `splunk_rule_inventory.spl`: the list of correlation searches with enabled state and ATT&CK
  annotations.
- `sentinel_monthly_counts.kql`: monthly counts per analytics rule from `SecurityAlert` and
  `SecurityIncident` (false positives from the incident classification).

```bash
export MAGMA_URL=https://magma.example.com MAGMA_TOKEN=mgm_...
# alert counts (columns: rule, period, alerts, incidents, false_positives[, false_negatives])
python3 magma_push.py alerts splunk counts.csv
python3 magma_push.py alerts sentinel counts.csv --mode add --dry-run
# rule inventory (JSON list of {"id", "name", "enabled", "severity", "techniques"})
python3 magma_push.py rules splunk rules.json
```
