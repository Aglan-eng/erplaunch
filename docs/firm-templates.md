# Firm Templates — Brand Pack Contract

This doc describes the 12-section markdown contract that the Phase
49.3 Brand Pack parser uses to populate a firm's template fields. A
worked example is in [`XELERATE_BRAND_PACK.md`](../XELERATE_BRAND_PACK.md)
at the workspace root.

## Why authoring matters

The proposal generator (and, in future phases, every other generator)
falls back to platform-default copy when a firm hasn't set its
template fields. The platform defaults are deliberately generic — they
work everywhere but they read like a software-vendor template. Firms
that want their own voice in their proposals author a Brand Pack and
ingest it via the Settings → Templates editor or the seed script.

After ingest, every PROPOSAL job for that firm picks up:

| Field group       | What it changes                                     |
| ----------------- | --------------------------------------------------- |
| Tagline + description | Why_Us section opener (when whyUs is not overridden) |
| Methodology       | Implementation_Approach phase list                  |
| Roadmap           | Implementation_Approach Roadmap subsection          |
| Industry verticals| Solution_Overview vertical-specific section         |
| CTA options       | Cover_Letter `{{cta}}` token                        |
| Theme             | Editor lock (font, headline case, accent color)     |

## Format rules

- The pack is a single markdown document.
- Every top-level section starts with `## N. Title` where N is the
  ordinal (1–12) and Title is the canonical section name (see below).
- Structured sections (5–9, 11) split on `### N.M Title` subsection
  headings. The subsection title is used as the row title; the body
  text is the row's body.
- Field-style content uses `**Field:** value` (colon inside the bold
  markers) or `**Field**: value` (colon outside). The parser accepts
  either form.
- The parser is strict: a missing required section returns 400 with
  the missing list; a structured section missing required fields
  returns 400 `MALFORMED_SECTION` with the section number.

## The 12 sections

### 1. Tagline

A single line — outcome-first and specific. Used as the lead in
firm-voice cover letters.

### 2. Subtitle

Supporting line that may be paired with the tagline on branded
surfaces. Plain text.

### 3. Company Description

2–3 paragraphs of markdown. Becomes the lead body when the proposal
generator falls back to the tagline-and-description Why_Us format
(i.e. when `whyUs` is null).

### 4. Why Us

Direct override for the Why_Us section. When set, takes precedence
over `tagline` + `companyDescription`. Markdown.

### 5. Methodology

Each subsection is one phase. Subsection title is the phase title;
body is the phase description.

```
## 5. Methodology

### 5.1 Frame

Baseline the operating model before designing the new state.

### 5.2 Build

Configuration + integrations land in parallel.

### 5.3 Land

Go live with confidence; hypercare is included.
```

### 6. Roadmap

Same shape as Methodology — subsections are roadmap phases.

### 7. Proposal Structure

Each subsection's body is a bulleted list (`-` or `*`). Bullets become
the section's `bullets` array.

```
## 7. Proposal Structure

### 7.1 Introduction

- Anchor the customer's pain
- Quote the conversation that got us here

### 7.2 Proposed System

- Module-by-module breakdown
- Configuration vs. customisation split
```

### 8. Pricing Template

Each subsection has `**SKU:**`, `**Description:**`, `**Annual:**`
fields. Annual accepts `$25,000` or `25000` — the parser strips
non-numeric characters.

```
### 8.1 Discovery package

**SKU:** XEL-DISC-001
**Description:** 4-week scoping engagement
**Annual:** $25,000
```

### 9. Industry Verticals

Each subsection has `**Outcome:**`, `**Strategic context:**`,
`**Approach:**` fields. The proposal generator matches a prospect's
industry against the subsection title (case-insensitive prefix) and
surfaces that vertical's content in Solution_Overview.

### 10. Voice Guide

Free-text markdown. Internal reference — not directly rendered into
generated documents but surfaced in the editor's helper text and used
to seed the "Create new template" wizard's starter copy.

### 11. CTA Options

Each subsection title is the CTA label; body is the description / use
case. The proposal generator takes the FIRST CTA and uses it for the
`{{cta}}` token in the cover letter.

### 12. Theme

Flat key:value block — no subsections.

```
## 12. Theme

**Font family:** Inter, system-ui, sans-serif
**Headline case:** sentence
**Accent color:** #1a8754
```

`Headline case` must be one of `sentence | title | upper`. The editor
locks every markdown headline to this case on save. `Accent color`
must be a 6-digit hex; the editor strips non-theme hex literals from
the body on save (defence-in-depth against bypassing the lock).

## Authoring workflow

1. Copy `XELERATE_BRAND_PACK.md` and edit for your firm.
2. As a firm admin, open Settings → Templates → "Brand pack ingest".
3. Paste your pack into the textarea and click "Ingest pack".
4. The parser surfaces structural errors inline (missing sections,
   malformed pricing, invalid theme). Fix and retry.
5. Once ingested, generate a proposal on any of your engagements to
   verify the firm voice is landing.

## Validation reference

The parser returns a structured 400 error with one of these codes:

| Code                | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `EMPTY_PACK`        | The body is empty / whitespace.                                               |
| `MISSING_SECTIONS`  | One or more required sections are absent. `missingSections` lists the IDs.    |
| `MALFORMED_SECTION` | A structured section (8 or 9) is missing a required field. `malformedSection` is the section ID. |
| `INVALID_THEME`     | Section 12 is missing a required key, has an out-of-enum case, or has a non-hex accent. |

## Idempotency + versioning

- `Firm.templateVersion` increments by 1 on every successful update.
- The Phase 49.5 seed script (`pnpm --filter @ofoq/api seed:xelerate-brand-pack`) skips if `templateVersion > 1` to avoid clobbering UI edits.
- Phase 50 will introduce template versioning + rollback. For now,
  the editor saves are destructive — use git or a backup strategy if
  you want history.

## Files of interest

- `XELERATE_BRAND_PACK.md` — canonical reference example.
- `apps/api/src/services/brandPackParser.ts` — parser source.
- `apps/api/src/routes/firmTemplate.ts` — `POST /firm/template-pack` route.
- `apps/api/src/db/seeds/049-xelerate-brand-pack.ts` — auto-seed script.
- `apps/web/src/pages/SettingsTemplatesPage.tsx` — editor UI.
- `apps/web/src/lib/templateThemeLock.ts` — headline-case + hex-strip
  enforcers used on every save.

## Phase 50 — Template token vocabulary

CustomTemplate bodies can include `{{token}}` placeholders that get
substituted against the engagement + firm context when the document
is generated. Tokens that don't exist render as `[missing: name]`
so the author can spot broken references inline. The full
vocabulary lives at
`apps/api/src/services/templateRenderer.ts:TOKEN_CATALOG`.

| Group        | Token                          | Description |
| ------------ | ------------------------------ | --- |
| Firm         | `firm.name`                    | Display name (falls back to legal name). |
| Firm         | `firm.tagline`                 | Tagline from the Brand Pack. |
| Firm         | `firm.contactEmail`            | Firm support email. |
| Firm         | `firm.logoUrl`                 | Firm logo URL. |
| Firm         | `firm.primaryColor`            | Primary brand color (hex). |
| Firm         | `firm.secondaryColor`          | Secondary brand color (hex). |
| Engagement   | `engagement.client`            | Client / company name. |
| Engagement   | `engagement.code`              | Internal engagement code. |
| Engagement   | `engagement.status`            | Current lifecycle stage. |
| Engagement   | `engagement.startDate`         | Kickoff date (YYYY-MM-DD). |
| Engagement   | `engagement.targetGoLive`      | Target go-live (YYYY-MM-DD). |
| Engagement   | `engagement.modules`           | Comma-joined list of licensed modules. |
| Engagement   | `engagement.cutoverStrategy`   | BIG_BANG \| PHASED. |
| People       | `client.lead.name`             | Client-side project lead. |
| People       | `client.sponsor.name`          | Client-side sponsor. |
| People       | `consultant.lead.name`         | Firm-side implementation lead. |
| Decisions    | `decisions.signedOff`          | Bullet list of signed-off decisions. |
| Decisions    | `decisions.pending`            | Bullet list of pending decisions. |
| Risks        | `risks.top5`                   | Markdown table of top 5 risks by score. |
| Action Items | `actionItems.open`             | Bullet list of open action items. |
| System       | `today`                        | Current date (YYYY-MM-DD). |

Empty fields render as the empty string (NOT `[missing]`) so "your
firm has no tagline yet" reads as configuration rather than author
error.

### Worked example — Cutover Runbook template

```markdown
# Cutover Runbook — {{engagement.client}}

Prepared by **{{firm.name}}** on {{today}}.
Project lead: {{consultant.lead.name}}.

## Decisions still open

{{decisions.pending}}

## Top risks for cutover weekend

{{risks.top5}}

## Open action items

{{actionItems.open}}
```

Rendered against a Xelerate / Acme engagement, this produces a
runbook with the actual client name, the signed-off decisions as
a bullet list, a top-5-by-score risk markdown table, and an open-
items bullet list — all without the author having to copy/paste
data manually.

### Round-trip to a downloadable file

The same body, once persisted as a GeneratedDocument, can be
exported to PDF / DOCX / PPTX via
`GET /engagements/:eid/documents/:docId/export?format=pdf|docx|pptx`.
The exporters carry every firm theme token through:

- Cover page in firm.primaryColor with the firm tagline subtitle in
  themeAccentColor.
- H1 → section divider in primaryColor.
- H2 → page heading in primaryColor with themeHeadlineCase
  enforced.
- H3 → sub-heading in themeAccentColor.
- Tables → header row in primaryColor, alternating-row fill.
- Footer → firm displayName · tagline + page-N-of-total in
  secondaryColor.

See `docs/engagement-documents.md` for the full lifecycle (author →
generate → edit → export → delete).
