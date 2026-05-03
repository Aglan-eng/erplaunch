import { describe, it, expect } from 'vitest';
import { validateAdaptor, evaluateAdaptorRules } from '@ofoq/adaptor-sdk';
import { AdaptorRegistry } from '@ofoq/adaptor-registry';
import netsuiteAdaptor from '../src/index.js';

describe('netsuiteAdaptor: manifest', () => {
  it('has the expected identity', () => {
    expect(netsuiteAdaptor.manifest.id).toBe('netsuite');
    expect(netsuiteAdaptor.manifest.sourceKind).toBe('built-in');
    expect(netsuiteAdaptor.manifest.vendor).toBe('Oracle');
    expect(netsuiteAdaptor.manifest.capabilities).toContain('document');
    expect(netsuiteAdaptor.manifest.capabilities).toContain('script');
    expect(netsuiteAdaptor.manifest.capabilities).toContain('workflow');
  });

  it('passes SDK shape validation', () => {
    const res = validateAdaptor(netsuiteAdaptor);
    expect(res.ok, res.errors.join('; ')).toBe(true);
  });
});

describe('netsuiteAdaptor: schema', () => {
  it('exposes 18 flows in the canonical order — adds INTEGRATIONS between RETURNS and MIGRATION (Pack ZZ)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    // Cross-platform pack ordering — universal lifecycle phases
    // append in lifecycle order. T → Phase 5, U → Phase 6, V → Phase 7,
    // X → Phase 8, Y → Phase 9. Pack Z inserts MIGRATION (cross-cutting
    // hardener) between RETURNS and TESTING. Pack ZZ inserts INTEGRATIONS
    // (second cross-cutting hardener) between RETURNS and MIGRATION —
    // build-phase concern that precedes data migration. Mirrors Odoo's
    // flow position.
    expect(ids).toEqual([
      'KICKOFF',
      'FOUNDATION', 'TAX', 'LOCALIZATION', 'SOLUTION_DESIGN',
      'R2R', 'P2P', 'APPROVALS', 'O2C', 'PRODUCTION', 'RETURNS',
      'INTEGRATIONS', 'MIGRATION', 'TESTING', 'TRAINING', 'CUTOVER', 'HYPERCARE', 'STABILIZATION',
    ]);
  });

  it('every flow has at least one section with at least one question', () => {
    for (const flow of netsuiteAdaptor.schema.flows) {
      expect(flow.sections.length, `flow ${flow.id} has no sections`).toBeGreaterThan(0);
      for (const section of flow.sections) {
        expect(section.questions.length, `section ${flow.id}/${section.id} has no questions`).toBeGreaterThan(0);
      }
    }
  });

  it('question IDs are namespaced and unique', () => {
    const seen = new Set<string>();
    for (const flow of netsuiteAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) {
          expect(q.id).toMatch(/^[a-z0-9]+\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+/);
          expect(seen.has(q.id), `duplicate question id: ${q.id}`).toBe(false);
          seen.add(q.id);
        }
      }
    }
  });
});

describe('netsuiteAdaptor: license', () => {
  it('includes Starter, Mid-Market, OneWorld editions', () => {
    const ids = netsuiteAdaptor.license.editions.map((e) => e.id);
    expect(ids).toEqual(['STARTER', 'MID_MARKET', 'ONEWORLD']);
  });

  it('default edition is MID_MARKET', () => {
    expect(netsuiteAdaptor.license.defaultEditionId).toBe('MID_MARKET');
  });

  it('lists ONEWORLD and MANUFACTURING in the module catalog', () => {
    const modIds = netsuiteAdaptor.license.modules.map((m) => m.id);
    expect(modIds).toContain('ONEWORLD');
    expect(modIds).toContain('MANUFACTURING');
  });
});

describe('netsuiteAdaptor: phases + generators', () => {
  it('default phases include Discovery through Go Live in order', () => {
    const order = netsuiteAdaptor.phases.defaultPhases.map((p) => p.label);
    expect(order).toEqual(['Discovery', 'Scoping', 'Build', 'UAT', 'Go Live']);
  });

  it('ships the eight known generators', () => {
    const genIds = netsuiteAdaptor.generators.map((g) => g.id).sort();
    expect(genIds).toEqual(
      ['brd', 'plan', 'risk', 'sdf', 'solution-doc', 'suitescript', 'training-manual', 'uat'].sort(),
    );
  });
});

describe('netsuiteAdaptor: rule pack (Phase 15)', () => {
  it('ships a non-empty rule pack covering the license-gap catalog', () => {
    expect(netsuiteAdaptor.rules.id).toBe('netsuite-rules');
    expect(netsuiteAdaptor.rules.rules.length).toBeGreaterThan(0);
  });

  it('rule IDs match the legacy rule-engine naming convention', () => {
    const ids = netsuiteAdaptor.rules.rules.map((r) => r.id);
    // License rules keep their LIC-xxx identity from the legacy engine so the
    // dual-dispatch migration can dedupe by id.
    for (const must of ['LIC-001', 'LIC-003', 'LIC-005', 'LIC-007', 'R2R-001', 'R2R-002', 'R2R-005', 'R2R-008']) {
      expect(ids).toContain(must);
    }
  });

  it('every rule carries a when clause so it auto-fires via the generic evaluator', () => {
    for (const rule of netsuiteAdaptor.rules.rules) {
      expect(rule.when, `rule ${rule.id} missing when clause`).toBeDefined();
    }
  });

  it('STARTER edition + OneWorld module fires LIC-001 (incompat modules)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {},
      license: { edition: 'STARTER', modules: ['ONEWORLD'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('LIC-001');
    expect(conflicts.find((c) => c.id === 'LIC-001')?.severity).toBe('BLOCK');
  });

  it('OneWorld module on MID_MARKET edition fires LIC-003', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {},
      license: { edition: 'MID_MARKET', modules: ['ONEWORLD'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('LIC-003');
  });

  it('WMS without Advanced Inventory fires LIC-005', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {},
      license: { edition: 'MID_MARKET', modules: ['WMS'] },
    });
    expect(conflicts.map((c) => c.id)).toContain('LIC-005');
  });

  it('Multi-entity answer without OneWorld module fires R2R-001', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'r2r.entities.multiEntity': true },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('R2R-001');
  });

  it('Invalid fiscal year start fires R2R-005 via the new answerIn primitive', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'r2r.accountingPeriods.fiscalYearStart': 'Octember' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('R2R-005');
  });

  it('Valid scoping (OneWorld edition + OneWorld module + no conflicts + Kickoff Pack populated) fires nothing', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        // Universal Kickoff Pack — populate to satisfy BLOCK/WARN rules.
        'kickoff.mandate.sponsor': 'Helena Reyes (CFO)',
        'kickoff.mandate.successCriteria': 'Q close 5d\nSingle source of truth\nEliminate manual journals',
        'kickoff.governance.steeringCadence': 'BIWEEKLY',
        'kickoff.governance.escalationPath': 'PM → Steering → Sponsor',
        'kickoff.communication.statusReportAudience': 'Sponsor, PM, leads',
        // Note: Kickoff R5 (multi-entity timeline) only fires when
        // targetGoLiveDate is also set — clean test omits it, so R5 stays
        // dormant even though edition=ONEWORLD.
        'r2r.entities.multiEntity': true,
        'r2r.currencies.isMultiCurrency': true,
        'r2r.accountingPeriods.fiscalYearStart': 'January',
      },
      license: { edition: 'ONEWORLD', modules: ['ONEWORLD', 'WORK_ORDERS', 'WMS', 'ADVANCED_INVENTORY'] },
    });
    expect(conflicts).toEqual([]);
  });
});

describe('AdaptorRegistry', () => {
  it('registers + retrieves + refuses to register twice', () => {
    const reg = new AdaptorRegistry();
    reg.register(netsuiteAdaptor);
    expect(reg.has('netsuite')).toBe(true);
    expect(reg.get('netsuite').manifest.id).toBe('netsuite');
    expect(() => reg.register(netsuiteAdaptor)).toThrow(/already registered/);
  });

  it('get() throws on unknown id, find() returns null', () => {
    const reg = new AdaptorRegistry();
    expect(() => reg.get('does-not-exist')).toThrow(/unknown adaptor/);
    expect(reg.find('does-not-exist')).toBeNull();
  });

  it('list() returns manifests in registration order', () => {
    const reg = new AdaptorRegistry();
    reg.register(netsuiteAdaptor);
    const listed = reg.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('netsuite');
    expect(listed[0].name).toBe('NetSuite');
    expect(listed[0].sourceKind).toBe('built-in');
  });

  it('rejects an adaptor that fails validation', () => {
    const reg = new AdaptorRegistry();
    const malformed = { manifest: { id: 'bad' } } as never;
    expect(() => reg.register(malformed)).toThrow(/invalid adaptor/);
  });
});

// ─── NS Pack 1 — Foundation & Account Type ───────────────────────────────────

describe('netsuiteAdaptor: NS Pack 1 — FOUNDATION flow shape', () => {
  const foundation = netsuiteAdaptor.schema.flows.find((f) => f.id === 'FOUNDATION');

  it('FOUNDATION flow exists with the expected label + description', () => {
    expect(foundation).toBeDefined();
    expect(foundation!.label).toBe('Project Foundation');
    expect(foundation!.description).toMatch(/edition|suitesuccess|user|country|subsidiary|fiscal/i);
  });

  it('FOUNDATION renders second (after KICKOFF), before TAX / LOCALIZATION / SOLUTION_DESIGN / R2R', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids[0]).toBe('KICKOFF');
    expect(ids[1]).toBe('FOUNDATION');
    expect(ids.indexOf('TAX')).toBe(2);
    expect(ids.indexOf('LOCALIZATION')).toBe(3);
    // NS SD Depth Pack inserted SOLUTION_DESIGN between LOCALIZATION
    // and R2R, so R2R now sits at index 5.
    expect(ids.indexOf('SOLUTION_DESIGN')).toBe(4);
    expect(ids.indexOf('R2R')).toBe(5);
  });

  it('renders four sections in the documented order', () => {
    const ids = (foundation!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['edition', 'users', 'country', 'subsidiaries']);
  });

  it('Edition & Account Type — 4 questions with the right ids + types + options', () => {
    const sec = foundation!.sections.find((s) => s.id === 'edition')!;
    expect(sec.label).toBe('Edition & Account Type');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.foundation.edition')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.foundation.edition')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ENTERPRISE', 'FINANCIALS_FIRST', 'MID_MARKET', 'ONEWORLD', 'STANDARD', 'STARTER']);
    expect(byId.get('ns.foundation.suiteSuccessBundle')?.inputType).toBe('TEXT');
    expect(byId.get('ns.foundation.suiteCloudPlus')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.foundation.sandboxAccount')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.foundation.sandboxAccount')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BOTH', 'FULL_COPY', 'NONE', 'RELEASE_PREVIEW']);
  });

  it('Users & Access — 4 questions with the right ids + types', () => {
    const sec = foundation!.sections.find((s) => s.id === 'users')!;
    expect(sec.label).toBe('Users & Access');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.foundation.fullUserCount')?.inputType).toBe('NUMBER');
    expect(byId.get('ns.foundation.essUserCount')?.inputType).toBe('NUMBER');
    expect(byId.get('ns.foundation.customRolesRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.foundation.ssoInScope')?.inputType).toBe('BOOLEAN');
  });

  it('Country & Fiscal Calendar — 4 questions with the right ids + types', () => {
    const sec = foundation!.sections.find((s) => s.id === 'country')!;
    expect(sec.label).toBe('Country & Fiscal Calendar');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.foundation.primaryCountry')?.inputType).toBe('TEXT');
    expect(byId.get('ns.foundation.fiscalYearStart')?.inputType).toBe('TEXT');
    expect(byId.get('ns.foundation.multiBookAccounting')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.foundation.advancedRevRecInScope')?.inputType).toBe('BOOLEAN');
  });

  it('Subsidiary Structure — 4 questions with the right ids + types', () => {
    const sec = foundation!.sections.find((s) => s.id === 'subsidiaries')!;
    expect(sec.label).toBe('Subsidiary Structure');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.foundation.subsidiaryCount')?.inputType).toBe('NUMBER');
    expect(byId.get('ns.foundation.subsidiaryList')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.foundation.multiCurrencyInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.foundation.eliminationEntity')?.inputType).toBe('TEXT');
  });
});

describe('netsuiteAdaptor: NS Pack 1 — Foundation rules registered in netsuite-rules', () => {
  const ids = netsuiteAdaptor.rules.rules.map((r) => r.id);

  it('R1 multi-subsidiary requires OneWorld', () => {
    expect(ids).toContain('ns.foundation.multi-subsidiary-requires-oneworld');
  });
  it('R2 multi-currency requires OneWorld', () => {
    expect(ids).toContain('ns.foundation.multi-currency-requires-oneworld');
  });
  it('R3 multi-book requires OneWorld', () => {
    expect(ids).toContain('ns.foundation.multi-book-requires-oneworld');
  });
  it('R4 no sandbox on Mid-Market or above (WARN)', () => {
    expect(ids).toContain('ns.foundation.no-sandbox-on-mid-market-or-above');
  });
  it('R5 custom roles on Starter restricted', () => {
    expect(ids).toContain('ns.foundation.custom-roles-on-starter-restricted');
  });
  it('R6 SSO better with SuiteCloud Plus (INFO)', () => {
    expect(ids).toContain('ns.foundation.sso-better-with-suitecloud-plus');
  });
  it('R7 subsidiary list required when count > 1', () => {
    expect(ids).toContain('ns.foundation.subsidiary-list-required-when-count-gt-one');
  });
  it('R8 elimination entity required for consolidation', () => {
    expect(ids).toContain('ns.foundation.elimination-entity-required-for-consolidation');
  });
  it('R9 ARM recommends Mid-Market or above', () => {
    expect(ids).toContain('ns.foundation.advanced-revrec-recommends-mid-market-or-above');
  });
});

describe('netsuiteAdaptor: NS Pack 1 — Foundation rule evaluation', () => {
  it('R1 fires (BLOCK) when subsidiaryCount>1 AND edition!==ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.multi-subsidiary-requires-oneworld');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R1 does NOT fire when edition is ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.multi-subsidiary-requires-oneworld');
  });

  it('R1 does NOT fire when subsidiaryCount=1', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 1,
        'ns.foundation.edition': 'STANDARD',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.multi-subsidiary-requires-oneworld');
  });

  it('R2 fires (BLOCK) when multiCurrencyInScope=true AND edition!==ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.multiCurrencyInScope': true,
        'ns.foundation.edition': 'MID_MARKET',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.multi-currency-requires-oneworld');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire on ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.multiCurrencyInScope': true,
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.multi-currency-requires-oneworld');
  });

  it('R3 fires (BLOCK) when multiBookAccounting=true AND edition!==ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.multiBookAccounting': true,
        'ns.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.multi-book-requires-oneworld');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 fires (WARN) when sandboxAccount=NONE AND edition is Mid-Market or above', () => {
    for (const edition of ['MID_MARKET', 'ENTERPRISE', 'ONEWORLD']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: {
          'ns.foundation.sandboxAccount': 'NONE',
          'ns.foundation.edition': edition,
        },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'ns.foundation.no-sandbox-on-mid-market-or-above');
      expect(r, `R4 should fire when edition=${edition}`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R4 does NOT fire on Starter', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.sandboxAccount': 'NONE',
        'ns.foundation.edition': 'STARTER',
      },
      license: { edition: 'STARTER', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.no-sandbox-on-mid-market-or-above');
  });

  it('R4 does NOT fire when sandbox is configured', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.sandboxAccount': 'FULL_COPY',
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.no-sandbox-on-mid-market-or-above');
  });

  it('R5 fires (BLOCK) when customRolesRequired=true AND edition=STARTER', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.customRolesRequired': true,
        'ns.foundation.edition': 'STARTER',
      },
      license: { edition: 'STARTER', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.custom-roles-on-starter-restricted');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R5 does NOT fire on STANDARD or higher', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.customRolesRequired': true,
        'ns.foundation.edition': 'STANDARD',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.custom-roles-on-starter-restricted');
  });

  it('R6 fires (INFO) when ssoInScope=true AND suiteCloudPlus=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.ssoInScope': true,
        'ns.foundation.suiteCloudPlus': false,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.sso-better-with-suitecloud-plus');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R6 does NOT fire when SuiteCloud Plus is in scope', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.ssoInScope': true,
        'ns.foundation.suiteCloudPlus': true,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.sso-better-with-suitecloud-plus');
  });

  it('R7 fires (WARN) when subsidiaryCount>1 AND subsidiaryList empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 4,
        'ns.foundation.subsidiaryList': '',
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.subsidiary-list-required-when-count-gt-one');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 does NOT fire when subsidiaryList is populated', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 4,
        'ns.foundation.subsidiaryList': 'Holdco US USD parent\nSubco UK GBP Holdco',
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.subsidiary-list-required-when-count-gt-one');
  });

  it('R8 fires (WARN) when subsidiaryCount>1 AND eliminationEntity empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.eliminationEntity': '',
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.foundation.elimination-entity-required-for-consolidation');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R8 does NOT fire on single-entity engagements', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 1,
        'ns.foundation.eliminationEntity': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.foundation.elimination-entity-required-for-consolidation');
  });

  it('R9 fires (WARN) when ARM in scope AND edition is Starter/Standard/Financials First', () => {
    for (const edition of ['STARTER', 'STANDARD', 'FINANCIALS_FIRST']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: {
          'ns.foundation.advancedRevRecInScope': true,
          'ns.foundation.edition': edition,
        },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'ns.foundation.advanced-revrec-recommends-mid-market-or-above');
      expect(r, `R9 should fire when edition=${edition}`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R9 does NOT fire on MID_MARKET / ENTERPRISE / ONEWORLD', () => {
    for (const edition of ['MID_MARKET', 'ENTERPRISE', 'ONEWORLD']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: {
          'ns.foundation.advancedRevRecInScope': true,
          'ns.foundation.edition': edition,
        },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R9 should NOT fire when edition=${edition}`,
      ).not.toContain('ns.foundation.advanced-revrec-recommends-mid-market-or-above');
    }
  });
});

// ─── NS Pack 2 — Tax Engine (SuiteTax) ───────────────────────────────────────

describe('netsuiteAdaptor: NS Pack 2 — TAX flow shape', () => {
  const tax = netsuiteAdaptor.schema.flows.find((f) => f.id === 'TAX');

  it('TAX flow exists with the expected label + description', () => {
    expect(tax).toBeDefined();
    expect(tax!.label).toBe('Tax Engine');
    expect(tax!.description).toMatch(/suitetax|nexus|e-?invoicing|withholding|filing/i);
  });

  it('TAX sits between FOUNDATION and LOCALIZATION (Pack 3 inserted LOCALIZATION after)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    const fIdx = ids.indexOf('FOUNDATION');
    const tIdx = ids.indexOf('TAX');
    const locIdx = ids.indexOf('LOCALIZATION');
    expect(tIdx).toBe(fIdx + 1);
    expect(locIdx).toBe(tIdx + 1);
  });

  it('renders four sections in the documented order', () => {
    const ids = (tax!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['engine', 'nexus', 'specials', 'filing']);
  });

  it('Tax Engine & Default Behavior — 4 questions with the right ids + types + options', () => {
    const sec = tax!.sections.find((s) => s.id === 'engine')!;
    expect(sec.label).toBe('Tax Engine & Default Behavior');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.tax.engine')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.tax.engine')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['LEGACY', 'SUITETAX']);
    expect(byId.get('ns.tax.itemPriceMode')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.tax.itemPriceMode')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['EXCLUSIVE', 'INCLUSIVE', 'MIXED']);
    expect(byId.get('ns.tax.defaultSalesTaxCode')?.inputType).toBe('TEXT');
    expect(byId.get('ns.tax.defaultPurchaseTaxCode')?.inputType).toBe('TEXT');
  });

  it('Nexus & Compliance — 4 questions with the right ids + types + options', () => {
    const sec = tax!.sections.find((s) => s.id === 'nexus')!;
    expect(sec.label).toBe('Nexus & Compliance');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.tax.nexusList')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.tax.taxReportingFramework')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.tax.einvoicingMandatory')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.tax.einvoicingMandatory')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['NO', 'UNSURE', 'YES']);
    expect(byId.get('ns.tax.einvoicingSuiteApp')?.inputType).toBe('TEXTAREA');
  });

  it('Special Tax Mechanics — 4 questions with the right ids + types', () => {
    const sec = tax!.sections.find((s) => s.id === 'specials')!;
    expect(sec.label).toBe('Special Tax Mechanics');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.tax.withholdingInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.tax.reverseChargeInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.tax.useTaxInScope')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.tax.taxExemptCustomers')?.inputType).toBe('BOOLEAN');
  });

  it('Tax Filing & Automation — 4 questions with the right ids + types + options', () => {
    const sec = tax!.sections.find((s) => s.id === 'filing')!;
    expect(sec.label).toBe('Tax Filing & Automation');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.tax.filingPeriodicity')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.tax.filingPeriodicity')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['ANNUAL', 'MIXED', 'MONTHLY', 'QUARTERLY']);
    expect(byId.get('ns.tax.multiJurisdictionReporting')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.tax.salesTaxAutomation')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.tax.salesTaxAutomationProvider')?.inputType).toBe('TEXT');
  });
});

describe('netsuiteAdaptor: NS Pack 2 — Tax rules registered in netsuite-rules', () => {
  const ids = netsuiteAdaptor.rules.rules.map((r) => r.id);

  it('R1 legacy engine on new SuiteSuccess account', () => {
    expect(ids).toContain('ns.tax.legacy-engine-on-new-account');
  });
  it('R2 OneWorld multi-sub needs nexus list', () => {
    expect(ids).toContain('ns.tax.oneworld-multi-sub-needs-nexus-list');
  });
  it('R3 e-invoicing YES needs SuiteApp', () => {
    expect(ids).toContain('ns.tax.einvoicing-yes-needs-suiteapp');
  });
  it('R4 withholding needs SuiteApp', () => {
    expect(ids).toContain('ns.tax.withholding-needs-suiteapp');
  });
  it('R5 use tax only in US', () => {
    expect(ids).toContain('ns.tax.use-tax-only-in-us');
  });
  it('R6 automation needs nexus list', () => {
    expect(ids).toContain('ns.tax.automation-needs-nexus-list');
  });
  it('R7 multi-jurisdiction needs multiple nexuses', () => {
    expect(ids).toContain('ns.tax.multi-jurisdiction-needs-multiple-nexuses');
  });
  it('R8 exempt customers need certificate management (INFO)', () => {
    expect(ids).toContain('ns.tax.exempt-customers-need-certificate-management');
  });
  it('R9 reverse charge typical on OneWorld (INFO)', () => {
    expect(ids).toContain('ns.tax.reverse-charge-typical-on-oneworld');
  });
});

describe('netsuiteAdaptor: NS Pack 2 — Tax rule evaluation', () => {
  it('R1 fires (WARN) when engine=LEGACY AND suiteSuccessBundle is populated', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.engine': 'LEGACY',
        'ns.foundation.suiteSuccessBundle': 'US',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.legacy-engine-on-new-account');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R1 does NOT fire when engine=SUITETAX', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.engine': 'SUITETAX',
        'ns.foundation.suiteSuccessBundle': 'US',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.legacy-engine-on-new-account');
  });

  it('R1 does NOT fire when suiteSuccessBundle is empty (legacy migration without a bundle)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.engine': 'LEGACY',
        'ns.foundation.suiteSuccessBundle': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.legacy-engine-on-new-account');
  });

  it('R2 fires (BLOCK) when subsidiaryCount>1 AND nexusList empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.tax.nexusList': '',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.oneworld-multi-sub-needs-nexus-list');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 does NOT fire when nexusList is populated', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.tax.nexusList': 'Atlas US Inc. | US/CA\nAtlas UK Ltd. | GB',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.oneworld-multi-sub-needs-nexus-list');
  });

  it('R3 fires (BLOCK) when einvoicingMandatory=YES AND einvoicingSuiteApp empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.einvoicingMandatory': 'YES',
        'ns.tax.einvoicingSuiteApp': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.einvoicing-yes-needs-suiteapp');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire when einvoicingMandatory=NO', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.einvoicingMandatory': 'NO',
        'ns.tax.einvoicingSuiteApp': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.einvoicing-yes-needs-suiteapp');
  });

  it('R4 fires (BLOCK) when withholdingInScope=true', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.tax.withholdingInScope': true },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.withholding-needs-suiteapp');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 does NOT fire when withholdingInScope=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.tax.withholdingInScope': false },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.withholding-needs-suiteapp');
  });

  it('R5 fires (WARN) when useTaxInScope=true AND primaryCountry!=US', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.useTaxInScope': true,
        'ns.foundation.primaryCountry': 'GB',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.use-tax-only-in-us');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire when primaryCountry=US', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.useTaxInScope': true,
        'ns.foundation.primaryCountry': 'US',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.use-tax-only-in-us');
  });

  it('R6 fires (WARN) when salesTaxAutomation=true AND nexusList empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.salesTaxAutomation': true,
        'ns.tax.nexusList': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.automation-needs-nexus-list');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 fires (WARN) when multiJurisdictionReporting=true AND nexusList empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.multiJurisdictionReporting': true,
        'ns.tax.nexusList': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.multi-jurisdiction-needs-multiple-nexuses');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 does NOT fire when nexusList is populated (DSL has no line-count operator; pragmatic empty-only fallback)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.multiJurisdictionReporting': true,
        'ns.tax.nexusList': 'Atlas US Inc. | US/CA\nAtlas US Inc. | US/NY',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.multi-jurisdiction-needs-multiple-nexuses');
  });

  it('R8 fires (INFO) when taxExemptCustomers=true', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.tax.taxExemptCustomers': true },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.exempt-customers-need-certificate-management');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R8 does NOT fire when taxExemptCustomers=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.tax.taxExemptCustomers': false },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.exempt-customers-need-certificate-management');
  });

  it('R9 fires (INFO) when reverseChargeInScope=true AND foundation.edition!=ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.reverseChargeInScope': true,
        'ns.foundation.edition': 'MID_MARKET',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.tax.reverse-charge-typical-on-oneworld');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R9 does NOT fire on ONEWORLD edition', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.tax.reverseChargeInScope': true,
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.tax.reverse-charge-typical-on-oneworld');
  });
});

// ─── NS Pack 3 — Localization & SuiteSuccess ─────────────────────────────────

describe('netsuiteAdaptor: NS Pack 3 — LOCALIZATION flow shape', () => {
  const loc = netsuiteAdaptor.schema.flows.find((f) => f.id === 'LOCALIZATION');

  it('LOCALIZATION flow exists with the expected label + description', () => {
    expect(loc).toBeDefined();
    expect(loc!.label).toBe('Localization & SuiteSuccess');
    expect(loc!.description).toMatch(/suitesuccess|coa|statutory|residency|gdpr|language|localization/i);
  });

  it('LOCALIZATION sits between TAX and SOLUTION_DESIGN (NS SD Depth Pack inserted SD after)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    const tIdx = ids.indexOf('TAX');
    const lIdx = ids.indexOf('LOCALIZATION');
    const sdIdx = ids.indexOf('SOLUTION_DESIGN');
    expect(lIdx).toBe(tIdx + 1);
    expect(sdIdx).toBe(lIdx + 1);
  });

  it('renders four sections in the documented order', () => {
    const ids = (loc!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['bundles', 'statutory', 'datasovereignty', 'languages']);
  });

  it('SuiteSuccess Bundles & Country COA — 4 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'bundles')!;
    expect(sec.label).toBe('SuiteSuccess Bundles & Country COA');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.localization.bundlePerSubsidiary')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.coaCustomScope')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.countrySpecificGlAccounts')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.localization.fiscalCalendarPerSubsidiary')?.inputType).toBe('BOOLEAN');
  });

  it('Statutory Reporting per Country — 4 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'statutory')!;
    expect(sec.label).toBe('Statutory Reporting per Country');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.localization.statutoryReports')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.taxReportingSuiteApps')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.auditTrailRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.localization.periodLockPerSubsidiary')?.inputType).toBe('BOOLEAN');
  });

  it('Data Residency & Privacy — 4 questions with the right ids + types + options', () => {
    const sec = loc!.sections.find((s) => s.id === 'datasovereignty')!;
    expect(sec.label).toBe('Data Residency & Privacy');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.localization.dataResidencyRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.localization.dataResidencyJurisdiction')?.inputType).toBe('TEXT');
    expect(byId.get('ns.localization.gdprApplicable')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.localization.dpaSignedWithNetsuite')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.localization.dpaSignedWithNetsuite')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['IN_PROGRESS', 'NO', 'N_A', 'YES']);
  });

  it('Languages & Localization SuiteApps — 4 questions with the right ids + types', () => {
    const sec = loc!.sections.find((s) => s.id === 'languages')!;
    expect(sec.label).toBe('Languages & Localization SuiteApps');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.localization.uiLanguages')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.languagesPerSubsidiary')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.localizationSuiteApps')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.localization.customLocalizationDev')?.inputType).toBe('BOOLEAN');
  });
});

describe('netsuiteAdaptor: NS Pack 3 — Localization rules registered in netsuite-rules', () => {
  const ids = netsuiteAdaptor.rules.rules.map((r) => r.id);

  it('R1 custom bundle on Mid-Market+ (WARN)', () => {
    expect(ids).toContain('ns.localization.custom-bundle-on-mid-market-or-above-warn');
  });
  it('R2 bundle list must cover all subsidiaries', () => {
    expect(ids).toContain('ns.localization.bundle-list-must-cover-all-subsidiaries');
  });
  it('R3 statutory reports need framework', () => {
    expect(ids).toContain('ns.localization.statutory-reports-need-framework');
  });
  it('R4 GDPR needs DPA', () => {
    expect(ids).toContain('ns.localization.gdpr-needs-dpa');
  });
  it('R5 data residency may not be supported', () => {
    expect(ids).toContain('ns.localization.data-residency-may-not-be-supported');
  });
  it('R6 multi-language needs OneWorld', () => {
    expect(ids).toContain('ns.localization.multi-language-needs-oneworld');
  });
  it('R7 COA custom modifications need scope', () => {
    expect(ids).toContain('ns.localization.coa-custom-modifications-need-scope');
  });
  it('R8 fiscal calendar per subsidiary needs OneWorld', () => {
    expect(ids).toContain('ns.localization.fiscal-calendar-per-subsidiary-needs-oneworld');
  });
  it('R9 custom localization dev needs SuiteCloud Plus (INFO)', () => {
    expect(ids).toContain('ns.localization.custom-localization-dev-needs-suitecloud-plus');
  });
});

describe('netsuiteAdaptor: NS Pack 3 — Localization rule evaluation', () => {
  it('R1 fires (WARN) when multi-sub paid edition has populated bundle list (DSL has no contains operator; pragmatic over-broad fallback)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.edition': 'ONEWORLD',
        'ns.localization.bundlePerSubsidiary': 'Atlas US Inc. | Custom — no bundle\nAtlas UK Ltd. | UK',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.custom-bundle-on-mid-market-or-above-warn');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R1 does NOT fire on STARTER edition', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.foundation.edition': 'STARTER',
        'ns.localization.bundlePerSubsidiary': 'Sub A | Custom',
      },
      license: { edition: 'STARTER', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.custom-bundle-on-mid-market-or-above-warn');
  });

  it('R1 does NOT fire on single-subsidiary engagements', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 1,
        'ns.foundation.edition': 'MID_MARKET',
        'ns.localization.bundlePerSubsidiary': 'US',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.custom-bundle-on-mid-market-or-above-warn');
  });

  it('R2 fires (WARN) when subsidiaryCount>1 AND bundlePerSubsidiary empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.foundation.subsidiaryCount': 3,
        'ns.localization.bundlePerSubsidiary': '',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.bundle-list-must-cover-all-subsidiaries');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 fires (BLOCK) when statutoryReports populated AND taxReportingSuiteApps empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.statutoryReports': 'US: 1099-NEC, FBAR\nUK: VAT 100',
        'ns.localization.taxReportingSuiteApps': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.statutory-reports-need-framework');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R3 does NOT fire when taxReportingSuiteApps is populated', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.statutoryReports': 'US: 1099-NEC',
        'ns.localization.taxReportingSuiteApps': 'US Tax Reports',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.statutory-reports-need-framework');
  });

  it('R4 fires (BLOCK) when gdprApplicable=true AND dpaSignedWithNetsuite=NO', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.gdprApplicable': true,
        'ns.localization.dpaSignedWithNetsuite': 'NO',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.gdpr-needs-dpa');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R4 fires (BLOCK) when gdprApplicable=true AND dpaSignedWithNetsuite is unset', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.localization.gdprApplicable': true },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('ns.localization.gdpr-needs-dpa');
  });

  it('R4 does NOT fire when DPA is signed (YES)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.gdprApplicable': true,
        'ns.localization.dpaSignedWithNetsuite': 'YES',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.gdpr-needs-dpa');
  });

  it('R5 fires (WARN) when residency required AND jurisdiction is outside US/EU/AU regions', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.dataResidencyRequired': true,
        'ns.localization.dataResidencyJurisdiction': 'Saudi Arabia',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.data-residency-may-not-be-supported');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire when jurisdiction is in the supported allow-list (e.g., "European Union")', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.dataResidencyRequired': true,
        'ns.localization.dataResidencyJurisdiction': 'European Union',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.data-residency-may-not-be-supported');
  });

  it('R6 fires (WARN) when languagesPerSubsidiary populated AND edition !== ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.languagesPerSubsidiary': 'Sub A | en\nSub B | de',
        'ns.foundation.edition': 'MID_MARKET',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.multi-language-needs-oneworld');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R6 does NOT fire on ONEWORLD edition', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.languagesPerSubsidiary': 'Sub A | en\nSub B | de',
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.multi-language-needs-oneworld');
  });

  it('R7 fires (WARN) when countrySpecificGlAccounts=true AND coaCustomScope empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.countrySpecificGlAccounts': true,
        'ns.localization.coaCustomScope': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.coa-custom-modifications-need-scope');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 does NOT fire when coaCustomScope is populated', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.countrySpecificGlAccounts': true,
        'ns.localization.coaCustomScope': 'Add: 2350-Withholding Tax Payable',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.coa-custom-modifications-need-scope');
  });

  it('R8 fires (BLOCK) when fiscalCalendarPerSubsidiary=true AND edition !== ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.fiscalCalendarPerSubsidiary': true,
        'ns.foundation.edition': 'ENTERPRISE',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.fiscal-calendar-per-subsidiary-needs-oneworld');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R8 does NOT fire on ONEWORLD edition', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.fiscalCalendarPerSubsidiary': true,
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.fiscal-calendar-per-subsidiary-needs-oneworld');
  });

  it('R9 fires (INFO) when customLocalizationDev=true AND suiteCloudPlus=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.customLocalizationDev': true,
        'ns.foundation.suiteCloudPlus': false,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.localization.custom-localization-dev-needs-suitecloud-plus');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R9 does NOT fire when SuiteCloud Plus is in scope', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.localization.customLocalizationDev': true,
        'ns.foundation.suiteCloudPlus': true,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.localization.custom-localization-dev-needs-suitecloud-plus');
  });
});

// ─── Kickoff Pack — UNIVERSAL (mirrored from adaptor-odoo) ───────────────────

describe('netsuiteAdaptor: Kickoff Pack — KICKOFF flow shape', () => {
  const kickoff = netsuiteAdaptor.schema.flows.find((f) => f.id === 'KICKOFF');

  it('KICKOFF flow exists with the expected label + description', () => {
    expect(kickoff).toBeDefined();
    expect(kickoff!.label).toBe('Project Kickoff');
    expect(kickoff!.description).toMatch(/mandate|governance|communication|discovery/i);
  });

  it('KICKOFF renders as the FIRST flow (before FOUNDATION)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids[0]).toBe('KICKOFF');
    expect(ids.indexOf('FOUNDATION')).toBe(1);
  });

  it('renders three sections in the documented order', () => {
    const ids = (kickoff!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['mandate', 'governance', 'communication']);
  });

  it('Project Mandate — 4 questions identical to Odoo Kickoff (universal pack)', () => {
    const sec = kickoff!.sections.find((s) => s.id === 'mandate')!;
    expect(sec.label).toBe('Project Mandate');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('kickoff.mandate.sponsor')?.inputType).toBe('TEXT');
    expect(byId.get('kickoff.mandate.businessCase')?.inputType).toBe('TEXTAREA');
    expect(byId.get('kickoff.mandate.successCriteria')?.inputType).toBe('TEXTAREA');
    expect(byId.get('kickoff.mandate.targetGoLiveDate')?.inputType).toBe('TEXT');
  });

  it('Governance & Decision-Making — 4 questions with the right options', () => {
    const sec = kickoff!.sections.find((s) => s.id === 'governance')!;
    expect(sec.label).toBe('Governance & Decision-Making');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('kickoff.governance.steeringCadence')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('kickoff.governance.steeringCadence')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['AD_HOC', 'BIWEEKLY', 'MONTHLY', 'WEEKLY']);
    expect(byId.get('kickoff.governance.workingGroupCadence')?.inputType).toBe('SINGLE_SELECT');
    expect(byId.get('kickoff.governance.decisionThresholds')?.inputType).toBe('TEXTAREA');
    expect(byId.get('kickoff.governance.escalationPath')?.inputType).toBe('TEXT');
  });

  it('Communication Plan — 4 questions with the right options', () => {
    const sec = kickoff!.sections.find((s) => s.id === 'communication')!;
    expect(sec.label).toBe('Communication Plan');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('kickoff.communication.statusReportCadence')?.inputType).toBe('SINGLE_SELECT');
    expect(byId.get('kickoff.communication.statusReportAudience')?.inputType).toBe('TEXTAREA');
    expect(byId.get('kickoff.communication.issueReportingChannel')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('kickoff.communication.issueReportingChannel')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['EMAIL', 'MIXED', 'SHARED_DOC', 'WORKING_GROUP']);
    expect(byId.get('kickoff.communication.stakeholderNotes')?.inputType).toBe('TEXTAREA');
  });
});

describe('netsuiteAdaptor: Kickoff Pack — rules registered in netsuite-rules', () => {
  const ids = netsuiteAdaptor.rules.rules.map((r) => r.id);

  it('R1 sponsor required (BLOCK)', () => {
    expect(ids).toContain('kickoff.mandate.sponsor-required');
  });
  it('R2 success criteria required (WARN)', () => {
    expect(ids).toContain('kickoff.mandate.success-criteria-required');
  });
  it('R3 steering cadence monthly/ad-hoc warn', () => {
    expect(ids).toContain('kickoff.governance.steering-cadence-monthly-warn');
  });
  it('R4 escalation path required (BLOCK)', () => {
    expect(ids).toContain('kickoff.governance.escalation-path-required');
  });
  it('R5 tight timeline on multi-entity (NetSuite variant uses ns.foundation.edition=ONEWORLD)', () => {
    expect(ids).toContain('kickoff.tight-timeline-on-multi-entity');
  });
  it('R6 communication audience empty', () => {
    expect(ids).toContain('kickoff.communication.audience-empty');
  });
});

describe('netsuiteAdaptor: Kickoff Pack — rule evaluation', () => {
  it('R1 fires (BLOCK) when sponsor is empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'kickoff.mandate.sponsor': '' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'kickoff.mandate.sponsor-required');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R2 fires (WARN) when successCriteria is empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'kickoff.mandate.successCriteria': '' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('kickoff.mandate.success-criteria-required');
  });

  it('R3 fires (WARN) for MONTHLY or AD_HOC steering cadence', () => {
    for (const cadence of ['MONTHLY', 'AD_HOC']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: { 'kickoff.governance.steeringCadence': cadence },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R3 should fire when cadence=${cadence}`,
      ).toContain('kickoff.governance.steering-cadence-monthly-warn');
    }
  });

  it('R3 does NOT fire on BIWEEKLY', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'kickoff.governance.steeringCadence': 'BIWEEKLY' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('kickoff.governance.steering-cadence-monthly-warn');
  });

  it('R4 fires (BLOCK) when escalationPath is empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'kickoff.governance.escalationPath': '' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('kickoff.governance.escalation-path-required');
  });

  it('R5 fires (WARN) when targetGoLiveDate is set AND ns.foundation.edition=ONEWORLD', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'kickoff.mandate.targetGoLiveDate': '2026-11-15',
        'ns.foundation.edition': 'ONEWORLD',
      },
      license: { edition: 'ONEWORLD', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'kickoff.tight-timeline-on-multi-entity');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R5 does NOT fire on non-OneWorld editions', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'kickoff.mandate.targetGoLiveDate': '2026-11-15',
        'ns.foundation.edition': 'MID_MARKET',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('kickoff.tight-timeline-on-multi-entity');
  });

  it('R6 fires (WARN) when statusReportAudience is empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'kickoff.communication.statusReportAudience': '' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).toContain('kickoff.communication.audience-empty');
  });
});

// ─── NS Solution Design Depth Pack ───────────────────────────────────────────

describe('netsuiteAdaptor: NS SD Depth — SOLUTION_DESIGN flow shape', () => {
  const sd = netsuiteAdaptor.schema.flows.find((f) => f.id === 'SOLUTION_DESIGN');

  it('SOLUTION_DESIGN flow exists with the expected label + description', () => {
    expect(sd).toBeDefined();
    expect(sd!.label).toBe('Solution Design — Architecture');
    expect(sd!.description).toMatch(/architecture|customization|data model|security|integration|reporting/i);
  });

  it('SOLUTION_DESIGN sits between LOCALIZATION and R2R', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    const locIdx = ids.indexOf('LOCALIZATION');
    const sdIdx = ids.indexOf('SOLUTION_DESIGN');
    const r2rIdx = ids.indexOf('R2R');
    expect(sdIdx).toBe(locIdx + 1);
    expect(r2rIdx).toBe(sdIdx + 1);
  });

  it('renders four sections in the documented order', () => {
    const ids = (sd!.sections as Array<{ id: string; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    expect(ids).toEqual(['approach', 'datamodel', 'security', 'integrations']);
  });

  it('Architecture Approach — 4 questions with the right ids + types + options', () => {
    const sec = sd!.sections.find((s) => s.id === 'approach')!;
    expect(sec.label).toBe('Architecture Approach');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.design.architecturePattern')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.design.architecturePattern')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['HYBRID_CUSTOM', 'MULTI_PLATFORM', 'SUITECLOUD_IPAAS', 'SUITECLOUD_ONLY']);
    expect(byId.get('ns.design.customUiScope')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.design.customUiScope')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['HEAVY', 'MINIMAL', 'MODERATE', 'NONE']);
    expect(byId.get('ns.design.scriptingScope')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.reportingPlatform')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.design.reportingPlatform')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['CONNECT_TO_BI', 'MIXED', 'SAVED_SEARCHES', 'SUITEANALYTICS']);
  });

  it('Data Model & Master Data — 4 questions with the right ids + types', () => {
    const sec = sd!.sections.find((s) => s.id === 'datamodel')!;
    expect(sec.label).toBe('Data Model & Master Data');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.design.customRecords')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.customFieldsScope')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.masterDataOwnership')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.referenceDataSources')?.inputType).toBe('TEXTAREA');
  });

  it('Security & Roles — 4 questions with the right ids + types', () => {
    const sec = sd!.sections.find((s) => s.id === 'security')!;
    expect(sec.label).toBe('Security & Roles');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.design.standardRoleCustomization')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.sodMatrixRequired')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.design.fieldLevelSecurity')?.inputType).toBe('BOOLEAN');
    expect(byId.get('ns.design.auditLogRetentionMonths')?.inputType).toBe('NUMBER');
  });

  it('Integration Architecture — 4 questions with the right ids + types + options', () => {
    const sec = sd!.sections.find((s) => s.id === 'integrations')!;
    expect(sec.label).toBe('Integration Architecture');
    const byId = new Map(sec.questions.map((q) => [q.id, q]));
    expect(byId.get('ns.design.inboundIntegrations')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.outboundIntegrations')?.inputType).toBe('TEXTAREA');
    expect(byId.get('ns.design.ipaasInScope')?.inputType).toBe('SINGLE_SELECT');
    expect(
      (byId.get('ns.design.ipaasInScope')?.options ?? []).map((o) => o.value).sort(),
    ).toEqual(['BOOMI', 'CELIGO', 'MULESOFT', 'NONE', 'OTHER', 'WORKATO']);
    expect(byId.get('ns.design.apiGovernance')?.inputType).toBe('TEXTAREA');
  });
});

describe('netsuiteAdaptor: NS SD Depth — rules registered in netsuite-rules', () => {
  const ids = netsuiteAdaptor.rules.rules.map((r) => r.id);

  it('R1 heavy custom UI needs SuiteCloud Plus', () => {
    expect(ids).toContain('ns.design.heavy-customui-needs-suitecloud-plus');
  });
  it('R2 RESTlets need SuiteCloud Plus', () => {
    expect(ids).toContain('ns.design.restlets-need-suitecloud-plus');
  });
  it('R3 SoD needs custom roles', () => {
    expect(ids).toContain('ns.design.sod-needs-custom-roles');
  });
  it('R4 external BI needs SuiteAnalytics Connect', () => {
    expect(ids).toContain('ns.design.external-bi-needs-suiteanalytics-connect');
  });
  it('R5 inbound integrations need method', () => {
    expect(ids).toContain('ns.design.inbound-integrations-need-method');
  });
  it('R6 iPaaS name required when OTHER', () => {
    expect(ids).toContain('ns.design.ipaas-name-required-when-other');
  });
  it('R7 long audit retention needs extract strategy', () => {
    expect(ids).toContain('ns.design.long-audit-retention-needs-extract-strategy');
  });
  it('R8 heavy custom records on small edition', () => {
    expect(ids).toContain('ns.design.heavy-custom-records-on-small-edition');
  });
  it('R9 field-level security needs custom roles', () => {
    expect(ids).toContain('ns.design.field-level-security-needs-custom-roles');
  });
});

describe('netsuiteAdaptor: NS SD Depth — rule evaluation', () => {
  it('R1 fires (WARN) when customUiScope=HEAVY AND suiteCloudPlus=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.customUiScope': 'HEAVY',
        'ns.foundation.suiteCloudPlus': false,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.heavy-customui-needs-suitecloud-plus');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R1 does NOT fire when SuiteCloud Plus is in scope', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.customUiScope': 'HEAVY',
        'ns.foundation.suiteCloudPlus': true,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.design.heavy-customui-needs-suitecloud-plus');
  });

  it('R2 fires (WARN) when scriptingScope mentions RESTlet AND suiteCloudPlus=false (DSL has no contains operator; pragmatic fallback fires whenever scriptingScope is populated)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.scriptingScope': 'RESTlet for external API ingestion\nUser Event scripts on Sales Order',
        'ns.foundation.suiteCloudPlus': false,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.restlets-need-suitecloud-plus');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 fires (WARN) when sodMatrixRequired=true AND foundation.customRolesRequired=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.sodMatrixRequired': true,
        'ns.foundation.customRolesRequired': false,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.sod-needs-custom-roles');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R3 does NOT fire when customRolesRequired=true', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.sodMatrixRequired': true,
        'ns.foundation.customRolesRequired': true,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.design.sod-needs-custom-roles');
  });

  it('R4 fires (INFO) on CONNECT_TO_BI or MIXED reporting platform', () => {
    for (const platform of ['CONNECT_TO_BI', 'MIXED']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: { 'ns.design.reportingPlatform': platform },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'ns.design.external-bi-needs-suiteanalytics-connect');
      expect(r, `R4 should fire when reportingPlatform=${platform}`).toBeDefined();
      expect(r?.severity).toBe('INFO');
    }
  });

  it('R4 does NOT fire on SAVED_SEARCHES', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.design.reportingPlatform': 'SAVED_SEARCHES' },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.design.external-bi-needs-suiteanalytics-connect');
  });

  it('R5 fires (BLOCK) when inboundIntegrations populated AND architecturePattern=SUITECLOUD_ONLY', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.inboundIntegrations': 'Shopify | sales orders | real-time | RESTlet',
        'ns.design.architecturePattern': 'SUITECLOUD_ONLY',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.inbound-integrations-need-method');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R5 does NOT fire when architecturePattern=SUITECLOUD_IPAAS', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.inboundIntegrations': 'Shopify | sales orders | real-time',
        'ns.design.architecturePattern': 'SUITECLOUD_IPAAS',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.design.inbound-integrations-need-method');
  });

  it('R6 fires (WARN) when ipaasInScope=OTHER AND apiGovernance empty', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.ipaasInScope': 'OTHER',
        'ns.design.apiGovernance': '',
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.ipaas-name-required-when-other');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('WARN');
  });

  it('R7 fires (INFO) when auditLogRetentionMonths > 84', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.design.auditLogRetentionMonths': 120 },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.long-audit-retention-needs-extract-strategy');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('INFO');
  });

  it('R7 does NOT fire at the boundary (84 months)', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: { 'ns.design.auditLogRetentionMonths': 84 },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.design.long-audit-retention-needs-extract-strategy');
  });

  it('R8 fires (WARN) when customRecords populated AND edition is small (DSL has no line-count operator; pragmatic fallback fires on any populated customRecords + small edition)', () => {
    for (const edition of ['STARTER', 'STANDARD', 'FINANCIALS_FIRST']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: {
          'ns.design.customRecords': 'Approval Tracker\nVendor Onboarding\nProject Milestone',
          'ns.foundation.edition': edition,
        },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      const r = conflicts.find((c) => c.id === 'ns.design.heavy-custom-records-on-small-edition');
      expect(r, `R8 should fire when edition=${edition}`).toBeDefined();
      expect(r?.severity).toBe('WARN');
    }
  });

  it('R8 does NOT fire on MID_MARKET / ENTERPRISE / ONEWORLD', () => {
    for (const edition of ['MID_MARKET', 'ENTERPRISE', 'ONEWORLD']) {
      const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
        answers: {
          'ns.design.customRecords': 'Approval Tracker\nVendor Onboarding',
          'ns.foundation.edition': edition,
        },
        license: { edition: 'MID_MARKET', modules: [] },
      });
      expect(
        conflicts.map((c) => c.id),
        `R8 should NOT fire when edition=${edition}`,
      ).not.toContain('ns.design.heavy-custom-records-on-small-edition');
    }
  });

  it('R9 fires (BLOCK) when fieldLevelSecurity=true AND foundation.customRolesRequired=false', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.fieldLevelSecurity': true,
        'ns.foundation.customRolesRequired': false,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    const r = conflicts.find((c) => c.id === 'ns.design.field-level-security-needs-custom-roles');
    expect(r).toBeDefined();
    expect(r?.severity).toBe('BLOCK');
  });

  it('R9 does NOT fire when customRolesRequired=true', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
        'ns.design.fieldLevelSecurity': true,
        'ns.foundation.customRolesRequired': true,
      },
      license: { edition: 'MID_MARKET', modules: [] },
    });
    expect(conflicts.map((c) => c.id)).not.toContain('ns.design.field-level-security-needs-custom-roles');
  });
});

// ─── NS Pack W — APPROVALS flow shape ───────────────────────────────────────

describe('netsuiteAdaptor: NS Pack W — APPROVALS flow shape', () => {
  const approvals = netsuiteAdaptor.schema.flows.find((f) => f.id === 'APPROVALS');

  it('APPROVALS flow exists with the expected label', () => {
    expect(approvals).toBeDefined();
    expect(approvals!.label).toBe('Approval Workflows');
  });

  it('APPROVALS sits AFTER P2P, BEFORE O2C', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('APPROVALS')).toBeGreaterThan(ids.indexOf('P2P'));
    expect(ids.indexOf('APPROVALS')).toBeLessThan(ids.indexOf('O2C'));
  });

  it('has 3 sections: transactional / recordstate / notifications', () => {
    expect(approvals!.sections).toHaveLength(3);
    const sectionIds = approvals!.sections.map((s) => s.id);
    expect(sectionIds).toContain('transactional');
    expect(sectionIds).toContain('recordstate');
    expect(sectionIds).toContain('notifications');
  });

  it('transactional section has the 10 expected questions (5 scope + 5 detail)', () => {
    const txn = approvals!.sections.find((s) => s.id === 'transactional')!;
    const ids = txn.questions.map((q) => q.id);
    expect(ids).toContain('ns.approvals.poApprovalInScope');
    expect(ids).toContain('ns.approvals.poApprovalTiers');
    expect(ids).toContain('ns.approvals.jeApprovalInScope');
    expect(ids).toContain('ns.approvals.jeApprovalTiers');
    expect(ids).toContain('ns.approvals.vbApprovalInScope');
    expect(ids).toContain('ns.approvals.vbApprovalTiers');
    expect(ids).toContain('ns.approvals.expenseApprovalInScope');
    expect(ids).toContain('ns.approvals.expenseApprovalTiers');
    expect(ids).toContain('ns.approvals.soApprovalInScope');
    expect(ids).toContain('ns.approvals.soApprovalTrigger');
  });

  it('recordstate section has the 2 expected questions', () => {
    const rs = approvals!.sections.find((s) => s.id === 'recordstate')!;
    const ids = rs.questions.map((q) => q.id);
    expect(ids).toContain('ns.approvals.recordStateWorkflowsInScope');
    expect(ids).toContain('ns.approvals.recordStateWorkflows');
  });

  it('notifications section has cadence + escalationDays', () => {
    const notif = approvals!.sections.find((s) => s.id === 'notifications')!;
    const ids = notif.questions.map((q) => q.id);
    expect(ids).toContain('ns.approvals.notificationCadence');
    expect(ids).toContain('ns.approvals.escalationDays');
  });

  it('notificationCadence is a SINGLE_SELECT with IMMEDIATE / DAILY_DIGEST / BOTH', () => {
    const notif = approvals!.sections.find((s) => s.id === 'notifications')!;
    const q = notif.questions.find((q) => q.id === 'ns.approvals.notificationCadence')!;
    expect(q.inputType).toBe('SINGLE_SELECT');
    const optionValues = (q.options ?? []).map((o) => o.value);
    expect(optionValues).toEqual(['IMMEDIATE', 'DAILY_DIGEST', 'BOTH']);
  });

  it('escalationDays is a NUMBER input', () => {
    const notif = approvals!.sections.find((s) => s.id === 'notifications')!;
    const q = notif.questions.find((q) => q.id === 'ns.approvals.escalationDays')!;
    expect(q.inputType).toBe('NUMBER');
  });

  it('every approval-tiers TEXTAREA dependsOn its scope flag', () => {
    const txn = approvals!.sections.find((s) => s.id === 'transactional')!;
    const pairs: Array<[string, string]> = [
      ['ns.approvals.poApprovalTiers', 'ns.approvals.poApprovalInScope'],
      ['ns.approvals.jeApprovalTiers', 'ns.approvals.jeApprovalInScope'],
      ['ns.approvals.vbApprovalTiers', 'ns.approvals.vbApprovalInScope'],
      ['ns.approvals.expenseApprovalTiers', 'ns.approvals.expenseApprovalInScope'],
      ['ns.approvals.soApprovalTrigger', 'ns.approvals.soApprovalInScope'],
    ];
    for (const [tiersId, scopeId] of pairs) {
      const q = txn.questions.find((q) => q.id === tiersId);
      expect(q, `question ${tiersId} should exist`).toBeDefined();
      expect(q!.dependsOn?.questionId, `${tiersId} should dependsOn ${scopeId}`).toBe(scopeId);
      expect(q!.dependsOn?.value).toBe(true);
    }
  });

  it('all in-scope flags are BOOLEAN inputType', () => {
    const txn = approvals!.sections.find((s) => s.id === 'transactional')!;
    const rs = approvals!.sections.find((s) => s.id === 'recordstate')!;
    const allScopeFlags = [...txn.questions, ...rs.questions].filter((q) =>
      q.id.endsWith('InScope'),
    );
    expect(allScopeFlags.length).toBeGreaterThanOrEqual(6);
    for (const q of allScopeFlags) {
      expect(q.inputType, `${q.id} should be BOOLEAN`).toBe('BOOLEAN');
    }
  });

  it('all approval-tiers detail questions are TEXTAREA inputType', () => {
    const txn = approvals!.sections.find((s) => s.id === 'transactional')!;
    const detailIds = [
      'ns.approvals.poApprovalTiers',
      'ns.approvals.jeApprovalTiers',
      'ns.approvals.vbApprovalTiers',
      'ns.approvals.expenseApprovalTiers',
      'ns.approvals.soApprovalTrigger',
    ];
    for (const id of detailIds) {
      const q = txn.questions.find((q) => q.id === id)!;
      expect(q.inputType, `${id} should be TEXTAREA`).toBe('TEXTAREA');
    }
  });
});

// ─── NS Pack F — Reporting question schema ──────────────────────────────────

describe('netsuiteAdaptor: NS Pack F — Reporting questions in SOLUTION_DESIGN', () => {
  const sd = netsuiteAdaptor.schema.flows.find((f) => f.id === 'SOLUTION_DESIGN');
  const approach = sd!.sections.find((s) => s.id === 'approach')!;

  it('approach section contains ns.design.kpiCatalog (TEXTAREA)', () => {
    const q = approach.questions.find((q) => q.id === 'ns.design.kpiCatalog');
    expect(q, 'kpiCatalog question must exist').toBeDefined();
    expect(q!.inputType).toBe('TEXTAREA');
  });

  it('approach section contains ns.design.roleDashboards (TEXTAREA)', () => {
    const q = approach.questions.find((q) => q.id === 'ns.design.roleDashboards');
    expect(q, 'roleDashboards question must exist').toBeDefined();
    expect(q!.inputType).toBe('TEXTAREA');
  });

  it('kpiCatalog label mentions the workstream prefix format', () => {
    const q = approach.questions.find((q) => q.id === 'ns.design.kpiCatalog')!;
    expect(q.label).toMatch(/workstream|R2R|P2P|O2C/i);
  });

  it('roleDashboards label mentions role-to-KPI binding', () => {
    const q = approach.questions.find((q) => q.id === 'ns.design.roleDashboards')!;
    expect(q.label.toLowerCase()).toContain('role');
    expect(q.label.toLowerCase()).toContain('kpi');
  });

  it('both questions are non-required (consultant-optional)', () => {
    const kpi = approach.questions.find((q) => q.id === 'ns.design.kpiCatalog')!;
    const dash = approach.questions.find((q) => q.id === 'ns.design.roleDashboards')!;
    expect(kpi.required).toBe(false);
    expect(dash.required).toBe(false);
  });

  it('reportingPlatform still exists alongside the new questions (Pack F adds, does not replace)', () => {
    const q = approach.questions.find((q) => q.id === 'ns.design.reportingPlatform');
    expect(q).toBeDefined();
    expect(q!.inputType).toBe('SINGLE_SELECT');
  });
});

// ─── NS Pack D — Tax matrix questions ──────────────────────────────────────

describe('netsuiteAdaptor: NS Pack D — Tax engine questions', () => {
  const tax = netsuiteAdaptor.schema.flows.find((f) => f.id === 'TAX');
  const engine = tax!.sections.find((s) => s.id === 'engine')!;

  it('engine section contains ns.tax.taxCodeMatrix (TEXTAREA)', () => {
    const q = engine.questions.find((q) => q.id === 'ns.tax.taxCodeMatrix');
    expect(q, 'taxCodeMatrix question must exist').toBeDefined();
    expect(q!.inputType).toBe('TEXTAREA');
  });

  it('engine section contains ns.tax.taxScheduleMatrix (TEXTAREA)', () => {
    const q = engine.questions.find((q) => q.id === 'ns.tax.taxScheduleMatrix');
    expect(q, 'taxScheduleMatrix question must exist').toBeDefined();
    expect(q!.inputType).toBe('TEXTAREA');
  });

  it('taxCodeMatrix label mentions the jurisdiction:type:rate format', () => {
    const q = engine.questions.find((q) => q.id === 'ns.tax.taxCodeMatrix')!;
    expect(q.label).toMatch(/jurisdiction/i);
    expect(q.label).toMatch(/rate/i);
  });

  it('taxScheduleMatrix label mentions transaction type wiring', () => {
    const q = engine.questions.find((q) => q.id === 'ns.tax.taxScheduleMatrix')!;
    expect(q.label.toLowerCase()).toContain('transaction');
  });

  it('both new questions are non-required', () => {
    const m = engine.questions.find((q) => q.id === 'ns.tax.taxCodeMatrix')!;
    const s = engine.questions.find((q) => q.id === 'ns.tax.taxScheduleMatrix')!;
    expect(m.required).toBe(false);
    expect(s.required).toBe(false);
  });

  it('existing tax engine questions still in place (Pack D adds, does not replace)', () => {
    const ids = engine.questions.map((q) => q.id);
    expect(ids).toContain('ns.tax.engine');
    expect(ids).toContain('ns.tax.itemPriceMode');
    expect(ids).toContain('ns.tax.defaultSalesTaxCode');
    expect(ids).toContain('ns.tax.defaultPurchaseTaxCode');
  });
});

// ─── Pack T — TESTING flow shape ────────────────────────────────────────────

describe('netsuiteAdaptor: Pack T — TESTING flow shape', () => {
  const testing = netsuiteAdaptor.schema.flows.find((f) => f.id === 'TESTING');

  it('TESTING flow exists with the expected label', () => {
    expect(testing).toBeDefined();
    expect(testing!.label).toBe('Test & UAT Planning');
  });

  it('TESTING sits AFTER RETURNS (and BEFORE TRAINING which Pack U appends last)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('TESTING')).toBeGreaterThan(ids.indexOf('RETURNS'));
    // Pack U appended TRAINING after TESTING; pre-Pack-U this test
    // asserted TESTING was the array tail. Same supersession pattern
    // as Odoo's MIGRATION-was-last test in Pack T.
    expect(ids.indexOf('TESTING')).toBeLessThan(ids.indexOf('TRAINING'));
  });

  it('TESTING has the 3 sections in canonical order — scope / performance / regression', () => {
    const sectionIds = testing!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['scope', 'performance', 'regression']);
  });

  it('Section 1 (scope) carries the 3 scope questions', () => {
    const scope = testing!.sections.find((s) => s.id === 'scope')!;
    const ids = scope.questions.map((q) => q.id);
    expect(ids).toEqual([
      'testing.scope.scenariosPerWorkstream',
      'testing.scope.testRoles',
      'testing.scope.acceptanceCriteriaTemplate',
    ]);
  });

  it('Section 2 (performance) carries the 2 performance questions', () => {
    const perf = testing!.sections.find((s) => s.id === 'performance')!;
    const ids = perf.questions.map((q) => q.id);
    expect(ids).toEqual([
      'testing.performance.performanceBenchmarks',
      'testing.performance.loadProfile',
    ]);
  });

  it('Section 3 (regression) carries the 2 regression questions', () => {
    const reg = testing!.sections.find((s) => s.id === 'regression')!;
    const ids = reg.questions.map((q) => q.id);
    expect(ids).toEqual([
      'testing.regression.regressionSmokeScenarios',
      'testing.regression.defectSeverityLevels',
    ]);
  });

  it('acceptanceCriteriaTemplate offers SIMPLE / GIVEN_WHEN_THEN / GHERKIN', () => {
    const q = testing!
      .sections.find((s) => s.id === 'scope')!
      .questions.find((qq) => qq.id === 'testing.scope.acceptanceCriteriaTemplate')!;
    expect(q.inputType).toBe('SINGLE_SELECT');
    const values = (q.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual(['GHERKIN', 'GIVEN_WHEN_THEN', 'SIMPLE']);
  });

  it('defectSeverityLevels offers STANDARD_4_LEVEL / MAJOR_MINOR / NUMERIC_1_5', () => {
    const q = testing!
      .sections.find((s) => s.id === 'regression')!
      .questions.find((qq) => qq.id === 'testing.regression.defectSeverityLevels')!;
    expect(q.inputType).toBe('SINGLE_SELECT');
    const values = (q.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual(['MAJOR_MINOR', 'NUMERIC_1_5', 'STANDARD_4_LEVEL']);
  });

  it('all TEXTAREA questions are non-required (consultant skip-friendly)', () => {
    for (const section of testing!.sections) {
      for (const q of section.questions) {
        if (q.inputType === 'TEXTAREA') {
          expect(q.required, `${q.id} should be optional`).toBe(false);
        }
      }
    }
  });

  it('flow description references the test artefacts the generators emit', () => {
    expect(testing!.description ?? '').toMatch(/Test_Scripts/);
    expect(testing!.description ?? '').toMatch(/Sign_Off_Matrix/);
    expect(testing!.description ?? '').toMatch(/Defect_Log_Template/);
    expect(testing!.description ?? '').toMatch(/Performance_Test_Plan/);
    expect(testing!.description ?? '').toMatch(/Regression_Test_Suite/);
  });

  it('question IDs use the testing.* namespace (cross-platform — same on Odoo)', () => {
    for (const section of testing!.sections) {
      for (const q of section.questions) {
        expect(q.id).toMatch(/^testing\./);
      }
    }
  });

  it('TESTING flow contributes 7 questions total (3 + 2 + 2)', () => {
    const total = testing!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(7);
  });
});

// ─── Pack U — TRAINING flow shape ───────────────────────────────────────────

describe('netsuiteAdaptor: Pack U — TRAINING flow shape', () => {
  const training = netsuiteAdaptor.schema.flows.find((f) => f.id === 'TRAINING');

  it('TRAINING flow exists with the expected label', () => {
    expect(training).toBeDefined();
    expect(training!.label).toBe('Training & Knowledge Transfer');
  });

  it('TRAINING sits AFTER TESTING (and BEFORE CUTOVER which Pack V appends last)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('TRAINING')).toBeGreaterThan(ids.indexOf('TESTING'));
    // Pack V appended CUTOVER after TRAINING; pre-Pack-V this test
    // asserted TRAINING was the array tail.
    expect(ids.indexOf('TRAINING')).toBeLessThan(ids.indexOf('CUTOVER'));
  });

  it('TRAINING has the 3 sections in canonical order — curriculum / schedule / assessment', () => {
    const sectionIds = training!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['curriculum', 'schedule', 'assessment']);
  });

  it('Section 1 (curriculum) carries the 3 curriculum questions', () => {
    const curriculum = training!.sections.find((s) => s.id === 'curriculum')!;
    const ids = curriculum.questions.map((q) => q.id);
    expect(ids).toEqual([
      'training.curriculum.trainingPerRole',
      'training.curriculum.businessChampions',
      'training.curriculum.cascadeStrategy',
    ]);
  });

  it('Section 2 (schedule) carries the 2 schedule questions', () => {
    const schedule = training!.sections.find((s) => s.id === 'schedule')!;
    const ids = schedule.questions.map((q) => q.id);
    expect(ids).toEqual([
      'training.schedule.trainingSessions',
      'training.schedule.deliveryMode',
    ]);
  });

  it('Section 3 (assessment) carries the 2 assessment questions', () => {
    const assessment = training!.sections.find((s) => s.id === 'assessment')!;
    const ids = assessment.questions.map((q) => q.id);
    expect(ids).toEqual([
      'training.assessment.assessmentRequired',
      'training.assessment.assessmentFormat',
    ]);
  });

  it('cascadeStrategy offers TRAIN_EVERYONE / TRAIN_THE_TRAINER / HYBRID', () => {
    const q = training!
      .sections.find((s) => s.id === 'curriculum')!
      .questions.find((qq) => qq.id === 'training.curriculum.cascadeStrategy')!;
    expect(q.inputType).toBe('SINGLE_SELECT');
    const values = (q.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual(['HYBRID', 'TRAIN_EVERYONE', 'TRAIN_THE_TRAINER']);
  });

  it('deliveryMode offers IN_PERSON / VIRTUAL_LIVE / HYBRID / SELF_PACED_VIDEO', () => {
    const q = training!
      .sections.find((s) => s.id === 'schedule')!
      .questions.find((qq) => qq.id === 'training.schedule.deliveryMode')!;
    expect(q.inputType).toBe('SINGLE_SELECT');
    const values = (q.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual(['HYBRID', 'IN_PERSON', 'SELF_PACED_VIDEO', 'VIRTUAL_LIVE']);
  });

  it('assessmentFormat offers QUIZ / LIVE_DEMO / WORK_PRODUCT_REVIEW / NONE', () => {
    const q = training!
      .sections.find((s) => s.id === 'assessment')!
      .questions.find((qq) => qq.id === 'training.assessment.assessmentFormat')!;
    expect(q.inputType).toBe('SINGLE_SELECT');
    const values = (q.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual(['LIVE_DEMO', 'NONE', 'QUIZ', 'WORK_PRODUCT_REVIEW']);
  });

  it('all TEXTAREA questions are non-required (consultant skip-friendly)', () => {
    for (const section of training!.sections) {
      for (const q of section.questions) {
        if (q.inputType === 'TEXTAREA') {
          expect(q.required, `${q.id} should be optional`).toBe(false);
        }
      }
    }
  });

  it('flow description references the training artefacts the generators emit', () => {
    expect(training!.description ?? '').toMatch(/per-role guides/);
    expect(training!.description ?? '').toMatch(/quick reference cards/);
    expect(training!.description ?? '').toMatch(/training matrix/);
    expect(training!.description ?? '').toMatch(/training schedule/);
    expect(training!.description ?? '').toMatch(/KT checklist/);
  });

  it('question IDs use the training.* universal namespace (cross-platform — same on Odoo)', () => {
    for (const section of training!.sections) {
      for (const q of section.questions) {
        expect(q.id).toMatch(/^training\./);
      }
    }
  });

  it('TRAINING flow contributes 7 questions total (3 + 2 + 2)', () => {
    const total = training!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(7);
  });
});

// ─── Pack V — CUTOVER flow shape ─────────────────────────────────────────────

describe('netsuiteAdaptor: Pack V — CUTOVER flow shape', () => {
  const cutover = netsuiteAdaptor.schema.flows.find((f) => f.id === 'CUTOVER');

  it('CUTOVER flow exists with the expected label', () => {
    expect(cutover).toBeDefined();
    expect(cutover!.label).toBe('Cutover & Go-Live');
  });

  it('CUTOVER sits AFTER TRAINING (and BEFORE HYPERCARE which Pack X appends last)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('CUTOVER')).toBeGreaterThan(ids.indexOf('TRAINING'));
    expect(ids.indexOf('CUTOVER')).toBeLessThan(ids.indexOf('HYPERCARE'));
  });

  it('CUTOVER has the 3 sections in canonical order — team / decisions / communication', () => {
    const sectionIds = cutover!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['team', 'decisions', 'communication']);
  });

  it('Section 1 (team) carries the 3 team questions', () => {
    const team = cutover!.sections.find((s) => s.id === 'team')!;
    const ids = team.questions.map((q) => q.id);
    expect(ids).toEqual([
      'cutover.team.cutoverTeamRoster',
      'cutover.team.dryRunCount',
      'cutover.team.dryRunDates',
    ]);
  });

  it('Section 2 (decisions) carries the 3 decision questions', () => {
    const dec = cutover!.sections.find((s) => s.id === 'decisions')!;
    const ids = dec.questions.map((q) => q.id);
    expect(ids).toEqual([
      'cutover.decisions.goNoGoCriteria',
      'cutover.decisions.goNoGoOwners',
      'cutover.decisions.rollbackTriggers',
    ]);
  });

  it('Section 3 (communication) carries the 2 comms questions', () => {
    const comm = cutover!.sections.find((s) => s.id === 'communication')!;
    const ids = comm.questions.map((q) => q.id);
    expect(ids).toEqual([
      'cutover.communication.cutoverMilestones',
      'cutover.communication.escalationContacts',
    ]);
  });

  it('dryRunCount is a NUMBER input', () => {
    const q = cutover!
      .sections.find((s) => s.id === 'team')!
      .questions.find((qq) => qq.id === 'cutover.team.dryRunCount')!;
    expect(q.inputType).toBe('NUMBER');
  });

  it('all TEXTAREA questions are non-required (consultant skip-friendly)', () => {
    for (const section of cutover!.sections) {
      for (const q of section.questions) {
        if (q.inputType === 'TEXTAREA') {
          expect(q.required, `${q.id} should be optional`).toBe(false);
        }
      }
    }
  });

  it('flow description references the cutover artefacts the generators emit', () => {
    expect(cutover!.description ?? '').toMatch(/runbook/);
    expect(cutover!.description ?? '').toMatch(/go\/no-go/i);
    expect(cutover!.description ?? '').toMatch(/rollback/);
    expect(cutover!.description ?? '').toMatch(/smoke/i);
    expect(cutover!.description ?? '').toMatch(/team roster/i);
    expect(cutover!.description ?? '').toMatch(/dry run/i);
  });

  it('question IDs use the cutover.* universal namespace (cross-platform — same on Odoo)', () => {
    for (const section of cutover!.sections) {
      for (const q of section.questions) {
        expect(q.id).toMatch(/^cutover\./);
      }
    }
  });

  it('CUTOVER flow contributes 8 questions total (3 + 3 + 2)', () => {
    const total = cutover!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(8);
  });
});

// ─── Pack X — HYPERCARE flow shape ───────────────────────────────────────────

describe('netsuiteAdaptor: Pack X — HYPERCARE flow shape', () => {
  const hypercare = netsuiteAdaptor.schema.flows.find((f) => f.id === 'HYPERCARE');

  it('HYPERCARE flow exists with the expected label', () => {
    expect(hypercare).toBeDefined();
    expect(hypercare!.label).toBe('Hypercare & BAU Transition');
  });

  it('HYPERCARE sits AFTER CUTOVER (and BEFORE STABILIZATION which Pack Y appends last)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('HYPERCARE')).toBeGreaterThan(ids.indexOf('CUTOVER'));
    expect(ids.indexOf('HYPERCARE')).toBeLessThan(ids.indexOf('STABILIZATION'));
  });

  it('HYPERCARE has 3 sections in canonical order — team / sla / cadence', () => {
    const sectionIds = hypercare!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['team', 'sla', 'cadence']);
  });

  it('Section 1 (team) carries the 3 team questions', () => {
    const team = hypercare!.sections.find((s) => s.id === 'team')!;
    const ids = team.questions.map((q) => q.id);
    expect(ids).toEqual([
      'hypercare.team.hypercareLeadName',
      'hypercare.team.hypercareTeamRoster',
      'hypercare.team.sustainmentOwner',
    ]);
  });

  it('Section 2 (sla) carries the 4 SLA questions', () => {
    const sla = hypercare!.sections.find((s) => s.id === 'sla')!;
    const ids = sla.questions.map((q) => q.id);
    expect(ids).toEqual([
      'hypercare.sla.hypercareDurationDays',
      'hypercare.sla.severityDefinitions',
      'hypercare.sla.responseTimeBySeverity',
      'hypercare.sla.businessHoursDefinition',
    ]);
  });

  it('Section 3 (cadence) carries the 4 cadence questions', () => {
    const cadence = hypercare!.sections.find((s) => s.id === 'cadence')!;
    const ids = cadence.questions.map((q) => q.id);
    expect(ids).toEqual([
      'hypercare.cadence.dailyStandupTime',
      'hypercare.cadence.weeklyReviewTime',
      'hypercare.cadence.warRoomHours',
      'hypercare.cadence.hypercareExitCriteria',
    ]);
  });

  it('hypercareDurationDays is a NUMBER input', () => {
    const q = hypercare!
      .sections.find((s) => s.id === 'sla')!
      .questions.find((qq) => qq.id === 'hypercare.sla.hypercareDurationDays')!;
    expect(q.inputType).toBe('NUMBER');
  });

  it('all TEXTAREA questions are non-required', () => {
    for (const section of hypercare!.sections) {
      for (const q of section.questions) {
        if (q.inputType === 'TEXTAREA') {
          expect(q.required, `${q.id} should be optional`).toBe(false);
        }
      }
    }
  });

  it('flow description references the hypercare artefacts', () => {
    expect(hypercare!.description ?? '').toMatch(/hypercare plan/i);
    expect(hypercare!.description ?? '').toMatch(/daily readiness/i);
    expect(hypercare!.description ?? '').toMatch(/escalation matrix/i);
    expect(hypercare!.description ?? '').toMatch(/war-room/i);
    expect(hypercare!.description ?? '').toMatch(/transition-to-support/i);
    expect(hypercare!.description ?? '').toMatch(/KPI dashboard/i);
    expect(hypercare!.description ?? '').toMatch(/power-user office hours/i);
  });

  it('question IDs use the hypercare.* universal namespace', () => {
    for (const section of hypercare!.sections) {
      for (const q of section.questions) {
        expect(q.id).toMatch(/^hypercare\./);
      }
    }
  });

  it('HYPERCARE flow contributes 11 questions total (3 + 4 + 4)', () => {
    const total = hypercare!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(11);
  });
});

// ─── Pack Y — STABILIZATION flow shape ───────────────────────────────────────

describe('netsuiteAdaptor: Pack Y — STABILIZATION flow shape', () => {
  const stab = netsuiteAdaptor.schema.flows.find((f) => f.id === 'STABILIZATION');

  it('STABILIZATION flow exists with the expected label', () => {
    expect(stab).toBeDefined();
    expect(stab!.label).toBe('Stabilization & Continuous Improvement');
  });

  it('STABILIZATION sits LAST in the flow order (after HYPERCARE) — terminal flow', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids[ids.length - 1]).toBe('STABILIZATION');
    expect(ids.indexOf('STABILIZATION')).toBeGreaterThan(ids.indexOf('HYPERCARE'));
  });

  it('STABILIZATION has 4 sections in canonical order — governance / benefits / backlog / learning', () => {
    const sectionIds = stab!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['governance', 'benefits', 'backlog', 'learning']);
  });

  it('Section 1 (governance) carries 4 questions', () => {
    const gov = stab!.sections.find((s) => s.id === 'governance')!;
    const ids = gov.questions.map((q) => q.id);
    expect(ids).toEqual([
      'stabilization.governance.stabilizationOwner',
      'stabilization.governance.governanceCommittee',
      'stabilization.governance.decisionCadence',
      'stabilization.governance.changeRequestProcess',
    ]);
  });

  it('Section 2 (benefits) carries 3 questions', () => {
    const ben = stab!.sections.find((s) => s.id === 'benefits')!;
    const ids = ben.questions.map((q) => q.id);
    expect(ids).toEqual([
      'stabilization.benefits.businessCaseSummary',
      'stabilization.benefits.benefitsReviewCadence',
      'stabilization.benefits.benefitsReviewOwner',
    ]);
  });

  it('Section 3 (backlog) carries 3 questions', () => {
    const bl = stab!.sections.find((s) => s.id === 'backlog')!;
    const ids = bl.questions.map((q) => q.id);
    expect(ids).toEqual([
      'stabilization.backlog.deferredFeatures',
      'stabilization.backlog.knownLimitations',
      'stabilization.backlog.phaseTwoScope',
    ]);
  });

  it('Section 4 (learning) carries 3 questions', () => {
    const lr = stab!.sections.find((s) => s.id === 'learning')!;
    const ids = lr.questions.map((q) => q.id);
    expect(ids).toEqual([
      'stabilization.learning.retroFormat',
      'stabilization.learning.retroDate',
      'stabilization.learning.lessonsLearnedSeed',
    ]);
  });

  it('all TEXTAREA questions are non-required', () => {
    for (const section of stab!.sections) {
      for (const q of section.questions) {
        if (q.inputType === 'TEXTAREA') {
          expect(q.required, `${q.id} should be optional`).toBe(false);
        }
      }
    }
  });

  it('flow description references the stabilization artefacts', () => {
    expect(stab!.description ?? '').toMatch(/stabilization roadmap/i);
    expect(stab!.description ?? '').toMatch(/lessons-learned register/i);
    expect(stab!.description ?? '').toMatch(/benefits realization tracker/i);
    expect(stab!.description ?? '').toMatch(/process-improvement backlog/i);
    expect(stab!.description ?? '').toMatch(/continuous-improvement governance/i);
    expect(stab!.description ?? '').toMatch(/KPI evolution plan/i);
    expect(stab!.description ?? '').toMatch(/phase-two charter/i);
  });

  it('question IDs use the stabilization.* universal namespace + match three-segment pattern', () => {
    for (const section of stab!.sections) {
      for (const q of section.questions) {
        expect(q.id).toMatch(/^stabilization\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+/);
      }
    }
  });

  it('STABILIZATION flow contributes 13 questions total (4 + 3 + 3 + 3)', () => {
    const total = stab!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(13);
  });
});

// ─── Pack Z — MIGRATION flow shape (cross-platform: same questions on Odoo) ──

describe('netsuiteAdaptor: Pack Z — MIGRATION flow shape', () => {
  const mig = netsuiteAdaptor.schema.flows.find((f) => f.id === 'MIGRATION');

  it('MIGRATION flow exists with the expected label', () => {
    expect(mig).toBeDefined();
    expect(mig!.label).toBe('Data Migration');
  });

  it('MIGRATION sits between INTEGRATIONS and TESTING (Pack ZZ inserted INTEGRATIONS between RETURNS and MIGRATION)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('MIGRATION')).toBe(ids.indexOf('INTEGRATIONS') + 1);
    expect(ids.indexOf('MIGRATION')).toBe(ids.indexOf('TESTING') - 1);
    // RETURNS still earlier in the chain — proves Pack Z's "MIGRATION sits
    // after RETURNS" contract still holds even though it's no longer adjacent.
    expect(ids.indexOf('MIGRATION')).toBeGreaterThan(ids.indexOf('RETURNS'));
  });

  it('MIGRATION has 2 sections in canonical order — details / readiness', () => {
    const sectionIds = mig!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['details', 'readiness']);
  });

  it('Section 1 (details) carries 4 cross-platform questions', () => {
    const det = mig!.sections.find((s) => s.id === 'details')!;
    expect(det.label).toBe('Migration Details');
    const ids = det.questions.map((q) => q.id).sort();
    expect(ids).toEqual([
      'migration.details.cleansingRulesByObject',
      'migration.details.historicalDataDepth',
      'migration.details.rejectSlaByObject',
      'migration.details.sourceSystemsByObject',
    ]);
  });

  it('Section 2 (readiness) carries 3 cross-platform questions', () => {
    const rd = mig!.sections.find((s) => s.id === 'readiness')!;
    expect(rd.label).toBe('Migration Readiness');
    const ids = rd.questions.map((q) => q.id).sort();
    expect(ids).toEqual([
      'migration.readiness.dataQualityOwners',
      'migration.readiness.dryRunPassThreshold',
      'migration.readiness.migrationCutoffDate',
    ]);
  });

  it('all questions are non-required (Pack Z keeps the floor green when overlay is sparse)', () => {
    for (const section of mig!.sections) {
      for (const q of section.questions) {
        expect(q.required, `${q.id} should be optional`).toBe(false);
      }
    }
  });

  it('MIGRATION flow contributes 7 questions total (4 + 3)', () => {
    const total = mig!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(7);
  });
});

// ─── Pack ZZ — INTEGRATIONS flow shape (cross-platform: same questions on Odoo) ──

describe('netsuiteAdaptor: Pack ZZ — INTEGRATIONS flow shape', () => {
  const integrations = netsuiteAdaptor.schema.flows.find((f) => f.id === 'INTEGRATIONS');

  it('INTEGRATIONS flow exists with the expected label', () => {
    expect(integrations).toBeDefined();
    expect(integrations!.label).toBe('Integrations');
  });

  it('INTEGRATIONS sits between RETURNS and MIGRATION (Pack ZZ build-phase position)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids.indexOf('INTEGRATIONS')).toBe(ids.indexOf('RETURNS') + 1);
    expect(ids.indexOf('INTEGRATIONS')).toBe(ids.indexOf('MIGRATION') - 1);
  });

  it('INTEGRATIONS has 3 sections in canonical order — catalog / reliability / support', () => {
    const sectionIds = integrations!.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['catalog', 'reliability', 'support']);
  });

  it('Section 1 (catalog) carries 2 cross-platform questions', () => {
    const cat = integrations!.sections.find((s) => s.id === 'catalog')!;
    expect(cat.label).toBe('Integration Catalog');
    const ids = cat.questions.map((q) => q.id).sort();
    expect(ids).toEqual([
      'integrations.catalog.integrationCatalog',
      'integrations.catalog.integrationOwnersByName',
    ]);
  });

  it('Section 2 (reliability) carries 3 cross-platform questions', () => {
    const rel = integrations!.sections.find((s) => s.id === 'reliability')!;
    expect(rel.label).toBe('Integration Reliability');
    const ids = rel.questions.map((q) => q.id).sort();
    expect(ids).toEqual([
      'integrations.reliability.integrationAuthMethods',
      'integrations.reliability.integrationErrorPatterns',
      'integrations.reliability.integrationMonitoring',
    ]);
  });

  it('Section 3 (support) carries 3 cross-platform questions', () => {
    const sup = integrations!.sections.find((s) => s.id === 'support')!;
    expect(sup.label).toBe('Integration Support');
    const ids = sup.questions.map((q) => q.id).sort();
    expect(ids).toEqual([
      'integrations.support.integrationCutoverSmokeTests',
      'integrations.support.integrationReconciliation',
      'integrations.support.integrationVendorContacts',
    ]);
  });

  it('all questions are TEXTAREA + non-required (Pack ZZ keeps the floor green when overlay is sparse)', () => {
    for (const section of integrations!.sections) {
      for (const q of section.questions) {
        expect(q.inputType, `${q.id} should be TEXTAREA`).toBe('TEXTAREA');
        expect(q.required, `${q.id} should be optional`).toBe(false);
      }
    }
  });

  it('INTEGRATIONS flow contributes 8 questions total (2 + 3 + 3)', () => {
    const total = integrations!.sections.reduce((sum, s) => sum + s.questions.length, 0);
    expect(total).toBe(8);
  });
});
