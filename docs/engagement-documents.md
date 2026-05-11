# Engagement Documents — Lifecycle Guide

This doc covers the Phase 50 templates-to-documents pipeline:
how to author a CustomTemplate, generate a document from it
against an engagement, edit the rendered body, export to PDF /
DOCX / PPTX, and delete.

## Concepts

- **CustomTemplate** — a markdown body authored at Settings →
  Templates → Custom templates. May contain `{{token}}` placeholders
  from the [Phase 50 token vocabulary](firm-templates.md#phase-50--template-token-vocabulary).
- **GeneratedDocument** — a rendered markdown snapshot persisted
  against an engagement. The canonical storage form is markdown;
  exporters render to other formats on demand.
- **Token substitution** — happens once, at generation time. The
  GeneratedDocument's body is post-substitution, so editing later
  doesn't re-run tokens (no live data leaks).

## Lifecycle

### 1. Author a template

1. Sign in as a firm admin and go to **Settings → Templates**.
2. Scroll to **Custom templates** and click **New custom template**.
3. Name it (e.g. "Cutover Runbook"), pick a type (CUSTOM unless
   it's an override for a built-in generator), and write the body
   in markdown.
4. Use the **Tokens** panel on the right to insert `{{token}}`
   placeholders — click a chip to copy `{{firm.name}}` (or
   whichever) to your clipboard, then paste into the textarea.
5. Save.

The editor enforces the firm's theme on every save:
- Markdown headings (lines starting with `#`) get cased to
  `themeHeadlineCase` (sentence / title / upper).
- Hex literals (`#RRGGBB`) get replaced with the firm's
  `themeAccentColor` so a stray non-brand color can't sneak into
  the body.

### 2. Generate a document from a template

Two ways:

**From the engagement page:**
1. Open the engagement wizard and click **Documents** in the
   left sidebar (sits below "Activity Feed", above
   "Customizations"). The link goes to
   `/engagements/:id/documents`.
2. Click **Generate from template**.
3. Step 1 — pick a CustomTemplate from the firm's library.
4. Step 2 — optionally override the document name (default:
   `"{{template.name}} — YYYY-MM-DD"`).
5. Step 3 — preview the rendered body; if the template referenced
   any unknown tokens, they appear as a warning at the top of the
   preview pane with the literal `[missing: token-name]` markers
   you'll see in the body.
6. Click **Done** to close. The document is already persisted.

**Shortcut (Phase 50.9.4):** the sidebar also has a **Generate
Document** entry directly below Documents. Clicking it routes to
`/engagements/:id/documents?action=generate` which auto-opens the
template-picker modal on mount — three clicks total from sidebar to
generated doc instead of six. The `?action=generate` param is
stripped from the URL after the modal opens so a refresh doesn't
re-trigger it.

**Via API:**
```http
POST /api/v1/engagements/:engagementId/documents/from-template/:templateId
Content-Type: application/json

{ "name": "Cutover Runbook v1" }
```

Response:
```json
{
  "data": {
    "document": { "id": "...", "name": "...", "body": "...", ... },
    "missingTokens": ["nonexistent.token"]
  }
}
```

### 3. View / edit the rendered body

The Documents page lists every GeneratedDocument newest-first.
PATCH the row to rename or re-edit the body:

```http
PATCH /api/v1/engagements/:engagementId/documents/:docId

{ "name": "Cutover Runbook v2", "body": "# updated markdown\n..." }
```

Edits don't re-run token substitution — the body is whatever you
wrote, verbatim.

### 4. Export to PDF / DOCX / PPTX

Each format comes from a dedicated exporter that pulls firm theme
tokens for the layout:

```http
GET /api/v1/engagements/:engagementId/documents/:docId/export?format=pdf
GET /api/v1/engagements/:engagementId/documents/:docId/export?format=docx
GET /api/v1/engagements/:engagementId/documents/:docId/export?format=pptx
```

Response headers:
- `Content-Type` — `application/pdf` /
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document` /
  `application/vnd.openxmlformats-officedocument.presentationml.presentation`.
- `Content-Disposition` — `attachment; filename="..."`
  with RFC 5987 `filename*=UTF-8''...` for non-ASCII names.

The UI's per-row download dropdown links to these URLs directly —
the browser handles auth via the existing cookie and triggers
save-as.

### 5. Delete

```http
DELETE /api/v1/engagements/:engagementId/documents/:docId
```

Permanent. Phase 51 will add soft-archive + version history; for
now, regenerate from the source template if you delete by
mistake.

## Cross-firm safety

Every read / write checks that the document's `firmId` matches the
caller's JWT and that the document's `engagementId` matches the
URL. Cross-firm requests return 404, not 403, so we don't leak
"this resource exists for someone else" info.

## What happens when a template is deleted

Templates use `ON DELETE SET NULL` on the FK from
`GeneratedDocument.sourceTemplateId`. Deleting a CustomTemplate
does NOT cascade-wipe documents that were generated from it — the
documents stay with `sourceTemplateId = NULL`. The audit trail of
"who generated what, when" is preserved.

What DOES cascade: deleting an Engagement deletes every
GeneratedDocument on it (FK `ON DELETE CASCADE`). Documents are
scoped to their engagement.

## Files of interest

- `apps/api/src/db/generatedDocument.ts` — DB layer + helpers.
- `apps/api/src/services/templateRenderer.ts` — token substitution
  engine.
- `apps/api/src/services/exporters/markdownToPdf.ts` — PDF exporter.
- `apps/api/src/services/exporters/markdownToDocx.ts` — DOCX exporter.
- `apps/api/src/services/exporters/markdownToPptx.ts` — PPTX exporter.
- `apps/api/src/routes/generatedDocuments.ts` — HTTP surface.
- `apps/web/src/components/GenerateFromTemplateModal.tsx` — picker
  modal.
- `apps/web/src/components/EngagementDocumentsList.tsx` — list
  with per-row download dropdown.
- `apps/web/src/pages/EngagementDocumentsPage.tsx` —
  `/engagements/:id/documents` route.

## Troubleshooting (Phase 50.9)

The Phase 50.9 hotfix sprint addressed three real bugs that all
blocked customer-facing PDF exports. These troubleshooting steps
explain how to diagnose them if they recur in a future regression.

### Generated PDF shows wrong colors (platform purple, not firm brand)

**Symptom:** the cover page, H1 dividers, footer, and headings render
in ERPLaunch purple (`#4f46e5`/`#818cf8`) regardless of the firm's
configured brand colors.

**Root cause (Phase 50.9.1):** `getFirmBranding` returns the platform
purple as a concrete fallback when `Firm.primaryColor` is NULL.
Brand Pack ingest sets `Firm.themeAccentColor` but never
`Firm.primaryColor`, so a firm that only ingested a Brand Pack (no
Settings → Branding override) sees the platform purple slip through.

**Fix paths:**
1. The route layer now uses `getFirmBrandingForExport` which returns
   the raw nullable column values.
2. The exporters use a shared `resolveExportColors` helper with the
   fallback chain `primary ← Firm.primaryColor → Brand Pack
   themeAccentColor → PLATFORM_PRIMARY`.

**If colors are wrong again:** check whether `Firm.primaryColor` is
NULL on the prod row AND whether `Firm.themeAccentColor` is also
NULL. If both are NULL, the firm needs to either set Settings →
Branding colors OR ingest a Brand Pack with a §12 Theme accent
color. If only `primaryColor` is NULL but accent is set, generate
a fresh PDF and confirm the accent color is rendering — if not, the
resolver may have regressed.

### Generated PDF has overlapping text lines

**Symptom:** cover-letter paragraphs render on top of each other,
bullet lists collapse onto a single y-coordinate, headings sit on
top of body text. File is unreadable.

**Root cause (Phase 50.9.2):** the PDF exporter's `renderInline`
terminated with `doc.text('', { continued: false })`. The
empty-string terminator doesn't reliably advance pdfkit's cursor;
combined with tight `moveDown(0.5)` paragraph spacing and bullets
emitted via a `continued:true` chain that never properly closed,
adjacent blocks could share a baseline.

**Fix paths:**
1. Inline tokens are now flattened into per-style `InlineRun` chunks
   and emitted with the LAST run carrying `continued: false` + real
   text (so pdfkit's wrapping logic flushes the line).
2. Bullet glyphs are prepended to the same paragraph as the body
   content — `list_item_open` is now a no-op.
3. `doc.lineGap(2)` on the document plus bumped `moveDown` values
   (`0.8` after paragraphs, `0.6` after headings, `1.2` before H2,
   `0.9` before H3) give breathing room.

**If overlap returns:** the regression test
`apps/api/tests/services/exporters/markdownToPdf.overlap.test.ts`
should catch it — it uses pdfjs-dist to extract per-item baselines
and asserts no bucket holds >5 items at the same y. File a P0 if
that test ever goes green but the rendered PDF still shows overlap;
that means the assertion's tolerance has drifted.

### Generated content shows the old placeholder copy

**Symptom:** Xelerate firm voice still reads "Outcome-first ERP
delivery for ambitious mid-market operators" instead of the real
"Business Enabling Technologies — your trusted Oracle NetSuite
partner across MENA." Even after a deploy.

**Root cause (Phase 50.9.3):** the Phase 50.8 content-hash seed
function existed but nothing invoked it — the seed lived behind a
manual `pnpm seed:xelerate-brand-pack` CLI script with no deploy
hook. The placeholder content never got overwritten.

**Fix paths:**
1. `initDb()` now auto-runs `seedXelerateBrandPack()` after the
   APP_ADMIN backfill. Safe because the hash-based idempotency
   makes re-runs a true no-op.
2. The seed now reads back the persisted tagline after write and
   asserts it contains the canonical Xelerate marker — fails loudly
   instead of silently leaving the placeholder.
3. Admin force-reseed endpoint:
   `POST /api/v1/admin/firm/:firmId/reseed-brand-pack`
   clears `brandPackContentHash` and re-runs the seed. Use when ops
   need to drop a hand-edit without redeploying.

**If the placeholder returns:** call the admin endpoint as an
APP_ADMIN on the affected firm. If that returns `PARSE_ERROR`,
inspect the seed-file content for malformed sections (`MISSING_SECTIONS`
/ `MALFORMED_SECTION` / `INVALID_THEME` codes). If it returns
`SEEDED` but the firm-template GET still shows the placeholder,
check that the matching `slug` in the seed lookup is still
`'xelerate'` and not a renamed alternative.

## Out of scope (Phase 51+)

- Soft-archive on document delete (currently hard-delete).
- Document versioning / history with rollback.
- Cross-engagement "see also" linking between documents.
- Real-time collaborative editing.
- Conditional rendering in templates (`{{#if engagement.modules contains 'Manufacturing'}}`).
- Loops in templates (`{{#each risks}}…{{/each}}`).
- LaTeX / HTML export.
- Email attachment workflow ("send this document to client").
