import { getDb } from './index.js';

export interface FirmBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}

/**
 * Platform defaults used when a Firm has no overrides configured.
 * These are intentionally conservative — ERPLaunch brand palette.
 */
export const DEFAULT_BRANDING: FirmBranding = {
  displayName: 'ERPLaunch',
  logoUrl: null,
  primaryColor: '#4f46e5',
  secondaryColor: '#818cf8',
  supportEmail: null,
};

type Row = Record<string, unknown>;

function coalesceBranding(row: Row | null): FirmBranding {
  if (!row) return { ...DEFAULT_BRANDING };

  const displayName = (row.displayName as string | null) ?? (row.name as string | null);
  const logoUrl = (row.logoUrl as string | null) ?? null;
  const primaryColor = (row.primaryColor as string | null) ?? DEFAULT_BRANDING.primaryColor;
  const secondaryColor = (row.secondaryColor as string | null) ?? DEFAULT_BRANDING.secondaryColor;
  const supportEmail = (row.supportEmail as string | null) ?? null;

  return {
    displayName: displayName ?? DEFAULT_BRANDING.displayName,
    logoUrl,
    primaryColor,
    secondaryColor,
    supportEmail,
  };
}

export async function getFirmBranding(firmId: string): Promise<FirmBranding> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT name, displayName, logoUrl, primaryColor, secondaryColor, supportEmail
          FROM Firm WHERE id = ?`,
    args: [firmId],
  });
  return coalesceBranding((r.rows[0] as Row) ?? null);
}

export async function getFirmBrandingByEngagementId(engagementId: string): Promise<FirmBranding> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT f.name, f.displayName, f.logoUrl, f.primaryColor, f.secondaryColor, f.supportEmail
          FROM Engagement e
          JOIN Firm f ON f.id = e.firmId
          WHERE e.id = ?`,
    args: [engagementId],
  });
  return coalesceBranding((r.rows[0] as Row) ?? null);
}
