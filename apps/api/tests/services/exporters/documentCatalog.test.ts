/**
 * Phase 53.2 — document-catalog tests.
 */
import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_CATALOG,
  documentsForStage,
  findDocument,
  stagesWithDocuments,
} from '../../../src/services/exporters/documentCatalog.js';
import { CUSTOMER_STAGES } from '../../../src/db/customer.js';

describe('DOCUMENT_CATALOG', () => {
  it('every entry has a non-empty id, name, description, and matching stage', () => {
    for (const doc of DOCUMENT_CATALOG) {
      expect(doc.id, `id missing for ${doc.name}`).toBeTruthy();
      expect(doc.name).toBeTruthy();
      expect(doc.description).toBeTruthy();
      expect((CUSTOMER_STAGES as readonly string[]).includes(doc.stage)).toBe(true);
    }
  });

  it('document ids are unique across the catalog', () => {
    const ids = new Set<string>();
    for (const doc of DOCUMENT_CATALOG) {
      expect(ids.has(doc.id), `duplicate id ${doc.id}`).toBe(false);
      ids.add(doc.id);
    }
  });

  it('available docs declare an exportRoute; coming-soon docs declare null', () => {
    for (const doc of DOCUMENT_CATALOG) {
      if (doc.status === 'available') expect(doc.exportRoute).toBeTruthy();
      else expect(doc.exportRoute).toBeNull();
    }
  });

  it('only `proposal` and `sow` are available today', () => {
    const available = DOCUMENT_CATALOG.filter((d) => d.status === 'available').map((d) => d.id);
    expect(available.sort()).toEqual(['proposal', 'sow']);
  });

  it('every non-terminal stage has at least one document defined', () => {
    const stages = stagesWithDocuments();
    // Terminal stages don't need doc templates.
    const terminals = ['LOST', 'CHURNED', 'RENEWED'];
    for (const s of CUSTOMER_STAGES) {
      if (terminals.includes(s)) continue;
      expect(stages.includes(s), `stage ${s} has no documents`).toBe(true);
    }
  });

  it('GOLIVE has the four expected go-live documents', () => {
    const docs = documentsForStage('GOLIVE').map((d) => d.id);
    expect(docs).toContain('cutover-plan');
    expect(docs).toContain('golive-checklist');
    expect(docs).toContain('golive-runbook');
    expect(docs).toContain('data-migration-plan');
  });

  it('PROPOSAL has the available proposal generator', () => {
    const docs = documentsForStage('PROPOSAL');
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('proposal');
    expect(docs[0].status).toBe('available');
  });

  it('WON has both the SOW (available) and the kickoff deck (coming-soon)', () => {
    const docs = documentsForStage('WON');
    const sow = docs.find((d) => d.id === 'sow');
    const kickoff = docs.find((d) => d.id === 'kickoff-deck');
    expect(sow?.status).toBe('available');
    expect(kickoff?.status).toBe('coming-soon');
  });

  it('findDocument returns the doc by id or undefined', () => {
    expect(findDocument('proposal')?.name).toBe('Proposal');
    expect(findDocument('nonexistent')).toBeUndefined();
  });
});
