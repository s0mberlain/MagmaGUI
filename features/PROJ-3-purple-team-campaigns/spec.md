# PROJ-3: Purple team campaigns (tests on rules, inspired by VECTR)

**Status:** Planned
**Created:** 2026-11-18

## Summary

SOC analysts plan **purple team campaigns** in Magma, modelled on the campaign / test case idea of
[VECTR](https://github.com/securityriskadvisors/VECTR). A campaign is a set of **test cases**, each
for one MITRE ATT&CK technique and linked to the L3 rules that should detect it. An **external red
team** executes the tests and records when and how it ran them; analysts (the blue team) record
the **outcome** (Blocked, Alerted, Logged, Not detected) and when the detection fired. Every outcome
is written as a **verification** on the linked rules, so "last verified" reflects real attack
simulation. Tests can be saved to a reusable **test library**.

Today Magma knows which ATT&CK techniques a rule is meant to cover (`attack_techniques` on L3) and
lets analysts press "Verify now", but there is no way to plan, run and record actual tests.

Reporting on campaigns (ATT&CK heatmap layer, campaign PDF, dashboard KPIs, detection rate and
time-to-detect trends) is **PROJ-4** and not part of this spec.

## Concepts

| Term | Meaning |
|---|---|
| Campaign | Named set of test cases with description, planned start, planned end, status, assigned red team accounts and a white box flag. |
| Campaign status | Planned → Running → Closed. |
| Test case | One test in one campaign: title, ATT&CK technique (required), procedure (free text, e.g. commands), tools, linked L3 rules, red team fields, blue team fields. |
| Red team fields | Execution status (Not run, Executed, Could not execute), executed at (date + time), red team notes. |
| Blue team fields | Outcome (Blocked, Alerted, Logged, Not detected), detected at (date + time), blue team notes. |
| Time to detect (TTD) | Detected at − executed at, for outcomes Blocked and Alerted. |
| Test library | Reusable test templates: title, ATT&CK technique, procedure, tools. Not tied to a campaign. |
| Red team account | New role `red_team`: local account, sees only campaigns it is assigned to, has an expiry date. |
| White box campaign | Campaign in which assigned red team accounts may read the full definition of the linked use cases. |

## Users

- **Analyst** (blue team): creates and runs campaigns, picks use cases, accepts proposed tests,
  links rules, records outcomes and detection times, closes campaigns, maintains the test library.
- **Admin**: everything an analyst can do, plus creating red team accounts and changing their
  expiry date.
- **Auditor** (read-only): views all campaigns, tests, the library and the test history on rules.
- **Red team** (new role, external): sees only campaigns it is assigned to; executes tests and
  records red team fields; sees outcomes only after the campaign is closed.

## User stories

- US-1: Als Analyst möchte ich eine Kampagne mit Zeitraum anlegen und L2/L3-Use-Cases auswählen,
  damit Magma mir passende Tests pro ATT&CK-Technik vorschlägt.
- US-2: Als Analyst möchte ich Tests aus der Testbibliothek übernehmen und eigene Tests als Vorlage
  speichern, damit ich dieselbe Prozedur in späteren Kampagnen wiederverwenden kann.
- US-3: Als Admin möchte ich einen externen Red-Team-Account mit Ablaufdatum anlegen und einer
  Kampagne zuweisen, damit externe Tester nur für die Dauer des Auftrags Zugriff haben.
- US-4: Als Red Teamer möchte ich die Tests meiner Kampagne sehen und Ausführungszeit, Status und
  Notizen eintragen, damit das Blue Team die Ereignisse findet.
- US-5: Als Analyst möchte ich pro Test das Ergebnis und die Erkennungszeit eintragen, damit die
  verknüpften Regeln automatisch als verifiziert (OK oder Issues found) gelten und die Time to
  Detect sichtbar ist.
- US-6: Als Analyst möchte ich bei der Kampagnenanlage „White box" wählen können, damit das Red
  Team bei Bedarf die vollständigen Use-Case-Definitionen sieht.
- US-7: Als Red Teamer möchte ich nach Abschluss der Kampagne die Ergebnisse meiner Tests sehen,
  damit wir das Debriefing gemeinsam machen können.
- US-8: Als Analyst oder Auditor möchte ich auf der Regelseite alle Tests dieser Regel sehen,
  damit ich weiß, wann und mit welchem Ergebnis sie zuletzt angegriffen wurde.

## Must-have behaviour

### Campaigns

1. New page **Campaigns** (navigation, visible to admin, analyst, auditor, red team) lists
   campaigns with name, status, planned start/end, number of tests and outcome counts (outcome
   counts hidden from red team while a campaign is not Closed).
2. Create campaign (analyst, admin): name (required, unique), description, planned start and
   planned end (required, end ≥ start), white box flag (default off), assigned red team accounts
   (zero or more). New campaigns are **Planned**.
3. Status changes by analysts: Planned → Running ("Start campaign"), Running → Closed ("Close
   campaign"), Closed → Running ("Reopen", analyst/admin). Closing is allowed only when every test
   has an execution status other than Not run **and** every Executed test has an outcome; otherwise
   the dialog lists the incomplete tests.
4. Red team and blue team fields can be edited only while the campaign is Running. A Closed
   campaign is read-only for everyone (reopen to change).
5. A campaign can be deleted by an admin only while Planned or when it has no test with an outcome.
   Deleting never removes verifications already written.

### Proposing tests

6. In a Planned or Running campaign, "Add from use cases" opens a picker for L2 use cases and/or
   single L3 rules. Choosing an L2 means all its L3 rules that are not Retired.
7. Magma proposes **one test per distinct current ATT&CK technique** across the chosen rules.
   Revoked technique IDs are resolved to their replacement (as on the ATT&CK page); deprecated or
   unknown IDs are not proposed and are listed as a note. Each proposed test is linked to every
   chosen rule that carries that technique.
8. If the test library holds templates for a proposed technique, the proposal is prefilled from the
   first matching template and the analyst can choose another one from a dropdown. Otherwise
   title = technique name, procedure empty.
9. Chosen rules without any ATT&CK technique are listed as "No technique: add a test by hand".
10. The analyst accepts, edits or drops each proposal before it becomes a test. A campaign may hold
    **several tests for the same technique** (e.g. different procedures). If a proposed technique
    already has tests in this campaign, the proposal shows "Already tested here (n tests)", is
    unselected by default, and offers to add its rules to one of the existing tests instead.

### Test cases

11. Analysts can also add a test by hand or from the library, edit title, technique, procedure,
    tools and linked rules, and delete tests that have no outcome.
12. A test may link zero or more L3 rules. Linking is analyst-only.
13. "Save to library" on a test creates a library template from title, technique, procedure and
    tools.

### Test library

14. New page **Test library** (analyst, admin edit; auditor read; red team no access): list with
    filter by technique and search, create, edit, delete templates. Deleting a template does not
    change tests created from it.

### Red team work

15. A red team account sees only the Campaigns page (its assigned campaigns) and its Account page.
    All other pages and API endpoints are denied.
16. Several red team accounts can be assigned to one campaign; they work as one team and see each
    other's entries and red team notes.
16a. In a Running campaign the red team can set execution status, executed at and red team notes on
    every test, and can add new tests (title, technique, procedure, tools) but cannot link rules,
    set outcomes or delete tests.
17. **Blind (default):** while the campaign is not Closed the red team does not see outcomes,
    detected at, TTD, blue team notes or linked rules.
18. **After close:** the red team sees outcome, detected at and TTD of each test; blue team notes
    and linked rules stay hidden (unless white box).
19. **White box:** if set on the campaign, the red team additionally sees the linked rules of each
    test with their full use case definition read-only (L2 and L3 code, name, description, log
    sources, detection technologies, ATT&CK techniques, current config). Config history, diffs and
    tags are not shown. It still cannot see
    outcomes before close. The flag can be changed by analysts while the campaign is Planned or
    Running; the change is audit-logged.

### Outcomes and verification

20. Analysts set the outcome: Blocked, Alerted, Logged or Not detected. Detected at is required for
    Blocked and Alerted and not allowed for Not detected.
21. When an outcome is set or changed, Magma writes **one verification per linked rule** with the
    existing Verification history: result **OK** for Blocked or Alerted, **Issues found** for Logged
    or Not detected; date = detected at date, else executed at date, else today; user = analyst;
    note = "Purple team: <campaign> / <test title> (<outcome>)". The rule's last verified date and
    user update as for "Verify now".
22. Changing an outcome writes a new verification; earlier ones stay. Clearing an outcome writes
    nothing and removes nothing.
23. Linking a rule to a test that already has an outcome writes a verification for that rule.
24. TTD is shown per test (hours and minutes, or days for ≥ 24 h) and the **median TTD** of the
    campaign on the campaign page.

### Rule page

25. The L3 rule page gets a **Tests** section listing every test linked to the rule: campaign,
    test title, technique, executed at, outcome, TTD, with a link to the test. Newest first.
    Not shown to red team accounts.

### Red team accounts

26. In user admin an admin can create a user with role **Red team**. Red team accounts are local
    only (no SSO mapping to this role); 2FA is optional as for other local accounts.
27. Each red team account has an **expiry date**. By default it is the latest planned end of its
    assigned campaigns + 7 days, recalculated whenever an assignment or a planned end changes. An
    admin can set it manually; a manual date is no longer recalculated until the admin resets it
    to "automatic". Without any assignment and no manual date, the account cannot sign in.
28. At the end of the expiry date (in the server time zone) the account is disabled and its
    sessions end. Re-enabling requires a new expiry date in the future.
29. Creating, assigning, changing expiry and automatic disabling are written to the audit log.

### General

30. All new UI texts in English, German and Dutch.
31. Campaigns, tests and library templates are included in the JSON export.

## Out of Scope

- All reporting: ATT&CK heatmap test layer, campaign PDF, dashboard KPIs, detection rate and TTD
  trends → **PROJ-4**.
- Importing Atomic Red Team or other external test libraries.
- Automated test execution or integration with C2 / BAS tools.
- Evidence attachments (screenshots, logs) on tests.
- E-mail or other notifications to red team accounts.
- SSO login or SSO group mapping for the red team role.
- Separate internal red team role with access beyond assigned campaigns.
- Testing L2 use cases directly without rules (tests always link to L3 rules).
- Excel import/export of campaigns.

## Acceptance Criteria

### Kampagnen
- [ ] AK-1: Angenommen ein Analyst ist angemeldet, wenn er eine Kampagne „Q1 Purple" mit geplantem Start 2026-12-01 und Ende 2026-12-12 anlegt, dann erscheint sie in der Liste „Campaigns" mit Status „Planned" und 0 Tests.
- [ ] AK-2: Angenommen es gibt bereits eine Kampagne „Q1 Purple", wenn ein Analyst eine zweite Kampagne mit demselben Namen anlegt, dann wird sie mit einem Hinweis auf den doppelten Namen abgelehnt.
- [ ] AK-3: Angenommen ein Analyst legt eine Kampagne an, wenn das geplante Ende vor dem geplanten Start liegt, dann wird das Speichern mit einer Fehlermeldung verhindert.
- [ ] AK-4: Angenommen eine Kampagne ist „Planned", wenn ein Analyst „Start campaign" klickt, dann wechselt der Status auf „Running".
- [ ] AK-5: Angenommen eine laufende Kampagne hat einen Test mit Ausführungsstatus „Not run", wenn ein Analyst „Close campaign" klickt, dann bleibt die Kampagne „Running" und der Dialog nennt diesen Test als unvollständig.
- [ ] AK-6: Angenommen eine laufende Kampagne hat einen Test „Executed" ohne Ergebnis, wenn ein Analyst sie schließen will, dann wird das Schließen verhindert und der Test als unvollständig genannt.
- [ ] AK-7: Angenommen alle Tests einer laufenden Kampagne sind „Executed" mit Ergebnis oder „Could not execute", wenn ein Analyst „Close campaign" klickt, dann ist die Kampagne „Closed" und alle Felder sind schreibgeschützt.
- [ ] AK-8: Angenommen eine Kampagne ist „Closed", wenn ein Analyst „Reopen" klickt, dann ist sie wieder „Running" und die Felder sind wieder bearbeitbar.
- [ ] AK-9: Angenommen eine Kampagne hat einen Test mit Ergebnis, wenn ein Admin sie löschen will, dann wird das Löschen verhindert.
- [ ] AK-10: Angenommen eine Kampagne ist „Planned" und ohne Ergebnisse, wenn ein Admin sie löscht, dann ist sie mit allen Tests entfernt und ein Analyst sieht keinen Löschen-Button.

### Testvorschläge
- [ ] AK-11: Angenommen die Regeln R1 (T1059.001, T1003) und R2 (T1059.001) gehören zur L2 „AO-ACC", wenn ein Analyst in einer Kampagne „Add from use cases" mit „AO-ACC" wählt, dann werden genau zwei Tests vorgeschlagen: T1059.001 verknüpft mit R1 und R2, T1003 verknüpft mit R1.
- [ ] AK-12: Angenommen eine gewählte Regel hat die zurückgezogene Technik T1086, wenn Vorschläge erzeugt werden, dann wird ein Test für T1059.001 vorgeschlagen.
- [ ] AK-13: Angenommen eine gewählte Regel hat nur eine veraltete (deprecated) Technik, wenn Vorschläge erzeugt werden, dann wird dafür kein Test vorgeschlagen und die Technik erscheint als Hinweis.
- [ ] AK-14: Angenommen eine gewählte Regel hat keine ATT&CK-Technik, wenn Vorschläge erzeugt werden, dann erscheint sie unter „No technique: add a test by hand".
- [ ] AK-15: Angenommen eine L2 enthält eine Regel im Status „Retired", wenn die L2 gewählt wird, dann wird diese Regel nicht verknüpft und ihre Techniken nicht vorgeschlagen.
- [ ] AK-16: Angenommen die Bibliothek enthält zwei Vorlagen für T1003, wenn T1003 vorgeschlagen wird, dann ist der Vorschlag mit der ersten Vorlage vorbefüllt und die zweite ist im Dropdown wählbar.
- [ ] AK-17: Angenommen die Kampagne hat schon einen Test für T1003, wenn ein Analyst eine weitere Regel mit T1003 auswählt, dann wird T1003 mit dem Hinweis „Already tested here (1 test)" nicht vorausgewählt vorgeschlagen, und der Analyst kann entweder einen zweiten T1003-Test anlegen oder die Regel dem bestehenden Test hinzufügen.
- [ ] AK-18: Angenommen ein Analyst legt von Hand einen zweiten Test für T1059.001 mit anderer Prozedur an, wenn er speichert, dann enthält die Kampagne beide Tests für T1059.001.
- [ ] AK-19: Angenommen drei Vorschläge werden angezeigt, wenn der Analyst einen verwirft und zwei übernimmt, dann enthält die Kampagne genau zwei neue Tests.

### Tests und Bibliothek
- [ ] AK-20: Angenommen eine Kampagne ist „Planned", wenn ein Analyst einen Test von Hand ohne ATT&CK-Technik speichern will, dann wird das mit einer Fehlermeldung verhindert.
- [ ] AK-21: Angenommen ein Test hat eine Prozedur, wenn der Analyst „Save to library" klickt, dann erscheint auf der Seite „Test library" eine Vorlage mit gleichem Titel, Technik, Prozedur und Tools.
- [ ] AK-22: Angenommen ein Test wurde aus einer Bibliotheksvorlage erstellt, wenn die Vorlage gelöscht wird, dann bleibt der Test unverändert.
- [ ] AK-23: Angenommen ein Auditor ist angemeldet, wenn er die Seite „Test library" öffnet, dann sieht er alle Vorlagen, aber keine Schaltflächen zum Anlegen, Bearbeiten oder Löschen.

### Red Team
- [ ] AK-24: Angenommen ein Red-Team-Account ist der Kampagne A, aber nicht B zugewiesen, wenn er sich anmeldet, dann sieht er nur „Campaigns" mit Kampagne A und seine Account-Seite.
- [ ] AK-25: Angenommen ein Red-Team-Account ist angemeldet, wenn er die URL einer Use-Case-Seite, des Dashboards oder von Kampagne B direkt aufruft, dann wird der Zugriff verweigert, ebenso über die API.
- [ ] AK-26: Angenommen Kampagne A läuft, wenn der Red Teamer bei einem Test „Executed", eine Ausführungszeit und eine Notiz einträgt, dann sind diese Werte für Analysten sichtbar.
- [ ] AK-27: Angenommen Kampagne A ist „Planned", wenn der Red Teamer einen Test öffnet, dann sind die Red-Team-Felder schreibgeschützt.
- [ ] AK-28: Angenommen Kampagne A läuft und ist nicht White Box, wenn ein Analyst bei einem Test „Alerted" einträgt, dann sieht der Red Teamer weder Ergebnis, Erkennungszeit, TTD, Blue-Team-Notiz noch verknüpfte Regeln, auch nicht über die API.
- [ ] AK-29: Angenommen Kampagne A läuft, wenn der Red Teamer einen neuen Test mit Titel und Technik anlegt, dann erscheint er in der Kampagne ohne verknüpfte Regeln, und der Red Teamer kann weder Regeln verknüpfen noch ein Ergebnis setzen noch Tests löschen.
- [ ] AK-30: Angenommen die Red-Team-Accounts X und Y sind Kampagne A zugewiesen, wenn X bei einem Test eine Red-Team-Notiz speichert, dann sieht Y diese Notiz und den von X gesetzten Ausführungsstatus.
- [ ] AK-31: Angenommen Kampagne A wurde geschlossen, wenn der Red Teamer sie öffnet, dann sieht er pro Test Ergebnis, Erkennungszeit und TTD, aber keine Blue-Team-Notizen und keine verknüpften Regeln.
- [ ] AK-32: Angenommen Kampagne A ist White Box, wenn der Red Teamer einen Test öffnet, dann sieht er die verknüpften Regeln mit Code, Name, Beschreibung, Log Sources, Detection Technologies, ATT&CK-Techniken und aktueller Konfiguration, schreibgeschützt.
- [ ] AK-33: Angenommen Kampagne A ist White Box und die verknüpfte Regel hat mehrere Konfigurationsversionen, wenn der Red Teamer den Test öffnet, dann sieht er nur die aktuelle Konfiguration, ohne Historie, Diffs oder Tags.
- [ ] AK-34: Angenommen Kampagne A ist White Box und läuft, wenn ein Analyst ein Ergebnis einträgt, dann sieht der Red Teamer dieses Ergebnis trotzdem erst nach dem Schließen.
- [ ] AK-35: Angenommen ein Analyst schaltet White Box bei einer laufenden Kampagne ein, wenn er speichert, dann steht ein Eintrag mit Kampagne, alt und neu im Audit Log.

### Ergebnisse und Verifikation
- [ ] AK-36: Angenommen ein Test ist mit R1 und R2 verknüpft und am 2026-12-02 10:00 ausgeführt, wenn ein Analyst „Alerted" mit Erkennungszeit 2026-12-02 10:12 speichert, dann haben R1 und R2 je eine Verifikation „OK" vom 2026-12-02 mit dem Analysten als Benutzer und Kampagne und Test in der Notiz, und die TTD zeigt „12 min".
- [ ] AK-37: Angenommen ein Test ist mit R1 verknüpft, wenn ein Analyst „Logged" speichert, dann hat R1 eine neue Verifikation „Issues found" und sein „Last verified" ist aktualisiert.
- [ ] AK-38: Angenommen ein Test ist mit R1 verknüpft, wenn ein Analyst „Not detected" speichert, dann hat R1 eine neue Verifikation „Issues found" und es wird keine TTD angezeigt.
- [ ] AK-39: Angenommen ein Analyst wählt „Blocked" oder „Alerted", wenn die Erkennungszeit fehlt, dann wird das Speichern verhindert.
- [ ] AK-40: Angenommen ein Analyst wählt „Not detected", wenn eine Erkennungszeit eingetragen ist, dann wird das Speichern verhindert.
- [ ] AK-41: Angenommen ein Test hat „Logged" und R1 hat dafür eine Verifikation „Issues found", wenn der Analyst das Ergebnis auf „Alerted" ändert, dann hat R1 zusätzlich eine Verifikation „OK" und die ältere bleibt in der Historie.
- [ ] AK-42: Angenommen ein Test hat ein Ergebnis, wenn ein Analyst das Ergebnis leert, dann wird keine Verifikation geschrieben oder gelöscht.
- [ ] AK-43: Angenommen ein Test hat „Alerted", wenn ein Analyst die Regel R3 neu verknüpft, dann erhält R3 eine Verifikation „OK".
- [ ] AK-44: Angenommen eine Kampagne hat drei Tests mit TTD 5 min, 20 min und 3 h, wenn ein Analyst die Kampagnenseite öffnet, dann zeigt sie eine Median-TTD von „20 min".
- [ ] AK-45: Angenommen die Erkennungszeit liegt vor der Ausführungszeit, wenn ein Analyst speichert, dann wird das mit einer Fehlermeldung verhindert.

### Regelseite
- [ ] AK-46: Angenommen R1 ist mit Tests aus zwei Kampagnen verknüpft, wenn ein Analyst oder Auditor die Regelseite von R1 öffnet, dann listet der Abschnitt „Tests" beide Tests mit Kampagne, Technik, Ausführungszeit, Ergebnis und TTD, neuester zuerst, mit Link zum Test.

### Red-Team-Accounts
- [ ] AK-47: Angenommen ein Admin legt einen Benutzer an, wenn er die Rolle „Red team" wählt, dann ist nur lokale Anmeldung möglich und 2FA ist optional.
- [ ] AK-48: Angenommen ein Red-Team-Account ohne manuelles Ablaufdatum wird Kampagne A (Ende 2026-12-12) zugewiesen, wenn der Admin den Account ansieht, dann ist das Ablaufdatum 2026-12-19 mit dem Hinweis „automatic".
- [ ] AK-49: Angenommen der Account ist auch Kampagne B (Ende 2027-01-20) zugewiesen, wenn die Zuweisung gespeichert ist, dann ist das automatische Ablaufdatum 2027-01-27.
- [ ] AK-50: Angenommen das geplante Ende von Kampagne B wird auf 2027-01-30 verschoben, wenn gespeichert wird, dann ist das automatische Ablaufdatum 2027-02-06.
- [ ] AK-51: Angenommen ein Admin setzt das Ablaufdatum manuell auf 2026-12-31, wenn sich danach das Kampagnenende ändert, dann bleibt es 2026-12-31, bis der Admin es auf „automatic" zurücksetzt.
- [ ] AK-52: Angenommen das Ablaufdatum eines Red-Team-Accounts ist erreicht, wenn der Tag endet, dann ist der Account deaktiviert, laufende Sitzungen sind beendet und ein Eintrag steht im Audit Log.
- [ ] AK-53: Angenommen ein Red-Team-Account ist abgelaufen, wenn ein Admin ihn ohne neues zukünftiges Ablaufdatum wieder aktivieren will, dann wird das verhindert.
- [ ] AK-54: Angenommen ein Red-Team-Account hat keine Kampagne und kein manuelles Ablaufdatum, wenn er sich anmelden will, dann wird die Anmeldung abgelehnt.
- [ ] AK-55: Angenommen ein Red-Team-Account ist angemeldet, wenn er die Regelseite einer Regel aufruft, die mit seinem Test verknüpft ist, dann wird der Zugriff verweigert (auch in White-Box-Kampagnen ist nur die Ansicht im Test möglich).

### Allgemein
- [ ] AK-56: Angenommen die Oberfläche ist auf Deutsch oder Niederländisch, wenn ein Benutzer die Seiten „Campaigns" und „Test library" öffnet, dann sind alle neuen Texte übersetzt.
- [ ] AK-57: Angenommen es gibt Kampagnen, Tests und Vorlagen, wenn ein Admin den JSON-Export ausführt, dann sind diese darin enthalten.

## Edge Cases

- EC-1: **Linked rule deleted.** The link is removed from the test; the test stays. Verifications
  are deleted with the rule as today.
- EC-2: **Linked rule retired after linking.** The link stays and is shown with a "Retired" badge;
  outcomes still write verifications.
- EC-3: **Rule's ATT&CK techniques change after the test was created.** The test keeps its own
  technique and links; nothing is re-proposed automatically.
- EC-4: **Red team account removed from a campaign while signed in.** Its next request to that
  campaign is denied; the automatic expiry date is recalculated.
- EC-5: **Campaign planned end in the past at creation.** Allowed (recording an earlier test), but
  the automatic expiry of an assigned red team account would already be over: the admin is warned
  on assignment.
- EC-6: **Two analysts set the outcome of the same test at the same time.** The second save gets a
  conflict message and reloads; only one set of verifications is written per save.
- EC-7: **Test without linked rules gets an outcome.** Allowed; no verification is written and the
  test is marked "No rule linked".
- EC-8: **Executed at missing but outcome set.** Allowed for Logged and Not detected; for Blocked
  and Alerted TTD shows "–" and the verification date is the detected at date.
- EC-9: **Could not execute.** Outcome and detected at are not allowed; no verification is written.
- EC-10: **Large campaign** (e.g. 300 tests from a whole L1). The proposal list and the campaign
  page stay usable (filter by technique, outcome and execution status).
- EC-11: **Long free text** (procedure, notes): up to 10,000 characters; longer input is rejected.
- EC-12: **Time zones.** Times are entered and shown in the user's browser time zone and stored as
  UTC, so red team and blue team in different zones get a correct TTD.
- EC-13: **Red team account with 2FA lost.** Reset as for other local accounts via the existing
  CLI or user admin.

## Dependencies

- Existing: L3 `attack_techniques` and ATT&CK revoke/deprecate data (M6), Verification history and
  "Verify now" (M2), users, roles, audit log, 2FA (M1/M5), i18n (M7), JSON export.
- PROJ-4 (reporting) builds on this spec.

## Technical Requirements

- New role must be denied by default on every existing API endpoint; access is granted only to
  campaign endpoints for assigned campaigns and to the own account.
- Hidden fields (outcome, detected at, TTD, blue notes, linked rules, rule details) must be removed
  server side for red team accounts, not only hidden in the UI.
- Runs on SQLite and PostgreSQL like the rest of the app.

## Open Questions

- Keine

## Product Decisions

- Scope = VECTR-style tests linked to L3 rules, not full VECTR assessments: Magma already has ATT&CK mapping and verification, so linking tests to rules fills the real gap in one unit. (2026-11-18)
- Analysts do the blue team work; a new limited red team role exists only for external testers: keeps existing roles unchanged while allowing outsiders in. (2026-11-18)
- Red team is blind during the campaign and sees outcomes after close; white box can be enabled per campaign to show full use case definitions: keeps tests realistic and rule logic private by default, but supports white box engagements. (2026-11-18)
- Outcome per test writes a verification per linked rule; Blocked/Alerted = OK, Logged/Not detected = Issues found: a rule that only logs did not alert, so it is a finding; writing per test keeps last verified dates current during long campaigns. (2026-11-18)
- Tests proposed from the chosen rules' ATT&CK techniques plus a reusable test library; Atomic Red Team import excluded: proposals reuse existing mapping, the library allows repeating procedures. (2026-11-18)
- Execution and detection times recorded; TTD per test and median per campaign: time to detect is the second key purple team figure. (2026-11-18)
- Reporting (ATT&CK layer, PDF, dashboard KPIs, trends) split into PROJ-4: needs real campaign data and is a separate set of screens. (2026-11-18)
- Red team accounts are local, 2FA optional, with an expiry date that defaults to the latest assigned campaign's planned end + 7 days and can be set manually: external engagements are time-boxed. (2026-11-18)
- White box shows only the current config of linked rules, no history: enough for a white box test without exposing past rule versions. (2026-11-18)
- Red team accounts in the same campaign see each other's notes: they work as one team. (2026-11-18)
- A campaign may contain several tests per ATT&CK technique: different procedures for the same technique are tested separately. (2026-11-18)
- Accepted in review: campaign states Planned/Running/Closed with reopen; red team may add ad-hoc tests but not link rules; red team cannot open rule pages even in white box; deletion only without outcomes. (2026-11-18)
