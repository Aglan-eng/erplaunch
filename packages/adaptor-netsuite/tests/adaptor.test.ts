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
  it('exposes 8 flows in the canonical order — FOUNDATION + TAX + LOCALIZATION + the legacy 5', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    // NS Pack 1 added FOUNDATION at the head.
    // NS Pack 2 inserted TAX after FOUNDATION.
    // NS Pack 3 inserts LOCALIZATION after TAX, before the legacy 5.
    // NetSuite keeps its native R2R/P2P/O2C terminology (unlike Odoo
    // where they got restructured in Pack R).
    expect(ids).toEqual([
      'FOUNDATION', 'TAX', 'LOCALIZATION',
      'R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS',
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

  it('Valid scoping (OneWorld edition + OneWorld module + no conflicts) fires nothing', () => {
    const conflicts = evaluateAdaptorRules(netsuiteAdaptor.rules, {
      answers: {
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

  it('FOUNDATION renders as the first flow (before TAX, before LOCALIZATION, before R2R)', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids[0]).toBe('FOUNDATION');
    // NS Pack 2 inserted TAX (index 1).
    // NS Pack 3 inserted LOCALIZATION between TAX and R2R, so R2R
    // now sits at index 3.
    expect(ids.indexOf('TAX')).toBe(1);
    expect(ids.indexOf('LOCALIZATION')).toBe(2);
    expect(ids.indexOf('R2R')).toBe(3);
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

  it('LOCALIZATION sits between TAX and R2R', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    const tIdx = ids.indexOf('TAX');
    const lIdx = ids.indexOf('LOCALIZATION');
    const r2rIdx = ids.indexOf('R2R');
    expect(lIdx).toBe(tIdx + 1);
    expect(r2rIdx).toBe(lIdx + 1);
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
