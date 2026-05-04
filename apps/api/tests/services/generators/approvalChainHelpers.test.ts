import { describe, it, expect } from 'vitest';
import {
  parseApprovalChain,
  chainIsEmpty,
  validateApprovalChain,
  renderApprovalChainSection,
  chainToLegacyTextarea,
  collectActiveChains,
  APPROVAL_FLOW_KEYS,
  type ApprovalChain,
  type ChainValidationContext,
} from '../../../src/services/generators/approvalChainHelpers.js';

/**
 * Phase 24 — Approval-chain helpers tests.
 *
 * Contract:
 *   1. Parser handles JSON / object / null / undefined / malformed.
 *   2. Validator catches gaps, overlaps, missing roles, top-tier-not-unlimited,
 *      currency-undeclared (when R2R is filled), and surfaces info-level note
 *      when R2R section is incomplete.
 *   3. Renderer is NetSuite-only (banlist safety) — returns '' on Odoo even
 *      when given a fully-populated chain.
 *   4. Renderer falls back gracefully (returns '') on empty chain.
 *   5. SuiteFlow build instructions render concrete UI navigation steps.
 *   6. Legacy bridge (chainToLegacyTextarea) produces strings the existing
 *      poApprovalTiers parser accepts.
 *   7. APPROVAL_FLOW_KEYS contains all 5 expected flows including JE +
 *      Expense (which Solution Design doesn't currently render).
 *   8. Cross-platform safety — role / alternate / notes free-text fields
 *      with NetSuite leakage stay inside the NetSuite-only render path.
 */

const FULL_CHAIN: ApprovalChain = {
  byCurrency: {
    USD: [
      { lowerBound: 0, upperBound: 5000, role: 'Auto-approve', escalationHours: 0, alternateApprover: '' },
      { lowerBound: 5001, upperBound: 50000, role: 'Department Manager', escalationHours: 24, alternateApprover: 'Director' },
      { lowerBound: 50001, upperBound: 250000, role: 'VP Operations', escalationHours: 24, alternateApprover: 'CFO' },
      { lowerBound: 250001, upperBound: null, role: 'CFO + Steering', escalationHours: 48, alternateApprover: '' },
    ],
  },
  selfApprovalBypassUpTo: { USD: 1000 },
  notes: 'Credit-hold transition triggers when customer overdue >30d.',
};

const FULL_CTX: ChainValidationContext = {
  baseCurrency: 'USD',
  additionalCurrencies: '',
};

const NO_R2R_CTX: ChainValidationContext = {
  baseCurrency: null,
  additionalCurrencies: null,
};

// ─── APPROVAL_FLOW_KEYS ─────────────────────────────────────────────────────

describe('Phase 24 — APPROVAL_FLOW_KEYS', () => {
  it('exposes all 5 approval flows including JE + Expense', () => {
    const ids = APPROVAL_FLOW_KEYS.map((f) => f.booleanKey);
    expect(ids).toEqual([
      'p2p.purchasing.poApprovalRequired',
      'p2p.bills.billApprovalRequired',
      'o2c.salesOrders.soApprovalRequired',
      'r2r.journalEntries.approvalRequired',
      'p2p.expenses.expenseApproval',
    ]);
  });

  it('every flow has a structuredKey, flowLabel, and netsuiteRecordType', () => {
    for (const f of APPROVAL_FLOW_KEYS) {
      expect(f.structuredKey).toMatch(/\.approvalChainStructured$/);
      expect(f.flowLabel.length).toBeGreaterThan(0);
      expect(f.netsuiteRecordType.length).toBeGreaterThan(0);
    }
  });

  it('netsuiteRecordType matches NetSuite SuiteFlow record-type labels', () => {
    const types = APPROVAL_FLOW_KEYS.map((f) => f.netsuiteRecordType);
    expect(types).toContain('Purchase Order');
    expect(types).toContain('Vendor Bill');
    expect(types).toContain('Sales Order');
    expect(types).toContain('Journal Entry');
    expect(types).toContain('Expense Report');
  });
});

// ─── parseApprovalChain ─────────────────────────────────────────────────────

describe('Phase 24 — parseApprovalChain', () => {
  it('returns null for null / undefined / empty / whitespace string', () => {
    expect(parseApprovalChain(null)).toBeNull();
    expect(parseApprovalChain(undefined)).toBeNull();
    expect(parseApprovalChain('')).toBeNull();
    expect(parseApprovalChain('   \n  \t  ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseApprovalChain('{not valid json')).toBeNull();
    expect(parseApprovalChain('[1,2,3]')).toBeNull(); // array at root
    expect(parseApprovalChain('"just a string"')).toBeNull();
    expect(parseApprovalChain('42')).toBeNull();
  });

  it('returns null for objects missing byCurrency', () => {
    expect(parseApprovalChain('{"notes": "hi"}')).toBeNull();
    expect(parseApprovalChain({ notes: 'hi' })).toBeNull();
  });

  it('parses well-formed JSON string round-trip', () => {
    const out = parseApprovalChain(JSON.stringify(FULL_CHAIN));
    expect(out).not.toBeNull();
    expect(out!.byCurrency.USD).toHaveLength(4);
    expect(out!.byCurrency.USD[3].upperBound).toBeNull();
  });

  it('accepts already-parsed object form', () => {
    const out = parseApprovalChain(FULL_CHAIN);
    expect(out).not.toBeNull();
    expect(out!.byCurrency.USD[1].role).toBe('Department Manager');
  });

  it('uppercases currency keys', () => {
    const out = parseApprovalChain({
      byCurrency: { usd: [{ lowerBound: 0, upperBound: null, role: 'X', escalationHours: 0, alternateApprover: '' }] },
      selfApprovalBypassUpTo: { usd: 0 },
      notes: '',
    });
    expect(out!.byCurrency).toHaveProperty('USD');
    expect(out!.byCurrency).not.toHaveProperty('usd');
    expect(out!.selfApprovalBypassUpTo).toHaveProperty('USD');
  });

  it('coerces non-finite numeric fields to 0', () => {
    const out = parseApprovalChain({
      byCurrency: {
        USD: [{ lowerBound: 'not-a-number', upperBound: null, role: 'X', escalationHours: NaN, alternateApprover: '' }],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    });
    expect(out!.byCurrency.USD[0].lowerBound).toBe(0);
    expect(out!.byCurrency.USD[0].escalationHours).toBe(0);
  });

  it('skips malformed tier entries silently (defensive)', () => {
    const out = parseApprovalChain({
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: null, role: 'X', escalationHours: 0, alternateApprover: '' },
          'not-a-tier-object',
          null,
          { lowerBound: 100, upperBound: null, role: 'Y', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    });
    expect(out!.byCurrency.USD).toHaveLength(2);
  });
});

// ─── chainIsEmpty ───────────────────────────────────────────────────────────

describe('Phase 24 — chainIsEmpty', () => {
  it('returns true for null', () => {
    expect(chainIsEmpty(null)).toBe(true);
  });
  it('returns true when byCurrency has no tiers', () => {
    expect(chainIsEmpty({ byCurrency: {}, selfApprovalBypassUpTo: {}, notes: '' })).toBe(true);
    expect(chainIsEmpty({ byCurrency: { USD: [] }, selfApprovalBypassUpTo: {}, notes: '' })).toBe(true);
  });
  it('returns false when at least one currency has at least one tier', () => {
    expect(chainIsEmpty(FULL_CHAIN)).toBe(false);
  });
});

// ─── validateApprovalChain ──────────────────────────────────────────────────

describe('Phase 24 — validateApprovalChain', () => {
  it('passes a complete USD chain with no issues when R2R declares USD', () => {
    const issues = validateApprovalChain(FULL_CHAIN, FULL_CTX);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
  });

  it('detects tier gap', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: 5000, role: 'A', escalationHours: 0, alternateApprover: '' },
          { lowerBound: 10000, upperBound: null, role: 'B', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'tier-gap')).toBe(true);
  });

  it('detects tier overlap', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: 10000, role: 'A', escalationHours: 0, alternateApprover: '' },
          { lowerBound: 5000, upperBound: null, role: 'B', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'tier-overlap')).toBe(true);
  });

  it('detects top-tier-not-unlimited', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: 5000, role: 'A', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'top-tier-not-unlimited')).toBe(true);
  });

  it('detects missing role', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: null, role: '   ', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'missing-role')).toBe(true);
  });

  it('detects negative escalation hours', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: null, role: 'X', escalationHours: -1, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'invalid-escalation')).toBe(true);
  });

  it('detects tier-after-unlimited (only top tier may have null upperBound)', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: null, role: 'A', escalationHours: 0, alternateApprover: '' },
          { lowerBound: 0, upperBound: null, role: 'B', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'tier-after-unlimited')).toBe(true);
  });

  it('flags currency-undeclared when R2R declares USD but chain uses EUR', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        EUR: [{ lowerBound: 0, upperBound: null, role: 'X', escalationHours: 0, alternateApprover: '' }],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, FULL_CTX);
    expect(issues.some((i) => i.code === 'currency-undeclared')).toBe(true);
  });

  it('downgrades to info-level when R2R Currencies section is empty (refinement #2)', () => {
    const issues = validateApprovalChain(FULL_CHAIN, NO_R2R_CTX);
    expect(issues.some((i) => i.code === 'currency-r2r-incomplete' && i.severity === 'info')).toBe(true);
    // Should NOT block — no currency-undeclared warning when R2R is empty.
    expect(issues.some((i) => i.code === 'currency-undeclared')).toBe(false);
  });

  it('parses additional currencies from "USD, AED, EUR" CSV form', () => {
    const ctx: ChainValidationContext = {
      baseCurrency: 'USD',
      additionalCurrencies: 'AED, EUR',
    };
    const chain: ApprovalChain = {
      byCurrency: {
        AED: [{ lowerBound: 0, upperBound: null, role: 'X', escalationHours: 0, alternateApprover: '' }],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, ctx);
    expect(issues.some((i) => i.code === 'currency-undeclared')).toBe(false);
  });

  it('parses additional currencies from line-per-row "USD — US Dollar" form', () => {
    const ctx: ChainValidationContext = {
      baseCurrency: 'AED',
      additionalCurrencies: 'USD — US Dollar\nEUR — Euro',
    };
    const chain: ApprovalChain = {
      byCurrency: {
        USD: [{ lowerBound: 0, upperBound: null, role: 'X', escalationHours: 0, alternateApprover: '' }],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const issues = validateApprovalChain(chain, ctx);
    expect(issues.some((i) => i.code === 'currency-undeclared')).toBe(false);
  });
});

// ─── renderApprovalChainSection ────────────────────────────────────────────

describe('Phase 24 — renderApprovalChainSection', () => {
  it('returns "" on Odoo (banlist safety)', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'Purchase Order Approval', {
      adaptorId: 'odoo',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toBe('');
  });

  it('returns "" on custom: adaptors', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'Purchase Order Approval', {
      adaptorId: 'custom:fake-erp',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toBe('');
  });

  it('returns "" for empty chain (caller falls back to generic prose)', () => {
    const out = renderApprovalChainSection(null, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toBe('');
  });

  it('renders flow heading + tier table on NetSuite happy path', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'Purchase Order Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toContain('Purchase Order Approval');
    expect(out).toContain('Detailed Tier Structure');
    expect(out).toContain('| Tier | From | To | Approver Role | Escalation | OOO Alternate |');
    expect(out).toContain('Department Manager');
    expect(out).toContain('CFO + Steering');
    expect(out).toContain('unlimited');
    expect(out).toContain('24h');
  });

  it('renders self-approval bypass row when > 0', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toContain('Self-approval bypass');
    expect(out).toContain('1,000');
  });

  it('renders consultant notes when non-empty', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toContain('Credit-hold transition');
  });

  it('renders SuiteFlow build instructions with concrete UI navigation', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toContain('How to build this in NetSuite SuiteFlow');
    expect(out).toContain('Customization → Workflow → Workflows → New');
    expect(out).toContain('Record Type:** Purchase Order');
    expect(out).toContain('Init Trigger:** On Create AND On Update');
    expect(out).toContain('Send-Email Actions');
    expect(out).toContain('role-based recipients, not hard-coded user IDs');
    expect(out).toContain('suitecloud object:import --type workflow');
  });

  it('renders ⚠ callout with warnings when chain is incomplete', () => {
    const incomplete: ApprovalChain = {
      byCurrency: {
        USD: [
          { lowerBound: 0, upperBound: 5000, role: 'A', escalationHours: 0, alternateApprover: '' },
          // gap then non-unlimited top
          { lowerBound: 10000, upperBound: 50000, role: 'B', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const out = renderApprovalChainSection(incomplete, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toContain('⚠');
    expect(out).toContain('Incomplete chain');
    expect(out).toContain('Gap');
    expect(out).toContain('unlimited');
  });

  it('renders info-level note when R2R Currencies section is empty', () => {
    const out = renderApprovalChainSection(FULL_CHAIN, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: NO_R2R_CTX,
    });
    expect(out).toContain('R2R → Currencies section is incomplete');
    expect(out).toContain('USD');
  });

  it('renders multi-currency tables when chain has tiers in multiple currencies', () => {
    const multi: ApprovalChain = {
      byCurrency: {
        USD: [{ lowerBound: 0, upperBound: null, role: 'CFO', escalationHours: 0, alternateApprover: '' }],
        AED: [{ lowerBound: 0, upperBound: null, role: 'GCC Director', escalationHours: 0, alternateApprover: '' }],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const out = renderApprovalChainSection(multi, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: { baseCurrency: 'USD', additionalCurrencies: 'AED' },
    });
    expect(out).toContain('Tier table — AED');
    expect(out).toContain('Tier table — USD');
    expect(out).toContain('GCC Director');
    expect(out).toContain('CFO');
  });

  it('escapes Markdown table-breaking chars in role / alternate / notes', () => {
    const tricky: ApprovalChain = {
      byCurrency: {
        USD: [{ lowerBound: 0, upperBound: null, role: 'CFO | CTO', escalationHours: 0, alternateApprover: '<unset>' }],
      },
      selfApprovalBypassUpTo: {},
      notes: 'See `internal-doc` for details.',
    };
    const out = renderApprovalChainSection(tricky, 'PO Approval', {
      adaptorId: 'netsuite',
      netsuiteRecordType: 'Purchase Order',
      validationContext: FULL_CTX,
    });
    expect(out).toContain('CFO \\| CTO'); // pipe escaped
    expect(out).toContain('&lt;unset&gt;'); // angle brackets escaped
    expect(out).toContain('\\`internal-doc\\`'); // backtick escaped
  });
});

// ─── chainToLegacyTextarea (option β bridge) ───────────────────────────────

describe('Phase 24 — chainToLegacyTextarea', () => {
  it('returns null for null chain', () => {
    expect(chainToLegacyTextarea(null, 'USD')).toBeNull();
  });

  it('returns null when baseCurrency is null/empty', () => {
    expect(chainToLegacyTextarea(FULL_CHAIN, null)).toBeNull();
    expect(chainToLegacyTextarea(FULL_CHAIN, '')).toBeNull();
    expect(chainToLegacyTextarea(FULL_CHAIN, '   ')).toBeNull();
  });

  it('returns null when chain has no tiers in the base currency', () => {
    const chain: ApprovalChain = {
      byCurrency: { AED: [{ lowerBound: 0, upperBound: null, role: 'X', escalationHours: 0, alternateApprover: '' }] },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    expect(chainToLegacyTextarea(chain, 'USD')).toBeNull();
  });

  it('synthesises a legacy TEXTAREA matching the existing parser shape (USD)', () => {
    const out = chainToLegacyTextarea(FULL_CHAIN, 'USD');
    expect(out).not.toBeNull();
    const lines = out!.split('\n');
    expect(lines).toHaveLength(4);
    // First tier from 0 → "<X" form
    expect(lines[0]).toBe('<$5,000: Auto-approve');
    // Mid tiers → "X-Y" form
    expect(lines[1]).toBe('$5,001-$50,000: Department Manager');
    expect(lines[2]).toBe('$50,001-$250,000: VP Operations');
    // Top tier (unlimited) → ">X" form
    expect(lines[3]).toBe('>$250,001: CFO + Steering');
  });

  it('uses ISO code prefix for non-USD base currencies', () => {
    const chain: ApprovalChain = {
      byCurrency: {
        AED: [
          { lowerBound: 0, upperBound: 18000, role: 'Manager', escalationHours: 0, alternateApprover: '' },
          { lowerBound: 18001, upperBound: null, role: 'CFO', escalationHours: 0, alternateApprover: '' },
        ],
      },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const out = chainToLegacyTextarea(chain, 'AED');
    expect(out).not.toBeNull();
    expect(out!).toContain('AED 18,000');
    expect(out!).toContain('AED 18,001');
  });

  it('handles base-currency lookup case-insensitively', () => {
    const out = chainToLegacyTextarea(FULL_CHAIN, 'usd');
    expect(out).not.toBeNull();
    expect(out!).toContain('Department Manager');
  });

  it('falls back to "_[ASSIGN]_" placeholder when role is empty', () => {
    const chain: ApprovalChain = {
      byCurrency: { USD: [{ lowerBound: 0, upperBound: null, role: '', escalationHours: 0, alternateApprover: '' }] },
      selfApprovalBypassUpTo: {},
      notes: '',
    };
    const out = chainToLegacyTextarea(chain, 'USD');
    expect(out).toContain('_[ASSIGN]_');
  });
});

// ─── collectActiveChains ───────────────────────────────────────────────────

describe('Phase 24 — collectActiveChains', () => {
  it('returns empty when no booleans are true', () => {
    const out = collectActiveChains({});
    expect(out).toEqual([]);
  });

  it('returns only flows where boolean is true AND chain is non-empty', () => {
    const answers = {
      'p2p.purchasing.poApprovalRequired': true,
      'p2p.purchasing.approvalChainStructured': JSON.stringify(FULL_CHAIN),
      'p2p.bills.billApprovalRequired': true,
      // bills has no structured chain → excluded
      'o2c.salesOrders.soApprovalRequired': false,
      'o2c.salesOrders.approvalChainStructured': JSON.stringify(FULL_CHAIN),
      // SO boolean is false → excluded even though chain is populated
    };
    const out = collectActiveChains(answers);
    expect(out).toHaveLength(1);
    expect(out[0].flowKey.booleanKey).toBe('p2p.purchasing.poApprovalRequired');
  });

  it('returns all 5 flows when all booleans true + all chains populated', () => {
    const answers: Record<string, unknown> = {};
    for (const flowKey of APPROVAL_FLOW_KEYS) {
      answers[flowKey.booleanKey] = true;
      answers[flowKey.structuredKey] = JSON.stringify(FULL_CHAIN);
    }
    const out = collectActiveChains(answers);
    expect(out).toHaveLength(5);
    const ids = out.map((o) => o.flowKey.booleanKey);
    expect(ids).toContain('r2r.journalEntries.approvalRequired');
    expect(ids).toContain('p2p.expenses.expenseApproval');
  });
});
