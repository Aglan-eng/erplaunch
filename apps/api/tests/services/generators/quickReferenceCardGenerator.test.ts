import { describe, it, expect } from 'vitest';
import { generateQuickReferenceCards } from '../../../src/services/generators/quickReferenceCardGenerator.js';

/**
 * Pack U — Quick Reference Card tests.
 *
 * Covers:
 *   - Always-on canonical tasks emitted on every engagement
 *   - Conditional tasks fire only when scope flags set
 *   - Per-custom-record tasks (create + update-status pair)
 *   - Platform-specific menu path branching (NetSuite vs Odoo)
 *   - File-path layout under Documentation/Training/Quick_Reference_Cards/
 *   - Common-pitfalls block + cross-refs to test scripts
 */

describe('Pack U — quickReferenceCardGenerator: canonical tasks', () => {
  it('emits all 9 always-on canonical QRCs by default', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    const slugs = out.emitted.map((e) => e.slug).sort();
    // Always-on (poApprovalInScope=false strips approve-purchase-order).
    expect(slugs).toContain('create-purchase-order');
    expect(slugs).toContain('enter-vendor-bill');
    expect(slugs).toContain('three-way-match');
    expect(slugs).toContain('run-payment-batch');
    expect(slugs).toContain('create-customer-invoice');
    expect(slugs).toContain('apply-customer-payment');
    expect(slugs).toContain('create-sales-order');
    expect(slugs).toContain('run-trial-balance');
    expect(slugs).toContain('period-close');
    expect(slugs).toContain('process-return');
    expect(slugs).toContain('saved-search-export');
  });

  it('strips approve-purchase-order when poApprovalInScope=false', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      poApprovalInScope: false,
    });
    expect(out.emitted.map((e) => e.slug)).not.toContain('approve-purchase-order');
  });

  it('keeps approve-purchase-order when poApprovalInScope=true', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      poApprovalInScope: true,
    });
    expect(out.emitted.map((e) => e.slug)).toContain('approve-purchase-order');
  });

  it('emits Documentation/Training/Quick_Reference_Cards/QRC-*.md paths', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    for (const path of Object.keys(out.files)) {
      expect(path).toMatch(/^Documentation\/Training\/Quick_Reference_Cards\/QRC-[a-z0-9-]+\.md$/);
    }
  });
});

describe('Pack U — quickReferenceCardGenerator: conditional tasks', () => {
  it('multiCurrencyInScope=true triggers multi-currency-revaluation QRC', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      multiCurrencyInScope: true,
    });
    expect(out.emitted.map((e) => e.slug)).toContain('multi-currency-revaluation');
  });

  it('multiCurrencyInScope=false omits multi-currency-revaluation QRC', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    expect(out.emitted.map((e) => e.slug)).not.toContain('multi-currency-revaluation');
  });

  it('mfgInScope=true triggers create-work-order QRC', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      mfgInScope: true,
    });
    expect(out.emitted.map((e) => e.slug)).toContain('create-work-order');
  });

  it('inventoryInScope=true triggers cycle-count + stock-adjustment QRCs', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      inventoryInScope: true,
    });
    const slugs = out.emitted.map((e) => e.slug);
    expect(slugs).toContain('cycle-count');
    expect(slugs).toContain('stock-adjustment');
  });
});

describe('Pack U — quickReferenceCardGenerator: per-custom-record tasks', () => {
  it('emits one create + one update pair per custom record', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      customRecords: 'Approval Tracker\nVendor Onboarding Request',
    });
    const slugs = out.emitted.map((e) => e.slug);
    expect(slugs).toContain('create-approval-tracker-record');
    expect(slugs).toContain('update-approval-tracker-status');
    expect(slugs).toContain('create-vendor-onboarding-request-record');
    expect(slugs).toContain('update-vendor-onboarding-request-status');
  });

  it('parses custom record names stripping parenthetical descriptions', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      customRecords: 'Approval Tracker (custom record — captures full chain)',
    });
    const slugs = out.emitted.map((e) => e.slug);
    expect(slugs).toContain('create-approval-tracker-record');
  });

  it('skips blank custom-record lines', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      customRecords: '\nApproval Tracker\n\n\nProject Milestone\n',
    });
    const slugs = out.emitted.map((e) => e.slug);
    expect(slugs).toContain('create-approval-tracker-record');
    expect(slugs).toContain('create-project-milestone-record');
  });
});

describe('Pack U — quickReferenceCardGenerator: platform-specific menu paths', () => {
  it('NetSuite menu path renders for create-purchase-order', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-purchase-order.md'];
    expect(md).toContain('Transactions > Purchases > Enter Purchase Orders');
  });

  it('Odoo menu path renders for create-purchase-order', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
    });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-purchase-order.md'];
    expect(md).toContain('Purchase > Orders > Purchase Orders > Create');
  });

  it('NetSuite + Odoo paths differ on the same QRC (run-trial-balance)', () => {
    const ns = generateQuickReferenceCards({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    const odoo = generateQuickReferenceCards({ clientName: 'Sahel', adaptorName: 'Odoo' });
    const nsMd = ns.files['Documentation/Training/Quick_Reference_Cards/QRC-run-trial-balance.md'];
    const odooMd = odoo.files['Documentation/Training/Quick_Reference_Cards/QRC-run-trial-balance.md'];
    expect(nsMd).toContain('Reports > Financial > Trial Balance');
    expect(odooMd).toContain('Accounting > Reporting > Trial Balance');
  });

  it('unknown adaptor renders [ASSIGN] placeholder for menu path', () => {
    const out = generateQuickReferenceCards({
      clientName: 'X',
      adaptorName: 'CustomERP',
    });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-purchase-order.md'];
    expect(md).toContain('_[ASSIGN platform menu path]_');
  });

  it('omitted adaptorName falls back to placeholder', () => {
    const out = generateQuickReferenceCards({ clientName: 'X' });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-purchase-order.md'];
    // Empty adaptorName renders as "**Platform:** the ERP". The menu
    // path is the [ASSIGN] placeholder the consultant must fill in.
    expect(md).toContain('**Platform:** the ERP');
    expect(md).toContain('_[ASSIGN platform menu path]_');
  });
});

describe('Pack U — quickReferenceCardGenerator: card structure', () => {
  it('every QRC carries the standard 5 markdown headings', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    const md = Object.values(out.files)[0];
    expect(md).toContain('## Prerequisites');
    expect(md).toContain('## Steps');
    expect(md).toContain('## Common Pitfalls');
    expect(md).toContain('## Where to Find It');
    expect(md).toContain('## Related Resources');
  });

  it('Common Pitfalls block fires per-task content for known slugs', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-purchase-order.md'];
    // Specific PITFALLS entry for create-purchase-order references "tier-2".
    expect(md).toContain('tier-2');
  });

  it('Common Pitfalls falls through to default copy when no specific entry exists', () => {
    const out = generateQuickReferenceCards({
      clientName: 'Atlas',
      customRecords: 'Approval Tracker',
    });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-approval-tracker-record.md'];
    expect(md).toContain('No platform-specific pitfalls captured');
  });

  it('cross-references the related test script in Pack T', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    const md = out.files['Documentation/Training/Quick_Reference_Cards/QRC-create-purchase-order.md'];
    expect(md).toContain('Documentation/Test_Scripts/TC-P2P-01-');
  });

  it('cross-references the role training guide + defect log', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Documentation/Training/<Role>_Training_Guide.md');
    expect(md).toContain('Documentation/Defect_Log_Template.md');
  });
});

describe('Pack U — quickReferenceCardGenerator: vacuous-truth contract', () => {
  it('still emits all canonical + always-on tasks even with no flags or records', () => {
    const out = generateQuickReferenceCards({ clientName: 'Atlas' });
    expect(out.emitted.length).toBeGreaterThanOrEqual(8);
  });

  it('output is deterministic — same input produces identical files', () => {
    const input = {
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      poApprovalInScope: true,
      multiCurrencyInScope: true,
      mfgInScope: true,
      inventoryInScope: true,
      customRecords: 'Approval Tracker\nProject Milestone',
    };
    const a = generateQuickReferenceCards(input);
    const b = generateQuickReferenceCards(input);
    expect(a.files).toEqual(b.files);
    expect(a.emitted).toEqual(b.emitted);
  });
});
