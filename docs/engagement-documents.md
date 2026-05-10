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
1. Open `/engagements/:id/documents`.
2. Click **Generate from template**.
3. Step 1 — pick a CustomTemplate from the firm's library.
4. Step 2 — optionally override the document name (default:
   `"{{template.name}} — YYYY-MM-DD"`).
5. Step 3 — preview the rendered body; if the template referenced
   any unknown tokens, they appear as a warning at the top of the
   preview pane with the literal `[missing: token-name]` markers
   you'll see in the body.
6. Click **Done** to close. The document is already persisted.

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

## Out of scope (Phase 51+)

- Soft-archive on document delete (currently hard-delete).
- Document versioning / history with rollback.
- Cross-engagement "see also" linking between documents.
- Real-time collaborative editing.
- Conditional rendering in templates (`{{#if engagement.modules contains 'Manufacturing'}}`).
- Loops in templates (`{{#each risks}}…{{/each}}`).
- LaTeX / HTML export.
- Email attachment workflow ("send this document to client").
