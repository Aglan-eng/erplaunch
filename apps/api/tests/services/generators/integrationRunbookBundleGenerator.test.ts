import { describe, it, expect } from 'vitest';
import { generateIntegrationRunbookBundle } from '../../../src/services/generators/integrationRunbookBundleGenerator.js';

describe('Pack ZZ — integrationRunbookBundleGenerator: file count', () => {
  it('NetSuite default emits 11 runbooks (one per default catalog integration)', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.runbookCount).toBe(11);
    expect(Object.keys(out.files)).toHaveLength(11);
  });

  it('Odoo default emits 6 runbooks', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    expect(out.runbookCount).toBe(6);
  });

  it('overlay drives runbook count when provided', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'X',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'A | Transactional | Inbound | Hourly | X | Y\nB | Master-data | Inbound | Daily | X | Y',
      },
    });
    expect(out.runbookCount).toBe(2);
  });
});

describe('Pack ZZ — integrationRunbookBundleGenerator: filename slug + sequence', () => {
  it('every filename uses 2-digit prefix and slug', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const fn of Object.keys(out.files)) {
      expect(fn).toMatch(/^\d{2}_[a-z0-9_]+\.md$/);
    }
  });

  it('Avalara Tax runbook filename is 01_avalara_tax.md (critical-path first)', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    expect(out.files['01_avalara_tax.md']).toBeDefined();
  });
});

describe('Pack ZZ — integrationRunbookBundleGenerator: 11 mandatory sections per runbook', () => {
  it('every runbook contains all 11 sections', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const content of Object.values(out.files)) {
      expect(content).toContain('## 1. Overview');
      expect(content).toContain('## 2. Architecture');
      expect(content).toContain('## 3. Auth & Secrets');
      expect(content).toContain('## 4. Data Flow');
      expect(content).toContain('## 5. Monitoring');
      expect(content).toContain('## 6. Common Errors & Resolution');
      expect(content).toContain('## 7. Recovery Procedures');
      expect(content).toContain('## 8. Pre-Cutover Smoke Test');
      expect(content).toContain('## 9. Post-Cutover Smoke Test');
      expect(content).toContain('## 10. Vendor Support');
      expect(content).toContain('## 11. Cross-References');
    }
  });

  it('every runbook has a Mermaid architecture diagram', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const content of Object.values(out.files)) {
      expect(content).toContain('```mermaid');
      expect(content).toContain('graph LR');
    }
  });
});

describe('Pack ZZ — integrationRunbookBundleGenerator: cross-pack references', () => {
  it('every runbook cross-references Cutover_Runbook (Pack V), Migration_Runbook (Pack Z), Hypercare_Plan (Pack X), War_Room_SOP', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const content of Object.values(out.files)) {
      expect(content).toContain('Documentation/Cutover/Cutover_Runbook.md');
      expect(content).toContain('Documentation/Data_Migration/Migration_Runbook.md');
      expect(content).toContain('Documentation/Hypercare/Hypercare_Plan.md');
      expect(content).toContain('Documentation/Hypercare/War_Room_SOP.md');
    }
  });

  it('every runbook references sibling Pack ZZ artefacts', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    for (const content of Object.values(out.files)) {
      expect(content).toContain('../Integration_Catalog.md');
      expect(content).toContain('../Integration_Health_Dashboard.md');
      expect(content).toContain('../Reconciliation_Procedures.md');
      expect(content).toContain('../Vendor_Escalation_Matrix.md');
    }
  });
});

describe('Pack ZZ — integrationRunbookBundleGenerator: adaptor-conditional logging', () => {
  it('NetSuite runbook references SuiteCloud Manager + Script Execution Log', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {},
    });
    const runbook = out.files['01_avalara_tax.md'];
    expect(runbook).toContain('Script Execution Log');
    expect(runbook).toContain('SuiteCloud Manager');
  });

  it('Odoo runbook references ir.logging table + scheduled actions history', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    for (const content of Object.values(out.files)) {
      expect(content).toContain('ir.logging');
      expect(content).toContain('Scheduled Actions');
    }
  });

  it('Odoo runbooks do not leak NetSuite vocabulary', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Sahel',
      adaptorName: 'Odoo',
      answers: {},
    });
    for (const content of Object.values(out.files)) {
      expect(content).not.toContain('SuiteScript');
      expect(content).not.toContain('OneWorld');
      expect(content).not.toContain('SuiteCloud');
    }
  });
});

describe('Pack ZZ — integrationRunbookBundleGenerator: overlay-driven personalisation', () => {
  it('uses consultant-supplied owner / auth method / monitoring thresholds', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet + SDK | Avalara',
      },
      integrationOwnersByName: 'Avalara Tax | Sarah Chen | Helena Reyes',
      integrationAuthMethods:
        'Avalara Tax | Account ID + License Key | Annual | Sarah Chen',
      integrationMonitoring:
        'Avalara Tax | API success rate | > 99.5% | 99-99.5% | < 99%',
    });
    const runbook = out.files['01_avalara_tax.md'];
    expect(runbook).toContain('Sarah Chen');
    expect(runbook).toContain('Helena Reyes');
    expect(runbook).toContain('Account ID + License Key');
    expect(runbook).toContain('Annual');
    expect(runbook).toContain('> 99.5%');
    expect(runbook).toContain('< 99%');
  });

  it('renders multiple error patterns for the same integration', () => {
    const out = generateIntegrationRunbookBundle({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
      answers: {
        'integrations.catalog.integrationCatalog':
          'Avalara Tax | Transactional API | Bidirectional | Realtime | RESTlet + SDK | Avalara',
      },
      integrationErrorPatterns:
        'Avalara Tax | Network timeout | Retry with backoff\nAvalara Tax | Address validation | Flag for manual fix',
    });
    const runbook = out.files['01_avalara_tax.md'];
    expect(runbook).toContain('Network timeout');
    expect(runbook).toContain('Retry with backoff');
    expect(runbook).toContain('Address validation');
    expect(runbook).toContain('Flag for manual fix');
  });
});
