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
  it('exposes FOUNDATION first followed by the five canonical flows', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    // Pack 1 — Foundation flow gates everything downstream and renders
    // before R2R in the wizard sidebar.
    expect(ids).toEqual(['FOUNDATION', 'R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']);
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

// ─── Pack 1 — Foundation & Deployment Architecture ───────────────────────────

describe('odooAdaptor: Pack 1 — FOUNDATION flow shape', () => {
  const foundation = odooAdaptor.schema.flows.find((f) => f.id === 'FOUNDATION');

  it('FOUNDATION flow exists with the expected label + description', () => {
    expect(foundation).toBeDefined();
    expect(foundation!.label).toBe('Project Foundation');
    expect(foundation!.description).toMatch(/deployment|edition|geography|entity/i);
  });

  it('renders four sections in the documented order', () => {
    const ids = (foundation!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['deployment', 'geography', 'fiscalcalendar', 'entities']);
  });

  it('Deployment & Licensing — 5 questions with the right ids + types', () => {
    const sec = foundation!.sections.find((s) => s.id === 'deployment')!;
    expect(sec.label).toBe('Deployment & Licensing');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.foundation.deploymentMode')?.inputType).toBe('SINGLE_SELECT');
    // Three deployment-mode options must surface so the consultant
    // can't slip through with an undefined choice.
    expect(
      (byId.get('odoo.foundation.deploymentMode')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ODOOSH', 'ONLINE', 'SELFHOSTED']);
    expect(byId.get('odoo.foundation.edition')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.foundation.edition')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['COMMUNITY', 'ENTERPRISE']);
    expect(byId.get('odoo.foundation.usersInternalY1')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.foundation.usersInternalY3')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.foundation.portalUsers')?.inputType).toBe('BOOLEAN');
  });

  it('Country & Languages — 4 questions with the right ids + types', () => {
    const sec = foundation!.sections.find((s) => s.id === 'geography')!;
    expect(sec.label).toBe('Country & Languages');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.foundation.primaryCountry')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.foundation.otherCountries')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.foundation.reportingLanguage')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.foundation.uiLanguages')?.inputType).toBe('TEXTAREA');
  });

  it('Fiscal Calendar — 1 question (fiscalYearStart, TEXT)', () => {
    const sec = foundation!.sections.find((s) => s.id === 'fiscalcalendar')!;
    expect(sec.label).toBe('Fiscal Calendar');
    expect(sec.questions.map((q) => q.id)).toEqual(['odoo.foundation.fiscalYearStart']);
    expect(sec.questions[0].inputType).toBe('TEXT');
  });

  it('Multi-Company & Currency — 5 questions with the right ids + types', () => {
    const sec = foundation!.sections.find((s) => s.id === 'entities')!;
    expect(sec.label).toBe('Multi-Company & Currency');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.foundation.multiCompany')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.foundation.entityList')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.foundation.intercompanyAuto')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.foundation.multiCurrency')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.foundation.reportingCurrency')?.inputType).toBe('TEXT');
  });

  it('does not move the existing R2R "company" section (parallel, non-breaking)', () => {
    // We intentionally keep odoo.company.* in R2R alongside the new
    // odoo.foundation.* parallel set — duplicate-rationalization is a
    // future pack. This test pins that decision so a refactor that
    // moves them silently fails.
    const r2r = odooAdaptor.schema.flows.find((f) => f.id === 'R2R')!;
    const company = r2r.sections.find((s) => s.id === 'company')!;
    const qids = company.questions.map((q) => q.id);
    expect(qids).toContain('odoo.company.multiCompany');
    expect(qids).toContain('odoo.company.currency');
    expect(qids).toContain('odoo.company.fiscalYearStart');
  });
});

describe('odooAdaptor: Pack 1 — Foundation rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 Online disallows custom modules', () => {
    expect(ids).toContain('odoo.foundation.online-disallows-custom-modules');
  });

  it('R3 Odoo.sh requires Enterprise', () => {
    expect(ids).toContain('odoo.foundation.odoosh-requires-enterprise');
  });

  it('R4 multi-company needs entities', () => {
    expect(ids).toContain('odoo.foundation.multi-company-needs-entities');
  });

  it('R5 multi-currency needs reporting currency', () => {
    expect(ids).toContain('odoo.foundation.multi-currency-needs-reporting-currency');
  });

  it('R6 Online cost warning at scale (INFO)', () => {
    expect(ids).toContain('odoo.foundation.online-cost-warning-at-scale');
  });

  it('R7 country mandates e-invoicing (INFO)', () => {
    expect(ids).toContain('odoo.foundation.country-mandates-einvoicing');
  });
});

describe('odooAdaptor: Pack 1 — Foundation rule evaluation', () => {
  it('R1 fires when deployment=ONLINE AND ENTERPRISE_STUDIO is in license', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.deploymentMode': 'ONLINE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['ENTERPRISE_STUDIO'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.foundation.online-disallows-custom-modules');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R1 does NOT fire when deployment=ODOOSH (Studio is fine on Odoo.sh)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.deploymentMode': 'ODOOSH',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['ENTERPRISE_STUDIO'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.online-disallows-custom-modules');
  });

  it('R3 fires when Odoo.sh is selected on Community edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.deploymentMode': 'ODOOSH',
        'odoo.foundation.edition': 'COMMUNITY',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.foundation.odoosh-requires-enterprise');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire when deployment is SELFHOSTED on Community', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.deploymentMode': 'SELFHOSTED',
        'odoo.foundation.edition': 'COMMUNITY',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.odoosh-requires-enterprise');
  });

  it('R4 fires when multiCompany=true but entityList is empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.foundation.multi-company-needs-entities');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R4 does NOT fire when multiCompany=true AND entityList has content', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Acme Holding, AE, AED\nAcme Trading, EG, EGP',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.multi-company-needs-entities');
  });

  it('R5 fires (BLOCK) when multiCurrency=true AND reportingCurrency is empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCurrency': true,
        'odoo.foundation.reportingCurrency': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.foundation.multi-currency-needs-reporting-currency');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R5 does NOT fire when reportingCurrency is set', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCurrency': true,
        'odoo.foundation.reportingCurrency': 'USD',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.multi-currency-needs-reporting-currency');
  });

  it('R6 fires (INFO) when ONLINE deployment with Y3 users > 50', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.deploymentMode': 'ONLINE',
        'odoo.foundation.usersInternalY3': 75,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.foundation.online-cost-warning-at-scale');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R6 does NOT fire at the threshold or below (50 is NOT > 50)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.deploymentMode': 'ONLINE',
        'odoo.foundation.usersInternalY3': 50,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.online-cost-warning-at-scale');
  });

  it('R7 fires (INFO) for an e-invoicing-mandate country (e.g. SA)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.foundation.country-mandates-einvoicing');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R7 fires across the full mandate list (IT, MX, ES, FR, SA, EG, BR, IN, TR, DE, PL)', () => {
    for (const cc of ['IT', 'MX', 'ES', 'FR', 'SA', 'EG', 'BR', 'IN', 'TR', 'DE', 'PL']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.foundation.primaryCountry': cc,
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R7 should fire for country ${cc}`,
      ).toContain('odoo.foundation.country-mandates-einvoicing');
    }
  });

  it('R7 does NOT fire for a non-mandate country (e.g. US)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'US',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.country-mandates-einvoicing');
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
