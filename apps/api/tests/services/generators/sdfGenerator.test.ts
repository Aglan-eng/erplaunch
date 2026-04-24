import { describe, it, expect } from 'vitest';
import { generateSDFPackage } from '../../../src/services/generators/sdfGenerator.js';
import { normalizeXml, readFixture } from './_helpers.js';

/**
 * SDF generator schema-compliance tests.
 *
 * Each `describe` block corresponds to one of the fixes in the SDF
 * compliance plan. Fixtures live next to this file under ./fixtures and
 * are the single source of truth for the post-fix XML shape — when a
 * phase lands, the fixture gets checked in alongside the code change
 * and the test asserts byte-equivalence (modulo whitespace) between the
 * generated bundle and the fixture.
 */

describe('sdfGenerator: Fix #1 — customrecordtype root element', () => {
  it('emits <customrecordtype> (not <customrecord>) with the Oracle-required children', () => {
    const files = generateSDFPackage({
      modules: [],
      answers: {
        // Only this answer is set to minimise unrelated mappings in the bundle.
        'p2p.purchasing.purchaseRequisitions': true,
      },
      clientName: 'FixtureTest',
    });

    const got = files['Objects/customrecord_nsix_purchase_req.xml'];
    expect(got).toBeDefined();

    // Byte-level assertions about the shape — these fail today and lock
    // in the fix so we can't regress.
    expect(got).toContain('<customrecordtype scriptid="customrecord_nsix_purchase_req">');
    expect(got).not.toContain('<customrecord ');
    // Forbidden children from the old shape.
    expect(got).not.toContain('<description>');
    expect(got).not.toContain('<isordered>');
    // Required shape — empty customrecordcustomfields container is valid.
    expect(got).toContain('<customrecordcustomfields>');
    expect(got).toContain('</customrecordcustomfields>');
    expect(got).toContain('<recordname>NSIX Purchase Requisition</recordname>');

    // Byte-normalized match against the checked-in fixture as a
    // belt-and-braces regression gate.
    expect(normalizeXml(got!)).toBe(normalizeXml(readFixture('customrecord_nsix_purchase_req.xml')));
  });

  it('emits <customrecordtype> for every customrecord_* mapping, never <customrecord>', () => {
    // Flip on every mapping trigger so every customrecord in the registry
    // fires — catches a template we might have missed during the rewrite.
    const files = generateSDFPackage({
      modules: ['MANUFACTURING', 'WORK_ORDERS'],
      answers: {
        'mfg.productionFlow.type': 'WIP_ROUTINGS',
        'p2p.purchasing.poApprovalRequired': true,
        'p2p.purchasing.purchaseRequisitions': true,
        'p2p.expenses.employeeExpenses': true,
        'o2c.invoicing.revenueRecognition': true,
        'o2c.collections.dunningLetters': true,
      },
      clientName: 'FixtureTest',
    });

    const customRecordFiles = Object.entries(files).filter(([name]) =>
      name.startsWith('Objects/customrecord_'),
    );
    expect(customRecordFiles.length).toBeGreaterThanOrEqual(6);
    for (const [name, body] of customRecordFiles) {
      expect(body, `${name} still uses legacy <customrecord> root`).not.toContain('<customrecord ');
      expect(body, `${name} missing <customrecordtype> root`).toContain('<customrecordtype ');
      expect(body, `${name} still has forbidden <description> child`).not.toContain('<description>');
      expect(body, `${name} still has forbidden <isordered> child`).not.toContain('<isordered>');
      expect(body, `${name} missing required <customrecordcustomfields> container`).toContain('<customrecordcustomfields>');
    }
  });
});
