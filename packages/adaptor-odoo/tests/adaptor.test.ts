import { describe, it, expect } from 'vitest';
import { validateAdaptor, evaluateAdaptorRules } from '@ofoq/adaptor-sdk';
import { AdaptorRegistry } from '@ofoq/adaptor-registry';
import odooAdaptor from '../src/index.js';

describe('odooAdaptor: manifest', () => {
  it('has the expected identity', () => {
    expect(odooAdaptor.manifest.id).toBe('odoo');
    expect(odooAdaptor.manifest.name).toBe('Odoo');
    expect(odooAdaptor.manifest.sourceKind).toBe('built-in');
    expect(odooAdaptor.manifest.vendor).toBe('Odoo SA');
    expect(odooAdaptor.manifest.capabilities).toContain('document');
    expect(odooAdaptor.manifest.capabilities).toContain('license.gating');
  });

  it('passes SDK shape validation', () => {
    const res = validateAdaptor(odooAdaptor);
    expect(res.ok, res.errors.join('; ')).toBe(true);
  });
});

describe('odooAdaptor: schema', () => {
  it('exposes the five canonical flows', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    expect(ids).toEqual(['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']);
  });

  it('every flow has at least one section with at least one question', () => {
    for (const flow of odooAdaptor.schema.flows) {
      expect(flow.sections.length, `flow ${flow.id} has no sections`).toBeGreaterThan(0);
      for (const section of flow.sections) {
        expect(section.questions.length, `section ${flow.id}/${section.id} has no questions`).toBeGreaterThan(0);
      }
    }
  });

  it('question IDs are namespaced under "odoo." and unique', () => {
    const seen = new Set<string>();
    for (const flow of odooAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) {
          expect(q.id.startsWith('odoo.'), `question ${q.id} not namespaced`).toBe(true);
          expect(seen.has(q.id), `duplicate question id: ${q.id}`).toBe(false);
          seen.add(q.id);
        }
      }
    }
  });

  it('dependsOn references point at questions that actually exist', () => {
    const allIds = new Set<string>();
    for (const flow of odooAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) allIds.add(q.id);
      }
    }
    for (const flow of odooAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) {
          if (q.dependsOn) {
            expect(allIds.has(q.dependsOn.questionId), `dependsOn target missing: ${q.dependsOn.questionId}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('odooAdaptor: license', () => {
  it('includes Community + Enterprise editions', () => {
    const ids = odooAdaptor.license.editions.map((e) => e.id);
    expect(ids).toEqual(['COMMUNITY', 'ENTERPRISE']);
  });

  it('default edition is ENTERPRISE', () => {
    expect(odooAdaptor.license.defaultEditionId).toBe('ENTERPRISE');
  });

  it('catalog contains core apps (MRP, CRM, HR, PROJECT)', () => {
    const modIds = odooAdaptor.license.modules.map((m) => m.id);
    expect(modIds).toContain('MRP');
    expect(modIds).toContain('CRM');
    expect(modIds).toContain('HR');
    expect(modIds).toContain('PROJECT');
  });

  it('Community edition omits Enterprise-only modules', () => {
    const community = odooAdaptor.license.editions.find((e) => e.id === 'COMMUNITY')!;
    expect(community.includesModules).not.toContain('ENTERPRISE_STUDIO');
    expect(community.includesModules).not.toContain('ENTERPRISE_ACCOUNTING');
  });
});

describe('odooAdaptor: phases + generators', () => {
  it('default phases include Discovery through Go Live in order', () => {
    const order = odooAdaptor.phases.defaultPhases.map((p) => p.label);
    expect(order).toEqual(['Discovery', 'Configuration', 'Data Migration', 'Training', 'UAT', 'Go Live']);
  });

  it('ships document generators (no SuiteScript leakage)', () => {
    const genIds = odooAdaptor.generators.map((g) => g.id);
    expect(genIds).toContain('brd');
    expect(genIds).toContain('solution-doc');
    expect(genIds).toContain('odoo-config-checklist');
    expect(genIds).not.toContain('suitescript');
    expect(genIds).not.toContain('sdf');
  });
});

describe('odooAdaptor: rule pack', () => {
  it('ships a non-empty rule pack with a stable id', () => {
    expect(odooAdaptor.rules.id).toBe('odoo-rules');
    expect(odooAdaptor.rules.rules.length).toBeGreaterThan(0);
  });

  it('every rule has an id, type, severity, message, resolution', () => {
    for (const rule of odooAdaptor.rules.rules) {
      expect(rule.id, `rule ${JSON.stringify(rule)} missing id`).toBeTruthy();
      expect(['LICENSE_GAP', 'PHASE_DEPENDENCY', 'CONFIG_CONFLICT', 'DATA_WARNING']).toContain(rule.type);
      expect(['BLOCK', 'WARN', 'INFO']).toContain(rule.severity);
      expect(rule.message, `rule ${rule.id} missing message`).toBeTruthy();
      expect(rule.resolution, `rule ${rule.id} missing resolution`).toBeTruthy();
      expect(Array.isArray(rule.questionIds)).toBe(true);
    }
  });

  it('rule IDs are namespaced under "odoo." and unique', () => {
    const seen = new Set<string>();
    for (const rule of odooAdaptor.rules.rules) {
      expect(rule.id.startsWith('odoo.'), `rule id ${rule.id} not namespaced`).toBe(true);
      expect(seen.has(rule.id), `duplicate rule id: ${rule.id}`).toBe(false);
      seen.add(rule.id);
    }
  });

  it('rule questionIds (when present) match real adaptor questions', () => {
    const allQuestionIds = new Set<string>();
    for (const flow of odooAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) allQuestionIds.add(q.id);
      }
    }
    for (const rule of odooAdaptor.rules.rules) {
      for (const qid of rule.questionIds) {
        expect(allQuestionIds.has(qid), `rule ${rule.id} references missing question ${qid}`).toBe(true);
      }
    }
  });

  it('covers MRP licensing gaps — the most common Odoo scoping pitfalls', () => {
    const ids = odooAdaptor.rules.rules.map((r) => r.id);
    expect(ids).toContain('odoo.mrp.requires-mrp-module');
    expect(ids).toContain('odoo.mrp.work-centers-require-mrp-module');
    expect(ids).toContain('odoo.mrp.quality-requires-mrp-and-quality');
  });

  it('documents Enterprise-only modules (Studio, Documents, Helpdesk)', () => {
    const ids = odooAdaptor.rules.rules.map((r) => r.id);
    expect(ids).toContain('odoo.studio-is-enterprise-only');
    expect(ids).toContain('odoo.documents-is-enterprise-only');
    expect(ids).toContain('odoo.helpdesk-is-enterprise-only');
  });
});

describe('odooAdaptor: rule evaluation via evaluateAdaptorRules', () => {
  it('clean Enterprise scoping raises no conflicts', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.company.multiCompany': true,
        'odoo.company.fiscalYearStart': '01-01',
        'odoo.coa.analyticAccounting': true,
        'odoo.mrp.enabled': true,
        'odoo.mrp.workCenters': true,
        'odoo.mrp.quality': true,
        'odoo.sales.priceListStrategy': 'SINGLE',
      },
      license: {
        edition: 'ENTERPRISE',
        modules: ['MRP', 'QUALITY', 'ENTERPRISE_STUDIO', 'ENTERPRISE_DOCUMENTS', 'HELPDESK'],
      },
    });
    expect(conflicts).toEqual([]);
  });

  it('flags MRP-enabled with missing MRP module (BLOCK)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mrp.enabled': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const ids = conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.mrp.requires-mrp-module');
    expect(conflicts.find((c) => c.id === 'odoo.mrp.requires-mrp-module')?.severity).toBe('BLOCK');
  });

  it('flags Studio on Community edition (BLOCK)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'COMMUNITY', modules: ['ENTERPRISE_STUDIO'] },
    });
    const ids = conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.studio-is-enterprise-only');
  });

  it('flags Quality Control without MRP or QUALITY modules (BLOCK)', () => {
    const missingMrp = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mrp.quality': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['QUALITY'] },
    });
    expect(missingMrp.map((c) => c.id)).toContain('odoo.mrp.quality-requires-mrp-and-quality');

    const missingQuality = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mrp.quality': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(missingQuality.map((c) => c.id)).toContain('odoo.mrp.quality-requires-mrp-and-quality');
  });

  it('warns on MRP sub-settings enabled while parent is off (WARN)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mrp.enabled': false,
        'odoo.mrp.workCenters': true,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const rule = conflicts.find((c) => c.id === 'odoo.mrp.sub-settings-without-parent');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('WARN');
  });

  it('warns when multi-company is on but analytic accounting is off', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.company.multiCompany': true,
        'odoo.coa.analyticAccounting': false,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.company.multi-company-needs-analytic');
  });

  it('warns when fiscal year start is missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {},
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.company.fiscal-year-start-required');
  });

  it('INFO-level nudge on customer-tier pricelist strategy', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.sales.priceListStrategy': 'CUSTOMER_TIER', 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const info = conflicts.find((c) => c.id === 'odoo.sales.tiered-pricelist-needs-customer-tiers');
    expect(info).toBeDefined();
    expect(info?.severity).toBe('INFO');
  });
});

describe('AdaptorRegistry with Odoo', () => {
  it('registers + retrieves Odoo by id', () => {
    const reg = new AdaptorRegistry();
    reg.register(odooAdaptor);
    expect(reg.has('odoo')).toBe(true);
    expect(reg.get('odoo').manifest.id).toBe('odoo');
  });

  it('refuses duplicate registration', () => {
    const reg = new AdaptorRegistry();
    reg.register(odooAdaptor);
    expect(() => reg.register(odooAdaptor)).toThrow(/already registered/);
  });
});
