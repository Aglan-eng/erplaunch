/**
 * SDF Custom Role generator (Pack C — Roles + Permissions + Account
 * Preferences).
 *
 * Reads the wizard's free-text TEXTAREA `ns.design.standardRoleCustomization`
 * (NS Pack 3 SD section 3.4) — one role per line, format
 * "<role_name>: <customization notes>". For each line, the generator:
 *   1. Slugifies the role name into a scriptid (custom_role_nsix_<slug>).
 *   2. Classifies the role family via keyword on the role name
 *      (specificity-first ordering — AP/AR before generic accounting,
 *      finance manager before sales manager, etc.).
 *   3. Picks the matching permission starter set (~5–8 perms per family).
 *   4. Applies the customization overlay parsed from the notes
 *      ("remove Approve" downgrades VENDORBILL FULL → CREATE;
 *      "read-only" downgrades every perm to VIEW; "subsidiary-scoped"
 *      sets restrictionbysubsidiary=OWN; "group-wide" sets NONE).
 *
 * The emitted permission lists are deliberately STARTERS — every
 * NetSuite implementation needs SoD review post-generation. The
 * generator's job is to land 70–80% of the work; the senior
 * consultant audits + adjusts in NetSuite UI.
 *
 * Sources:
 *   - NetSuite SDF role XML reference + permkey catalog (Oracle Help —
 *     SuiteCloud Development Framework XML Reference).
 *   - NetSuite Center IDs (CLASSIC / ACCOUNTING_CENTER / SALES_CENTER /
 *     INVENTORY_CENTER / PURCHASE_CENTER / MANUFACTURING_CENTER /
 *     EXECUTIVE_CENTER) — same enum re-used from Pack F's dashboard
 *     generator.
 *   - NetSuite SoD compliance patterns (Oracle Help — Audit Trail and
 *     SoD).
 */

export type CenterId =
  | 'CLASSIC'
  | 'ACCOUNTING_CENTER'
  | 'SALES_CENTER'
  | 'INVENTORY_CENTER'
  | 'PURCHASE_CENTER'
  | 'MANUFACTURING_CENTER'
  | 'EXECUTIVE_CENTER';

export type PermLevel = 'NONE' | 'VIEW' | 'CREATE' | 'EDIT' | 'FULL';

export type SubsidiaryRestriction = 'NONE' | 'OWN' | 'OWN_AND_HIERARCHY';

export interface Permission {
  /** SDF permkey enum value (LIST_VENDOR / TRAN_VENDORBILL / REPO_AR / etc.). */
  permkey: string;
  /** Permission level. */
  permlevel: PermLevel;
}

export interface RoleStarterSpec {
  center: CenterId;
  permissions: Permission[];
  /** Default restrictionbysubsidiary value before overlay. */
  defaultRestriction: SubsidiaryRestriction;
}

export interface EmittedRole {
  filename: string;
  scriptid: string;
  roleName: string;
  center: CenterId;
  /** Final permission list AFTER overlay (post-customization-notes). */
  permissions: Permission[];
  /** Final subsidiary restriction AFTER overlay. */
  restrictionbysubsidiary: SubsidiaryRestriction;
  /** Provenance notes — drives the harness + commit-body summary. */
  appliedOverlays: string[];
}

export interface RoleGeneratorInput {
  /** Raw TEXTAREA from ns.design.standardRoleCustomization. One role
   *  per line, "<role_name>: <customization notes>". */
  standardRoleCustomization: string | null | undefined;
}

export interface RoleGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedRole[];
}

// ─── Permission starter sets ────────────────────────────────────────────────

const AP_STARTER: Permission[] = [
  { permkey: 'LIST_VENDOR', permlevel: 'FULL' },
  { permkey: 'TRAN_VENDORBILL', permlevel: 'FULL' },
  { permkey: 'TRAN_VENDPYMT', permlevel: 'FULL' },
  { permkey: 'TRAN_PURCHASEORDER', permlevel: 'VIEW' },
  { permkey: 'REPO_AP', permlevel: 'VIEW' },
];

const AR_STARTER: Permission[] = [
  { permkey: 'LIST_CUSTOMER', permlevel: 'FULL' },
  { permkey: 'TRAN_INVOICE', permlevel: 'FULL' },
  { permkey: 'TRAN_CASHSALE', permlevel: 'FULL' },
  { permkey: 'TRAN_CUSTPYMT', permlevel: 'FULL' },
  { permkey: 'REPO_AR', permlevel: 'VIEW' },
];

const SALES_STARTER: Permission[] = [
  { permkey: 'LIST_CUSTOMER', permlevel: 'FULL' },
  { permkey: 'LIST_OPPORTUNITY', permlevel: 'FULL' },
  { permkey: 'TRAN_ESTIMATE', permlevel: 'FULL' },
  { permkey: 'TRAN_SALESORD', permlevel: 'FULL' },
  { permkey: 'TRAN_INVOICE', permlevel: 'VIEW' },
  { permkey: 'LIST_PRICELIST', permlevel: 'VIEW' },
];

const FINANCE_BROAD_STARTER: Permission[] = [
  { permkey: 'LIST_CUSTOMER', permlevel: 'FULL' },
  { permkey: 'LIST_VENDOR', permlevel: 'FULL' },
  { permkey: 'LIST_ITEM', permlevel: 'FULL' },
  { permkey: 'LIST_EMPLOYEE', permlevel: 'FULL' },
  { permkey: 'TRAN_INVOICE', permlevel: 'FULL' },
  { permkey: 'TRAN_VENDORBILL', permlevel: 'FULL' },
  { permkey: 'TRAN_JOURNAL', permlevel: 'FULL' },
  { permkey: 'TRAN_PURCHASEORDER', permlevel: 'FULL' },
  { permkey: 'TRAN_SALESORD', permlevel: 'FULL' },
  { permkey: 'REPO_AP', permlevel: 'VIEW' },
  { permkey: 'REPO_AR', permlevel: 'VIEW' },
  { permkey: 'REPO_GENERAL_LEDGER', permlevel: 'FULL' },
];

const INVENTORY_STARTER: Permission[] = [
  { permkey: 'LIST_ITEM', permlevel: 'FULL' },
  { permkey: 'TRAN_INVADJST', permlevel: 'FULL' },
  { permkey: 'TRAN_TRNFRORD', permlevel: 'FULL' },
  { permkey: 'TRAN_BINTRSFR', permlevel: 'FULL' },
  { permkey: 'TRAN_ITEMRCPT', permlevel: 'VIEW' },
];

const PROCUREMENT_STARTER: Permission[] = [
  { permkey: 'LIST_VENDOR', permlevel: 'FULL' },
  { permkey: 'TRAN_PURCHASEORDER', permlevel: 'FULL' },
  { permkey: 'TRAN_VENDRFQ', permlevel: 'FULL' },
  { permkey: 'TRAN_ITEMRCPT', permlevel: 'FULL' },
  { permkey: 'LIST_PRICELIST', permlevel: 'VIEW' },
];

const MANUFACTURING_STARTER: Permission[] = [
  { permkey: 'LIST_BOM', permlevel: 'FULL' },
  { permkey: 'TRAN_ASSYBUILD', permlevel: 'FULL' },
  { permkey: 'TRAN_WORKORDER', permlevel: 'FULL' },
  { permkey: 'LIST_ROUTINGS', permlevel: 'FULL' },
  { permkey: 'TRAN_ITEMRCPT', permlevel: 'VIEW' },
];

const QUALITY_AUDITOR_STARTER: Permission[] = [
  { permkey: 'LIST_CUSTOMER', permlevel: 'VIEW' },
  { permkey: 'LIST_VENDOR', permlevel: 'VIEW' },
  { permkey: 'LIST_ITEM', permlevel: 'VIEW' },
  { permkey: 'LIST_EMPLOYEE', permlevel: 'VIEW' },
  { permkey: 'TRAN_INVOICE', permlevel: 'VIEW' },
  { permkey: 'TRAN_VENDORBILL', permlevel: 'VIEW' },
  { permkey: 'TRAN_JOURNAL', permlevel: 'VIEW' },
];

const CLINICAL_STARTER: Permission[] = [
  { permkey: 'LIST_PROJECT', permlevel: 'VIEW' },
  { permkey: 'LIST_EMPLOYEE', permlevel: 'VIEW' },
  { permkey: 'LIST_CUSTOMRECORDENTRY', permlevel: 'FULL' },
];

const IT_SUITEADMIN_STARTER: Permission[] = [
  { permkey: 'SETUP_SUITESCRIPT', permlevel: 'FULL' },
  { permkey: 'LIST_SAVEDSEARCH', permlevel: 'FULL' },
  { permkey: 'SETUP_CUSTRECORDS', permlevel: 'FULL' },
  { permkey: 'SETUP_CUSTRECORDFIELDS', permlevel: 'FULL' },
];

const DEFAULT_STARTER: Permission[] = [
  { permkey: 'LIST_CUSTOMER', permlevel: 'VIEW' },
  { permkey: 'LIST_ITEM', permlevel: 'VIEW' },
  { permkey: 'LIST_VENDOR', permlevel: 'VIEW' },
];

// ─── Role keyword classifier ────────────────────────────────────────────────

/**
 * Classify a role name into a starter spec. First-match-wins,
 * specificity-first ordering — AP/AR before generic accounting,
 * finance manager before sales manager, etc. Same principle as
 * Pack F's center classifier.
 *
 * Buyer is included in the AP family per spec (AP buyers process
 * vendor bills); pure procurement roles use the "procurement /
 * purchasing" keywords.
 */
export function classifyRole(roleName: string): RoleStarterSpec {
  // Normalize before keyword matching: strip slashes that split common
  // abbreviations ("A/P Clerk" → "AP Clerk", "A/R Lead" → "AR Lead")
  // so the \bap\b / \bar\b regexes match. Other punctuation
  // (parentheses, hyphens, periods) is left alone — they don't break
  // typical role-name keyword detection.
  const lc = roleName.toLowerCase().replace(/\//g, '');

  if (/\bap\b|\baccounts payable\b|\bpayables?\b|\bbuyer\b/.test(lc)) {
    return { center: 'ACCOUNTING_CENTER', permissions: AP_STARTER, defaultRestriction: 'OWN' };
  }
  if (/\bar\b|\baccounts receivable\b|\breceivables?\b|\bcollections?\b/.test(lc)) {
    return { center: 'ACCOUNTING_CENTER', permissions: AR_STARTER, defaultRestriction: 'OWN' };
  }
  // Finance broad — CFO / controller / finance director / finance manager.
  // Match BEFORE sales so "Finance Manager" doesn't get misrouted to sales
  // via a stray "manager" keyword (sales regex requires "sales" / "account
  // exec" / "account manager" / "business dev" specifically — bare "manager"
  // doesn't match — so this ordering is defensive).
  if (/\bcfo\b|\bcontroller\b|\bfinance director\b|\bfinance manager\b/.test(lc)) {
    return {
      center: 'ACCOUNTING_CENTER',
      permissions: FINANCE_BROAD_STARTER,
      defaultRestriction: 'NONE',
    };
  }
  if (/\bsales\b|\baccount (?:exec|manager)\b|\bbusiness dev/.test(lc)) {
    return { center: 'SALES_CENTER', permissions: SALES_STARTER, defaultRestriction: 'OWN' };
  }
  if (/\binventory\b|\bwarehouse\b|\bsupply chain\b/.test(lc)) {
    return { center: 'INVENTORY_CENTER', permissions: INVENTORY_STARTER, defaultRestriction: 'OWN' };
  }
  if (/\bprocurement\b|\bpurchasing\b/.test(lc)) {
    return { center: 'PURCHASE_CENTER', permissions: PROCUREMENT_STARTER, defaultRestriction: 'OWN' };
  }
  if (/\bmanufacturing\b|\bproduction\b|\bplant\b/.test(lc)) {
    return {
      center: 'MANUFACTURING_CENTER',
      permissions: MANUFACTURING_STARTER,
      defaultRestriction: 'OWN',
    };
  }
  if (/\bquality\b|\bauditors?\b|\binternal audit\b/.test(lc)) {
    return {
      center: 'CLASSIC',
      permissions: QUALITY_AUDITOR_STARTER,
      defaultRestriction: 'NONE',
    };
  }
  if (/\bclinical\b|\btrial\b|\bmedical\b/.test(lc)) {
    return { center: 'CLASSIC', permissions: CLINICAL_STARTER, defaultRestriction: 'OWN' };
  }
  if (/\bit\b|\btechnical\b|\bsuiteadmin\b/.test(lc)) {
    return {
      center: 'CLASSIC',
      permissions: IT_SUITEADMIN_STARTER,
      defaultRestriction: 'NONE',
    };
  }
  return { center: 'CLASSIC', permissions: DEFAULT_STARTER, defaultRestriction: 'OWN' };
}

// ─── Customization overlay ──────────────────────────────────────────────────

interface OverlayResult {
  permissions: Permission[];
  restriction: SubsidiaryRestriction;
  appliedOverlays: string[];
}

/**
 * Apply the customization-notes overlay to the starter spec.
 * Recognised patterns:
 *   - "remove Approve [bills/etc.]"     → downgrade VENDORBILL/INVOICE
 *                                          from FULL to CREATE
 *   - "read-only" / "read only"          → all permlevels → VIEW
 *   - "subsidiary-scoped"                → restriction = OWN
 *   - "group-wide" / "cross-subsidiary"  → restriction = NONE
 *
 * Multiple overlays compose. The function returns the post-overlay
 * permission list + restriction + a provenance string per applied
 * rule (used in the role XML's comment header).
 */
export function applyOverlay(
  starter: RoleStarterSpec,
  customizationNotes: string,
): OverlayResult {
  // Strip quote characters before regex matching — wizard answers
  // commonly wrap permission names in quotes ("remove \"Approve
  // Bills\" permission") which break naive word-boundary regexes.
  // The replacement preserves all other text including punctuation.
  const notes = (customizationNotes ?? '').replace(/["'“”‘’]/g, ' ');
  let permissions: Permission[] = starter.permissions.map((p) => ({ ...p }));
  let restriction: SubsidiaryRestriction = starter.defaultRestriction;
  const applied: string[] = [];

  // "remove Approve [whatever] permission" — downgrade approval-shaped
  // perms from FULL to CREATE. Mostly hits VENDORBILL for AP roles.
  const removeApproveMatch = notes.match(/\bremove\s+approve\s+([\w\s]+?)\s+permission/i);
  if (removeApproveMatch) {
    const target = removeApproveMatch[1].toLowerCase();
    permissions = permissions.map((p) => {
      const keyLc = p.permkey.toLowerCase();
      if (target.includes('bill') && /vendorbill/.test(keyLc) && p.permlevel === 'FULL') {
        return { ...p, permlevel: 'CREATE' };
      }
      if (target.includes('invoice') && /^tran_invoice$/.test(keyLc) && p.permlevel === 'FULL') {
        return { ...p, permlevel: 'CREATE' };
      }
      return p;
    });
    applied.push(`downgraded approval permkeys for "${removeApproveMatch[1]}" from FULL → CREATE`);
  }

  // "read-only" / "read only" — every FULL/EDIT/CREATE drops to VIEW.
  if (/\bread[- ]?only\b/i.test(notes)) {
    permissions = permissions.map((p) => ({ ...p, permlevel: 'VIEW' }));
    applied.push('read-only override: all permissions downgraded to VIEW');
  }

  // Subsidiary scope — OWN keeps the starter default; explicit overrides
  // flip to NONE for group-wide roles.
  if (/\bgroup[- ]?wide\b|\bcross[- ]?subsidiary\b/i.test(notes)) {
    restriction = 'NONE';
    applied.push('group-wide override: restrictionbysubsidiary = NONE');
  } else if (/\bsubsidiary[- ]?scoped\b/i.test(notes)) {
    restriction = 'OWN';
    applied.push('subsidiary-scoped override: restrictionbysubsidiary = OWN');
  }

  return { permissions, restriction, appliedOverlays: applied };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

interface ParsedRoleLine {
  roleName: string;
  customizationNotes: string;
}

function parseLine(line: string): ParsedRoleLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(/^([^:]+):\s*(.*)$/);
  if (!m) return null;
  const roleName = m[1].trim();
  const notes = m[2].trim();
  if (roleName.length === 0) return null;
  return { roleName, customizationNotes: notes };
}

// ─── XML emission ────────────────────────────────────────────────────────────

function buildRoleXml(args: {
  scriptid: string;
  roleName: string;
  center: CenterId;
  restriction: SubsidiaryRestriction;
  permissions: Permission[];
  rawLine: string;
  appliedOverlays: string[];
}): string {
  const overlayLines =
    args.appliedOverlays.length > 0
      ? args.appliedOverlays.map((o) => `    - ${o}`).join('\n')
      : '    - (none — defaults applied)';
  const permissionRows = args.permissions
    .map(
      (p) => `    <permission>
      <permkey>${p.permkey}</permkey>
      <permlevel>${p.permlevel}</permlevel>
    </permission>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Role Generator from wizard answer ns.design.standardRoleCustomization.
  Role: ${xmlEscape(args.roleName)}
  Center: ${args.center}
  Source line: "${xmlEscape(args.rawLine)}"
  Customization notes parsed:
${overlayLines}
  Review before deploy:
    - Confirm permission level overrides match SoD policy
    - Add subsidiary restriction in NetSuite UI if multi-entity scope is needed beyond restrictionbysubsidiary
    - Test role login + transaction creation in sandbox
-->
<role scriptid="${args.scriptid}">
  <name>${xmlEscape(args.roleName)}</name>
  <centertype>${args.center}</centertype>
  <employeerestriction>NONE</employeerestriction>
  <issalesrole>F</issalesrole>
  <issupportrole>F</issupportrole>
  <iswebservicesonlyrole>F</iswebservicesonlyrole>
  <restrictionbysubsidiary>${args.restriction}</restrictionbysubsidiary>
  <permissions>
${permissionRows}
  </permissions>
</role>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateRoles(input: RoleGeneratorInput): RoleGeneratorOutput {
  const files: Record<string, string> = {};
  const emitted: EmittedRole[] = [];

  const raw = (input.standardRoleCustomization ?? '').toString();
  if (raw.trim().length === 0) return { files, emitted };

  const seen = new Set<string>();
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    let scriptid = `customrole_nsix_${slugify(parsed.roleName)}`;
    let n = 2;
    while (seen.has(scriptid)) {
      scriptid = `customrole_nsix_${slugify(parsed.roleName)}_${n++}`;
    }
    seen.add(scriptid);

    const starter = classifyRole(parsed.roleName);
    const overlay = applyOverlay(starter, parsed.customizationNotes);
    const filename = `Objects/${scriptid}.xml`;

    files[filename] = buildRoleXml({
      scriptid,
      roleName: parsed.roleName,
      center: starter.center,
      restriction: overlay.restriction,
      permissions: overlay.permissions,
      rawLine: line.trim(),
      appliedOverlays: overlay.appliedOverlays,
    });
    emitted.push({
      filename,
      scriptid,
      roleName: parsed.roleName,
      center: starter.center,
      permissions: overlay.permissions,
      restrictionbysubsidiary: overlay.restriction,
      appliedOverlays: overlay.appliedOverlays,
    });
  }

  return { files, emitted };
}
