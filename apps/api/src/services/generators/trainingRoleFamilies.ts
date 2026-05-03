/**
 * Pack U — Role-family classifier shared across the training generators
 * (per-role guides, training matrix, training schedule, KT checklist).
 *
 * Cross-platform — same family identifiers on NetSuite + Odoo. The
 * curriculum (topic list + workstream coverage) is platform-agnostic;
 * platform-specific menu paths land later in the Quick Reference Card
 * generator.
 *
 * Specificity-first ordering — same principle as Pack C / Pack F. AP/AR
 * before generic accounting; finance broad before sales (so "Finance
 * Manager" doesn't misroute via a stray "manager" keyword).
 *
 * Sources mirror Pack C's classifier for consistency, plus:
 *   - Standard ERP role-curriculum mappings (SuiteSuccess Champion track,
 *     Odoo Functional Consultant certification topics).
 *   - ADDIE — Analyze step (audience analysis drives curriculum).
 */

export type RoleFamily =
  | 'AP'
  | 'AR'
  | 'FINANCE_BROAD'
  | 'SALES'
  | 'INVENTORY'
  | 'PROCUREMENT'
  | 'MANUFACTURING'
  | 'QUALITY'
  | 'CLINICAL'
  | 'IT'
  | 'GENERIC';

export type Workstream = 'R2R' | 'P2P' | 'O2C' | 'INV' | 'MFG' | 'RTN' | 'CRM' | 'HR' | 'IT';

/** Coverage map per family. */
export type CoverageLevel = 'REQUIRED' | 'VIEW' | 'NONE';

export interface RoleFamilySpec {
  family: RoleFamily;
  /** Default canonical curriculum — used when consultant's input topics
   *  are empty or shorter than 3 entries. Each entry becomes a Module N
   *  in the per-role training guide. */
  canonicalCurriculum: string[];
  /** Per-workstream coverage — feeds the training matrix. */
  coverage: Record<Workstream, CoverageLevel>;
  /** Estimated total duration in hours for the canonical curriculum. */
  estimatedHours: number;
}

// ─── Canonical curricula per family ─────────────────────────────────────────

const AP_CURRICULUM: string[] = [
  'Vendor Master Setup',
  'Vendor Bill Entry',
  '3-Way Match (PO + Receipt + Bill)',
  'Payment Run',
  'Voucher Approval Workflow',
];

const AR_CURRICULUM: string[] = [
  'Customer Master Setup',
  'Invoice Creation',
  'Cash Application',
  'Dunning Letters & Collections',
  'AR Aging Reports',
];

const FINANCE_BROAD_CURRICULUM: string[] = [
  'Trial Balance Export',
  'Multi-Entity Close',
  'Financial Statements (P&L + Balance Sheet)',
  'Multi-Currency Revaluation',
  'Audit Trail Review',
];

const SALES_CURRICULUM: string[] = [
  'Lead-to-Quote Process',
  'Sales Order Entry',
  'Pricelist Management',
  'Discount Approval',
  'Pipeline Reports',
];

const INVENTORY_CURRICULUM: string[] = [
  'Item Master Setup',
  'Stock Adjustment',
  'Cycle Count',
  'Lot / Serial Tracking',
  'Warehouse Transfer',
];

const PROCUREMENT_CURRICULUM: string[] = [
  'Vendor RFQ',
  'PO Creation',
  'PO Approval',
  'Receipt + Inspection',
  'Three-Way Match',
];

const MANUFACTURING_CURRICULUM: string[] = [
  'BOM Setup',
  'Work Order Release',
  'Production Reporting',
  'Quality Check',
  'Backflushing',
];

const QUALITY_CURRICULUM: string[] = [
  'Saved Search Run',
  'Permission Audit',
  'Audit Trail Review',
  'SoD Validation',
  'Compliance Reporting',
];

const CLINICAL_CURRICULUM: string[] = [
  'Patient Record Entry',
  'Trial Phase Tracking',
  'Adverse Event Logging',
  'Regulatory Submission Workflow',
];

const IT_CURRICULUM: string[] = [
  'User Provisioning',
  'Custom Script Deployment',
  'Sandbox Refresh',
  'Permission Sets',
  'Platform CLI / Admin Tools',
];

const GENERIC_CURRICULUM: string[] = [
  'Platform Navigation Basics',
  'Personal Dashboard Setup',
  'Saved Search Use',
  'Reporting Basics',
];

// ─── Per-family workstream coverage ─────────────────────────────────────────

function coverage(map: Partial<Record<Workstream, CoverageLevel>>): Record<Workstream, CoverageLevel> {
  return {
    R2R: map.R2R ?? 'NONE',
    P2P: map.P2P ?? 'NONE',
    O2C: map.O2C ?? 'NONE',
    INV: map.INV ?? 'NONE',
    MFG: map.MFG ?? 'NONE',
    RTN: map.RTN ?? 'NONE',
    CRM: map.CRM ?? 'NONE',
    HR: map.HR ?? 'NONE',
    IT: map.IT ?? 'NONE',
  };
}

const SPECS: Record<RoleFamily, RoleFamilySpec> = {
  AP: {
    family: 'AP',
    canonicalCurriculum: AP_CURRICULUM,
    coverage: coverage({ P2P: 'REQUIRED', R2R: 'VIEW' }),
    estimatedHours: 4,
  },
  AR: {
    family: 'AR',
    canonicalCurriculum: AR_CURRICULUM,
    coverage: coverage({ O2C: 'REQUIRED', RTN: 'REQUIRED', R2R: 'VIEW' }),
    estimatedHours: 4,
  },
  FINANCE_BROAD: {
    family: 'FINANCE_BROAD',
    canonicalCurriculum: FINANCE_BROAD_CURRICULUM,
    coverage: coverage({
      R2R: 'REQUIRED',
      P2P: 'VIEW',
      O2C: 'VIEW',
      INV: 'VIEW',
      MFG: 'VIEW',
    }),
    estimatedHours: 6,
  },
  SALES: {
    family: 'SALES',
    canonicalCurriculum: SALES_CURRICULUM,
    coverage: coverage({ O2C: 'REQUIRED', CRM: 'REQUIRED' }),
    estimatedHours: 3,
  },
  INVENTORY: {
    family: 'INVENTORY',
    canonicalCurriculum: INVENTORY_CURRICULUM,
    coverage: coverage({ INV: 'REQUIRED', P2P: 'VIEW', RTN: 'VIEW' }),
    estimatedHours: 4,
  },
  PROCUREMENT: {
    family: 'PROCUREMENT',
    canonicalCurriculum: PROCUREMENT_CURRICULUM,
    coverage: coverage({ P2P: 'REQUIRED', INV: 'VIEW' }),
    estimatedHours: 4,
  },
  MANUFACTURING: {
    family: 'MANUFACTURING',
    canonicalCurriculum: MANUFACTURING_CURRICULUM,
    coverage: coverage({ MFG: 'REQUIRED', INV: 'REQUIRED' }),
    estimatedHours: 5,
  },
  QUALITY: {
    family: 'QUALITY',
    canonicalCurriculum: QUALITY_CURRICULUM,
    coverage: coverage({ R2R: 'VIEW', P2P: 'VIEW', O2C: 'VIEW', INV: 'VIEW' }),
    estimatedHours: 3,
  },
  CLINICAL: {
    family: 'CLINICAL',
    canonicalCurriculum: CLINICAL_CURRICULUM,
    coverage: coverage({}),
    estimatedHours: 4,
  },
  IT: {
    family: 'IT',
    canonicalCurriculum: IT_CURRICULUM,
    coverage: coverage({ IT: 'REQUIRED' }),
    estimatedHours: 5,
  },
  GENERIC: {
    family: 'GENERIC',
    canonicalCurriculum: GENERIC_CURRICULUM,
    coverage: coverage({ R2R: 'VIEW' }),
    estimatedHours: 2,
  },
};

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify a role name into a family. Specificity-first — AP/AR before
 * generic accounting; finance broad before sales (defensive — sales
 * regex requires "sales" / "account exec" / "business dev" but the
 * ordering still matters when role names mix tokens like
 * "Senior Sales Finance Manager").
 *
 * The slash-strip pre-pass ("A/P Clerk" → "AP Clerk") borrows from
 * Pack C's classifyRole.
 */
export function classifyRoleFamily(roleName: string): RoleFamilySpec {
  const lc = roleName.toLowerCase().replace(/\//g, '');

  if (/\bap\b|\baccounts payable\b|\bpayables?\b|\bbuyer\b/.test(lc)) {
    return SPECS.AP;
  }
  if (/\bar\b|\baccounts receivable\b|\breceivables?\b|\bcollections?\b/.test(lc)) {
    return SPECS.AR;
  }
  if (/\bcfo\b|\bcontroller\b|\bfinance director\b|\bfinance manager\b/.test(lc)) {
    return SPECS.FINANCE_BROAD;
  }
  if (/\bsales\b|\baccount (?:exec|manager)\b|\bbusiness dev/.test(lc)) {
    return SPECS.SALES;
  }
  if (/\binventory\b|\bwarehouse\b|\bsupply chain\b/.test(lc)) {
    return SPECS.INVENTORY;
  }
  if (/\bprocurement\b|\bpurchasing\b/.test(lc)) {
    return SPECS.PROCUREMENT;
  }
  if (/\bmanufacturing\b|\bproduction\b|\bplant\b/.test(lc)) {
    return SPECS.MANUFACTURING;
  }
  if (/\bquality\b|\bauditors?\b|\binternal audit\b/.test(lc)) {
    return SPECS.QUALITY;
  }
  if (/\bclinical\b|\btrial\b|\bmedical\b/.test(lc)) {
    return SPECS.CLINICAL;
  }
  if (/\bit\b|\btechnical\b|\bsuiteadmin\b|\badmin\b/.test(lc)) {
    return SPECS.IT;
  }
  return SPECS.GENERIC;
}

/**
 * Slugify a role name for filename use.
 * "A/P Clerk" → "ap-clerk", "CFO / Controller" → "cfo-controller".
 */
export function slugifyRole(roleName: string): string {
  return roleName
    .toLowerCase()
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'role';
}
