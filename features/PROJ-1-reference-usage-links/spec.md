# PROJ-1: Reference list entries link to their use cases

Status: Planned
Created: 2026-11-14

## Summary

Every entry on the **Reference lists** page shows how many use cases use it, and that count opens
the **Use cases** page filtered to exactly those use cases. The link also works the other way:
wherever a use case or rule shows a reference entry, that entry opens the same filtered list.

Today the use cases behind an entry only appear when someone tries to delete it.

## Reference kinds and what they link to

| Tab on Reference lists | Linked to | "Used by" counts | Filtered list shows |
|---|---|---|---|
| Threat actors | L2 use cases | L2 use cases | L2 use cases |
| Detection technologies | L3 rules | L3 rules | L3 rules |
| Log sources | L3 rules | L3 rules | L3 rules |
| Scopes | L3 rules | L3 rules | L3 rules |

## Users

- **Analyst / admin**: maintain the reference lists and want to see the impact of an entry
  (e.g. "which rules depend on this log source?") before renaming, deleting or retiring it.
- **Auditor** (read-only): wants to trace from a log source, technology, scope or threat actor to the
  use cases that cover it.

## User stories

- US-1: As an analyst, I want to see on the Reference lists page how many rules use each entry,
  so that I can judge the impact of a change at a glance.
- US-2: As an analyst, I want to click that number and see exactly those rules on the Use cases
  page, so that I can review or edit them.
- US-3: As an auditor, I want the same counts and links in read-only form, so that I can trace
  coverage of a log source or threat actor.
- US-4: As an analyst, I want to spot unused entries quickly by sorting on usage, so that I can
  clean up the lists.
- US-5: As an analyst looking at a rule or L2 use case, I want to click one of its log sources,
  detection technologies, scopes or threat actors and see all other use cases that share it.
- US-6: As a user, I want the filtered view to have a URL I can share or bookmark.

## Must-have behaviour

1. **"Used by" column** on all four tabs of the Reference lists page, for every role.
   - Threat actors: number of L2 use cases with that actor.
   - The other three tabs: number of L3 rules with that entry.
   - A count above 0 is a link to the filtered Use cases page. Hovering it shows the codes of the
     linked use cases.
   - A count of 0 is shown muted, without a link.
   - The list can be sorted by this column (ascending and descending), as well as by name.
2. **Reference filter on the Use cases page.**
   - Exactly one reference entry can be active as a filter at a time.
   - It is shown at the top as a removable chip naming kind and entry, e.g.
     "Log source: Windows Security".
   - It is part of the URL; opening the URL restores the filter.
   - It combines with the existing driver filters and the search (all must match).
   - "Clear filters" also removes it.
   - **Tree view, L3 filter** (log source, detection technology, scope): only L2 use cases that
     have at least one matching rule stay visible (with their L1). The rule panel lists only the
     matching rules and shows a hint like "3 of 8 rules shown".
   - **Table view, L3 filter**: only matching rules are listed.
   - **Threat actor filter**: only L2 use cases with that actor are visible (with their L1);
     their rules are shown unfiltered.
3. **Reverse links.** Wherever an entry is shown on a use case or rule, it opens the filtered
   Use cases page for that entry:
   - Rule detail page: each assigned log source, detection technology and scope.
   - Use cases page: log source chips in the rule panel / table, threat actor chips on the L2
     detail.
   - Editing a rule or L2 must stay possible; the links must not get in the way of the edit fields.
4. Counts and filters always reflect the current data (after a rename, delete, or a change on a
   rule, the next page load shows the new numbers).

## Acceptance criteria

- [ ] AK-1: Angenommen der Log-Source-Eintrag „Windows Security" wird von 3 L3-Regeln verwendet, wenn ein Benutzer den Tab „Log sources" der Seite „Reference lists" öffnet, dann zeigt die Spalte „Used by" für diesen Eintrag „3".
- [ ] AK-2: Angenommen der Threat-Actor-Eintrag „APT29" ist 2 L2-Use-Cases zugeordnet, wenn ein Benutzer den Tab „Threat actors" öffnet, dann zeigt die Spalte „Used by" für diesen Eintrag „2".
- [ ] AK-3: Angenommen ein Eintrag wird von keinem Use Case verwendet, wenn die Liste angezeigt wird, dann steht in „Used by" eine ausgegraute „0" ohne Link.
- [ ] AK-4: Angenommen ein Eintrag hat einen Zähler größer 0, wenn der Benutzer mit der Maus über den Zähler fährt, dann werden die Codes der verwendenden Use Cases angezeigt.
- [ ] AK-5: Angenommen ein Benutzer mit der Rolle Auditor öffnet die Seite „Reference lists", wenn die Liste geladen ist, dann sieht er die Spalte „Used by" mit klickbaren Zählern, aber keine Bearbeiten- oder Löschen-Aktionen.
- [ ] AK-6: Angenommen eine Liste mit mehreren Einträgen, wenn der Benutzer nach „Used by" aufsteigend sortiert, dann stehen die Einträge mit 0 Verwendungen oben; bei absteigender Sortierung stehen sie unten.
- [ ] AK-7: Angenommen „Windows Security" wird von den Regeln UC-001-01 und UC-002-03 verwendet, wenn der Benutzer auf den Zähler klickt, dann öffnet sich die Seite „Use cases" mit dem Filter-Chip „Log source: Windows Security" und in der Baumansicht sind nur die L2-Use-Cases UC-001 und UC-002 (mit ihren L1) sichtbar.
- [ ] AK-8: Angenommen der Log-Source-Filter aus AK-7 ist aktiv und UC-001 hat 8 Regeln, von denen 1 den Eintrag verwendet, wenn der Benutzer UC-001 auswählt, dann zeigt das Regel-Panel nur diese eine Regel und den Hinweis „1 of 8 rules shown".
- [ ] AK-9: Angenommen ein L3-Referenzfilter ist aktiv, wenn der Benutzer auf die Tabellenansicht wechselt, dann werden nur die Regeln gelistet, die den Eintrag verwenden.
- [ ] AK-10: Angenommen der Benutzer klickt auf den Zähler des Threat Actors „APT29", wenn die Seite „Use cases" geöffnet ist, dann sind nur die L2-Use-Cases mit diesem Actor sichtbar und deren Regeln werden ungefiltert angezeigt.
- [ ] AK-11: Angenommen ein Referenzfilter ist aktiv, wenn der Benutzer die URL kopiert und in einem neuen Tab öffnet, dann ist derselbe Filter aktiv und dieselben Use Cases sind sichtbar.
- [ ] AK-12: Angenommen ein Referenzfilter und ein Business-Driver-Filter sind aktiv, wenn die Liste angezeigt wird, dann sind nur Use Cases sichtbar, die beide Filter erfüllen.
- [ ] AK-13: Angenommen ein Referenzfilter ist aktiv, wenn der Benutzer im Suchfeld einen Begriff eingibt, dann werden nur Use Cases angezeigt, die sowohl den Filter als auch die Suche erfüllen.
- [ ] AK-14: Angenommen ein Referenzfilter ist aktiv, wenn der Benutzer auf das „×" des Filter-Chips klickt, dann wird nur dieser Filter entfernt und andere aktive Filter bleiben erhalten.
- [ ] AK-15: Angenommen ein Referenzfilter ist aktiv, wenn der Benutzer „Clear filters" klickt, dann sind alle Filter einschließlich des Referenzfilters entfernt.
- [ ] AK-16: Angenommen ein Referenzfilter ist aktiv, wenn der Benutzer auf den Zähler eines anderen Eintrags (auch einer anderen Art) navigiert, dann ersetzt der neue Referenzfilter den alten.
- [ ] AK-17: Angenommen eine Regel verwendet die Log Source „Windows Security", wenn der Benutzer auf deren Detailseite auf „Windows Security" klickt, dann öffnet sich die Seite „Use cases" mit dem Filter „Log source: Windows Security".
- [ ] AK-18: Angenommen eine Regel hat Detection Technologies und Scopes, wenn der Benutzer auf der Detailseite auf einen dieser Einträge klickt, dann öffnet sich die gefilterte Liste für genau diesen Eintrag.
- [ ] AK-19: Angenommen ein Analyst bearbeitet eine Regel auf der Detailseite, wenn er Log Sources, Detection Technologies oder Scopes hinzufügt oder entfernt, dann funktioniert das wie bisher und ein Klick in das Auswahlfeld navigiert nicht weg.
- [ ] AK-20: Angenommen eine Regel zeigt im Regel-Panel oder in der Tabellenansicht Log-Source-Chips, wenn der Benutzer auf einen Chip klickt, dann wird der Referenzfilter auf diesen Eintrag gesetzt.
- [ ] AK-21: Angenommen ein L2-Use-Case zeigt Threat-Actor-Chips, wenn der Benutzer auf einen Chip klickt, dann wird der Threat-Actor-Filter auf diesen Eintrag gesetzt.
- [ ] AK-22: Angenommen ein Eintrag wird umbenannt, wenn der Benutzer danach die Seite „Use cases" über einen Zähler oder Chip öffnet, dann zeigt der Filter-Chip den neuen Namen und dieselben Use Cases.
- [ ] AK-23: Angenommen ein Analyst entfernt „Windows Security" von einer Regel, wenn er danach die Seite „Reference lists" neu lädt, dann ist der Zähler um 1 kleiner.
- [ ] AK-24: Angenommen die Oberfläche ist auf Deutsch oder Niederländisch eingestellt, wenn der Benutzer die Seite „Reference lists" oder den Filter-Chip ansieht, dann sind Spaltenüberschrift, Hinweis „x of y rules shown" und Filter-Chip übersetzt.

## Edge cases

- EC-1: **Stale or deleted entry in URL.** The URL names an entry that no longer exists. The Use cases
  page shows a notice ("This reference entry no longer exists") with a way to clear the filter,
  and lists no use cases until the filter is cleared. No error page.
- EC-2: **Invalid kind in URL** (e.g. a typo). Treated like EC-1.
- EC-3: **Filter matches nothing** (entry became unused after the link was copied). The page shows
  the existing "no use case matches" empty state; the filter chip stays so it can be removed.
- EC-4: **Entry used by many rules** (e.g. 200). The hover text is shortened (first codes plus
  "and N more"); the count and the filtered list stay complete.
- EC-5: **Same name in two kinds** (e.g. "Azure" as log source and as scope). The filter is always
  for one kind and one entry; the other kind's rules are not included.
- EC-6: **Rule moved to another L2** or L2 moved to another L1. The filtered list follows the
  current position.
- EC-7: **Retired / non-scored rules.** All rules count, whatever their lifecycle status, because the
  question is "who uses this entry". The filtered list shows them as it does today.
- EC-8: **L2 selected in URL does not match the filter.** The first matching L2 is selected instead,
  as the driver filters do today.
- EC-9: **Concurrent change.** Another user changes a rule while the list is open. Counts update on
  the next load; no live refresh is required.
- EC-10: **Empty reference list.** The existing empty table is shown; the new column adds nothing.

## Dependencies

- Reference lists page and the four reference kinds (exist).
- Use cases page with tree/table view, URL-based driver filters and "Clear filters" (exist).
- Rule detail page with reference multi-selects (exist).
- Translations: new strings go into the DE and NL locale files and must pass the i18n check.

## Out of scope

- A "show unused only" toggle on the Reference lists page (sorting by "Used by" covers it).
- Filtering by more than one reference entry at a time, or OR-combinations.
- Inline expansion of a reference row listing all rules.
- Showing rules below the L2s for a threat actor count (threat actors count L2s only).
- Live / push updates of counts while the page is open.
- Usage counts in exports (Excel, JSON backup, PDF report).
- Changing how delete-with-usage works today (the existing confirm dialog stays).
- Business and compliance drivers (they already have this on the Drivers page).

## Product decisions

| # | Decision | Rationale |
|---|---|---|
| PD-1 | Count column linking to a filtered Use cases list, not an inline expansion. | Same pattern as the Drivers page; one place to work with the rules. |
| PD-2 | Threat actors count and filter L2 use cases; other kinds count L3 rules. | Each kind links to the level that actually uses it, so the number is honest. |
| PD-3 | Filter hides non-matching L2s and rules instead of highlighting them. | Lists can be long; a filter is easier to review and to share as a URL. |
| PD-4 | One reference filter at a time, combined with driver filters and search (AND). | Covers the trace question without a complex filter builder. |
| PD-5 | Unused entries: muted "0", no link; sortable column instead of a toggle. | Enough to find cleanup candidates without extra UI. |
| PD-6 | Reverse links (rule detail, rule chips, actor chips) are part of this feature. | Requested by the person on 2026-11-14 so tracing works in both directions. |
| PD-7 | All roles, including auditors, see counts and links. | Read-only information; useful for audits. |
| PD-8 | All rules count regardless of lifecycle status. | The question is usage, not scoring. |

## Open questions

- [ ] None at the moment.

## Decision log

- 2026-11-14: Spec created after interview with the person (PD-1 to PD-8).
