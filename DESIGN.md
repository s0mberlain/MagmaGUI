---
name: Vulcan
description: A calm, exact, auditable workbench for the SOC's MaGMa use cases.
colors:
  ember-rust: "#c2410c"
  ember-rust-deep: "#9a3412"
  ember-wash: "#fff1e8"
  ember-flare: "#f97316"
  graphite: "#16181d"
  graphite-raised: "#2c3038"
  slate-ink: "#3a3f4a"
  muted-slate: "#5b6170"
  rail-text: "#c9cdd4"
  rail-muted: "#a9aeb8"
  page-mist: "#f4f5f7"
  surface-white: "#ffffff"
  table-head: "#fafafb"
  hairline: "#e2e4e9"
  hairline-strong: "#d5d8de"
  subtle-fill: "#f1f2f5"
  track: "#eef0f3"
  info-wash: "#eef2ff"
  info-ink: "#1e3a8a"
  data-effectiveness: "#1d4ed8"
  data-implementation: "#93c5fd"
  data-coverage: "#ea580c"
  ok-ink: "#166534"
  ok-wash: "#e7f6ec"
  ok-signal: "#16a34a"
  caution-ink: "#854d0e"
  caution-wash: "#fef6dc"
  caution-signal: "#d97706"
  danger-ink: "#b91c1c"
  danger-deep: "#991b1b"
  danger-wash: "#fde8e8"
  danger-signal: "#dc2626"
  paused-ink: "#5b21b6"
  paused-wash: "#f5f3ff"
  outcome-blocked: "#166534"
  outcome-alerted: "#4ade80"
  outcome-logged-central: "#facc15"
  outcome-logged-local: "#fb923c"
  outcome-none: "#dc2626"
typography:
  display:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1.1
  headline:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "28px"
    fontWeight: 600
  metric:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1
  metric-sm:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "24px"
    fontWeight: 600
  title:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  body-dense:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  overline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  tag: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "999px"
spacing:
  2xs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.ember-rust}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ember-rust-deep}"
    textColor: "{colors.surface-white}"
  button-secondary:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.subtle-fill}"
  button-sm:
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  button-dark:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.md}"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.md}"
    height: "44px"
  input:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface-white}"
    rounded: "{rounded.lg}"
    padding: "20px 22px"
  nav-rail:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.rail-text}"
    width: "232px"
  nav-link-active:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.md}"
    height: "40px"
  tab-active:
    textColor: "{colors.graphite}"
    height: "40px"
  filter-chip-active:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.full}"
    height: "36px"
  pill-operational:
    backgroundColor: "{colors.ok-wash}"
    textColor: "{colors.ok-ink}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  pill-onboarding:
    backgroundColor: "{colors.caution-wash}"
    textColor: "{colors.caution-ink}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-gap:
    backgroundColor: "{colors.ember-wash}"
    textColor: "{colors.ember-rust-deep}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  chip-info:
    backgroundColor: "{colors.info-wash}"
    textColor: "{colors.info-ink}"
    rounded: "{rounded.tag}"
    padding: "2px 7px"
  table-header:
    backgroundColor: "{colors.table-head}"
    textColor: "{colors.muted-slate}"
    typography: "{typography.caption}"
    padding: "12px 14px"
  code-block:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.hairline}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  unsaved-bar:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
---

# Design System: Vulcan

## Overview

**Creative North Star: "The Basalt Ledger"**

Vulcan is a dark Graphite frame of cooled stone around a light, precise record. The near-black rail and the occasional dark band (code, the sticky save bar) are the basalt. The pale page and its white, hairline-bordered cards hold the ledger, where every rule, score, verification and decision is written down and can be traced. Ember Rust is the heat that remains. It marks the one action that moves work forward and the gaps that still need attention, and nothing else. The name fits the world: Vulcan is the forge, and the mark is a V struck like a hammer blow, throwing one Ember spark.

Four kinds of experts use the system at their desks all day, so it is dense, calm and exact. Information beats ornament: tables, readouts, chips and small status pills do the work, and the type pairing splits voices cleanly. Space Grotesk speaks for headings and numbers; Inter carries everything you read and fill in; JetBrains Mono marks identifiers, configs and code. Controls are precise and quiet: neutral outlined buttons and inputs, with orange reserved for the single primary action in an area.

The system rejects four looks. It is not a neon "hacker" terminal with green or cyan glow, not a generic SaaS dashboard with gradients, glassy cards and decorative hero blocks, and not a clone of the old Excel grid. It also refuses traffic-light overload: red, amber and green appear only where a real status is being reported.

**Key Characteristics:**
- Graphite rail and frame, pale Page Mist canvas, white cards separated by 1px hairlines.
- One warm accent (Ember Rust), used sparingly for primary actions, active indicators, links and gaps.
- Flat surfaces; shadows only on things that float.
- Space Grotesk for headings and metrics, Inter for text and controls, JetBrains Mono for IDs and code.
- Dense desktop layouts: 13–14px text, 44px controls, tables that scroll inside their card.
- Status colour is semantic and local: pills, dots, outcome cells and badges, never page decoration.

**Motion** (GSAP, `frontend/src/lib/motion.ts`). Motion explains, it does not decorate: figures count to their value and bars fill from the left when data first arrives (0.6 s, `power2.out` / `expo.out`), floating bars rise 14 px into place (0.24 s), dialogs and menus open with a short fade and a 4–6 px lift (0.24 s; the dialog's dim fades with it), and ranked rows glide to their new place when a filter reorders them (Flip, 0.36 s) and rows new to the list fade in as the data lands. The one authored moment is the **sign-in strike**: the V drops onto its base and the Ember spark is struck with a brief glow and settles (~0.55 s). Only the mark moves; the headline and the form are there from the first paint. Content always renders in its final state first. Under `prefers-reduced-motion` nothing moves: numbers show at once, entrances keep only a short fade, and content that stays never blinks.

**The One Strike Rule.** Only the sign-in mark gets an authored sequence. Everything else in the app is feedback or continuity under 0.4 s, and nothing waits on an animation.

## Colors

A neutral, slightly cool grey scale framed by Graphite, with one warm accent and a disciplined set of semantic status colours.

### Primary
- **Ember Rust** (`ember-rust`): primary buttons, the active-tab underline, links, focus rings, checkbox accents and the highest risk level. It is the colour of "act here".
- **Ember Rust Deep** (`ember-rust-deep`): hover and pressed state of primary actions and links; the text colour of gap badges, warnings and form errors.
- **Ember Wash** (`ember-wash`): the soft background behind detection-gap badges, form errors, warning pills and config tags.
- **Ember Flare** (`ember-flare`): the logo's spark only. It is brighter than Ember Rust so the spark reads on Graphite. It is never a UI colour.

### Secondary
- **Info Ink** on **Info Wash** (`info-ink`, `info-wash`): the calm blue for informational chips, notices, the Maintenance status and L2 level tags. It is the "neutral but meaningful" voice beside the accent.
- **Data series** (`data-effectiveness`, `data-implementation`, `data-coverage`): the three embedded metrics, always in this order and these colours. They appear in metric bars, legends, trend charts and change bars. Coverage's orange is a data colour, distinct from Ember Rust, and never stands for an action.

### Neutral
- **Graphite** (`graphite`): body text (ink) and the nav rail, code blocks, the sticky unsaved bar, dark buttons and active filter chips.
- **Graphite Raised** (`graphite-raised`): the active nav item, the avatar and dividers on the rail.
- **Rail Text / Rail Muted** (`rail-text`, `rail-muted`): nav link text and group headings on Graphite.
- **Slate Ink** (`slate-ink`): secondary text, lead paragraphs, neutral chips.
- **Muted Slate** (`muted-slate`): labels, table headers, subtitles, captions and empty values (shown as "–").
- **Page Mist** (`page-mist`): the app background behind the cards.
- **Surface White** (`surface-white`): cards, inputs, buttons, dialogs.
- **Table Head** (`table-head`): the faint band behind table header rows.
- **Hairline / Hairline Strong** (`hairline`, `hairline-strong`): card borders and dividers; Hairline Strong for control borders and dashed empty states.
- **Subtle Fill / Track** (`subtle-fill`, `track`): hover fills, neutral pills, row separators and the empty part of metric bars.

### Status (semantic only)
- **OK** (`ok-ink` on `ok-wash`, dot `ok-signal`): Operational, covered, confirmed, positive deltas, diff additions, success notices.
- **Caution** (`caution-ink` on `caution-wash`, dot `caution-signal`): Onboarding, drafts, partly covered, in-progress runs, risk level 3.
- **Danger** (`danger-ink`, `danger-deep` on `danger-wash`, dot `danger-signal`): gaps in coverage grids, destructive buttons, errors, diff deletions, not-executed tests.
- **Paused** (`paused-ink` on `paused-wash`): paused purple-team runs.
- **Purple-team outcomes** (`outcome-blocked` → `outcome-none`): a fixed ordinal scale from dark green (blocked) through light green (alerted), yellow (logged centrally) and orange (logged locally) to red (none). It is used only in outcome cells, dots, legends and the technique matrix.

### Named Rules
**The Ember Budget Rule.** Each area gets at most one Ember Rust button. Every other action is a neutral outlined button. If two things on a screen are orange and only one is a gap or the primary action, one of them is wrong.

**The Status Is Local Rule.** Status colours live inside the element that reports the status (a pill, dot, cell, badge or border edge). They never tint whole cards, page headers or backgrounds.

**The Data Triad Rule.** Effectiveness, implementation and coverage always use the three data colours, in that order, with a legend nearby. No other series may borrow them.

## Typography

**Display Font:** Space Grotesk (with Inter, sans-serif)
**Body Font:** Inter (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, monospace)

**Character:** Space Grotesk's squared, slightly technical shapes give headings and numbers an engineered voice. Inter stays invisible in dense tables and forms. Mono marks anything that is an identifier: rule codes (`AO-CRE-01`), ATT&CK IDs, config tags, SIEM names, code.

All three families are self-hosted through `@fontsource`; nothing loads from a font CDN.

### Hierarchy
- **Display** (600, 44px, 1.1): the login hero headline only. In-app screens never use it.
- **Headline** (600, 28px): the page title (`h1`), one per page.
- **Metric** (600, 34px, 1): KPI readouts on the dashboard. **Metric small** (600, 24px) is for stat grids, trend values and secondary KPIs.
- **Title** (600, 18px): card and section headings (`h2`). Table cards use 16px; Space Grotesk ends at this level.
- **Body** (400, 14px): base text, inputs, buttons, nav links. Lead and explanatory paragraphs set at 1.5 line height and about 480–520px wide.
- **Body dense** (400, 13px): table cells, notices, breadcrumbs, form errors.
- **Label** (500, 13px): field labels, KPI labels, secondary buttons at small size.
- **Caption** (600, 12px): table headers, pills, badges, chips, legends, KPI sub-lines (500).
- **Overline** (600, 11px, 0.08em, uppercase): nav group headings ("Daily work", "Analysis", "Setup") only.
- **Code** (400, 12px, 1.6): config editors, diffs, code blocks, command lines.

### Named Rules
**The Two Voices Rule.** Space Grotesk is for headings and numbers; Inter is for everything people read or type. Never set body text, labels or table cells in Space Grotesk, and never set a page title in Inter.

**The Identifier Rule.** Anything a user could copy into a SIEM, a ticket or a search (rule codes, technique IDs, SHAs, tags) is set in mono.

## Layout

The app shell is a fixed **232px Graphite nav rail** on the left and a fluid content column. On wide screens the rail folds to a **56px icon rail** showing only the logo and the expand button, with a 0.15s width transition that is disabled under `prefers-reduced-motion`. The content column has **28px top, 36px side and 48px bottom padding**, and stacks its blocks with a **24px gap**: page header, KPI or filter row, then cards.

- **Page header:** title and subtitle on the left, actions on the right, wrapping with a 16px gap.
- **Grids:** KPI tiles use `auto-fit, minmax(148px, 1fr)` with 16px gaps. Stat grids use 150px, trend cards 260px and form grids 200px (14px gap).
- **Split views:** a dominant main column (`flex 999 1 560px`) beside a 340px side column with a 24px gap. Two-column detail views use `1fr / 1.4fr` with a 20px gap.
- **Vertical rhythm:** stacks of 8px (tight), 14px (default) and 20px (loose) inside cards; field label-to-control gap 6px.
- **Tables** keep a minimum width of 720px and scroll horizontally inside their card instead of squeezing columns. The first column holds the identifier and gets at least 220px.
- **Breakpoints:** the product is desktop-only. Responsive rules exist as a fallback: under 800px the rail becomes a sticky top bar with a menu button, and under 640px the content padding drops to 20px/16px. New work targets desktop widths and does not design phone layouts.

**The Dense, Not Cramped Rule.** Density comes from small type and tight tables, not from removing padding. Cards keep their 20–22px inner padding and controls keep their 44px height (36px for small, 28px for in-table extra-small).

## Elevation & Depth

The system is flat. Depth comes from tone and hairlines: white cards with 1px Hairline borders on a Page Mist background, a faint Table Head band, and Graphite for the frame. Surfaces at rest never cast shadows. Shadows appear only on elements that float above the page: dropdown lists, dialogs and the sticky unsaved-changes bar.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 8px 24px rgba(22, 24, 29, 0.12)`): multi-select dropdown lists and other anchored popovers.
- **Floating bar** (`box-shadow: 0 10px 30px rgba(22, 24, 29, 0.25)`): the sticky Graphite unsaved-changes bar at the bottom of long forms.
- **Dialog** (`box-shadow: 0 20px 60px rgba(22, 24, 29, 0.3)`): native `<dialog>` modals, with a `rgba(22, 24, 29, 0.45)` backdrop.
- **Selection ring** (`box-shadow: 0 0 0 2px #fff1e8, 0 0 0 3px #c2410c`): the focused risk in coverage views. A 1px Ember ring marks invalid inputs.

### Named Rules
**The Flat-By-Default Rule.** Cards, tables, tiles and panels are separated by borders and tone, never by resting shadows. If it doesn't float over other content, it doesn't get a shadow.

## Shapes

The shapes are gently rounded and consistent. Controls, nav items, notices and code blocks use the **8px** radius. Cards, dialogs and the unsaved bar use **12px**. Tree rows and small inner elements use **6px**. Inline tags and level markers (`chip`, `L2`/`L3`) use a tight **4px**, which makes them read as labels. Status pills, badges and filter chips are **fully rounded**, which makes them read as states. Avatars, level badges and status dots are circles. The login card alone uses 16px.

Borders are always 1px. A dashed Hairline Strong border means "nothing here yet" (empty states, unrated risks, low-coverage badges). A 3px coloured left edge marks a risk row's coverage.

**The Pill Means State Rule.** Fully rounded shapes are reserved for statuses, outcomes and filters. Identifiers and tags use the 4px tag shape.

## Components

### Buttons
Precise and quiet: almost every button is a neutral outline, and the orange one tells you what comes next.
- **Shape:** gently rounded (8px), 44px tall; small 36px; extra-small 28px for in-table actions.
- **Secondary (default):** Surface White, 1px Hairline Strong border, Graphite text, weight 500; hover fills Subtle Fill. Used for most actions.
- **Primary:** Ember Rust fill and border, white text, weight 600; hover Ember Rust Deep. One per area: Save, Create, Complete.
- **Dark:** Graphite fill, white text; for strong neutral actions on light surfaces.
- **Danger:** a white outline with Danger Ink text and a pale red border. The solid red variant is reserved for the final confirmation inside a destructive dialog.
- **Ghost:** transparent; used on the Graphite unsaved bar and in compact run bars.
- **Focus:** 2px Ember Rust outline at a 2px offset on every interactive element. **Disabled:** 55% opacity, `not-allowed` cursor.

### Status pills and badges
- **Lifecycle pills:** Operational (OK), Maintenance (Info), Onboarding (Caution), Offloading and Retired (neutral Subtle Fill, Retired in Muted Slate). 12px/600, fully rounded, 4px × 10px.
- **Detection gap badge:** Ember Wash with Ember Rust Deep text. It is the visible form of "show the gap, never hide it" and replaces any 0 for an unscored L2.
- **Coverage badges:** covered / partly covered / gap / below threshold / unrated, using the OK / Caution / Danger / neutral / dashed treatments.
- **Purple-team state:** a pill with a leading dot. The dot pulses (1.4s ease-in-out) only while a run is in progress; the pulse is disabled under reduced motion.

### Chips and tags
- **Info chip:** Info Wash with Info Ink, 4px radius, 12px; for log sources, technologies, scopes. Chips can be links to the matching use cases.
- **Neutral chip:** Subtle Fill with Slate Ink, fully rounded.
- **Config tag:** Ember Wash, mono text.
- **Level tags:** `L2` (Info) and `L3` (violet), mono 10px bold, 4px radius.
- **Filter chips:** 36px fully rounded outline buttons; the active one turns solid Graphite.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Surface White on Page Mist.
- **Shadow Strategy:** none (Flat-By-Default).
- **Border:** 1px Hairline.
- **Internal Padding:** 20px vertical, 22px horizontal. Table cards have no padding so the table runs edge to edge, with the title inset 16px × 18px.

### Tables
The workhorse. 13px Body Dense text; a header row in 12px/600 Muted Slate on the Table Head band; 12px × 14px cell padding; 1px Track separators between rows. Numeric columns right-align and never wrap. The first column carries the identifier (mono code plus name) and links to the record. Missing values show as a muted "–".

### Inputs / Fields
- **Style:** Surface White, 1px Hairline Strong border, 8px radius, 44px tall (36px small), 12px horizontal padding, 14px text. Textareas grow vertically at 1.5 line height.
- **Label:** 13px/500 above the control with a 6px gap.
- **Focus:** 2px Ember Rust outline at a 2px offset.
- **Error:** an Ember Rust border plus a 1px Ember ring, and a field error message below. Form-level errors sit in an Ember Wash box.

### Navigation
- **Rail:** Graphite, 232px, 20px × 14px padding. The Struck V mark and the "Vulcan" wordmark (Space Grotesk 700, 18px, 0.02em tracking) sit at the top; the user box with avatar, name and role at the bottom.
- **Groups:** an overline heading per group (Daily work, Analysis, Setup).
- **Links:** 40px tall, 14px/500 Rail Text; hover goes white on a 6% white wash; active uses a Graphite Raised fill, white text, weight 600.
- **Tabs (in-page):** 40px, Muted Slate text, a 2px Ember Rust underline on the active tab, which goes Graphite and weight 600. A count bubble shows pending items.

### Dialogs
Native `<dialog>` (focus trap and Esc for free), 12px radius, 22px × 24px padding, 520px wide (820px for the wide variant), with the Dialog shadow and a dark backdrop. Destructive confirmations go through the shared confirm dialog, never `window.confirm`.

### Logo: The Struck V (signature)
A V monogram cut like a hammer blow (filled with the text colour: light `#e6e8ec` on the Graphite rail, Graphite on light surfaces) with a four-pointed Ember Flare spark at the notch. Drawn on a 32 px grid so it stays crisp at 16 px; the favicon puts it on a Graphite tile with 7 px corners. The V and the spark are separate paths (`.logo-v`, `.logo-spark`) for the sign-in strike. Never recolour the V in Ember, never outline it, never add a second spark.

### Unsaved-changes bar (signature)
A Graphite bar, 12px radius, sticky 12px above the bottom of long editors, with the Floating bar shadow. It holds the save status and the Save/Discard actions, so the primary action stays in reach while you scroll a long form.

### Metric bars (signature)
Three stacked 6px bars with 3px radius on Track, one each for effectiveness, implementation and coverage, in the Data Triad colours. A tooltip gives the exact percentage. A null metric renders as an empty track, never as a filled 0.

### Code and config
A Graphite code block with light text, mono 12px/1.6, 8px radius, scrolling horizontally. Diffs use OK Wash for added lines and Danger Wash for deleted ones, with coloured +/− markers.

## Do's and Don'ts

### Do:
- **Do** keep one Ember Rust (`#c2410c`) primary button per area, and use neutral outlined buttons for everything else.
- **Do** show missing data explicitly: a Detection gap badge, a muted "–", a dashed "unrated" or empty-state box. Never show a fabricated 0.
- **Do** use the 1px Hairline border on white for every card and panel, and keep shadows for floating elements only.
- **Do** set rule codes, ATT&CK IDs, SHAs, tags and SIEM names in JetBrains Mono.
- **Do** reuse the existing status mappings (lifecycle pills, coverage badges, outcome scale) instead of inventing new colour meanings.
- **Do** give every interactive element the 2px Ember Rust focus outline at a 2px offset.
- **Do** let wide tables scroll inside their card, keeping the 720px minimum width.
- **Do** run every new label through translation and leave room for longer German and Dutch strings in buttons, tabs and table headers.

### Don't:
- **Don't** use a neon "hacker" look: no dark terminal pages, green or cyan glows, scanlines or matrix motifs. Graphite is a frame, not a theme.
- **Don't** import generic SaaS dashboard tropes: gradients, glassmorphism, glowing cards, large decorative icon tiles or marketing hero blocks inside the app.
- **Don't** recreate the old Excel's grid look (gridlines on every cell, coloured header bands, spreadsheet chrome). Vulcan is its own tool.
- **Don't** apply red, amber and green to things that are not statuses. No coloured page headers, card backgrounds or decorative traffic lights.
- **Don't** add a new amber or red when an existing one fits. Two near-duplicate caution pairs exist today (`#fef6dc`/`#854d0e` and `#fef3c7`/`#92400e`); use the first and consolidate the second when touching that code.
- **Don't** use Ember Flare (`#f97316`) anywhere but the logo's spark, and don't use the coverage orange (`#ea580c`) as an action colour.
- **Don't** set body text or table content in Space Grotesk, or page titles in Inter.
- **Don't** add resting shadows to cards, tables or KPI tiles.
