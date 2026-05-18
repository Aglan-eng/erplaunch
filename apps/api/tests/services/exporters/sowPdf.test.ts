/**
 * Phase 51.3 — branded SOW PDF renderer integration tests.
 *
 * Same shape as `proposalPdf.test.ts` — these tests drive the real
 * Chromium binary via puppeteer-core, so they only execute in
 * environments that have one available (Linux + apk-installed
 * chromium, or local dev with PUPPETEER_EXECUTABLE_PATH set).
 *
 * Path note: spec asked for `tests/exporters/`. Established
 * convention in this repo is `tests/services/exporters/` (see
 * markdownToPdf*.test.ts + proposalPdf.test.ts neighbours).
 * Following convention.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../../_helpers/testDb.js';
import { getDb } from '../../../src/db/index.js';
import { renderSowPdf } from '../../../src/services/exporters/templates/sow/index.js';
import { closeBrowser } from '../../../src/services/exporters/puppeteerBrowser.js';
import type { SowInput } from '../../../src/services/exporters/templates/sow/types.js';

const CHROMIUM_AVAILABLE = (() => {
  const path = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!path) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    return fs.existsSync(path);
  } catch {
    return false;
  }
})();

const skipReason = !CHROMIUM_AVAILABLE
  ? `Chromium binary not available — set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium executable to enable.`
  : null;

let cleanup: () => void;
let firmId: string;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(async () => {
  try {
    await closeBrowser();
  } catch {
    // ignore
  }
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute(`DELETE FROM Firm`);
  firmId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, displayName, primaryColor, secondaryColor, themeAccentColor, themeFontFamily, tagline, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      firmId,
      'Test Firm',
      `test-${createId()}`,
      'STARTER',
      'Test Firm',
      '#0A1A2F',
      '#475569',
      '#1FAE5C',
      "'Inter', sans-serif",
      'ORACLE NETSUITE PARTNER',
      now,
    ],
  });
});

function makeFixture(over: Partial<SowInput> = {}): SowInput {
  return {
    firmId,
    customer: {
      name: 'Acme Industries',
      address: '12 Industry Way, Dubai, UAE',
      contactName: 'Lina Said',
    },
    sow: {
      title: 'NetSuite Implementation — Statement of Work',
      effectiveDate: '2026-06-01',
      referenceProposalNumber: 'PRO-2026-0142',
      projectOverview:
        'Acme Industries will deploy **Oracle NetSuite Mid-Market** over a 16-week ' +
        'engagement. This SOW defines the deliverables, milestones, fees, and ' +
        'governance for that implementation.',
      inScope: [
        'Financials configuration (GL, AP, AR, Cash)',
        'Inventory + warehouse setup for 2 locations',
        'Order-to-cash workflow automation',
        'Integration with Acme’s existing Shopify storefront',
        'UAT support + 30 days of post-go-live hypercare',
      ],
      outOfScope: [
        'Acme’s legacy QuickBooks data archival',
        'Non-NetSuite custom developments outside the workflow scope',
        'Third-party storefront re-platforming',
      ],
      deliverables: [
        {
          id: 'DLV-1',
          name: 'Solution Design Document',
          description: 'Module-by-module configuration specification covering Financials, Inventory, O2C.',
          acceptanceCriteria: 'Sign-off by Acme finance lead + Acme operations lead within 5 business days of submission.',
        },
        {
          id: 'DLV-2',
          name: 'Configured NetSuite environment (UAT)',
          description: 'NetSuite sandbox configured to the SDD with all required test data loaded.',
          acceptanceCriteria: 'UAT test scripts pass at ≥ 95% on Acme’s validation pass.',
        },
        {
          id: 'DLV-3',
          name: 'Cutover Runbook',
          description: 'Hour-by-hour go-live plan including data migration, smoke tests, and rollback triggers.',
          acceptanceCriteria: 'Joint dry-run executed end-to-end with zero unresolved P1 issues.',
        },
        {
          id: 'DLV-4',
          name: 'Hypercare Handoff Package',
          description: 'Operating runbook for the named Acme operators + ticket queue setup.',
          acceptanceCriteria: 'Acme operators sign the handoff checklist by day 30 post go-live.',
        },
      ],
      milestones: [
        { name: 'Contract sign + kickoff', targetDate: '2026-06-01', paymentPercent: 30 },
        { name: 'Solution Design Document sign-off', targetDate: '2026-06-22', paymentPercent: 20 },
        { name: 'UAT environment delivered', targetDate: '2026-08-10', paymentPercent: 20 },
        { name: 'Go-live', targetDate: '2026-09-14', paymentPercent: 20 },
        { name: 'Hypercare exit + handoff', targetDate: '2026-10-14', paymentPercent: 10 },
      ],
      assumptions: [
        'Acme will provide a named project sponsor available 4 hours per week.',
        'Acme’s data is exported from QuickBooks in the agreed CSV templates by week 2.',
        'Out-of-hours cutover support is included for one weekend.',
      ],
      changeOrderProcess:
        'Changes affecting scope, timeline, or fees require a **Change Order** signed by both parties.\n\n' +
        '- Acme submits the change request in writing.\n' +
        '- Xelerate provides an impact assessment within 3 business days.\n' +
        '- Change is in effect only upon signed Change Order.',
      fees: {
        fixedFee: 150_000,
        tAndM: { rate: 250, estimatedHours: 200, cap: 50_000 },
        currency: 'USD',
        paymentTerms: 'Net 30 from milestone sign-off. Late payments accrue 1.5% per month.',
      },
      termAndTermination:
        'This SOW is effective from the Effective Date and continues through Hypercare Exit. ' +
        'Either party may terminate for convenience with 30 days written notice; Acme is liable for fees ' +
        'earned through the termination date plus reasonable wind-down costs.',
      signatures: {
        firmSignatoryName: 'Karim Aglan',
        firmSignatoryTitle: 'Managing Director',
        customerSignatoryName: 'Lina Said',
        customerSignatoryTitle: 'Chief Financial Officer',
      },
    },
    ...over,
  };
}

describe.skipIf(skipReason !== null)(
  'renderSowPdf — Phase 51.3 branded SOW',
  () => {
    it('returns a non-empty PDF buffer with %PDF- magic bytes', async () => {
      const pdf = await renderSowPdf(makeFixture());
      expect(pdf).toBeInstanceOf(Buffer);
      expect(pdf.byteLength).toBeGreaterThan(50_000);
      expect(pdf.toString('ascii', 0, 5)).toBe('%PDF-');
    });

    it('renders without crashing when the firm has zero brand-pack values (unbranded fallback)', async () => {
      const db = getDb();
      const unbrandedId = createId();
      await db.execute({
        sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?, ?, ?, ?, ?)`,
        args: [unbrandedId, 'Unbranded Firm', 'unbranded-test', 'STARTER', new Date().toISOString()],
      });
      const pdf = await renderSowPdf(makeFixture({ firmId: unbrandedId }));
      expect(pdf.toString('ascii', 0, 5)).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(10_000);
    });

    it('renders correctly when the fees structure is T&M-only (no fixedFee)', async () => {
      const base = makeFixture();
      const pdf = await renderSowPdf({
        ...base,
        sow: {
          ...base.sow,
          fees: {
            tAndM: { rate: 250, estimatedHours: 600 },
            currency: 'USD',
            paymentTerms: 'Net 30, billed monthly against logged hours.',
          },
        },
      });
      expect(pdf.toString('ascii', 0, 5)).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(10_000);
    });

    it('produces meaningfully different output for different firm theme colours', async () => {
      const db = getDb();
      const altFirm = createId();
      await db.execute({
        sql: `INSERT INTO Firm (id, name, slug, plan, displayName, primaryColor, secondaryColor, themeAccentColor, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          altFirm,
          'Alt Firm',
          `alt-${createId()}`,
          'STARTER',
          'Alt Firm',
          '#7C3AED',
          '#94A3B8',
          '#F59E0B',
          new Date().toISOString(),
        ],
      });
      const original = await renderSowPdf(makeFixture());
      const alt = await renderSowPdf(makeFixture({ firmId: altFirm }));
      const sizeDelta = Math.abs(original.byteLength - alt.byteLength);
      const byteDiff = Buffer.compare(original, alt) !== 0;
      expect(sizeDelta > 200 || byteDiff).toBe(true);
    }, 30_000);
  },
);

describe('renderSowPdf — sanity (always runs)', () => {
  it('exports renderSowPdf as a function', () => {
    expect(typeof renderSowPdf).toBe('function');
  });

  if (skipReason) {
    it.skip(`integration tests skipped: ${skipReason}`, () => {});
  }
});
