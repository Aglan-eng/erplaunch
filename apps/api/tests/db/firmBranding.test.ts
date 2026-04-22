import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb, seedEngagementWithToken } from '../_helpers/testDb.js';
import {
  getFirmBranding,
  getFirmBrandingByEngagementId,
  DEFAULT_BRANDING,
} from '../../src/db/firmBranding.js';
import { getDb } from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

describe('firmBranding: getFirmBranding', () => {
  it('returns defaults when all branding columns are null', async () => {
    const db = getDb();
    const firmId = createId();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: [firmId, 'Acme Advisory', `acme-${createId()}`, 'STARTER', new Date().toISOString()],
    });

    const branding = await getFirmBranding(firmId);

    // displayName falls back to Firm.name
    expect(branding.displayName).toBe('Acme Advisory');
    expect(branding.logoUrl).toBeNull();
    // Colors fall back to platform defaults
    expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    expect(branding.secondaryColor).toBe(DEFAULT_BRANDING.secondaryColor);
    expect(branding.supportEmail).toBeNull();
  });

  it('returns stored values when set', async () => {
    const db = getDb();
    const firmId = createId();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, displayName, logoUrl, primaryColor, secondaryColor, supportEmail, createdAt)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        firmId,
        'Acme Advisory',
        `acme-${createId()}`,
        'STARTER',
        'Acme Project Portal',
        '/uploads/firms/acme/logo.png',
        '#4f46e5',
        '#818cf8',
        'support@acme.example',
        new Date().toISOString(),
      ],
    });

    const branding = await getFirmBranding(firmId);
    expect(branding.displayName).toBe('Acme Project Portal');
    expect(branding.logoUrl).toBe('/uploads/firms/acme/logo.png');
    expect(branding.primaryColor).toBe('#4f46e5');
    expect(branding.secondaryColor).toBe('#818cf8');
    expect(branding.supportEmail).toBe('support@acme.example');
  });

  it('returns null-shaped defaults when firm is missing', async () => {
    const branding = await getFirmBranding('does-not-exist');
    expect(branding.displayName).toBe(DEFAULT_BRANDING.displayName);
    expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
  });
});

describe('firmBranding: getFirmBrandingByEngagementId', () => {
  it('joins Engagement to Firm and returns branding', async () => {
    const { engagementId, firmId } = await seedEngagementWithToken({ firmName: 'Lookup Firm' });
    const db = getDb();
    await db.execute({
      sql: `UPDATE Firm SET displayName = ?, primaryColor = ? WHERE id = ?`,
      args: ['Lookup Portal', '#123456', firmId],
    });

    const branding = await getFirmBrandingByEngagementId(engagementId);
    expect(branding.displayName).toBe('Lookup Portal');
    expect(branding.primaryColor).toBe('#123456');
  });

  it('returns defaults when engagement is missing', async () => {
    const branding = await getFirmBrandingByEngagementId('no-such-engagement');
    expect(branding.displayName).toBe(DEFAULT_BRANDING.displayName);
  });
});
