/**
 * SDF Manifest generator — emits a valid Oracle SuiteCloud
 * `manifest.xml` for an Account Customization Project (ACP) with
 * features derived from wizard answers.
 *
 * Pre-Pack-A: features were hardcoded to {CUSTOMRECORDS,
 * SERVERSIDESCRIPTING} regardless of engagement shape. This worked
 * for trivial bundles but failed real OneWorld deploys — bundles
 * emit subsidiary / multi-currency / SuiteFlow / SAML SSO objects
 * that the manifest didn't declare, so SuiteCloud refused install.
 *
 * Pack A wires the manifest to the actual wizard flags. Foundation
 * answers (edition, multi-currency, multi-book, ARM, custom roles,
 * SSO, languages), tax engine choice, and downstream artefact
 * presence (custom records, SuiteScripts, workflows, PO approval)
 * all drive the <features> block. Output declares only the features
 * the bundle actually needs — no over-declaration that would cause
 * the deploy to demand features the customer hasn't licensed.
 *
 * Sources:
 *   - Oracle NetSuite SDF Manifest documentation
 *     https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4724963992.html
 *   - NetSuite OneWorld feature dependency catalog (Oracle Help)
 *   - sdfValidator.ts validateManifest() rule set — every <feature>
 *     tag must carry a required="true|false" attribute, root must be
 *     <manifest projecttype="ACCOUNTCUSTOMIZATION">, etc.
 */

export interface SdfManifestInput {
  /** Implementing firm name (e.g., "NSIX" or "NSIX Implementation
   *  Partners"). Drives the <projectname> "<firm> implementation for
   *  <client>" string. */
  firmName: string;
  /** Client / engagement name (e.g., "Atlas Industries Group"). */
  clientName: string;

  // ── Foundation flags (Pack A — derive features from wizard) ──
  /** ns.foundation.edition — drives SUBSIDIARIES/INTERCOMPANY/etc.
   *  Recognised values: 'STANDARD', 'MID_MARKET', 'ENTERPRISE',
   *  'ONEWORLD'. Unknown strings are treated as 'STANDARD' (lowest
   *  tier — no edition-derived features added). */
  edition?: string;
  /** ns.foundation.multiCurrencyInScope — drives MULTICURRENCY. */
  multiCurrencyInScope?: boolean;
  /** ns.foundation.multiBookAccounting — drives MULTIBOOKACCOUNTING +
   *  REVENUEACCOUNTINGSTANDARDS. */
  multiBookAccounting?: boolean;
  /** ns.foundation.advancedRevRecInScope — drives ADVANCEDREVENUERECOGNITION. */
  advancedRevRecInScope?: boolean;
  /** ns.foundation.customRolesRequired — drives CUSTOMSCRIPTS + CUSTOMUI. */
  customRolesRequired?: boolean;
  /** ns.foundation.ssoInScope — drives SAMLSSO. */
  ssoInScope?: boolean;

  // ── Tax engine ──
  /** ns.tax.engine — drives SUITETAX. */
  taxEngine?: 'SUITETAX' | 'LEGACY' | string;

  // ── Downstream artefact presence (set by orchestrator) ──
  /** True when the bundle will emit ≥1 customrecord_*.xml. */
  hasCustomRecords?: boolean;
  /** True when the bundle will emit ≥1 SuiteScripts/*.js (Pack B+E). */
  hasSuiteScripts?: boolean;
  /** True when the bundle will emit ≥1 workflow XML (future Pack D). */
  hasWorkflows?: boolean;
  /** True when the PO approval User Event is in scope — turns on
   *  SUITEFLOW even without an explicit workflow XML, since the script
   *  routes via approvalstatus changes. */
  poApprovalInScope?: boolean;

  // ── Languages ──
  /** ns.localization.uiLanguages parsed into an array. ≥2 entries →
   *  MULTILANGUAGE feature. */
  uiLanguages?: readonly string[];
}

/**
 * XML-escape user-supplied text. firm + client names land inside
 * <projectname> as literal text, so the five XML special chars must
 * be escaped before splicing.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Edition tier rank — used to gate features that require a minimum
 *  edition (e.g., CUSTOMTRANSACTIONS / CUSTOMSEGMENTS need MID_MARKET+). */
const EDITION_RANK: Record<string, number> = {
  STANDARD: 1,
  MID_MARKET: 2,
  ENTERPRISE: 3,
  ONEWORLD: 4,
};

function editionRank(edition: string | undefined): number {
  if (!edition) return EDITION_RANK.STANDARD;
  return EDITION_RANK[edition.toUpperCase()] ?? EDITION_RANK.STANDARD;
}

/**
 * Derive the set of NetSuite feature IDs this manifest must declare,
 * keyed by feature ID with the required="true|false" string.
 *
 * Logic mirrors the Pack A spec table. Features are emitted in
 * alphabetical order so the output is deterministic across runs (the
 * test suite + bundle diff stay clean across regenerations).
 */
function deriveFeatures(input: SdfManifestInput): { id: string; required: 'true' | 'false' }[] {
  const features = new Map<string, 'true' | 'false'>();
  const add = (id: string, required: 'true' | 'false' = 'true') => {
    // Defensive: don't downgrade required=true to false on a second add.
    if (features.get(id) === 'true') return;
    features.set(id, required);
  };

  // Always-included when downstream artefacts are present.
  if (input.hasCustomRecords) add('CUSTOMRECORDS');
  if (input.hasSuiteScripts) add('SERVERSIDESCRIPTING');

  // Custom transactions + segments unlock above STANDARD tier when the
  // engagement actually has custom records to apply them to.
  if (input.hasCustomRecords && editionRank(input.edition) >= EDITION_RANK.MID_MARKET) {
    add('CUSTOMTRANSACTIONS');
    add('CUSTOMSEGMENTS');
  }

  // OneWorld trio — required for any multi-subsidiary tenant.
  if ((input.edition ?? '').toUpperCase() === 'ONEWORLD') {
    add('SUBSIDIARIES');
    add('INTERCOMPANY');
    add('EXPENSEALLOCATIONS');
  }

  if (input.multiCurrencyInScope) add('MULTICURRENCY');

  if (input.multiBookAccounting) {
    add('MULTIBOOKACCOUNTING');
    add('REVENUEACCOUNTINGSTANDARDS');
  }

  if (input.advancedRevRecInScope) add('ADVANCEDREVENUERECOGNITION');

  // Custom roles + custom UI flow together — both gate SuiteScripts
  // and any custom-form usage downstream.
  if (input.customRolesRequired || input.hasSuiteScripts) {
    add('CUSTOMSCRIPTS');
    add('CUSTOMUI');
  }

  if (input.ssoInScope) add('SAMLSSO');

  if ((input.taxEngine ?? '').toUpperCase() === 'SUITETAX') add('SUITETAX');

  // Workflow engine — explicit workflows OR the PO approval User Event
  // (which routes via approvalstatus transitions that downstream
  // SuiteFlow workflows latch onto).
  if (input.hasWorkflows || input.poApprovalInScope) add('SUITEFLOW');

  // Multi-language only when the engagement uses 2+ UI languages.
  if ((input.uiLanguages?.length ?? 0) > 1) add('MULTILANGUAGE');

  // Stable alphabetical sort so the manifest is deterministic.
  return [...features.entries()]
    .map(([id, required]) => ({ id, required }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Emit the manifest.xml body with features derived from wizard
 * answers. When all derivation flags are false / unset, the manifest
 * still emits a valid <manifest> element with an empty <features>
 * block — defensive shape for edge-case engagements (single-entity,
 * no customisation, no scripts) that only need a project name.
 */
export function generateSdfManifest(input: SdfManifestInput): string {
  const projectName = xmlEscape(`${input.firmName} implementation for ${input.clientName}`);
  const features = deriveFeatures(input);
  const featureLines = features
    .map(({ id, required }) => `      <feature required="${required}">${id}</feature>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>${projectName}</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
${featureLines}
    </features>
  </dependencies>
</manifest>
`;
}
