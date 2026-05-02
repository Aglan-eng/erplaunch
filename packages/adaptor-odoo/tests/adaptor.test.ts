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
  it('exposes the canonical Odoo App-shaped flow order (Pack R + Pack 8 + Pack 9)', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    // Pack R — Restructure to Odoo App shape.
    // Pack 8 — REVENUE_APPS (POS + eCommerce + Subscriptions) between
    //          Sales and Manufacturing.
    // Pack 9 — OPERATIONS_APPS (HR + Project + CRM) between Revenue
    //          Apps and Manufacturing. Closes the Odoo content track.
    expect(ids).toEqual([
      'FOUNDATION', 'ACCOUNTING', 'TAX', 'LOCALIZATION', 'INVENTORY',
      'P2P', 'O2C', 'REVENUE_APPS', 'OPERATIONS_APPS',
      'MANUFACTURING', 'RETURNS', 'MIGRATION',
    ]);
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

  it('Pack R — R2R flow has been deleted; odoo.company.* are no longer live questions', () => {
    expect(odooAdaptor.schema.flows.find((f) => f.id === 'R2R')).toBeUndefined();
    const allQuestionIds = new Set<string>();
    for (const flow of odooAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) allQuestionIds.add(q.id);
      }
    }
    expect(allQuestionIds.has('odoo.company.multiCompany')).toBe(false);
    expect(allQuestionIds.has('odoo.company.currency')).toBe(false);
    expect(allQuestionIds.has('odoo.company.fiscalYearStart')).toBe(false);
    expect(allQuestionIds.has('odoo.coa.template')).toBe(false);
    expect(allQuestionIds.has('odoo.coa.analyticAccounting')).toBe(false);
  });

  it('Pack R — PRODUCTION flow has been deleted; odoo.mrp.* are no longer live questions', () => {
    expect(odooAdaptor.schema.flows.find((f) => f.id === 'PRODUCTION')).toBeUndefined();
    const allQuestionIds = new Set<string>();
    for (const flow of odooAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) allQuestionIds.add(q.id);
      }
    }
    expect(allQuestionIds.has('odoo.mrp.enabled')).toBe(false);
    expect(allQuestionIds.has('odoo.mrp.workCenters')).toBe(false);
    expect(allQuestionIds.has('odoo.mrp.quality')).toBe(false);
  });

  it('Pack R — P2P flow renders as "Purchase" (label changed; id stays for backward-compat)', () => {
    const p2p = odooAdaptor.schema.flows.find((f) => f.id === 'P2P')!;
    expect(p2p.label).toBe('Purchase');
  });

  it('Pack R — O2C flow renders as "Sales" with Invoicing merged in (label + section changes)', () => {
    const o2c = odooAdaptor.schema.flows.find((f) => f.id === 'O2C')!;
    expect(o2c.label).toBe('Sales');
    // Single Sales section now includes the invoicing.policy question.
    const sales = o2c.sections.find((s) => s.id === 'sales')!;
    const qids = sales.questions.map((q) => q.id);
    expect(qids).toContain('odoo.sales.quoteTemplate');
    expect(qids).toContain('odoo.sales.priceListStrategy');
    expect(qids).toContain('odoo.invoicing.policy');
    // The standalone "invoicing" section no longer exists.
    expect(o2c.sections.find((s) => s.id === 'invoicing')).toBeUndefined();
  });

  it('Pack R — MANUFACTURING flow (was MANUFACTURING_DEPTH) — id + label both updated', () => {
    expect(odooAdaptor.schema.flows.find((f) => f.id === 'MANUFACTURING_DEPTH')).toBeUndefined();
    const mfg = odooAdaptor.schema.flows.find((f) => f.id === 'MANUFACTURING')!;
    expect(mfg.label).toBe('Manufacturing');
  });

  it('Pack R — odoo.mrp.sub-settings-without-parent rule has been deleted', () => {
    const ids = odooAdaptor.rules.rules.map((r) => r.id);
    expect(ids).not.toContain('odoo.mrp.sub-settings-without-parent');
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
  it('clean Enterprise scoping raises no conflicts (Pack R repointed answer keys)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Holdco AE\nSubco EG',
        'odoo.foundation.fiscalYearStart': '01-01',
        'odoo.accounting.analyticAxes': 'Cost Centers\nProjects',
        'odoo.mfg.routingRequired': true,
        'odoo.mfg.workCenterCount': 6,
        'odoo.mfg.qualityPlansRequired': true,
        'odoo.sales.priceListStrategy': 'SINGLE',
      },
      license: {
        edition: 'ENTERPRISE',
        modules: ['MRP', 'QUALITY', 'ENTERPRISE_STUDIO', 'ENTERPRISE_DOCUMENTS', 'HELPDESK'],
      },
    });
    expect(conflicts).toEqual([]);
  });

  it('flags Manufacturing-in-scope with missing MRP module (BLOCK) — repointed to mfg.routingRequired', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.routingRequired': true, 'odoo.foundation.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const ids = conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.mrp.requires-mrp-module');
    expect(conflicts.find((c) => c.id === 'odoo.mrp.requires-mrp-module')?.severity).toBe('BLOCK');
  });

  it('flags Studio on Community edition (BLOCK)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.foundation.fiscalYearStart': '01-01' },
      license: { edition: 'COMMUNITY', modules: ['ENTERPRISE_STUDIO'] },
    });
    const ids = conflicts.map((c) => c.id);
    expect(ids).toContain('odoo.studio-is-enterprise-only');
  });

  it('flags Quality plans without MRP or QUALITY modules (BLOCK) — repointed to mfg.qualityPlansRequired', () => {
    const missingMrp = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.qualityPlansRequired': true, 'odoo.foundation.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['QUALITY'] },
    });
    expect(missingMrp.map((c) => c.id)).toContain('odoo.mrp.quality-requires-mrp-and-quality');

    const missingQuality = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.qualityPlansRequired': true, 'odoo.foundation.fiscalYearStart': '01-01' },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(missingQuality.map((c) => c.id)).toContain('odoo.mrp.quality-requires-mrp-and-quality');
  });

  it('warns when multi-company is on but analytic axes is empty (Pack R repointed)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.foundation.multiCompany': true,
        'odoo.accounting.analyticAxes': '',
        'odoo.foundation.fiscalYearStart': '01-01',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.company.multi-company-needs-analytic');
  });

  it('warns when fiscal year start is missing (Pack R repointed to foundation.fiscalYearStart)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {},
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.company.fiscal-year-start-required');
  });

  it('INFO-level nudge on customer-tier pricelist strategy', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.sales.priceListStrategy': 'CUSTOMER_TIER', 'odoo.foundation.fiscalYearStart': '01-01' },
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

// ─── Pack 5 — Inventory & Valuation depth ────────────────────────────────────

describe('odooAdaptor: Pack 5 — INVENTORY flow shape', () => {
  const inv = odooAdaptor.schema.flows.find((f) => f.id === 'INVENTORY');

  it('INVENTORY flow exists with the expected label + description', () => {
    expect(inv).toBeDefined();
    expect(inv!.label).toBe('Inventory & Valuation');
    expect(inv!.description).toMatch(/warehouse|valuation|lot|serial|replenishment|removal/i);
  });

  it('INVENTORY sits between LOCALIZATION and P2P (Purchase) in the Pack R flow order', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    const locIdx = ids.indexOf('LOCALIZATION');
    const invIdx = ids.indexOf('INVENTORY');
    const p2pIdx = ids.indexOf('P2P');
    expect(invIdx).toBe(locIdx + 1);
    expect(p2pIdx).toBe(invIdx + 1);
  });

  it('renders four sections in the documented order', () => {
    const ids = (inv!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['warehouses', 'valuation', 'tracking', 'operations']);
  });

  it('Warehouse Structure — 4 questions with the right ids + types', () => {
    const sec = inv!.sections.find((s) => s.id === 'warehouses')!;
    expect(sec.label).toBe('Warehouse Structure');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.inventory.warehouseCount')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.inventory.warehouseTypes')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.inventory.transferRules')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.inventory.crossDocking')?.inputType).toBe('BOOLEAN');
  });

  it('Valuation & Costing — 4 questions with the right ids + types + options', () => {
    const sec = inv!.sections.find((s) => s.id === 'valuation')!;
    expect(sec.label).toBe('Valuation & Costing');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.inventory.valuationMethod')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.inventory.valuationMethod')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['AVCO', 'FIFO', 'STANDARD']);
    expect(byId.get('odoo.inventory.removalStrategy')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.inventory.removalStrategy')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['CLOSEST', 'FEFO', 'FIFO', 'LIFO']);
    expect(byId.get('odoo.inventory.landedCosts')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.inventory.negativeStockAllowed')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.inventory.negativeStockAllowed')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ALLOWED', 'MIGRATION_ONLY', 'NEVER']);
  });

  it('Lot / Serial / Expiration Tracking — 5 questions with the right ids + types', () => {
    const sec = inv!.sections.find((s) => s.id === 'tracking')!;
    expect(sec.label).toBe('Lot / Serial / Expiration Tracking');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.inventory.lotsSerialsRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.inventory.lotProductCategories')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.inventory.serialProductCategories')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.inventory.expirationTracking')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.inventory.barcodeScanning')?.inputType).toBe('BOOLEAN');
  });

  it('Replenishment & Operations — 4 questions with the right ids + types + options', () => {
    const sec = inv!.sections.find((s) => s.id === 'operations')!;
    expect(sec.label).toBe('Replenishment & Operations');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.inventory.replenishmentStrategy')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.inventory.replenishmentStrategy')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['MIN_MAX', 'MIXED', 'MTO', 'MTS']);
    expect(byId.get('odoo.inventory.dropShip')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.inventory.countMethod')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.inventory.countMethod')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ANNUAL', 'BOTH', 'CYCLE']);
    expect(byId.get('odoo.inventory.putawayRules')?.inputType).toBe('BOOLEAN');
  });
});

describe('odooAdaptor: Pack 5 — Inventory rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 LIFO banned under IFRS', () => {
    expect(ids).toContain('odoo.inventory.lifo-banned-under-ifrs');
  });
  it('R2 FEFO needs expiration tracking', () => {
    expect(ids).toContain('odoo.inventory.fefo-needs-expiration-tracking');
  });
  it('R3 lots required but no categories listed', () => {
    expect(ids).toContain('odoo.inventory.lots-required-no-categories-listed');
  });
  it('R4 multi-warehouse needs transfer rules', () => {
    expect(ids).toContain('odoo.inventory.multi-warehouse-needs-transfer-rules');
  });
  it('R5 landed costs need Enterprise', () => {
    expect(ids).toContain('odoo.inventory.landed-costs-need-enterprise');
  });
  it('R6 MTO without MRP (INFO)', () => {
    expect(ids).toContain('odoo.inventory.mto-without-mrp');
  });
  it('R7 negative stock with Anglo-Saxon', () => {
    expect(ids).toContain('odoo.inventory.negative-stock-with-anglo-saxon');
  });
  it('R8 dropship needs Purchase + Sales', () => {
    expect(ids).toContain('odoo.inventory.dropship-needs-purchase-and-sales');
  });
  it('R9 barcode needs app or IoT (INFO)', () => {
    expect(ids).toContain('odoo.inventory.barcode-needs-app-or-iot');
  });
});

describe('odooAdaptor: Pack 5 — Inventory rule evaluation', () => {
  it('R1 fires (BLOCK) when removalStrategy=LIFO AND reportingStandard=IFRS', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.removalStrategy': 'LIFO',
        'odoo.accounting.reportingStandard': 'IFRS',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.lifo-banned-under-ifrs');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R1 does NOT fire under US_GAAP', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.removalStrategy': 'LIFO',
        'odoo.accounting.reportingStandard': 'US_GAAP',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.lifo-banned-under-ifrs');
  });

  it('R1 does NOT fire when removalStrategy=FIFO', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.removalStrategy': 'FIFO',
        'odoo.accounting.reportingStandard': 'IFRS',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.lifo-banned-under-ifrs');
  });

  it('R2 fires (BLOCK) when removalStrategy=FEFO AND expirationTracking=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.removalStrategy': 'FEFO',
        'odoo.inventory.expirationTracking': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.fefo-needs-expiration-tracking');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire when expirationTracking=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.removalStrategy': 'FEFO',
        'odoo.inventory.expirationTracking': true,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.fefo-needs-expiration-tracking');
  });

  it('R3 fires (WARN) when lotsSerialsRequired=true AND both category lists empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.lotsSerialsRequired': true,
        'odoo.inventory.lotProductCategories': '',
        'odoo.inventory.serialProductCategories': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.lots-required-no-categories-listed');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 does NOT fire when lotProductCategories is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.lotsSerialsRequired': true,
        'odoo.inventory.lotProductCategories': 'Pharmaceuticals',
        'odoo.inventory.serialProductCategories': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.lots-required-no-categories-listed');
  });

  it('R3 does NOT fire when serialProductCategories is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.lotsSerialsRequired': true,
        'odoo.inventory.lotProductCategories': '',
        'odoo.inventory.serialProductCategories': 'High-value electronics',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.lots-required-no-categories-listed');
  });

  it('R4 fires (WARN) when warehouseCount>1 AND transferRules=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.warehouseCount': 3,
        'odoo.inventory.transferRules': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.multi-warehouse-needs-transfer-rules');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R4 does NOT fire when warehouseCount=1', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.warehouseCount': 1,
        'odoo.inventory.transferRules': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.multi-warehouse-needs-transfer-rules');
  });

  it('R4 does NOT fire when transferRules=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.warehouseCount': 5,
        'odoo.inventory.transferRules': true,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.multi-warehouse-needs-transfer-rules');
  });

  it('R5 fires (BLOCK) when landedCosts=true AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.landedCosts': true,
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.landed-costs-need-enterprise');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R5 does NOT fire on Enterprise edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.landedCosts': true,
        'odoo.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.landed-costs-need-enterprise');
  });

  it('R6 fires (INFO) when replenishmentStrategy=MTO and MRP not licensed', () => {
    for (const strategy of ['MTO', 'MIXED']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: { 'odoo.inventory.replenishmentStrategy': strategy },
        license: { edition: 'ENTERPRISE', modules: ['BASE_PURCHASE'] },
      });
      const r = conflicts.find((c) => c.id === 'odoo.inventory.mto-without-mrp');
      expect(r, `R6 should fire when strategy=${strategy}`).toBeDefined();
      expect(r?.severity).toBe('INFO');
    }
  });

  it('R6 does NOT fire when MRP is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.inventory.replenishmentStrategy': 'MTO' },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.mto-without-mrp');
  });

  it('R6 does NOT fire when strategy=MTS or MIN_MAX', () => {
    for (const strategy of ['MTS', 'MIN_MAX']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: { 'odoo.inventory.replenishmentStrategy': strategy },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R6 should NOT fire when strategy=${strategy}`,
      ).not.toContain('odoo.inventory.mto-without-mrp');
    }
  });

  it('R7 fires (WARN) when negativeStockAllowed=ALLOWED AND tradition=ANGLO_SAXON', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.negativeStockAllowed': 'ALLOWED',
        'odoo.accounting.tradition': 'ANGLO_SAXON',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.negative-stock-with-anglo-saxon');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 does NOT fire when negativeStockAllowed=NEVER', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.negativeStockAllowed': 'NEVER',
        'odoo.accounting.tradition': 'ANGLO_SAXON',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.negative-stock-with-anglo-saxon');
  });

  it('R7 does NOT fire under Continental tradition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.inventory.negativeStockAllowed': 'ALLOWED',
        'odoo.accounting.tradition': 'CONTINENTAL',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.negative-stock-with-anglo-saxon');
  });

  it('R8 fires (BLOCK) when dropShip=true AND BASE_PURCHASE missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.inventory.dropShip': true },
      license: { edition: 'ENTERPRISE', modules: ['BASE_SALES'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.dropship-needs-purchase-and-sales');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R8 fires (BLOCK) when dropShip=true AND BASE_SALES missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.inventory.dropShip': true },
      license: { edition: 'ENTERPRISE', modules: ['BASE_PURCHASE'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.inventory.dropship-needs-purchase-and-sales');
  });

  it('R8 does NOT fire when both BASE_PURCHASE and BASE_SALES are licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.inventory.dropShip': true },
      license: { edition: 'ENTERPRISE', modules: ['BASE_PURCHASE', 'BASE_SALES'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.dropship-needs-purchase-and-sales');
  });

  it('R9 fires (INFO) when barcodeScanning=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.inventory.barcodeScanning': true },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.inventory.barcode-needs-app-or-iot');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R9 does NOT fire when barcodeScanning=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.inventory.barcodeScanning': false },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.inventory.barcode-needs-app-or-iot');
  });
});

// ─── Pack 6 — Manufacturing depth ─────────────────────────────────────────────

describe('odooAdaptor: Pack 6 — MANUFACTURING flow shape (renamed in Pack R)', () => {
  const mfg = odooAdaptor.schema.flows.find((f) => f.id === 'MANUFACTURING');

  it('MANUFACTURING flow exists with the expected label + description', () => {
    expect(mfg).toBeDefined();
    expect(mfg!.label).toBe('Manufacturing');
    expect(mfg!.description).toMatch(/bom|routing|quality|subcontract|plm|maintenance/i);
  });

  it('MANUFACTURING sits between OPERATIONS_APPS and Returns (Pack 9 inserted OPERATIONS_APPS before MFG)', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    const opsIdx = ids.indexOf('OPERATIONS_APPS');
    const mfgIdx = ids.indexOf('MANUFACTURING');
    const retIdx = ids.indexOf('RETURNS');
    expect(mfgIdx).toBe(opsIdx + 1);
    expect(retIdx).toBe(mfgIdx + 1);
  });

  it('renders four sections in the documented order', () => {
    const ids = (mfg!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['bom', 'routing', 'quality', 'operations']);
  });

  it('BoM Architecture — 4 questions with the right ids + types + options', () => {
    const sec = mfg!.sections.find((s) => s.id === 'bom')!;
    expect(sec.label).toBe('BoM Architecture');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.mfg.bomTypes')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.mfg.multiLevelBom')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.plmInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.bomCostMethod')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.mfg.bomCostMethod')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['COMPONENT_BASED', 'REAL_TIME', 'STANDARD_FIXED']);
  });

  it('Routing & Work Centers — 4 questions with the right ids + types', () => {
    const sec = mfg!.sections.find((s) => s.id === 'routing')!;
    expect(sec.label).toBe('Routing & Work Centers');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.mfg.routingRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.workCenterCount')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.mfg.capacityPlanning')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.operationTimeTracking')?.inputType).toBe('BOOLEAN');
  });

  it('Quality Control — 3 questions with the right ids + types + options', () => {
    const sec = mfg!.sections.find((s) => s.id === 'quality')!;
    expect(sec.label).toBe('Quality Control');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.mfg.qualityPlansRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.qualityCheckpoints')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.mfg.qualityFailBlocks')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.mfg.qualityFailBlocks')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BLOCK_HARD', 'BLOCK_SOFT', 'NO_BLOCK']);
  });

  it('Subcontracting & Maintenance — 5 questions with the right ids + types + options', () => {
    const sec = mfg!.sections.find((s) => s.id === 'operations')!;
    expect(sec.label).toBe('Subcontracting & Maintenance');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.mfg.subcontractingInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.subcontractingComponentsTracking')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.maintenanceInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.mfg.maintenanceType')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.mfg.maintenanceType')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BOTH', 'CORRECTIVE', 'PREVENTIVE']);
    expect(byId.get('odoo.mfg.backflushing')?.inputType).toBe('BOOLEAN');
  });
});

describe('odooAdaptor: Pack 6 — Manufacturing rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 routing needs work centers', () => {
    expect(ids).toContain('odoo.mfg.routing-needs-work-centers');
  });
  it('R2 quality needs Quality module', () => {
    expect(ids).toContain('odoo.mfg.quality-needs-quality-module');
  });
  it('R3 subcontracting needs MRP module', () => {
    expect(ids).toContain('odoo.mfg.subcontracting-needs-module');
  });
  it('R4 PLM is Enterprise-only', () => {
    expect(ids).toContain('odoo.mfg.plm-is-enterprise-only');
  });
  it('R5 maintenance needs Maintenance module', () => {
    expect(ids).toContain('odoo.mfg.maintenance-needs-module');
  });
  it('R6 multi-level BoM rough edge on Community (INFO)', () => {
    expect(ids).toContain('odoo.mfg.multi-level-bom-on-community-rough-edge');
  });
  it('R7 standard cost vs Continental tradition (INFO)', () => {
    expect(ids).toContain('odoo.mfg.standard-cost-needs-anglo-saxon-alignment');
  });
  it('R8 backflushing with lots creates noise (INFO)', () => {
    expect(ids).toContain('odoo.mfg.backflushing-with-lots-creates-noise');
  });
  it('R9 subcontracting needs component tracking', () => {
    expect(ids).toContain('odoo.mfg.subcontracting-needs-component-tracking');
  });
});

describe('odooAdaptor: Pack 6 — Manufacturing rule evaluation', () => {
  it('R1 fires (WARN) when routingRequired=true AND workCenterCount unset', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.routingRequired': true },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.routing-needs-work-centers');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R1 fires (WARN) when routingRequired=true AND workCenterCount=0', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.routingRequired': true,
        'odoo.mfg.workCenterCount': 0,
      },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.mfg.routing-needs-work-centers');
  });

  it('R1 does NOT fire when workCenterCount>=1', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.routingRequired': true,
        'odoo.mfg.workCenterCount': 3,
      },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.routing-needs-work-centers');
  });

  it('R2 fires (BLOCK) when qualityPlansRequired=true AND QUALITY missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.qualityPlansRequired': true },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.quality-needs-quality-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire when QUALITY is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.qualityPlansRequired': true },
      license: { edition: 'ENTERPRISE', modules: ['MRP', 'QUALITY'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.quality-needs-quality-module');
  });

  it('R3 fires (BLOCK) when subcontractingInScope=true AND MRP missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.subcontractingInScope': true },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.subcontracting-needs-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire when MRP is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.subcontractingInScope': true },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.subcontracting-needs-module');
  });

  it('R4 fires (BLOCK) when plmInScope=true AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.plmInScope': true,
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.plm-is-enterprise-only');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 does NOT fire on Enterprise edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.plmInScope': true,
        'odoo.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.plm-is-enterprise-only');
  });

  it('R5 fires (WARN) when maintenanceInScope=true AND MAINTENANCE missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.maintenanceInScope': true },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.maintenance-needs-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire when MAINTENANCE is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.mfg.maintenanceInScope': true },
      license: { edition: 'ENTERPRISE', modules: ['MRP', 'MAINTENANCE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.maintenance-needs-module');
  });

  it('R6 fires (INFO) when multiLevelBom=true AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.multiLevelBom': true,
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.multi-level-bom-on-community-rough-edge');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R6 does NOT fire on Enterprise edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.multiLevelBom': true,
        'odoo.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.multi-level-bom-on-community-rough-edge');
  });

  it('R7 fires (INFO) when bomCostMethod=STANDARD_FIXED AND tradition=CONTINENTAL', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.bomCostMethod': 'STANDARD_FIXED',
        'odoo.accounting.tradition': 'CONTINENTAL',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.standard-cost-needs-anglo-saxon-alignment');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R7 does NOT fire under Anglo-Saxon tradition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.bomCostMethod': 'STANDARD_FIXED',
        'odoo.accounting.tradition': 'ANGLO_SAXON',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.standard-cost-needs-anglo-saxon-alignment');
  });

  it('R7 does NOT fire when bomCostMethod=COMPONENT_BASED', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.bomCostMethod': 'COMPONENT_BASED',
        'odoo.accounting.tradition': 'CONTINENTAL',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.standard-cost-needs-anglo-saxon-alignment');
  });

  it('R8 fires (INFO) when backflushing=true AND lotsSerialsRequired=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.backflushing': true,
        'odoo.inventory.lotsSerialsRequired': true,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.backflushing-with-lots-creates-noise');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R8 does NOT fire when lotsSerialsRequired=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.backflushing': true,
        'odoo.inventory.lotsSerialsRequired': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.backflushing-with-lots-creates-noise');
  });

  it('R9 fires (WARN) when subcontractingInScope=true AND subcontractingComponentsTracking=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.subcontractingInScope': true,
        'odoo.mfg.subcontractingComponentsTracking': false,
      },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.mfg.subcontracting-needs-component-tracking');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R9 does NOT fire when subcontractingComponentsTracking=true', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.mfg.subcontractingInScope': true,
        'odoo.mfg.subcontractingComponentsTracking': true,
      },
      license: { edition: 'ENTERPRISE', modules: ['MRP'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.mfg.subcontracting-needs-component-tracking');
  });
});

// ─── Pack 7 — Data Migration sizing ──────────────────────────────────────────

describe('odooAdaptor: Pack 7 — MIGRATION flow shape', () => {
  const mig = odooAdaptor.schema.flows.find((f) => f.id === 'MIGRATION');

  it('MIGRATION flow exists with the expected label + description', () => {
    expect(mig).toBeDefined();
    expect(mig!.label).toBe('Data Migration');
    expect(mig!.description).toMatch(/volume|source|history|cutover|reconciliation/i);
  });

  it('MIGRATION is the LAST flow in the array (after RETURNS)', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    expect(ids[ids.length - 1]).toBe('MIGRATION');
    expect(ids.indexOf('MIGRATION')).toBe(ids.indexOf('RETURNS') + 1);
  });

  it('renders four sections in the documented order', () => {
    const ids = (mig!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['volumes', 'sources', 'cutover', 'validation']);
  });

  it('Migration Volumes — 8 NUMBER questions with the right ids', () => {
    const sec = mig!.sections.find((s) => s.id === 'volumes')!;
    expect(sec.label).toBe('Migration Volumes');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    for (const id of [
      'odoo.migration.customerCount',
      'odoo.migration.vendorCount',
      'odoo.migration.productSkuCount',
      'odoo.migration.openSoCount',
      'odoo.migration.openPoCount',
      'odoo.migration.openArInvoiceCount',
      'odoo.migration.openApBillCount',
      'odoo.migration.inventoryLineCount',
    ]) {
      expect(byId.get(id)?.inputType, `${id} should be NUMBER`).toBe('NUMBER');
    }
  });

  it('Source Systems & History — 3 questions with the right ids + types', () => {
    const sec = mig!.sections.find((s) => s.id === 'sources')!;
    expect(sec.label).toBe('Source Systems & History');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.migration.sourceSystems')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.migration.historicalDepthYears')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.migration.masterDataOwnership')?.inputType).toBe('TEXTAREA');
  });

  it('Cutover Strategy — 4 questions with the right ids + types + options', () => {
    const sec = mig!.sections.find((s) => s.id === 'cutover')!;
    expect(sec.label).toBe('Cutover Strategy');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.migration.cutoverStyle')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.migration.cutoverStyle')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BIG_BANG', 'PARALLEL_RUN', 'PHASED_ENTITY', 'PHASED_MODULE']);
    expect(byId.get('odoo.migration.parallelRunDays')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.migration.preFreezeDays')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.migration.cutoverWindowHours')?.inputType).toBe('NUMBER');
  });

  it('Validation & Reconciliation — 4 questions with the right ids + types + options', () => {
    const sec = mig!.sections.find((s) => s.id === 'validation')!;
    expect(sec.label).toBe('Validation & Reconciliation');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.migration.cleansingScope')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.migration.postValidationApproach')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.migration.postValidationApproach')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BUSINESS_RULE', 'FULL_CHECK', 'SAMPLE', 'STRATIFIED_SAMPLE']);
    expect(byId.get('odoo.migration.reconciliationStrategy')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.migration.signoffOwner')?.inputType).toBe('TEXT');
  });
});

describe('odooAdaptor: Pack 7 — Migration rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 large customer count with big bang', () => {
    expect(ids).toContain('odoo.migration.large-customer-count-with-big-bang');
  });
  it('R2 parallel run needs duration', () => {
    expect(ids).toContain('odoo.migration.parallel-run-needs-duration');
  });
  it('R3 customer migration needs source system', () => {
    expect(ids).toContain('odoo.migration.no-source-system');
  });
  it('R4 large inventory needs cleansing', () => {
    expect(ids).toContain('odoo.migration.large-inventory-needs-cleansing');
  });
  it('R5 deep history needs source detail', () => {
    expect(ids).toContain('odoo.migration.deep-history-needs-source-detail');
  });
  it('R6 big bang multi-entity risk', () => {
    expect(ids).toContain('odoo.migration.big-bang-multi-entity-risk');
  });
  it('R7 short freeze with open transactions', () => {
    expect(ids).toContain('odoo.migration.short-freeze-with-open-transactions');
  });
  it('R8 multi-warehouse needs inventory snapshot', () => {
    expect(ids).toContain('odoo.migration.snapshot-required-for-multi-warehouse');
  });
  it('R9 full check not feasible at scale', () => {
    expect(ids).toContain('odoo.migration.full-check-not-feasible-at-scale');
  });
});

describe('odooAdaptor: Pack 7 — Migration rule evaluation', () => {
  it('R1 fires (WARN) when customerCount>50000 AND cutoverStyle=BIG_BANG', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.customerCount': 75000,
        'odoo.migration.cutoverStyle': 'BIG_BANG',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.large-customer-count-with-big-bang');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R1 does NOT fire when cutoverStyle=PHASED_ENTITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.customerCount': 75000,
        'odoo.migration.cutoverStyle': 'PHASED_ENTITY',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.large-customer-count-with-big-bang');
  });

  it('R1 does NOT fire when customerCount=50000 (boundary — strictly greater)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.customerCount': 50000,
        'odoo.migration.cutoverStyle': 'BIG_BANG',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.large-customer-count-with-big-bang');
  });

  it('R2 fires (BLOCK) when cutoverStyle=PARALLEL_RUN AND parallelRunDays unset', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.migration.cutoverStyle': 'PARALLEL_RUN' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.parallel-run-needs-duration');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 fires (BLOCK) when cutoverStyle=PARALLEL_RUN AND parallelRunDays=0', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.cutoverStyle': 'PARALLEL_RUN',
        'odoo.migration.parallelRunDays': 0,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.migration.parallel-run-needs-duration');
  });

  it('R2 does NOT fire when parallelRunDays=14', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.cutoverStyle': 'PARALLEL_RUN',
        'odoo.migration.parallelRunDays': 14,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.parallel-run-needs-duration');
  });

  it('R3 fires (BLOCK) when customerCount>0 AND sourceSystems empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.customerCount': 1500,
        'odoo.migration.sourceSystems': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.no-source-system');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire when sourceSystems is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.customerCount': 1500,
        'odoo.migration.sourceSystems': 'QuickBooks Online — accounting since 2018',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.no-source-system');
  });

  it('R4 fires (WARN) when inventoryLineCount>50000 AND cleansingScope empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.inventoryLineCount': 75000,
        'odoo.migration.cleansingScope': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.large-inventory-needs-cleansing');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R4 does NOT fire when cleansingScope is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.inventoryLineCount': 75000,
        'odoo.migration.cleansingScope': 'Drop zero-qty lines older than 6 months',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.large-inventory-needs-cleansing');
  });

  it('R5 fires (WARN) when historicalDepthYears>5 AND sourceSystems empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.historicalDepthYears': 7,
        'odoo.migration.sourceSystems': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.deep-history-needs-source-detail');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire at historicalDepthYears=5 (boundary — strictly greater)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.historicalDepthYears': 5,
        'odoo.migration.sourceSystems': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.deep-history-needs-source-detail');
  });

  it('R6 fires (WARN) when cutoverStyle=BIG_BANG AND multiCompany=true AND entities populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.cutoverStyle': 'BIG_BANG',
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Holdco AE\nSubco EG\nSubco SA',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.big-bang-multi-entity-risk');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R6 does NOT fire when multiCompany=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.cutoverStyle': 'BIG_BANG',
        'odoo.foundation.multiCompany': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.big-bang-multi-entity-risk');
  });

  it('R6 does NOT fire when cutoverStyle is phased', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.cutoverStyle': 'PHASED_ENTITY',
        'odoo.foundation.multiCompany': true,
        'odoo.foundation.entityList': 'Holdco AE\nSubco EG',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.big-bang-multi-entity-risk');
  });

  it('R7 fires (WARN) when preFreezeDays<2 AND openSoCount>0', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.preFreezeDays': 1,
        'odoo.migration.openSoCount': 50,
        'odoo.migration.openPoCount': 0,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.short-freeze-with-open-transactions');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 fires (WARN) when preFreezeDays=0 AND openPoCount>0', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.preFreezeDays': 0,
        'odoo.migration.openSoCount': 0,
        'odoo.migration.openPoCount': 12,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.migration.short-freeze-with-open-transactions');
  });

  it('R7 does NOT fire when preFreezeDays>=2', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.preFreezeDays': 3,
        'odoo.migration.openSoCount': 50,
        'odoo.migration.openPoCount': 12,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.short-freeze-with-open-transactions');
  });

  it('R7 does NOT fire when no open transactions', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.preFreezeDays': 0,
        'odoo.migration.openSoCount': 0,
        'odoo.migration.openPoCount': 0,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.short-freeze-with-open-transactions');
  });

  it('R8 fires (WARN) when productSkuCount>1000 AND warehouseCount>1 AND inventoryLineCount unset', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.productSkuCount': 5000,
        'odoo.inventory.warehouseCount': 3,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.snapshot-required-for-multi-warehouse');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R8 does NOT fire when inventoryLineCount is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.productSkuCount': 5000,
        'odoo.inventory.warehouseCount': 3,
        'odoo.migration.inventoryLineCount': 12000,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.snapshot-required-for-multi-warehouse');
  });

  it('R8 does NOT fire on single warehouse', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.productSkuCount': 5000,
        'odoo.inventory.warehouseCount': 1,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.snapshot-required-for-multi-warehouse');
  });

  it('R9 fires (INFO) when postValidationApproach=FULL_CHECK AND customerCount>5000', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.postValidationApproach': 'FULL_CHECK',
        'odoo.migration.customerCount': 12000,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.migration.full-check-not-feasible-at-scale');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R9 does NOT fire when postValidationApproach=STRATIFIED_SAMPLE', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.postValidationApproach': 'STRATIFIED_SAMPLE',
        'odoo.migration.customerCount': 12000,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.full-check-not-feasible-at-scale');
  });

  it('R9 does NOT fire when customerCount<=5000', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.migration.postValidationApproach': 'FULL_CHECK',
        'odoo.migration.customerCount': 1500,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.migration.full-check-not-feasible-at-scale');
  });
});

// ─── Pack 8 — Revenue Apps depth (POS + eCommerce + Subscriptions) ───────────

describe('odooAdaptor: Pack 8 — REVENUE_APPS flow shape', () => {
  const rev = odooAdaptor.schema.flows.find((f) => f.id === 'REVENUE_APPS');

  it('REVENUE_APPS flow exists with the expected label + description', () => {
    expect(rev).toBeDefined();
    expect(rev!.label).toBe('Revenue Apps (POS, eCommerce, Subscriptions)');
    expect(rev!.description).toMatch(/pos|point of sale|ecommerce|subscription/i);
  });

  it('REVENUE_APPS sits between Sales (O2C) and Operations Apps (Pack 9 inserted OPERATIONS_APPS after)', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    const o2cIdx = ids.indexOf('O2C');
    const revIdx = ids.indexOf('REVENUE_APPS');
    const opsIdx = ids.indexOf('OPERATIONS_APPS');
    expect(revIdx).toBe(o2cIdx + 1);
    expect(opsIdx).toBe(revIdx + 1);
  });

  it('renders three sections in the documented order', () => {
    const ids = (rev!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['pos', 'ecommerce', 'subscriptions']);
  });

  it('Point of Sale — 5 questions with the right ids + types + options', () => {
    const sec = rev!.sections.find((s) => s.id === 'pos')!;
    expect(sec.label).toBe('Point of Sale');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.revenue.posInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.revenue.posType')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.revenue.posType')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BOTH', 'RESTAURANT', 'RETAIL']);
    expect(byId.get('odoo.revenue.posTerminalCount')?.inputType).toBe('NUMBER');
    expect(byId.get('odoo.revenue.posHardware')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.revenue.posOfflineMode')?.inputType).toBe('BOOLEAN');
  });

  it('Website + eCommerce — 5 questions with the right ids + types + options', () => {
    const sec = rev!.sections.find((s) => s.id === 'ecommerce')!;
    expect(sec.label).toBe('Website + eCommerce');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.revenue.ecommerceInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.revenue.ecommerceSiteCount')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.revenue.ecommerceSiteCount')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['MULTI_SITE', 'SINGLE']);
    expect(byId.get('odoo.revenue.ecommerceLanguages')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.revenue.ecommercePaymentProviders')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.revenue.ecommerceShippingCarriers')?.inputType).toBe('TEXTAREA');
  });

  it('Subscriptions — 5 questions with the right ids + types + options', () => {
    const sec = rev!.sections.find((s) => s.id === 'subscriptions')!;
    expect(sec.label).toBe('Subscriptions');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.revenue.subscriptionsInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.revenue.subscriptionFrequencies')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.revenue.subscriptionAutoRenewal')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.revenue.subscriptionAutoRenewal')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['AUTO', 'HYBRID', 'MANUAL', 'NA']);
    expect(byId.get('odoo.revenue.subscriptionDunningPolicy')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.revenue.mrrArrReporting')?.inputType).toBe('BOOLEAN');
  });
});

describe('odooAdaptor: Pack 8 — Revenue Apps rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 POS needs POINT_OF_SALE module', () => {
    expect(ids).toContain('odoo.revenue.pos-needs-module');
  });
  it('R2 eCommerce needs ECOMMERCE module', () => {
    expect(ids).toContain('odoo.revenue.ecommerce-needs-module');
  });
  it('R3 Subscriptions needs Enterprise', () => {
    expect(ids).toContain('odoo.revenue.subscriptions-needs-module-and-enterprise');
  });
  it('R4 auto-renewal needs payment provider', () => {
    expect(ids).toContain('odoo.revenue.auto-renewal-needs-payment-provider');
  });
  it('R5 MRR/ARR needs analytic axes', () => {
    expect(ids).toContain('odoo.revenue.mrr-needs-analytic-axes');
  });
  it('R6 IoT/POS hardware on self-hosted (INFO)', () => {
    expect(ids).toContain('odoo.revenue.iotbox-on-selfhosted-extra-setup');
  });
  it('R7 multi-site eCommerce on Community (INFO)', () => {
    expect(ids).toContain('odoo.revenue.multi-site-ecommerce-community-rough-edge');
  });
  it('R8 no payment providers blocks checkout', () => {
    expect(ids).toContain('odoo.revenue.no-payment-providers-blocks-checkout');
  });
  it('R9 restaurant POS without kitchen-printer planning', () => {
    expect(ids).toContain('odoo.revenue.restaurant-pos-with-no-mention-of-printer-routing');
  });
});

describe('odooAdaptor: Pack 8 — Revenue Apps rule evaluation', () => {
  it('R1 fires (BLOCK) when posInScope=true AND POINT_OF_SALE missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.revenue.posInScope': true },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.pos-needs-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R1 does NOT fire when POINT_OF_SALE is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.revenue.posInScope': true },
      license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.pos-needs-module');
  });

  it('R2 fires (BLOCK) when ecommerceInScope=true AND ECOMMERCE missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.ecommerceInScope': true,
        'odoo.revenue.ecommercePaymentProviders': 'Stripe',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.ecommerce-needs-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire when ECOMMERCE is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.ecommerceInScope': true,
        'odoo.revenue.ecommercePaymentProviders': 'Stripe',
      },
      license: { edition: 'ENTERPRISE', modules: ['ECOMMERCE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.ecommerce-needs-module');
  });

  it('R3 fires (BLOCK) when subscriptionsInScope=true AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.subscriptionsInScope': true,
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.subscriptions-needs-module-and-enterprise');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire on Enterprise edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.subscriptionsInScope': true,
        'odoo.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.subscriptions-needs-module-and-enterprise');
  });

  it('R4 fires (BLOCK) when subscriptionsInScope=true AND autoRenewal=AUTO AND no payment providers', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.subscriptionsInScope': true,
        'odoo.revenue.subscriptionAutoRenewal': 'AUTO',
        'odoo.revenue.ecommercePaymentProviders': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.auto-renewal-needs-payment-provider');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 does NOT fire when payment providers are listed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.subscriptionsInScope': true,
        'odoo.revenue.subscriptionAutoRenewal': 'AUTO',
        'odoo.revenue.ecommercePaymentProviders': 'Stripe',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.auto-renewal-needs-payment-provider');
  });

  it('R4 does NOT fire when autoRenewal=MANUAL', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.subscriptionsInScope': true,
        'odoo.revenue.subscriptionAutoRenewal': 'MANUAL',
        'odoo.revenue.ecommercePaymentProviders': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.auto-renewal-needs-payment-provider');
  });

  it('R5 fires (WARN) when mrrArrReporting=true AND analyticAxes empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.mrrArrReporting': true,
        'odoo.accounting.analyticAxes': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.mrr-needs-analytic-axes');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire when analyticAxes is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.mrrArrReporting': true,
        'odoo.accounting.analyticAxes': 'Product Lines\nCustomer Segments',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.mrr-needs-analytic-axes');
  });

  it('R6 fires (INFO) when posInScope=true AND posHardware listed AND deploymentMode=SELFHOSTED', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.posInScope': true,
        'odoo.revenue.posHardware': 'IoT Box\nReceipt printer (Epson)',
        'odoo.foundation.deploymentMode': 'SELFHOSTED',
      },
      license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.iotbox-on-selfhosted-extra-setup');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R6 does NOT fire on Online or Odoo.sh deployment', () => {
    for (const deployment of ['ONLINE', 'ODOOSH']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.revenue.posInScope': true,
          'odoo.revenue.posHardware': 'IoT Box',
          'odoo.foundation.deploymentMode': deployment,
        },
        license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R6 should NOT fire when deployment=${deployment}`,
      ).not.toContain('odoo.revenue.iotbox-on-selfhosted-extra-setup');
    }
  });

  it('R7 fires (INFO) when ecommerceSiteCount=MULTI_SITE AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.ecommerceSiteCount': 'MULTI_SITE',
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.multi-site-ecommerce-community-rough-edge');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R7 does NOT fire on single-site setups', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.ecommerceSiteCount': 'SINGLE',
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.multi-site-ecommerce-community-rough-edge');
  });

  it('R8 fires (BLOCK) when ecommerceInScope=true AND ecommercePaymentProviders empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.ecommerceInScope': true,
        'odoo.revenue.ecommercePaymentProviders': '',
      },
      license: { edition: 'ENTERPRISE', modules: ['ECOMMERCE'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.no-payment-providers-blocks-checkout');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R8 does NOT fire when payment providers are listed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.ecommerceInScope': true,
        'odoo.revenue.ecommercePaymentProviders': 'Stripe',
      },
      license: { edition: 'ENTERPRISE', modules: ['ECOMMERCE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.no-payment-providers-blocks-checkout');
  });

  it('R9 fires (WARN) when posType=RESTAURANT (DSL has no contains operator — fires whenever restaurant scope is set)', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.posInScope': true,
        'odoo.revenue.posType': 'RESTAURANT',
      },
      license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.revenue.restaurant-pos-with-no-mention-of-printer-routing');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R9 fires (WARN) when posType=BOTH', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.posInScope': true,
        'odoo.revenue.posType': 'BOTH',
      },
      license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('odoo.revenue.restaurant-pos-with-no-mention-of-printer-routing');
  });

  it('R9 does NOT fire when posType=RETAIL', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.revenue.posInScope': true,
        'odoo.revenue.posType': 'RETAIL',
      },
      license: { edition: 'ENTERPRISE', modules: ['POINT_OF_SALE'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.revenue.restaurant-pos-with-no-mention-of-printer-routing');
  });
});

// ─── Pack 9 — Operations Apps depth (HR + Project + CRM) ─────────────────────

describe('odooAdaptor: Pack 9 — OPERATIONS_APPS flow shape', () => {
  const ops = odooAdaptor.schema.flows.find((f) => f.id === 'OPERATIONS_APPS');

  it('OPERATIONS_APPS flow exists with the expected label + description', () => {
    expect(ops).toBeDefined();
    expect(ops!.label).toBe('Operations Apps (HR, Project, CRM)');
    expect(ops!.description).toMatch(/hr|payroll|project|timesheet|crm/i);
  });

  it('OPERATIONS_APPS sits between REVENUE_APPS and Manufacturing', () => {
    const ids = odooAdaptor.schema.flows.map((f) => f.id);
    const revIdx = ids.indexOf('REVENUE_APPS');
    const opsIdx = ids.indexOf('OPERATIONS_APPS');
    const mfgIdx = ids.indexOf('MANUFACTURING');
    expect(opsIdx).toBe(revIdx + 1);
    expect(mfgIdx).toBe(opsIdx + 1);
  });

  it('renders three sections in the documented order', () => {
    const ids = (ops!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['hr', 'project', 'crm']);
  });

  it('HR + Payroll — 6 questions with the right ids + types', () => {
    const sec = ops!.sections.find((s) => s.id === 'hr')!;
    expect(sec.label).toBe('HR + Payroll');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.operations.hrInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.payrollInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.timeOffInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.attendanceInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.endOfServiceRules')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.operations.recruitmentInScope')?.inputType).toBe('BOOLEAN');
  });

  it('Project + Timesheets — 5 questions with the right ids + types + options', () => {
    const sec = ops!.sections.find((s) => s.id === 'project')!;
    expect(sec.label).toBe('Project + Timesheets');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.operations.projectInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.timesheetsInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.projectBillingMode')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('odoo.operations.projectBillingMode')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['FIXED_PRICE', 'MILESTONE', 'MIXED', 'NONE', 'TM']);
    expect(byId.get('odoo.operations.projectProfitability')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.projectForecasting')?.inputType).toBe('BOOLEAN');
  });

  it('CRM — 4 questions with the right ids + types', () => {
    const sec = ops!.sections.find((s) => s.id === 'crm')!;
    expect(sec.label).toBe('CRM');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('odoo.operations.crmInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.crmPipelineStages')?.inputType).toBe('TEXTAREA');
    expect(byId.get('odoo.operations.crmLeadEnrichmentInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('odoo.operations.crmEmailIntegration')?.inputType).toBe('TEXTAREA');
  });
});

describe('odooAdaptor: Pack 9 — Operations Apps rules registered in odoo-rules', () => {
  const ids = odooAdaptor.rules.rules.map((r) => r.id);

  it('R1 HR needs HR module', () => {
    expect(ids).toContain('odoo.operations.hr-needs-module');
  });
  it('R2 payroll needs HR module', () => {
    expect(ids).toContain('odoo.operations.payroll-needs-hr-module');
  });
  it('R3 EOSB rules for non-MENA country (WARN)', () => {
    expect(ids).toContain('odoo.operations.eosb-needs-mena-payroll');
  });
  it('R4 timesheets without project (WARN)', () => {
    expect(ids).toContain('odoo.operations.timesheets-without-project');
  });
  it('R5 project billing needs Sales module', () => {
    expect(ids).toContain('odoo.operations.tm-billing-needs-sales');
  });
  it('R6 profitability needs analytic axes (WARN)', () => {
    expect(ids).toContain('odoo.operations.profitability-needs-analytic-axes');
  });
  it('R7 forecasting is Enterprise-only', () => {
    expect(ids).toContain('odoo.operations.forecasting-is-enterprise-only');
  });
  it('R8 CRM needs CRM module', () => {
    expect(ids).toContain('odoo.operations.crm-needs-module');
  });
  it('R9 attendance on self-hosted (INFO)', () => {
    expect(ids).toContain('odoo.operations.attendance-on-selfhosted-needs-iot');
  });
});

describe('odooAdaptor: Pack 9 — Operations Apps rule evaluation', () => {
  it('R1 fires (BLOCK) when hrInScope=true AND HR module missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.operations.hrInScope': true },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.hr-needs-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R1 does NOT fire when HR module is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.operations.hrInScope': true },
      license: { edition: 'ENTERPRISE', modules: ['HR'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.hr-needs-module');
  });

  it('R2 fires (BLOCK) when payrollInScope=true AND hrInScope=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.payrollInScope': true,
        'odoo.operations.hrInScope': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.payroll-needs-hr-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire when both payroll and HR are in scope', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.payrollInScope': true,
        'odoo.operations.hrInScope': true,
      },
      license: { edition: 'ENTERPRISE', modules: ['HR'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.payroll-needs-hr-module');
  });

  it('R3 fires (WARN) when EOSB rules captured AND primary country is non-MENA', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.endOfServiceRules': 'Severance: 2 weeks per year of service',
        'odoo.foundation.primaryCountry': 'US',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.eosb-needs-mena-payroll');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 does NOT fire when primary country IS in the MENA list', () => {
    for (const cc of ['AE', 'SA', 'KW', 'QA', 'BH', 'OM', 'EG', 'JO', 'LB']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.operations.endOfServiceRules': 'EOSB per local labour law',
          'odoo.foundation.primaryCountry': cc,
        },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R3 should NOT fire when primaryCountry=${cc}`,
      ).not.toContain('odoo.operations.eosb-needs-mena-payroll');
    }
  });

  it('R3 does NOT fire when endOfServiceRules is empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.endOfServiceRules': '',
        'odoo.foundation.primaryCountry': 'US',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.eosb-needs-mena-payroll');
  });

  it('R4 fires (WARN) when timesheetsInScope=true AND projectInScope=false', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.timesheetsInScope': true,
        'odoo.operations.projectInScope': false,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.timesheets-without-project');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R4 does NOT fire when both project and timesheets are in scope', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.timesheetsInScope': true,
        'odoo.operations.projectInScope': true,
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.timesheets-without-project');
  });

  it('R5 fires (BLOCK) when projectBillingMode is a real billing mode AND BASE_SALES missing', () => {
    for (const mode of ['TM', 'FIXED_PRICE', 'MILESTONE', 'MIXED']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: { 'odoo.operations.projectBillingMode': mode },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'odoo.operations.tm-billing-needs-sales');
      expect(r, `R5 should fire when billingMode=${mode}`).toBeDefined();
      expect(r?.severity).toBe('BLOCK');
    }
  });

  it('R5 does NOT fire when billingMode=NONE', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.operations.projectBillingMode': 'NONE' },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.tm-billing-needs-sales');
  });

  it('R5 does NOT fire when BASE_SALES is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.operations.projectBillingMode': 'TM' },
      license: { edition: 'ENTERPRISE', modules: ['BASE_SALES'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.tm-billing-needs-sales');
  });

  it('R6 fires (WARN) when projectProfitability=true AND analyticAxes empty', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.projectProfitability': true,
        'odoo.accounting.analyticAxes': '',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.profitability-needs-analytic-axes');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R6 does NOT fire when analyticAxes is populated', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.projectProfitability': true,
        'odoo.accounting.analyticAxes': 'Projects\nCost Centers',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.profitability-needs-analytic-axes');
  });

  it('R7 fires (BLOCK) when projectForecasting=true AND foundation.edition=COMMUNITY', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.projectForecasting': true,
        'odoo.foundation.edition': 'COMMUNITY',
      },
      license: { edition: 'COMMUNITY', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.forecasting-is-enterprise-only');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R7 does NOT fire on Enterprise edition', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.projectForecasting': true,
        'odoo.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.forecasting-is-enterprise-only');
  });

  it('R8 fires (BLOCK) when crmInScope=true AND CRM module missing', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.operations.crmInScope': true },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.crm-needs-module');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R8 does NOT fire when CRM is licensed', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: { 'odoo.operations.crmInScope': true },
      license: { edition: 'ENTERPRISE', modules: ['CRM'] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('odoo.operations.crm-needs-module');
  });

  it('R9 fires (INFO) when attendanceInScope=true AND deploymentMode=SELFHOSTED', () => {
    const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
      answers: {
        'odoo.operations.attendanceInScope': true,
        'odoo.foundation.deploymentMode': 'SELFHOSTED',
      },
      license: { edition: 'ENTERPRISE', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'odoo.operations.attendance-on-selfhosted-needs-iot');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R9 does NOT fire on Online or Odoo.sh deployment', () => {
    for (const deployment of ['ONLINE', 'ODOOSH']) {
      const conflicts = evaluateAdaptorRules(odooAdaptor.rules, {
        answers: {
          'odoo.operations.attendanceInScope': true,
          'odoo.foundation.deploymentMode': deployment,
        },
        license: { edition: 'ENTERPRISE', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R9 should NOT fire when deployment=${deployment}`,
      ).not.toContain('odoo.operations.attendance-on-selfhosted-needs-iot');
    }
  });
});
