import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import * as db from '../db/index.js';
import { DATA_TEMPLATES, getTemplate, getTemplatesForVertical } from '../config/dataTemplates.js';
import { getVertical } from '../config/verticals.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import * as xlsx from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const anthropic = new Anthropic();

// ─── AI: Generate / customise template schemas for an engagement ───────────────

async function generateTemplateSchemas(
  engagement: Record<string, unknown>,
  verticalType: string | null,
  profile: Record<string, unknown>,
): Promise<Array<{
  templateId: string;
  name: string;
  category: string;
  description: string;
  sheetName: string;
  fields: unknown[];
  validationRules: string[];
}>> {

  // Start from base templates relevant to this vertical
  const baseTemplates = verticalType
    ? getTemplatesForVertical(verticalType, true)
    : DATA_TEMPLATES.filter((t) => !t.verticalId);

  const verticalDef = verticalType ? getVertical(verticalType) : null;

  const systemPrompt = `You are a NetSuite implementation data migration expert.
Your task is to review base data collection templates and customise them for a specific client engagement.

Rules:
- Return valid JSON only — no markdown, no prose, no code fences
- You may ADD fields relevant to the client's setup (mark new fields with "addedByAI": true)
- You may REMOVE optional fields that don't apply (mark with removed: true instead of deleting, so the user knows)
- You may ADJUST field labels, options, and validation rules to match the client's terminology
- For each template, generate precise, client-specific validation rules
- Keep the templateId, category, and sheetName unchanged
- Return an array of template objects`;

  const userPrompt = `Client engagement: ${engagement.clientName}
Industry vertical: ${verticalDef?.name ?? 'Standard NetSuite'}
${verticalDef?.tag ? `Product: ${verticalDef.tag}` : ''}

Business profile answers (key discovery facts about this client):
${JSON.stringify(profile, null, 2)}

Base templates to customise (return ALL of them, even if unchanged):
${JSON.stringify(baseTemplates.map((t) => ({
  templateId: t.id,
  name: t.name,
  category: t.category,
  description: t.description,
  sheetName: t.sheetName,
  fields: t.fields,
  validationRules: t.validationRules ?? [],
})), null, 2)}

Return a JSON array. Each element must have:
{
  "templateId": "same as input",
  "name": "string",
  "category": "financial|master|transactional|vertical",
  "description": "string — mention any client-specific customisations",
  "sheetName": "string",
  "fields": [ { "key","label","type","required","options"?,"description"?,"example"?,"addedByAI"? } ],
  "validationRules": ["...client-specific rules..."]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const text = (response.content[0] as { type: string; text: string }).text.trim();
    // Strip any accidental code fences
    const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    // Fallback: return base templates as-is
    console.error('AI template generation failed, using base templates:', err);
    return baseTemplates.map((t) => ({
      templateId: t.id,
      name: t.name,
      category: t.category,
      description: t.description ?? '',
      sheetName: t.sheetName,
      fields: t.fields,
      validationRules: t.validationRules ?? [],
    }));
  }
}

// ─── AI: Validate an uploaded Excel file against a template schema ─────────────

async function validateUploadedFile(
  filePath: string,
  schema: Record<string, unknown>,
): Promise<{
  valid: boolean;
  rowCount: number;
  errorCount: number;
  warningCount: number;
  issues: Array<{ row?: number; column?: string; severity: 'ERROR' | 'WARNING'; message: string }>;
  summary: string;
}> {
  // Read Excel file
  let workbook: xlsx.WorkBook;
  try {
    workbook = xlsx.readFile(filePath);
  } catch {
    return {
      valid: false, rowCount: 0, errorCount: 1, warningCount: 0,
      issues: [{ severity: 'ERROR', message: 'Could not read file — ensure it is a valid .xlsx or .csv file' }],
      summary: 'File could not be read.',
    };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null }) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return {
      valid: false, rowCount: 0, errorCount: 1, warningCount: 0,
      issues: [{ severity: 'ERROR', message: 'File appears to be empty — no data rows found' }],
      summary: 'File is empty.',
    };
  }

  // Sample first 100 rows to send to AI (avoid context overflow)
  const sampleRows = rows.slice(0, 100);
  const fields = (schema.fields as Array<{ key: string; label: string; required: boolean; type: string; options?: string[] }>) ?? [];
  const validationRules = (schema.validationRules as string[]) ?? [];

  const systemPrompt = `You are a data quality expert validating client data files for a NetSuite implementation.
Validate the provided data rows against the template schema and validation rules.
Return valid JSON only — no prose, no markdown.`;

  const userPrompt = `Template: ${schema.name}

Template Fields (expected columns):
${JSON.stringify(fields.map((f) => ({ label: f.label, required: f.required, type: f.type, options: f.options })), null, 2)}

Validation Rules:
${validationRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Total rows in file: ${rows.length}
Sample (first ${sampleRows.length} rows):
${JSON.stringify(sampleRows, null, 2)}

Check for:
1. Missing required fields (blank where required: true)
2. Invalid values for 'select' type fields (value not in options list)
3. Invalid date formats
4. Non-numeric values in number/currency fields
5. Duplicate values where uniqueness is expected
6. Cross-reference violations (referenced IDs not found in same file)
7. Business logic violations from the validation rules above

Return JSON:
{
  "valid": boolean,
  "rowCount": ${rows.length},
  "errorCount": number,
  "warningCount": number,
  "issues": [
    { "row": number_or_null, "column": "column_name_or_null", "severity": "ERROR|WARNING", "message": "description" }
  ],
  "summary": "1-2 sentence plain English summary for the consultant"
}

Limit issues to the most important 50. Group similar issues (e.g. '23 rows missing required field Email') rather than listing each row.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const text = (response.content[0] as { type: string; text: string }).text.trim();
    const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const result = JSON.parse(clean);
    result.rowCount = rows.length; // Ensure accurate total
    return result;
  } catch (err) {
    console.error('AI validation failed:', err);
    return {
      valid: false,
      rowCount: rows.length,
      errorCount: 0,
      warningCount: 1,
      issues: [{ severity: 'WARNING', message: 'AI validation could not complete — manual review required' }],
      summary: 'Automated validation encountered an error. Please review the file manually.',
    };
  }
}

// ─── AI: Ask questions to design a custom template ────────────────────────────

async function generateCustomTemplate(
  engagement: Record<string, unknown>,
  userRequirements: string,
  existingTemplateIds: string[],
): Promise<{
  templateId: string;
  name: string;
  category: string;
  description: string;
  sheetName: string;
  fields: unknown[];
  validationRules: string[];
  questions?: Array<{ key: string; question: string; type: 'text' | 'select' | 'boolean'; options?: string[] }>;
  needsMoreInfo?: boolean;
}> {
  const systemPrompt = `You are a NetSuite data migration architect.
Design custom Excel data collection templates based on client requirements.
Return valid JSON only.`;

  const userPrompt = `Client: ${engagement.clientName}
Existing template IDs (don't duplicate these): ${existingTemplateIds.join(', ')}

Consultant's requirement:
"${userRequirements}"

If the requirement is clear enough to design a complete template, return:
{
  "needsMoreInfo": false,
  "templateId": "snake_case_unique_id",
  "name": "Human readable template name",
  "category": "master|financial|transactional|vertical",
  "description": "What this template collects and why",
  "sheetName": "Excel sheet tab name",
  "fields": [
    { "key": "field_key", "label": "Column Header in Excel", "type": "text|number|date|email|select|boolean|currency", "required": true/false, "options": ["opt1","opt2"]?, "description": "help text"?, "example": "example value"? }
  ],
  "validationRules": ["plain-English validation rule 1", "rule 2", ...]
}

If you need more information before designing the template, return:
{
  "needsMoreInfo": true,
  "questions": [
    { "key": "q1", "question": "What should we ask?", "type": "text|select|boolean", "options": ["opt1","opt2"]? }
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });

  const text = (response.content[0] as { type: string; text: string }).text.trim();
  const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(clean);
}

// ─── Route registrations ──────────────────────────────────────────────────────

export async function dataCollectionRoutes(fastify: FastifyInstance) {

  // GET /engagements/:id/data-templates/schemas — AI-generated schemas for this engagement
  fastify.get('/engagements/:id/data-templates/schemas', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const schemas = await db.listDataTemplateSchemas(id);
    return reply.send({ data: schemas });
  });

  // POST /engagements/:id/data-templates/generate — AI generates/customises templates
  fastify.post('/engagements/:id/data-templates/generate', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rawEngagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!rawEngagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagement = rawEngagement as Record<string, unknown>;
    const profile = await db.getProfile(id);
    const answers = (profile as Record<string, unknown>)?.answers ?? {};

    const verticalType = (engagement.verticalType as string | null) ?? null;

    // AI generates schemas
    const schemas = await generateTemplateSchemas(engagement, verticalType, answers as Record<string, unknown>);

    // Upsert each generated schema to DB
    for (const schema of schemas) {
      await db.upsertDataTemplateSchema(id, schema);
    }

    // Auto-create data collection items for each schema (if not already present)
    const existingItems = await db.listDataCollectionItems(id);
    const existingTemplateIds = new Set(existingItems.map((item: Record<string, unknown>) => item.templateId as string));

    const allSchemas = await db.listDataTemplateSchemas(id);
    for (const schema of allSchemas as Array<Record<string, unknown>>) {
      if (!existingTemplateIds.has(schema.templateId as string)) {
        await db.createDataCollectionItem(id, {
          templateId: schema.templateId as string,
          templateSchemaId: schema.id as string,
          name: schema.name as string,
          category: schema.category as string,
        });
      }
    }

    await db.logActivity(id, request.jwtUser.firmId, 'DATA_TEMPLATES_GENERATED', `AI generated ${schemas.length} data collection templates`);

    const updatedItems = await db.listDataCollectionItems(id);
    return reply.send({ data: { schemas, items: updatedItems } });
  });

  // POST /engagements/:id/data-templates/custom — AI designs a brand-new template from description
  fastify.post('/engagements/:id/data-templates/custom', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { requirements: string; answers?: Record<string, string> };

    const rawEngagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!rawEngagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const existing = await db.listDataTemplateSchemas(id);
    const existingIds = (existing as Array<Record<string, unknown>>).map((s) => s.templateId as string);

    let requirements = body.requirements;
    // If answers to prior questions are provided, fold them into the requirements string
    if (body.answers && Object.keys(body.answers).length > 0) {
      requirements += '\n\nAdditional clarifications:\n' +
        Object.entries(body.answers).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    }

    const result = await generateCustomTemplate(rawEngagement as Record<string, unknown>, requirements, existingIds);

    if (result.needsMoreInfo) {
      return reply.send({ data: { needsMoreInfo: true, questions: result.questions } });
    }

    // Save the schema
    await db.upsertDataTemplateSchema(id, {
      templateId: result.templateId,
      name: result.name,
      category: result.category,
      description: result.description,
      sheetName: result.sheetName,
      fields: result.fields,
      validationRules: result.validationRules,
      generatedBy: 'AI_CUSTOM',
    });

    const allSchemas = await db.listDataTemplateSchemas(id);
    const schema = (allSchemas as Array<Record<string, unknown>>).find((s) => s.templateId === result.templateId);

    // Create collection item
    await db.createDataCollectionItem(id, {
      templateId: result.templateId,
      templateSchemaId: schema?.id as string | undefined,
      name: result.name,
      category: result.category,
    });

    await db.logActivity(id, request.jwtUser.firmId, 'CUSTOM_TEMPLATE_CREATED', `Custom template "${result.name}" created via AI`);

    return reply.send({ data: { needsMoreInfo: false, schema: result } });
  });

  // DELETE /engagements/:id/data-templates/schemas/:schemaId
  fastify.delete('/engagements/:id/data-templates/schemas/:schemaId', { onRequest: authenticate }, async (request, reply) => {
    const { id, schemaId } = request.params as { id: string; schemaId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    await db.deleteDataTemplateSchema(schemaId);
    return reply.code(204).send();
  });

  // ─── Collection Items ─────────────────────────────────────────────────────

  // GET /engagements/:id/data-collection
  fastify.get('/engagements/:id/data-collection', { onRequest: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const items = await db.listDataCollectionItems(id);
    return reply.send({ data: items });
  });

  // PATCH /engagements/:id/data-collection/:itemId
  fastify.patch('/engagements/:id/data-collection/:itemId', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const body = request.body as Record<string, string>;
    const updated = await db.updateDataCollectionItem(itemId, body);
    return reply.send({ data: updated });
  });

  // DELETE /engagements/:id/data-collection/:itemId
  fastify.delete('/engagements/:id/data-collection/:itemId', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    await db.deleteDataCollectionItem(itemId);
    return reply.code(204).send();
  });

  // ─── Excel Template Download ──────────────────────────────────────────────

  // GET /engagements/:id/data-collection/:itemId/download — generate & download Excel template
  fastify.get('/engagements/:id/data-collection/:itemId/download', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const items = await db.listDataCollectionItems(id);
    const item = (items as Array<Record<string, unknown>>).find((i) => i.id === itemId);
    if (!item) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const fields = (item.fields as Array<{ key: string; label: string; required: boolean; description?: string; example?: string; options?: string[] }>) ?? [];

    // Build Excel workbook
    const wb = xlsx.utils.book_new();

    // ── Instructions sheet ──
    const instructionRows = [
      ['OFOQ NSIX — Data Collection Template'],
      [''],
      [`Template: ${item.name}`],
      [`Engagement: ${(engagement as Record<string, unknown>).clientName}`],
      [`Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`],
      [''],
      ['INSTRUCTIONS:'],
      ['1. Fill in the Data tab below — do not rename or delete columns'],
      ['2. Columns marked * are mandatory'],
      ['3. Return the completed file to your OFOQ consultant'],
      [''],
      ['COLUMN GUIDE:'],
      ['Column', 'Required?', 'Description', 'Example'],
      ...fields.map((f) => [
        `${f.label}${f.required ? ' *' : ''}`,
        f.required ? 'Yes' : 'Optional',
        f.description ?? (f.options ? `Allowed values: ${f.options.join(', ')}` : ''),
        f.example ?? '',
      ]),
    ];
    const ws_instructions = xlsx.utils.aoa_to_sheet(instructionRows);
    ws_instructions['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 50 }, { wch: 30 }];
    xlsx.utils.book_append_sheet(wb, ws_instructions, 'Instructions');

    // ── Data sheet ──
    const headers = fields.map((f) => `${f.label}${f.required ? ' *' : ''}`);
    const exampleRow = fields.map((f) => f.example ?? '');
    const ws_data = xlsx.utils.aoa_to_sheet([headers, exampleRow]);
    ws_data['!cols'] = fields.map(() => ({ wch: 25 }));
    xlsx.utils.book_append_sheet(wb, ws_data, item.sheetName as string ?? 'Data');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `${String(item.name).replace(/[^a-zA-Z0-9]/g, '_')}_Template.xlsx`;

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(buffer);
  });

  // ─── File Upload ──────────────────────────────────────────────────────────

  // POST /engagements/:id/data-collection/:itemId/upload — upload filled template
  fastify.post('/engagements/:id/data-collection/:itemId/upload', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: { code: 'NO_FILE' } });

    const ext = path.extname(data.filename);
    const uniqueName = `${id}_${itemId}_${Date.now()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);

    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);

    const fileRecord = await db.createDataFile({
      engagementId: id,
      dataCollectionItemId: itemId,
      filename: uniqueName,
      originalName: data.filename,
      mimeType: data.mimetype,
      sizeBytes: buffer.length,
      uploadedBy: request.jwtUser.name ?? request.jwtUser.email,
    });

    // Update item status to RECEIVED
    await db.updateDataCollectionItem(itemId, {
      status: 'RECEIVED',
      receivedAt: new Date().toISOString(),
    });

    await db.logActivity(id, request.jwtUser.firmId, 'DATA_FILE_UPLOADED', `File uploaded: ${data.filename}`);

    return reply.code(201).send({ data: fileRecord });
  });

  // POST /engagements/:id/data-collection/:itemId/files/:fileId/validate — AI validates a file
  fastify.post('/engagements/:id/data-collection/:itemId/files/:fileId/validate', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId, fileId } = request.params as { id: string; itemId: string; fileId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    // Load file info
    const allFiles = await db.listDataFiles(itemId);
    const fileRecord = (allFiles as Array<Record<string, unknown>>).find((f) => f.id === fileId);
    if (!fileRecord) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    // Load template schema
    const items = await db.listDataCollectionItems(id);
    const item = (items as Array<Record<string, unknown>>).find((i) => i.id === itemId);
    if (!item) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const filePath = path.join(UPLOADS_DIR, fileRecord.filename as string);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: { code: 'FILE_NOT_FOUND', message: 'Uploaded file not found on disk' } });
    }

    // Mark as VALIDATING
    await db.updateDataFileValidation(fileId, { validationStatus: 'VALIDATING' });

    // Run AI validation
    const result = await validateUploadedFile(filePath, item as Record<string, unknown>);

    const updated = await db.updateDataFileValidation(fileId, {
      validationStatus: result.valid ? 'VALID' : 'INVALID',
      validationResult: result,
      rowCount: result.rowCount,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
    });

    // Update item status
    if (result.valid) {
      await db.updateDataCollectionItem(itemId, { status: 'VALIDATED', validatedAt: new Date().toISOString() });
    }

    await db.logActivity(id, request.jwtUser.firmId, 'DATA_FILE_VALIDATED',
      `Validation ${result.valid ? 'passed' : 'failed'}: ${result.errorCount} errors, ${result.warningCount} warnings`);

    return reply.send({ data: updated });
  });

  // GET /engagements/:id/data-collection/:itemId/files — list uploaded files
  fastify.get('/engagements/:id/data-collection/:itemId/files', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const files = await db.listDataFiles(itemId);
    return reply.send({ data: files });
  });

  // DELETE /engagements/:id/data-collection/:itemId/files/:fileId
  fastify.delete('/engagements/:id/data-collection/:itemId/files/:fileId', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId, fileId } = request.params as { id: string; itemId: string; fileId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const fileRecord = await db.deleteDataFile(fileId);
    if (fileRecord) {
      const filePath = path.join(UPLOADS_DIR, (fileRecord as Record<string, unknown>).filename as string);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    return reply.code(204).send();
  });

  // PATCH /engagements/:id/data-collection/:itemId/mark-uploaded — mark as uploaded to NetSuite
  fastify.patch('/engagements/:id/data-collection/:itemId/mark-uploaded', { onRequest: authenticate }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const engagement = await db.findEngagementByIdAndFirmId(id, request.jwtUser.firmId);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const updated = await db.updateDataCollectionItem(itemId, {
      status: 'UPLOADED',
      uploadedAt: new Date().toISOString(),
    });
    await db.logActivity(id, request.jwtUser.firmId, 'DATA_UPLOADED_TO_NS', `Data marked as uploaded to NetSuite`);
    return reply.send({ data: updated });
  });

  // ─── Portal: client-side file upload (no auth — uses portal token) ─────────

  fastify.post('/portal/:token/data-collection/:itemId/upload', async (request, reply) => {
    const { token, itemId } = request.params as { token: string; itemId: string };
    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagementId = (engagement as Record<string, unknown>).id as string;
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: { code: 'NO_FILE' } });

    const ext = path.extname(data.filename);
    const uniqueName = `${engagementId}_${itemId}_client_${Date.now()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);
    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);

    const fileRecord = await db.createDataFile({
      engagementId,
      dataCollectionItemId: itemId,
      filename: uniqueName,
      originalName: data.filename,
      mimeType: data.mimetype,
      sizeBytes: buffer.length,
      uploadedBy: 'Client',
    });

    await db.updateDataCollectionItem(itemId, {
      status: 'RECEIVED',
      receivedAt: new Date().toISOString(),
    });

    return reply.code(201).send({ data: fileRecord });
  });

  // GET /portal/:token/data-collection — client sees their assigned templates
  fastify.get('/portal/:token/data-collection', async (request, reply) => {
    const { token } = request.params as { token: string };
    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagementId = (engagement as Record<string, unknown>).id as string;
    const items = await db.listDataCollectionItems(engagementId);
    // Only return items that are assigned (sent to client)
    const clientItems = (items as Array<Record<string, unknown>>).filter(
      (i) => ['SENT', 'RECEIVED', 'VALIDATED', 'UPLOADED'].includes(i.status as string)
    );
    return reply.send({ data: clientItems });
  });

  // GET /portal/:token/data-collection/:itemId/download
  fastify.get('/portal/:token/data-collection/:itemId/download', async (request, reply) => {
    const { token, itemId } = request.params as { token: string; itemId: string };
    const engagement = await db.findEngagementByPortalToken(token);
    if (!engagement) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const engagementId = (engagement as Record<string, unknown>).id as string;
    const items = await db.listDataCollectionItems(engagementId);
    const item = (items as Array<Record<string, unknown>>).find((i) => i.id === itemId);
    if (!item) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const fields = (item.fields as Array<{ key: string; label: string; required: boolean; description?: string; example?: string }>) ?? [];

    const wb = xlsx.utils.book_new();
    const headers = fields.map((f) => `${f.label}${f.required ? ' *' : ''}`);
    const exampleRow = fields.map((f) => f.example ?? '');
    const ws = xlsx.utils.aoa_to_sheet([headers, exampleRow]);
    ws['!cols'] = fields.map(() => ({ wch: 25 }));
    xlsx.utils.book_append_sheet(wb, ws, item.sheetName as string ?? 'Data');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `${String(item.name).replace(/[^a-zA-Z0-9]/g, '_')}_Template.xlsx`;

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(buffer);
  });
}
