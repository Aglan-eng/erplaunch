import { describe, it, expect } from 'vitest';
import { generateKnowledgeTransferChecklist } from '../../../src/services/generators/knowledgeTransferChecklistGenerator.js';

/**
 * Pack U — Knowledge Transfer Checklist tests.
 */

describe('Pack U — knowledgeTransferChecklistGenerator: structure', () => {
  it('emits the 6 canonical sections', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Documentation Handoff');
    expect(out.markdown).toContain('## 2. Configuration Knowledge Transfer');
    expect(out.markdown).toContain('## 3. Operational Run-Books');
    expect(out.markdown).toContain('## 4. Training Cascade Status');
    expect(out.markdown).toContain('## 5. BAU Transition');
    expect(out.markdown).toContain('## 6. Sign-off');
  });

  it('platform name flows into header (NetSuite)', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      adaptorName: 'NetSuite',
    });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });

  it('platform default reads as ERP when omitted', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });
});

describe('Pack U — knowledgeTransferChecklistGenerator: cascade branching', () => {
  it('TRAIN_THE_TRAINER renders the champion-list cascade section', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      cascadeStrategy: 'TRAIN_THE_TRAINER',
    });
    expect(out.markdown).toContain('Train-the-Trainer');
    expect(out.markdown).toContain('Champion list confirmed');
    expect(out.markdown).toContain('Champion-led cascade sessions');
  });

  it('TRAIN_EVERYONE renders the consultant-led cascade section', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      cascadeStrategy: 'TRAIN_EVERYONE',
    });
    expect(out.markdown).toContain('Train-Everyone');
    expect(out.markdown).toContain('All end users completed direct consultant-led training');
  });

  it('HYBRID (default) renders the per-role mix section', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Hybrid');
    expect(out.markdown).toContain('Per-role mix confirmed');
  });

  it('unknown cascade falls back to HYBRID', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      cascadeStrategy: 'BOGUS' as unknown as 'HYBRID',
    });
    expect(out.markdown).toContain('Hybrid');
  });
});

describe('Pack U — knowledgeTransferChecklistGenerator: workstream + integrations', () => {
  it('workstream-driven run-book lines emit when workstreamsInScope is provided', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      workstreamsInScope: ['R2R', 'P2P', 'O2C'],
    });
    expect(out.markdown).toContain('Period close + reporting procedure');
    expect(out.markdown).toContain('Procurement + payables + payment-run procedure');
    expect(out.markdown).toContain('Sales + invoicing + collections procedure');
  });

  it('falls back to generic placeholder when workstreamsInScope is empty', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Per-workstream run-books documented');
  });

  it('integration walk-through lines parse from integrationsList', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      integrationsList:
        'Salesforce | customer master | hourly | Boomi process\n' +
        'Avalara | tax-code lookup | real-time | native NetSuite connector',
    });
    expect(out.markdown).toContain('- [ ] Salesforce integration walk-through');
    expect(out.markdown).toContain('- [ ] Avalara integration walk-through');
  });

  it('falls back to ASSIGN placeholder when integrationsList is empty', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_[ASSIGN integration walk-throughs');
  });
});

describe('Pack U — knowledgeTransferChecklistGenerator: cross-references', () => {
  it('references key Pack T artefacts (Sign_Off_Matrix + Defect_Log_Template)', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Sign_Off_Matrix.md');
    expect(out.markdown).toContain('Documentation/Defect_Log_Template.md');
  });

  it('forward-references Pack V Cutover_Runbook + Pack X Hypercare_Plan', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Cutover_Runbook.md');
    expect(out.markdown).toContain('Documentation/Hypercare_Plan.md');
  });

  it('cross-refs sibling Pack U artefacts (Training_Matrix + Training_Schedule)', () => {
    const out = generateKnowledgeTransferChecklist({
      clientName: 'Atlas',
      cascadeStrategy: 'TRAIN_THE_TRAINER',
    });
    expect(out.markdown).toContain('Documentation/Training_Matrix.md');
    expect(out.markdown).toContain('Documentation/Training_Schedule.md');
  });

  it('BAU transition section spells out 30/60/90 day on-call rotation', () => {
    const out = generateKnowledgeTransferChecklist({ clientName: 'Atlas' });
    expect(out.markdown).toContain('week 1-30');
    expect(out.markdown).toContain('week 31-60');
    expect(out.markdown).toContain('week 61+');
  });
});
