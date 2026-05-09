/**
 * Phase 46.8.6 — Firm sales-template DB layer.
 *
 * Stores firm-level customisations for the proposal/SOW generators:
 *   - per-module pricing (JSON map: moduleId → annual per-user price)
 *   - default per-user price (fallback for modules not in the map)
 *   - geography multipliers (JSON map: country code → multiplier)
 *   - "Why Us" markdown template
 *   - Cover letter markdown template (supports {{decisionMaker}},
 *     {{firmName}}, {{adaptorName}}, {{topPain}}, {{goLiveLabel}},
 *     {{validUntil}}, {{preparedBy}}, {{contactLine}})
 *   - SOW Terms & Conditions markdown template
 *
 * The proposalGenerator + sowGenerator already accept these as
 * optional inputs and fall back to safe defaults when null. This
 * module persists/reads them; the routes wire them in.
 */
import { getDb } from './index.js';

export interface FirmSalesTemplates {
  perModulePricing: Record<string, number>;
  defaultPerUserPrice: number | null;
  geographyMultipliers: Record<string, number>;
  whyUsTemplate: string | null;
  coverLetterTemplate: string | null;
  sowTermsTemplate: string | null;
}

export const SALES_TEMPLATE_DEFAULTS: FirmSalesTemplates = {
  perModulePricing: {},
  defaultPerUserPrice: null,
  geographyMultipliers: {},
  whyUsTemplate: null,
  coverLetterTemplate: null,
  sowTermsTemplate: null,
};

type Row = Record<string, unknown>;

function parseJsonRecord(v: unknown): Record<string, number> {
  if (typeof v !== 'string' || v.length === 0) return {};
  try {
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Coerce values to finite numbers; drop anything else.
      const out: Record<string, number> = {};
      for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export async function getFirmSalesTemplates(firmId: string): Promise<FirmSalesTemplates> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT salesPerModulePricingJson, salesDefaultPerUserPrice,
                 salesGeographyMultipliersJson, salesWhyUsTemplate,
                 salesCoverLetterTemplate, salesSowTermsTemplate
          FROM Firm WHERE id = ?`,
    args: [firmId],
  });
  const row = (r.rows[0] as Row) ?? null;
  if (!row) return { ...SALES_TEMPLATE_DEFAULTS };
  const dpup = row.salesDefaultPerUserPrice;
  return {
    perModulePricing: parseJsonRecord(row.salesPerModulePricingJson),
    defaultPerUserPrice:
      typeof dpup === 'number' && Number.isFinite(dpup) ? dpup : null,
    geographyMultipliers: parseJsonRecord(row.salesGeographyMultipliersJson),
    whyUsTemplate: (row.salesWhyUsTemplate as string | null) ?? null,
    coverLetterTemplate: (row.salesCoverLetterTemplate as string | null) ?? null,
    sowTermsTemplate: (row.salesSowTermsTemplate as string | null) ?? null,
  };
}

export async function updateFirmSalesTemplates(
  firmId: string,
  patch: Partial<{
    perModulePricing: Record<string, number>;
    defaultPerUserPrice: number | null;
    geographyMultipliers: Record<string, number>;
    whyUsTemplate: string | null;
    coverLetterTemplate: string | null;
    sowTermsTemplate: string | null;
  }>,
): Promise<FirmSalesTemplates> {
  const db = getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.perModulePricing !== undefined) {
    sets.push('salesPerModulePricingJson = ?');
    args.push(JSON.stringify(patch.perModulePricing));
  }
  if (patch.defaultPerUserPrice !== undefined) {
    sets.push('salesDefaultPerUserPrice = ?');
    args.push(patch.defaultPerUserPrice);
  }
  if (patch.geographyMultipliers !== undefined) {
    sets.push('salesGeographyMultipliersJson = ?');
    args.push(JSON.stringify(patch.geographyMultipliers));
  }
  if (patch.whyUsTemplate !== undefined) {
    sets.push('salesWhyUsTemplate = ?');
    args.push(patch.whyUsTemplate);
  }
  if (patch.coverLetterTemplate !== undefined) {
    sets.push('salesCoverLetterTemplate = ?');
    args.push(patch.coverLetterTemplate);
  }
  if (patch.sowTermsTemplate !== undefined) {
    sets.push('salesSowTermsTemplate = ?');
    args.push(patch.sowTermsTemplate);
  }
  if (sets.length > 0) {
    args.push(firmId);
    await db.execute({
      sql: `UPDATE Firm SET ${sets.join(', ')} WHERE id = ?`,
      args,
    });
  }
  return getFirmSalesTemplates(firmId);
}
