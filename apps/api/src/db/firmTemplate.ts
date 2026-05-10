/**
 * Phase 49.1 — Firm template / brand-pack fields DB layer.
 *
 * Extends the firm row with the rich content the proposal generator +
 * template editor consume. All fields are NULL-able; generators fall
 * back to platform defaults when absent. Structured fields are JSON
 * blobs stored as TEXT — parsed defensively so a corrupt write never
 * 500s the read path.
 */
import { getDb } from './index.js';

export interface MethodologyStep {
  step: number;
  title: string;
  body: string;
}

export interface RoadmapPhase {
  phase: number;
  title: string;
  body: string;
}

export interface ProposalSection {
  section: number;
  title: string;
  bullets: string[];
}

export interface PricingItem {
  sku: string;
  description: string;
  annual: number;
}

export interface IndustryVertical {
  name: string;
  outcome: string;
  strategicContext: string;
  approach: string;
}

export interface CtaOption {
  label: string;
  description: string;
}

export type HeadlineCase = 'sentence' | 'title' | 'upper';

export const HEADLINE_CASES: ReadonlyArray<HeadlineCase> = ['sentence', 'title', 'upper'];

export function isHeadlineCase(s: string): s is HeadlineCase {
  return (HEADLINE_CASES as readonly string[]).includes(s);
}

export interface FirmTemplate {
  // Core identity
  tagline: string | null;
  subtitle: string | null;
  companyDescription: string | null;
  whyUs: string | null;

  // Structured content — parsed JSON
  methodology: MethodologyStep[];
  roadmap: RoadmapPhase[];
  proposalStructure: ProposalSection[];
  pricingTemplate: PricingItem[];
  industryVerticals: IndustryVertical[];
  ctaOptions: CtaOption[];

  // Voice + theme
  voiceGuide: string | null;
  themeFontFamily: string | null;
  themeHeadlineCase: HeadlineCase | null;
  themeAccentColor: string | null;

  templateVersion: number;
}

export const EMPTY_FIRM_TEMPLATE: FirmTemplate = {
  tagline: null,
  subtitle: null,
  companyDescription: null,
  whyUs: null,
  methodology: [],
  roadmap: [],
  proposalStructure: [],
  pricingTemplate: [],
  industryVerticals: [],
  ctaOptions: [],
  voiceGuide: null,
  themeFontFamily: null,
  themeHeadlineCase: null,
  themeAccentColor: null,
  templateVersion: 1,
};

type Row = Record<string, unknown>;

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function rowToTemplate(row: Row): FirmTemplate {
  const headlineCaseRaw = (row.themeHeadlineCase as string | null) ?? null;
  return {
    tagline: (row.tagline as string | null) ?? null,
    subtitle: (row.subtitle as string | null) ?? null,
    companyDescription: (row.companyDescription as string | null) ?? null,
    whyUs: (row.whyUs as string | null) ?? null,
    methodology: parseJsonArray<MethodologyStep>(row.methodology),
    roadmap: parseJsonArray<RoadmapPhase>(row.roadmap),
    proposalStructure: parseJsonArray<ProposalSection>(row.proposalStructure),
    pricingTemplate: parseJsonArray<PricingItem>(row.pricingTemplate),
    industryVerticals: parseJsonArray<IndustryVertical>(row.industryVerticals),
    ctaOptions: parseJsonArray<CtaOption>(row.ctaOptions),
    voiceGuide: (row.voiceGuide as string | null) ?? null,
    themeFontFamily: (row.themeFontFamily as string | null) ?? null,
    themeHeadlineCase:
      headlineCaseRaw && isHeadlineCase(headlineCaseRaw) ? headlineCaseRaw : null,
    themeAccentColor: (row.themeAccentColor as string | null) ?? null,
    templateVersion: Number((row.templateVersion as number | null) ?? 1),
  };
}

/**
 * Read the firm's template fields. Returns EMPTY_FIRM_TEMPLATE if the
 * firm row exists but no template fields have been populated (still
 * a valid response — the proposal generator falls back to defaults).
 * Returns null when the firm row itself doesn't exist.
 */
export async function getFirmTemplate(firmId: string): Promise<FirmTemplate | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT
            tagline, subtitle, companyDescription, whyUs,
            methodology, roadmap, proposalStructure, pricingTemplate,
            industryVerticals, ctaOptions, voiceGuide,
            themeFontFamily, themeHeadlineCase, themeAccentColor,
            templateVersion
          FROM Firm WHERE id = ?`,
    args: [firmId],
  });
  if (!r.rows[0]) return null;
  return rowToTemplate(r.rows[0] as Row);
}

/**
 * Upsert template fields on a firm row. Any field set to undefined is
 * left untouched; explicit null clears a field back to "use platform
 * default". Structured fields accept the typed shape and JSON.stringify
 * before write. Always bumps templateVersion by 1 so seeds + UI saves
 * stay idempotent against the version gate.
 */
export interface FirmTemplatePatch {
  tagline?: string | null;
  subtitle?: string | null;
  companyDescription?: string | null;
  whyUs?: string | null;
  methodology?: MethodologyStep[];
  roadmap?: RoadmapPhase[];
  proposalStructure?: ProposalSection[];
  pricingTemplate?: PricingItem[];
  industryVerticals?: IndustryVertical[];
  ctaOptions?: CtaOption[];
  voiceGuide?: string | null;
  themeFontFamily?: string | null;
  themeHeadlineCase?: HeadlineCase | null;
  themeAccentColor?: string | null;
}

export async function updateFirmTemplate(
  firmId: string,
  patch: FirmTemplatePatch,
): Promise<FirmTemplate | null> {
  const db = getDb();
  const sets: string[] = [];
  const args: (string | null)[] = [];

  function setText(col: keyof FirmTemplatePatch, v: string | null | undefined): void {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    args.push(v);
  }
  function setJson(col: keyof FirmTemplatePatch, v: unknown[] | undefined): void {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    args.push(JSON.stringify(v));
  }

  setText('tagline', patch.tagline);
  setText('subtitle', patch.subtitle);
  setText('companyDescription', patch.companyDescription);
  setText('whyUs', patch.whyUs);
  setJson('methodology', patch.methodology);
  setJson('roadmap', patch.roadmap);
  setJson('proposalStructure', patch.proposalStructure);
  setJson('pricingTemplate', patch.pricingTemplate);
  setJson('industryVerticals', patch.industryVerticals);
  setJson('ctaOptions', patch.ctaOptions);
  setText('voiceGuide', patch.voiceGuide);
  setText('themeFontFamily', patch.themeFontFamily);
  // themeHeadlineCase is a typed enum; setText() preserves the
  // undefined-vs-null distinction so a partial patch that omits this
  // field doesn't overwrite the stored value with null.
  setText('themeHeadlineCase', patch.themeHeadlineCase);
  setText('themeAccentColor', patch.themeAccentColor);

  if (sets.length === 0) {
    // No-op write — return the current state without bumping version.
    return getFirmTemplate(firmId);
  }

  // Bump templateVersion atomically with the patch so a concurrent
  // read sees the new version once any field landed.
  sets.push('templateVersion = COALESCE(templateVersion, 1) + 1');

  args.push(firmId);
  await db.execute({
    sql: `UPDATE Firm SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });
  return getFirmTemplate(firmId);
}
