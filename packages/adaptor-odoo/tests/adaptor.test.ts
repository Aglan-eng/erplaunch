import { describe, it, expect } from 'vitest';
import { validateAdaptor, evaluateAdaptorRules } from '@ofoq/adaptor-sdk';
import { AdaptorRegistry } from '@ofoq/adaptor-registry';
import odooAdaptor, { L10N_MODULES_BY_COUNTRY } from '../src/index.js';

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
  it('exposes FOUNDATION + TAX + LOCALIZATION + ACCOUNTING before the five canonical flows', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    // Pack 1 — Foundation gates everything downstream.
    // Pack 2 — Tax engine sits between Foundation and R2R.
    // Pack 3 — Localization & Compliance converts country answers into
    // hard requirements; sits after Tax, before R2R.
    // Pack 4 — Accounting & Multi-Company depth: reporting standards,
    // analytic axes, bank reconciliation, intercompany mechanics,
    // transfer pricing. Sits after Localization (so the COA template +
    // statutory standards are settled first) and before R2R.
    expect(ids).toEqual(['FOUNDATION', 'TAX', 'LOCALIZATION', 'ACCOUNTING', 'R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']);
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

// ─── Pack 2 — Tax Engine ─────────────────────────────────────────────────────

describe('odooAdaptor: Pack 2 — TAX flow shape', () => {
  const tax = odooAdaptor.schema.flows.find((f) => f.id === 'TAX');

  it('TAX flow exists with the expected label + description', () => {
    expect(tax).toBeDefined();
    expect(tax!.label).toBe('Tax Engine');
    expect(tax!.description).toMatch(/tax|fiscal|withholding|e-invoicing/i);
  });

  it('renders four sections in the documented order', () => {
    const ids = (tax!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['behavior', 'exemptions', 'advanced', 'compliance']);
  });

  it('Default Tax Behavior — 4 questions with the right ids + types', () => {
    const sec = tax!.sections.find((s) => s.id === 'behavior')!;
    expect(sec.label).toBe('Default Tax Behavior');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.tax.salesPriceMode')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.tax.salesPriceMode')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['EXCLUDED', 'INCLUDED']);
    expect(byId.get('odoo.tax.purchasePriceMode')?.inputType).toBe('SINGLE_SELECT');
    expect(byId.get('odoo.tax.defaultSalesTax')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.tax.defaultPurchaseTax')?.inputType).toBe('TEXT');
  });

  it('Exemptions & Special Categories — 4 questions with the right ids + types', () => {
    const sec = tax!.sections.find((s) => s.id === 'exemptions')!;
    expect(sec.label).toBe('Exemptions & Special Categories');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.tax.hasExemptCustomers')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.tax.exemptCategories')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.tax.hasReducedRates')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.tax.reducedRateCategories')?.inputType).toBe('TEXTAREA');
  });

  it('Advanced Tax Mechanics — 5 questions with the right ids + types', () => {
    const sec = tax!.sections.find((s) => s.id === 'advanced')!;
    expect(sec.label).toBe('Advanced Tax Mechanics');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.tax.reverseCharge')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.tax.withholding')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.tax.regionalVariation')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.tax.fiscalPositions')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.tax.fiscalPositionList')?.inputType).toBe('TEXTAREA');
  });

  it('Compliance & E-invoicing — 3 questions with the right ids + types', () => {
    const sec = tax!.sections.find((s) => s.id === 'compliance')!;
    expect(sec.label).toBe('Compliance & E-invoicing');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.tax.einvoicingRequired')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.tax.einvoicingRequired')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['NO', 'UNSURE', 'YES']);
    expect(byId.get('odoo.tax.einvoicingSystem')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.tax.taxFilingPeriodicity')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.tax.taxFilingPeriodicity')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ANNUAL', 'MONTHLY', 'QUARTERLY']);
  });
});

describe('odooAdaptor: Pack 2 — Tax rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 price-mode-mismatch', () => {
    expect(ids).toContain('odoo.tax.price-mode-mismatch');
  });
  it('R2 e-invoicing yes needs l10n', () => {
    expect(ids).toContain('odoo.tax.einvoicing-yes-needs-l10n');
  });
  it('R3 reverse-charge needs base accounting', () => {
    expect(ids).toContain('odoo.tax.reverse-charge-needs-base-accounting');
  });
  it('R4 withholding needs CoA accounts', () => {
    expect(ids).toContain('odoo.tax.withholding-needs-coa-accounts');
  });
  it('R5 fiscal positions need list', () => {
    expect(ids).toContain('odoo.tax.fiscal-positions-need-list');
  });
  it('R6 b2c price-mode on services-only license (INFO)', () => {
    expect(ids).toContain('odoo.tax.b2c-mode-on-services-only');
  });
  it('R7 regional variation needs multiple tax codes (INFO)', () => {
    expect(ids).toContain('odoo.tax.regional-variation-needs-multiple-tax-codes');
  });
  it('R8 exempt customers need fiscal position', () => {
    expect(ids).toContain('odoo.tax.exempt-customers-need-fiscal-position');
  });
});

describe('odooAdaptor: Pack 2 — Tax rule evaluation', () => {
  it('R1 fires when sales=INCLUDED and purchase=EXCLUDED (or vice versa)', () => {
    const a = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.salesPriceMode': 'INCLUDED',
        'odoo.tax.purchasePriceMode': 'EXCLUDED',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(a.find((c) => c.id === 'odoo.tax.price-mode-mismatch')?.severity).toBe('WARN');

    const b = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.salesPriceMode': 'EXCLUDED',
        'odoo.tax.purchasePriceMode': 'INCLUDED',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(b.find((c) => c.id === 'odoo.tax.price-mode-mismatch')).toBeDefined();
  });

  it('R1 does NOT fire when both modes match', () => {
    const c = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.salesPriceMode': 'EXCLUDED',
        'odoo.tax.purchasePriceMode': 'EXCLUDED',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(c.map((x) => x.id)).not.toContain('odoo.tax.price-mode-mismatch');
  });

  it('R2 fires (BLOCK) when einvoicing=YES and no l10n_<country> module is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.einvoicing-yes-needs-l10n');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire when einvoicing=YES AND a known l10n module is in the license', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING', 'l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.einvoicing-yes-needs-l10n');
  });

  it('R3 fires (BLOCK) when reverseCharge=true AND neither BASE nor ENTERPRISE Accounting is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.reverseCharge': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.reverse-charge-needs-base-accounting');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire when BASE_ACCOUNTING is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.reverseCharge': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.reverse-charge-needs-base-accounting');
  });

  it('R3 does NOT fire when ENTERPRISE_ACCOUNTING is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.reverseCharge': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['ENTERPRISE_ACCOUNTING'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.reverse-charge-needs-base-accounting');
  });

  it('R4 fires (WARN) when withholding=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.withholding': true, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.withholding-needs-coa-accounts');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R4 does NOT fire when withholding is false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.withholding': false, 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.withholding-needs-coa-accounts');
  });

  it('R5 fires (WARN) when fiscalPositions=true and fiscalPositionList is empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.fiscalPositions': true,
        'odoo.tax.fiscalPositionList': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.fiscal-positions-need-list');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire when fiscalPositionList is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.fiscalPositions': true,
        'odoo.tax.fiscalPositionList': 'Domestic\nExport — GCC',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.fiscal-positions-need-list');
  });

  it('R6 fires (INFO) when salesPriceMode=INCLUDED and no POS / eCommerce module is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.salesPriceMode': 'INCLUDED', 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['BASE_ACCOUNTING'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.b2c-mode-on-services-only');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R6 does NOT fire when ECOMMERCE is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.salesPriceMode': 'INCLUDED', 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['ECOMMERCE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.b2c-mode-on-services-only');
  });

  it('R6 does NOT fire when POINT_OF_SALE is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.tax.salesPriceMode': 'INCLUDED', 'odoo.company.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.b2c-mode-on-services-only');
  });

  it('R7 fires (INFO) when regionalVariation=true and fiscalPositionList is empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.regionalVariation': true,
        'odoo.tax.fiscalPositionList': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.regional-variation-needs-multiple-tax-codes');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R7 does NOT fire when regionalVariation=true AND fiscalPositionList has entries', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.regionalVariation': true,
        'odoo.tax.fiscalPositionList': 'Region A\nRegion B',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.tax.regional-variation-needs-multiple-tax-codes');
  });

  it('R8 fires (WARN) when hasExemptCustomers=true and fiscalPositions=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.hasExemptCustomers': true,
        'odoo.tax.fiscalPositions': false,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.exempt-customers-need-fiscal-position');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R8 does NOT fire when hasExemptCustomers=true AND fiscalPositions=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.hasExemptCustomers': true,
        'odoo.tax.fiscalPositions': true,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.tax.exempt-customers-need-fiscal-position');
  });
});

// ─── Pack 3 — Localization & Compliance ──────────────────────────────────────

describe('odooAdaptor: Pack 3 — L10N_MODULES_BY_COUNTRY constant export', () => {
  it('exports the country lookup table with the documented shape', () => {
    expect(L10N_MODULES_BY_COUNTRY).toBeDefined();
    expect(typeof L10N_MODULES_BY_COUNTRY).toBe('object');
    // Spot check the canonical entries called out in the pack spec.
    expect(L10N_MODULES_BY_COUNTRY['SA']?.module).toBe('l10n_sa');
    expect(L10N_MODULES_BY_COUNTRY['SA']?.einvoicingMandatory).toBe(true);
    expect(L10N_MODULES_BY_COUNTRY['SA']?.einvoicingSystem).toContain('ZATCA');
    expect(L10N_MODULES_BY_COUNTRY['IT']?.einvoicingSystem).toContain('SDI');
    expect(L10N_MODULES_BY_COUNTRY['MX']?.einvoicingSystem).toContain('CFDI');
    expect(L10N_MODULES_BY_COUNTRY['AE']?.module).toBe('l10n_ae');
    expect(L10N_MODULES_BY_COUNTRY['US']?.module).toBe('l10n_us');
    expect(L10N_MODULES_BY_COUNTRY['GB']?.module).toBe('l10n_uk');
    // Mandate countries must include all 11 from Pack 1 R7's original list.
    for (const cc of ['IT', 'MX', 'ES', 'FR', 'SA', 'EG', 'BR', 'IN', 'TR', 'DE', 'PL']) {
      expect(L10N_MODULES_BY_COUNTRY[cc]?.einvoicingMandatory, `${cc} should be a mandate country`).toBe(true);
    }
  });

  it('every entry has a non-empty module field', () => {
    for (const [cc, info] of Object.entries(L10N_MODULES_BY_COUNTRY)) {
      expect(info.module, `${cc} missing module`).toBeTruthy();
      expect(info.module.startsWith('l10n_'), `${cc} module ${info.module} should be l10n_*`).toBe(true);
    }
  });
});

describe('odooAdaptor: Pack 3 — LOCALIZATION flow shape', () => {
  const loc = odooAdaptor.schema.flows.find((f) => f.id === 'LOCALIZATION');

  it('LOCALIZATION flow exists with the expected label + description', () => {
    expect(loc).toBeDefined();
    expect(loc!.label).toBe('Localization & Compliance');
    expect(loc!.description).toMatch(/COA|statutory|e-invoicing|tax filing/i);
  });

  it('renders four sections in the documented order', () => {
    const ids = (loc!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['coatemplate', 'einvoicing', 'payroll', 'datasovereignty']);
  });

  it('Country COA & Statutory — 3 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'coatemplate')!;
    expect(sec.label).toBe('Country COA & Statutory');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.localization.coaTemplate')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.localization.statutoryReports')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.localization.languagePackInstall')?.inputType).toBe('BOOLEAN');
  });

  it('E-Invoicing System — 4 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'einvoicing')!;
    expect(sec.label).toBe('E-Invoicing System');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.localization.einvoicingProvider')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.localization.einvoicingPhase')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.localization.einvoicingPilotDone')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.localization.einvoicingPilotDone')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['IN_PROGRESS', 'NO', 'N_A', 'YES']);
    expect(byId.get('odoo.localization.einvoicingDigitalCert')?.inputType).toBe('SINGLE_SELECT');
  });

  it('Country-Specific Payroll — 3 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'payroll')!;
    expect(sec.label).toBe('Country-Specific Payroll');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.localization.payrollInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.localization.payrollFrequency')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.localization.payrollFrequency')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BIWEEKLY', 'MONTHLY', 'OTHER', 'WEEKLY']);
    expect(byId.get('odoo.localization.payrollEndOfService')?.inputType).toBe('TEXTAREA');
  });

  it('Data Sovereignty & Residency — 3 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'datasovereignty')!;
    expect(sec.label).toBe('Data Sovereignty & Residency');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.localization.dataResidencyRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.localization.dataResidencyJurisdiction')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.localization.gdprApplicable')?.inputType).toBe('BOOLEAN');
  });
});

describe('odooAdaptor: Pack 3 — Localization rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 COA template required', () => {
    expect(ids).toContain('odoo.localization.coa-template-required');
  });
  it('R2 e-invoicing mandatory confirmed', () => {
    expect(ids).toContain('odoo.localization.einvoicing-mandatory-confirmed');
  });
  it('R3 e-invoicing system must match country', () => {
    expect(ids).toContain('odoo.localization.einvoicing-system-must-match-country');
  });
  it('R4 e-invoicing needs digital cert', () => {
    expect(ids).toContain('odoo.localization.einvoicing-needs-digital-cert');
  });
  it('R5 e-invoicing needs pilot completion', () => {
    expect(ids).toContain('odoo.localization.einvoicing-needs-pilot-completion');
  });
  it('R6 payroll needs l10n hr_payroll', () => {
    expect(ids).toContain('odoo.localization.payroll-needs-l10n-hr-payroll');
  });
  it('R7 data residency blocks online', () => {
    expect(ids).toContain('odoo.localization.data-residency-blocks-online');
  });
  it('R8 GDPR needs portal config (INFO)', () => {
    expect(ids).toContain('odoo.localization.gdpr-needs-portal-config');
  });
  it('R9 e-invoicing Phase 2 needs base modules', () => {
    expect(ids).toContain('odoo.localization.einvoicing-phase2-needs-base-modules');
  });
});

describe('odooAdaptor: Pack 3 — Localization rule evaluation', () => {
  it('R1 fires when primaryCountry=SA AND no l10n_sa AND coaTemplate empty (BLOCK)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.localization.coaTemplate': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.coa-template-required');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R1 does NOT fire when primaryCountry=SA AND l10n_sa is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.localization.coaTemplate': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.localization.coa-template-required');
  });

  it('R1 does NOT fire when consultant typed an l10n hint into coaTemplate', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.localization.coaTemplate': 'l10n_sa (will install during config phase)',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.localization.coa-template-required');
  });

  it('R2 fires (BLOCK) when primaryCountry mandates e-invoicing AND einvoicingRequired=NO', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'IT',
        'odoo.tax.einvoicingRequired': 'NO',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_it'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.einvoicing-mandatory-confirmed');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire for non-mandate country (US)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'US',
        'odoo.tax.einvoicingRequired': 'NO',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_us'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.localization.einvoicing-mandatory-confirmed');
  });

  it('R3 fires (WARN) when country has known e-invoicing system AND einvoicingProvider is empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.localization.einvoicingProvider': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.einvoicing-system-must-match-country');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 does NOT fire when einvoicingProvider is populated (consultant trust)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.localization.einvoicingProvider': 'ZATCA Phase 2',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.localization.einvoicing-system-must-match-country');
  });

  it('R4 fires (BLOCK) when einvoicingRequired=YES AND digitalCert=NO', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.localization.einvoicingDigitalCert': 'NO',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.einvoicing-needs-digital-cert');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 also fires when digitalCert is undefined / not yet answered', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.localization.einvoicing-needs-digital-cert');
  });

  it('R4 does NOT fire when digitalCert=YES', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.localization.einvoicingDigitalCert': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.localization.einvoicing-needs-digital-cert');
  });

  it('R5 fires (WARN) when einvoicingRequired=YES AND pilotDone in NO/IN_PROGRESS/missing', () => {
    for (const status of ['NO', 'IN_PROGRESS', undefined] as const) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.tax.einvoicingRequired': 'YES',
          ...(status ? { 'odoo.localization.einvoicingPilotDone': status } : {}),
          'odoo.foundation.primaryCountry': 'SA',
          'odoo.localization.einvoicingDigitalCert': 'YES',
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
      });
      const r = conflicts.find((c) => c.id === 'odoo.localization.einvoicing-needs-pilot-completion');
      expect(r, `R5 should fire when pilotDone=${status ?? 'undefined'}`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R5 does NOT fire when pilotDone=YES', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.localization.einvoicingPilotDone': 'YES',
        'odoo.localization.einvoicingDigitalCert': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.localization.einvoicing-needs-pilot-completion');
  });

  it('R6 fires (BLOCK) when payrollInScope=true AND no HR/PAYROLL module', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.payrollInScope': true,
        'odoo.foundation.primaryCountry': 'AE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.payroll-needs-l10n-hr-payroll');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R6 does NOT fire when HR module is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.payrollInScope': true,
        'odoo.foundation.primaryCountry': 'AE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['HR'] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.localization.payroll-needs-l10n-hr-payroll');
  });

  it('R7 fires (BLOCK) when dataResidencyRequired=true AND deployment=ONLINE', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.dataResidencyRequired': true,
        'odoo.foundation.deploymentMode': 'ONLINE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.data-residency-blocks-online');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R7 does NOT fire on Self-hosted deployment', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.dataResidencyRequired': true,
        'odoo.foundation.deploymentMode': 'SELFHOSTED',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.localization.data-residency-blocks-online');
  });

  it('R8 fires (INFO) when GDPR + portal users both true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.gdprApplicable': true,
        'odoo.foundation.portalUsers': true,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.localization.gdpr-needs-portal-config');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R8 does NOT fire when no portal users', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.gdprApplicable': true,
        'odoo.foundation.portalUsers': false,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.localization.gdpr-needs-portal-config');
  });

  it('R9 fires (WARN) when einvoicingPhase mentions Phase 2 AND no Accounting module', () => {
    for (const phase of ['Phase 2', 'phase 2', 'P2P']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.localization.einvoicingPhase': phase,
          'odoo.foundation.primaryCountry': 'SA',
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
      });
      const r = conflicts.find((c) => c.id === 'odoo.localization.einvoicing-phase2-needs-base-modules');
      expect(r, `R9 should fire when einvoicingPhase="${phase}"`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R9 does NOT fire when Accounting is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.localization.einvoicingPhase': 'Phase 2',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa', 'BASE_ACCOUNTING'] },
    });
    expect(conflicts.map((c) => c.id))
      .not.toContain('odoo.localization.einvoicing-phase2-needs-base-modules');
  });
});

describe('odooAdaptor: Pack 3 — existing rules updated to use the country lookup', () => {
  it('Pack 1 R7 still fires for every country in the L10N_MODULES_BY_COUNTRY mandate set', () => {
    const mandateCountries = Object.entries(L10N_MODULES_BY_COUNTRY)
      .filter(([, v]) => v.einvoicingMandatory)
      .map(([cc]) => cc);
    expect(mandateCountries.length).toBeGreaterThan(11);  // pack 1 had 11; pack 3 lookup adds more
    for (const cc of mandateCountries) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.foundation.primaryCountry': cc,
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: [L10N_MODULES_BY_COUNTRY[cc].module] },
      });
      expect(
        conflicts.map((c) => c.id),
        `Pack 1 R7 should fire for mandate country ${cc}`,
      ).toContain('odoo.foundation.country-mandates-einvoicing');
    }
  });

  it('Pack 1 R7 does NOT fire for non-mandate country (US)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.primaryCountry': 'US',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_us'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.foundation.country-mandates-einvoicing');
  });

  it('Pack 2 R2 now uses country-aware lookup: fires when primaryCountry=SA AND l10n_sa missing, even if l10n_us is licensed', () => {
    // Country-mismatch case: client is in SA but licensed l10n_us. The
    // old hardcoded list would have passed because l10n_us is in it;
    // the new country-aware check should fire.
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_us'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.tax.einvoicing-yes-needs-l10n');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('Pack 2 R2 does NOT fire when the licensed l10n matches primaryCountry', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.tax.einvoicingRequired': 'YES',
        'odoo.foundation.primaryCountry': 'SA',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: ['l10n_sa'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.tax.einvoicing-yes-needs-l10n');
  });
});

// ─── Pack 4 — Accounting & Multi-Company depth ───────────────────────────────

describe('odooAdaptor: Pack 4 — ACCOUNTING flow shape', () => {
  const acc = odooAdaptor.schema.flows.find((f) => f.id === 'ACCOUNTING');

  it('ACCOUNTING flow exists with the expected label + description', () => {
    expect(acc).toBeDefined();
    expect(acc!.label).toBe('Accounting & Multi-Company');
    expect(acc!.description).toMatch(/reporting|analytic|bank|inter-?company|currency/i);
  });

  it('renders four sections in the documented order', () => {
    const ids = (acc!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['standards', 'analytic', 'bankrecon', 'intercompany']);
  });

  it('Reporting & Standards — 5 questions with the right ids + types', () => {
    const sec = acc!.sections.find((s) => s.id === 'standards')!;
    expect(sec.label).toBe('Reporting & Standards');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.accounting.reportingStandard')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.reportingStandard')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['IFRS', 'LOCAL_GAAP', 'OTHER', 'US_GAAP']);
    expect(byId.get('odoo.accounting.tradition')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.tradition')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ANGLO_SAXON', 'CONTINENTAL']);
    expect(byId.get('odoo.accounting.basis')?.inputType).toBe('SINGLE_SELECT');
    expect(byId.get('odoo.accounting.closeCadence')?.inputType).toBe('SINGLE_SELECT');
    expect(byId.get('odoo.accounting.lockDatesPolicy')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.lockDatesPolicy')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['FULL_LOCK', 'NONE', 'TAX_LOCK']);
  });

  it('Analytic Accounting & Budgets — 4 questions with the right ids + types', () => {
    const sec = acc!.sections.find((s) => s.id === 'analytic')!;
    expect(sec.label).toBe('Analytic Accounting & Budgets');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.accounting.analyticAxes')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.accounting.budgetsInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.accounting.budgetControlMode')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.budgetControlMode')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BLOCKING', 'INFORMATIONAL', 'WARNING']);
    expect(byId.get('odoo.accounting.consolidationInScope')?.inputType).toBe('BOOLEAN');
  });

  it('Bank Feeds & Reconciliation — 4 questions with the right ids + types', () => {
    const sec = acc!.sections.find((s) => s.id === 'bankrecon')!;
    expect(sec.label).toBe('Bank Feeds & Reconciliation');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.accounting.bankFeedIntegration')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.accounting.bankStatementFormat')?.inputType).toBe('TEXT');
    expect(byId.get('odoo.accounting.reconciliationMethod')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.reconciliationMethod')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['AUTO_RULES', 'AUTO_SUGGEST', 'MANUAL']);
    expect(byId.get('odoo.accounting.currencyRevalCadence')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.currencyRevalCadence')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['MONTHLY', 'NONE', 'ON_DEMAND', 'QUARTERLY']);
  });

  it('Inter-Company Mechanics — 4 questions with the right ids + types', () => {
    const sec = acc!.sections.find((s) => s.id === 'intercompany')!;
    expect(sec.label).toBe('Inter-Company Mechanics');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.accounting.intercompanyValidation')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.intercompanyValidation')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['AUTO_DRAFT', 'AUTO_VALIDATE', 'MANUAL', 'NA']);
    expect(byId.get('odoo.accounting.intercompanyCurrencyRule')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.intercompanyCurrencyRule')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BUYER_CURRENCY', 'GROUP_CURRENCY', 'NA', 'SELLER_CURRENCY']);
    expect(byId.get('odoo.accounting.transferPricingPolicy')?.inputType).toBe('SINGLE_SELECT');
    expect(byId.get('odoo.accounting.sharedAccountsStrategy')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.accounting.sharedAccountsStrategy')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['CONSOLIDATION_ONLY', 'PER_COMPANY', 'SHARED']);
  });
});

describe('odooAdaptor: Pack 4 — Accounting rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 cash basis conflicts with IFRS', () => {
    expect(ids).toContain('odoo.accounting.cash-basis-conflicts-with-ifrs');
  });
  it('R2 multi-currency needs reval cadence', () => {
    expect(ids).toContain('odoo.accounting.multi-currency-needs-reval-cadence');
  });
  it('R3 budgets need analytic axes', () => {
    expect(ids).toContain('odoo.accounting.budgets-need-analytic-axes');
  });
  it('R4 consolidation needs multi-entity', () => {
    expect(ids).toContain('odoo.accounting.consolidation-needs-multi-entity');
  });
  it('R5 bank feeds need Enterprise', () => {
    expect(ids).toContain('odoo.accounting.bank-feeds-need-enterprise');
  });
  it('R6 bank feeds on self-hosted needs connector (INFO)', () => {
    expect(ids).toContain('odoo.accounting.bank-feeds-on-selfhosted-needs-connector');
  });
  it('R7 intercompany auto-validate risk', () => {
    expect(ids).toContain('odoo.accounting.intercompany-auto-validate-risk');
  });
  it('R8 transfer pricing without multi-entity', () => {
    expect(ids).toContain('odoo.accounting.transfer-pricing-without-multi-entity');
  });
  it('R9 lockdates recommended for monthly close (INFO)', () => {
    expect(ids).toContain('odoo.accounting.lockdates-recommended-for-monthly-close');
  });
});

describe('odooAdaptor: Pack 4 — Accounting rule evaluation', () => {
  it('R1 fires (WARN) when basis=CASH AND reportingStandard=IFRS', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.basis': 'CASH',
        'odoo.accounting.reportingStandard': 'IFRS',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.cash-basis-conflicts-with-ifrs');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R1 does NOT fire when basis=ACCRUAL', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.basis': 'ACCRUAL',
        'odoo.accounting.reportingStandard': 'IFRS',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.cash-basis-conflicts-with-ifrs');
  });

  it('R2 fires (WARN) when multiCurrency=true AND currencyRevalCadence=NONE or unset', () => {
    for (const cadence of ['NONE', undefined] as const) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.foundation.multiCurrency': true,
          ...(cadence ? { 'odoo.accounting.currencyRevalCadence': cadence } : {}),
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'odoo.accounting.multi-currency-needs-reval-cadence');
      expect(r, `R2 should fire when cadence=${cadence ?? 'undefined'}`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R2 does NOT fire when cadence=MONTHLY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCurrency': true,
        'odoo.accounting.currencyRevalCadence': 'MONTHLY',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.multi-currency-needs-reval-cadence');
  });

  it('R3 fires (WARN) when budgetsInScope=true AND analyticAxes empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.budgetsInScope': true,
        'odoo.accounting.analyticAxes': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.budgets-need-analytic-axes');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 does NOT fire when analyticAxes is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.budgetsInScope': true,
        'odoo.accounting.analyticAxes': 'Cost Centers\nProjects',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.budgets-need-analytic-axes');
  });

  it('R4 fires (BLOCK) when consolidationInScope=true AND multiCompany=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.consolidationInScope': true,
        'odoo.foundation.multiCompany': false,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.consolidation-needs-multi-entity');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 fires (BLOCK) when consolidationInScope=true AND entityList empty (even with multiCompany=true)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.consolidationInScope': true,
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': '',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.accounting.consolidation-needs-multi-entity');
  });

  it('R4 does NOT fire when consolidationInScope=true AND multi-company entities populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.consolidationInScope': true,
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Holdco, AE, AED\nSubco, EG, EGP',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.consolidation-needs-multi-entity');
  });

  it('R5 fires (BLOCK) when bankFeedIntegration=true AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.bankFeedIntegration': true,
        'odoo.foundation.edition': 'COMMUNITY',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.bank-feeds-need-enterprise');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R5 does NOT fire on Enterprise edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.bankFeedIntegration': true,
        'odoo.foundation.edition': 'ENTERPRISE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.bank-feeds-need-enterprise');
  });

  it('R6 fires (INFO) when bankFeedIntegration=true AND deploymentMode=SELFHOSTED', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.bankFeedIntegration': true,
        'odoo.foundation.deploymentMode': 'SELFHOSTED',
        'odoo.foundation.edition': 'ENTERPRISE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.bank-feeds-on-selfhosted-needs-connector');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R6 does NOT fire on Odoo.sh deployment', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.bankFeedIntegration': true,
        'odoo.foundation.deploymentMode': 'ODOOSH',
        'odoo.foundation.edition': 'ENTERPRISE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.bank-feeds-on-selfhosted-needs-connector');
  });

  it('R7 fires (WARN) when intercompanyValidation=AUTO_VALIDATE', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.intercompanyValidation': 'AUTO_VALIDATE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.intercompany-auto-validate-risk');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 does NOT fire when intercompanyValidation=AUTO_DRAFT', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.intercompanyValidation': 'AUTO_DRAFT',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.intercompany-auto-validate-risk');
  });

  it('R8 fires (WARN) when transferPricingPolicy is a real policy AND multiCompany=false', () => {
    for (const policy of ['COST_PLUS', 'MARKET', 'FIXED_MARGIN']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.accounting.transferPricingPolicy': policy,
          'odoo.foundation.multiCompany': false,
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'odoo.accounting.transfer-pricing-without-multi-entity');
      expect(r, `R8 should fire when policy=${policy}`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R8 does NOT fire when policy=NA', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.transferPricingPolicy': 'NA',
        'odoo.foundation.multiCompany': false,
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.transfer-pricing-without-multi-entity');
  });

  it('R8 does NOT fire when multiCompany=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.transferPricingPolicy': 'COST_PLUS',
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Holdco, AE, AED\nSubco, EG, EGP',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.accounting.transfer-pricing-without-multi-entity');
  });

  it('R9 fires (INFO) when closeCadence=MONTHLY AND lockDatesPolicy=NONE', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.closeCadence': 'MONTHLY',
        'odoo.accounting.lockDatesPolicy': 'NONE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.accounting.lockdates-recommended-for-monthly-close');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R9 also fires for closeCadence=BOTH', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.accounting.closeCadence': 'BOTH',
        'odoo.accounting.lockDatesPolicy': 'NONE',
        'odoo.company.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.accounting.lockdates-recommended-for-monthly-close');
  });

  it('R9 does NOT fire when lockDatesPolicy=TAX_LOCK or FULL_LOCK', () => {
    for (const policy of ['TAX_LOCK', 'FULL_LOCK']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.accounting.closeCadence': 'MONTHLY',
          'odoo.accounting.lockDatesPolicy': policy,
          'odoo.company.fiscalYearStart': '01-01',
        },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R9 should NOT fire when lockDatesPolicy=${policy}`,
      ).not.toContain('odoo.accounting.lockdates-recommended-for-monthly-close');
    }
  });
});
