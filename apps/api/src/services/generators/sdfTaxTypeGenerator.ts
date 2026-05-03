/**
 * SDF Tax Type generator (Pack D — Tax Engine).
 *
 * Emits one Oracle SDF `taxtype` XML per tax-type category the
 * engagement uses. Tax codes (Component 3 / sdfTaxCodeGenerator) link
 * to one of these via their <taxtype> field, so this generator must
 * run BEFORE the tax code generator.
 *
 * Always-on floor:
 *   taxtype_nsix_vat        → universal (every NS engagement uses VAT or
 *                              its US-equivalent)
 *   taxtype_nsix_sales_tax  → universal (US-style)
 *
 * Conditional emission (driven by NS Pack 2 wizard flags):
 *   withholdingInScope     → taxtype_nsix_withholding
 *   useTaxInScope          → taxtype_nsix_use_tax
 *   reverseChargeInScope   → taxtype_nsix_reverse_charge
 *
 * Auto-detection from the tax code matrix:
 *   Any line with type=GST   → taxtype_nsix_gst
 *   Any line with a NOVEL type beyond the canonical set → emits a
 *     taxtype_nsix_<typeslug> with a generic placeholder description
 *
 * The novel-type fallback is forward-looking — Pack D today recognises
 * VAT/SALES_TAX/GST/WITHHOLDING/USE_TAX/REVERSE_CHARGE; if the
 * consultant adds a custom type token (e.g., DIGITAL_SERVICES_TAX) on
 * a future engagement, the generator emits a placeholder so the bundle
 * isn't broken at deploy.
 *
 * Sources:
 *   - NetSuite SDF taxtype XML reference (Oracle docs).
 *   - NetSuite SuiteTax tax-type catalog (Oracle Help — Tax Types).
 */

export interface TaxTypeGeneratorInput {
  /** Raw TEXTAREA from ns.tax.taxCodeMatrix — used for type detection. */
  taxCodeMatrix?: string | null;
  /** ns.tax.withholdingInScope. */
  withholdingInScope?: boolean;
  /** ns.tax.useTaxInScope. */
  useTaxInScope?: boolean;
  /** ns.tax.reverseChargeInScope. */
  reverseChargeInScope?: boolean;
  /** Raw TEXTAREA from ns.tax.nexusList — used for starter-library
   *  type detection. AU in nexus → GST type emitted (because the
   *  tax code generator's AU starter set is all GST), NZ/IN/CA same.
   *  Without this signal, tax codes referencing taxtype_nsix_gst
   *  would dangle (referential integrity failure caught by the
   *  harness check p4.sdf-tax-codes-reference-tax-types). */
  nexusList?: string | null;
}

export interface EmittedTaxType {
  filename: string;
  scriptid: string;
  /** Display name that appears in <name>. */
  displayName: string;
  /** Reason the type was emitted — drives the comment header in the
   *  XML (always-on / withholding flag / matrix detection / etc.). */
  source: string;
}

export interface TaxTypeGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedTaxType[];
}

// ─── Canonical tax type catalog ──────────────────────────────────────────────

interface CanonicalTaxType {
  slug: string;
  displayName: string;
  description: string;
}

const CANONICAL: Record<string, CanonicalTaxType> = {
  VAT: {
    slug: 'vat',
    displayName: 'VAT',
    description: 'Value Added Tax — applies to sales/purchases of goods and services',
  },
  SALES_TAX: {
    slug: 'sales_tax',
    displayName: 'Sales Tax',
    description: 'Standard sales tax — typically US state-level',
  },
  GST: {
    slug: 'gst',
    displayName: 'GST',
    description: 'Goods and Services Tax — common in AU/NZ/IN/CA',
  },
  WITHHOLDING: {
    slug: 'withholding',
    displayName: 'Withholding Tax',
    description: 'Withheld at source per regulatory requirement',
  },
  USE_TAX: {
    slug: 'use_tax',
    displayName: 'Use Tax',
    description: 'Self-assessed tax on out-of-state purchases — US-specific',
  },
  REVERSE_CHARGE: {
    slug: 'reverse_charge',
    displayName: 'Reverse Charge',
    description: 'Buyer self-accounts for tax — common in EU intra-community + UK',
  },
};

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

/**
 * Extract the set of tax-type tokens that appear in the matrix. Each
 * line shape is "<jurisdiction>: <type>: <rate>%: <name>"; the type
 * is the second colon-delimited segment. Tokens are upcased.
 */
function detectMatrixTypes(matrix: string): Set<string> {
  const out = new Set<string>();
  for (const line of matrix.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(/^[\w/]+:\s*([A-Z_]+):/);
    if (m) out.add(m[1].toUpperCase());
  }
  return out;
}

/**
 * Detect tax types implied by nexus countries via the tax code
 * generator's starter library. Mirrors the country → type set the
 * starter library emits — keeps the two generators agreeing on which
 * types must exist.
 *
 * Source of truth: sdfTaxCodeGenerator.STARTER_LIBRARY. Any change
 * there must keep this map in sync.
 */
const STARTER_TYPES_BY_COUNTRY: Record<string, ReadonlyArray<string>> = {
  AE: ['VAT'],
  SA: ['VAT'],
  EG: ['VAT'],
  GB: ['VAT'],
  AU: ['GST'],
  DE: ['VAT'],
  FR: ['VAT'],
  IT: ['VAT'],
};

function detectNexusTypes(nexusList: string): Set<string> {
  const out = new Set<string>();
  for (const line of nexusList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx < 0) continue;
    // Right side is "<country>" or "<country>/<region>" — take the
    // country prefix.
    const right = trimmed.slice(pipeIdx + 1).trim();
    const slashIdx = right.indexOf('/');
    const country = (slashIdx >= 0 ? right.slice(0, slashIdx) : right).trim().toUpperCase();
    const types = STARTER_TYPES_BY_COUNTRY[country];
    if (types) {
      for (const t of types) out.add(t);
    }
  }
  return out;
}

// ─── XML emission ────────────────────────────────────────────────────────────

function buildTaxTypeXml(args: {
  scriptid: string;
  displayName: string;
  description: string;
  source: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Tax Type Generator.
  Source: ${xmlEscape(args.source)}
  Review before deploy:
    - Confirm name + description match client tax-engine vocabulary
    - Set country if jurisdiction-specific (most types are global)
-->
<taxtype scriptid="${args.scriptid}">
  <name>${xmlEscape(args.displayName)}</name>
  <description>${xmlEscape(args.description)}</description>
  <country></country>
  <isinactive>F</isinactive>
</taxtype>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit the full set of tax types for an engagement: 2 always-on
 * (VAT + Sales Tax), N conditional (driven by NS Pack 2 flags), plus
 * matrix-detected GST + novel types.
 *
 * Output is deterministic — emissions appear in canonical order
 * regardless of input ordering, so the bundle diff stays clean across
 * regenerations.
 */
export function generateTaxTypes(input: TaxTypeGeneratorInput): TaxTypeGeneratorOutput {
  const matrixRaw = (input.taxCodeMatrix ?? '').toString();
  const matrixTypes = detectMatrixTypes(matrixRaw);

  // Build the set of types to emit — keyed by upper-case token so we
  // dedup naturally between always-on, flag-driven, and matrix-detected.
  const toEmit = new Map<string, { source: string }>();

  // Always-on floor.
  toEmit.set('VAT', { source: 'always-on (universal NetSuite engagement floor)' });
  toEmit.set('SALES_TAX', { source: 'always-on (universal NetSuite engagement floor)' });

  // Flag-driven conditionals.
  if (input.withholdingInScope === true) {
    toEmit.set('WITHHOLDING', { source: 'wizard flag ns.tax.withholdingInScope = true' });
  }
  if (input.useTaxInScope === true) {
    toEmit.set('USE_TAX', { source: 'wizard flag ns.tax.useTaxInScope = true' });
  }
  if (input.reverseChargeInScope === true) {
    toEmit.set('REVERSE_CHARGE', { source: 'wizard flag ns.tax.reverseChargeInScope = true' });
  }

  // Matrix-detected types (GST is the common one; novel types fall
  // through to placeholder emission).
  for (const token of matrixTypes) {
    if (!toEmit.has(token)) {
      toEmit.set(token, { source: `detected in ns.tax.taxCodeMatrix (type token: ${token})` });
    }
  }

  // Nexus-implied types: countries in nexusList where the tax code
  // generator's starter library emits codes of a type not yet covered.
  // E.g., AU in nexus → GST starter codes → must also emit
  // taxtype_nsix_gst so referential integrity holds.
  const nexusRaw = (input.nexusList ?? '').toString();
  const nexusTypes = detectNexusTypes(nexusRaw);
  for (const token of nexusTypes) {
    if (!toEmit.has(token)) {
      toEmit.set(token, {
        source: `implied by ns.tax.nexusList (starter library type for nexus country: ${token})`,
      });
    }
  }

  // Emit in canonical order, then any novel types alphabetically.
  const canonicalOrder = ['VAT', 'SALES_TAX', 'GST', 'WITHHOLDING', 'USE_TAX', 'REVERSE_CHARGE'];
  const orderedTokens: string[] = [];
  for (const token of canonicalOrder) {
    if (toEmit.has(token)) orderedTokens.push(token);
  }
  const novelTokens = [...toEmit.keys()].filter((t) => !canonicalOrder.includes(t)).sort();
  orderedTokens.push(...novelTokens);

  const files: Record<string, string> = {};
  const emitted: EmittedTaxType[] = [];

  for (const token of orderedTokens) {
    const meta = CANONICAL[token];
    const slug = meta?.slug ?? slugify(token);
    const displayName = meta?.displayName ?? token;
    const description =
      meta?.description ?? `Custom tax type derived from wizard matrix token "${token}" — review.`;
    const scriptid = `taxtype_nsix_${slug}`;
    const filename = `Objects/${scriptid}.xml`;
    const source = toEmit.get(token)!.source;
    files[filename] = buildTaxTypeXml({ scriptid, displayName, description, source });
    emitted.push({ filename, scriptid, displayName, source });
  }

  return { files, emitted };
}

// Exported for the tax code generator (so it can match a type token
// to the corresponding emitted scriptid without re-deriving the slug).
export function taxTypeScriptidFor(typeToken: string): string {
  const upper = typeToken.toUpperCase();
  const meta = CANONICAL[upper];
  const slug = meta?.slug ?? slugify(upper);
  return `taxtype_nsix_${slug}`;
}
