/**
 * SDF Subsidiary generator (Pack A — OneWorld Foundation).
 *
 * Reads the wizard's free-text TEXTAREA `ns.foundation.subsidiaryList`
 * and emits one Oracle SDF `subsidiary` XML per declared entity, plus
 * one extra subsidiary XML for the elimination entity (marked
 * `<iselimination>T</iselimination>`).
 *
 * Without these files, an SDF bundle on a OneWorld tenant fails
 * deploy — every customrecord / form / script downstream references
 * subsidiary IDs that NetSuite refuses to resolve to non-existent
 * entities. Pack A unblocks the deploy path that Packs B and H built
 * on top of.
 *
 * Input format (one subsidiary per line):
 *   "<name>, <city or country>, <currency_iso4217>, <parent_or_'parent'>"
 *
 * Examples:
 *   "Atlas Industries Group Inc., US, USD, parent"
 *   "Brightside Manufacturing KSA, Riyadh, SAR, Brightside Holdings UAE"
 *
 * Lines that don't have at least 4 comma-separated fields are skipped
 * silently (Pack A's job is "emit what we can parse"; the consultant
 * fixes broken lines manually). The parent field is either the literal
 * "parent" (root subsidiary) or the human name of another subsidiary
 * in the same list — the generator resolves the name to a scriptid
 * using NetSuite's bracketed `[scriptid=...]` reference syntax.
 *
 * Sources:
 *   - NetSuite SDF subsidiary XML reference (Oracle docs).
 *   - NetSuite OneWorld feature dependency catalog (Oracle Help).
 */

export interface SubsidiaryGeneratorInput {
  /** Raw TEXTAREA value from ns.foundation.subsidiaryList. */
  subsidiaryList: string | null | undefined;
  /** Raw value from ns.foundation.eliminationEntity (e.g.,
   *  "Atlas Group Eliminations" or "Brightside Group Eliminations
   *  (UAE)"). When present + non-empty + subsidiaryList yielded ≥1
   *  parsed subsidiary, the generator emits a 5th XML for this entity
   *  with iselimination=T and parent pointing at the root subsidiary. */
  eliminationEntity: string | null | undefined;
}

export interface EmittedSubsidiary {
  /** Bundle-relative path. */
  filename: string;
  /** scriptid (e.g., "subsidiary_atlas_industries_group_inc"). */
  scriptid: string;
  /** Original human name from the wizard. */
  name: string;
  /** ISO 4217 currency code or empty when the line didn't supply one. */
  currency: string;
  /** Inferred ISO 3166 alpha-2 country (or "" when no inference fired). */
  country: string;
  /** True for the elimination entity. */
  isElimination: boolean;
}

export interface SubsidiaryGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedSubsidiary[];
}

// ─── Country inference ───────────────────────────────────────────────────────

/**
 * Best-effort country inference from a free-text "city or country"
 * field. Empty string when no rule fires — the consultant fills in
 * post-generation. Order matters: the most-specific phrases (city
 * names) are matched before broader country names.
 */
function inferCountry(locationOrCountry: string): string {
  const lc = locationOrCountry.toLowerCase();
  // UAE
  if (/\b(ae|uae|united arab emirates|dubai|abu dhabi|sharjah)\b/.test(lc)) return 'AE';
  // KSA
  if (/\b(ksa|sa|saudi|riyadh|jeddah|dammam)\b/.test(lc)) return 'SA';
  // Egypt
  if (/\b(eg|egypt|cairo|alexandria|giza)\b/.test(lc)) return 'EG';
  // UK
  if (/\b(uk|gb|united kingdom|england|britain|london|manchester|edinburgh)\b/.test(lc)) return 'GB';
  // Australia
  if (/\b(au|australia|sydney|melbourne|brisbane)\b/.test(lc)) return 'AU';
  // Germany
  if (/\b(de|germany|deutschland|berlin|frankfurt|munich)\b/.test(lc)) return 'DE';
  // France
  if (/\b(fr|france|paris|lyon|marseille)\b/.test(lc)) return 'FR';
  // Canada
  if (/\b(ca|canada|toronto|vancouver|montreal|calgary)\b/.test(lc)) return 'CA';
  // India
  if (/\b(in|india|mumbai|delhi|bangalore|chennai)\b/.test(lc)) return 'IN';
  // US — checked late because "US state name" is broad. Matches "US",
  // "USA", "United States", and a list of common state names. Boston (MA)
  // has the abbrev in parens which the regex catches.
  if (
    /\b(us|usa|united states|new york|california|texas|florida|illinois|massachusetts|boston|chicago|seattle|washington dc|ma|ny|ca|tx|fl|il)\b/.test(
      lc,
    )
  ) {
    return 'US';
  }
  return '';
}

// ─── Slugify ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface ParsedSubsidiary {
  name: string;
  locationOrCountry: string;
  currency: string;
  parentLabel: string; // either "parent" (root) or the parent subsidiary's name
  rawLine: string;
}

function parseLine(line: string): ParsedSubsidiary | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.length < 4) return null;
  // Subsidiary names that contain commas would break this — but the
  // wizard prompt explicitly tells consultants to use one row per
  // subsidiary in the documented "name, location, currency, parent"
  // format. If a name has a literal comma, the consultant works
  // around it manually (rename or quote in their answer).
  const [name, locationOrCountry, currency, ...parentRest] = parts;
  const parentLabel = parentRest.join(',').trim(); // re-join in case the parent name itself had a comma
  if (name.length === 0) return null;
  return { name, locationOrCountry, currency, parentLabel, rawLine: trimmed };
}

// ─── XML emission ────────────────────────────────────────────────────────────

function buildSubsidiaryXml(args: {
  scriptid: string;
  name: string;
  country: string;
  currency: string;
  parentScriptid: string; // empty for root, otherwise [scriptid=subsidiary_*]
  isElimination: boolean;
  rawLine: string;
}): string {
  const escapedName = xmlEscape(args.name);
  const parentLine = args.parentScriptid
    ? `  <parent>[scriptid=${args.parentScriptid}]</parent>`
    : `  <parent></parent>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Subsidiary Generator from wizard answer ns.foundation.subsidiaryList.
  Original line: "${xmlEscape(args.rawLine)}"
  Review before deploy:
    - Confirm currency code is a valid ISO 4217 code already enabled on the account
    - Set tax nexus per subsidiary in the TAX section before deploy
    - For elimination entity, confirm the iselimination flag is T and the parent points to the top-level subsidiary
-->
<subsidiary scriptid="${args.scriptid}">
  <name>${escapedName}</name>
  <country>${args.country}</country>
  <currency>${args.currency}</currency>
  <iselimination>${args.isElimination ? 'T' : 'F'}</iselimination>
  <isinactive>F</isinactive>
  <legalname>${escapedName}</legalname>
${parentLine}
  <state></state>
</subsidiary>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse subsidiaryList + eliminationEntity → emit one subsidiary XML
 * per parsed line + (optionally) one for the elimination entity.
 *
 * Empty / whitespace-only / undefined subsidiaryList yields {files: {},
 * emitted: []}. Single-subsidiary engagements (parsed length === 1)
 * still emit the one subsidiary file but suppress elimination entity
 * emission — there's nothing to eliminate against in a single-entity
 * tenant.
 */
export function generateSubsidiaries(
  input: SubsidiaryGeneratorInput,
): SubsidiaryGeneratorOutput {
  const raw = (input.subsidiaryList ?? '').toString();
  if (raw.trim().length === 0) return { files: {}, emitted: [] };

  const lines = raw.split(/\r?\n/);
  const parsed = lines
    .map((l) => parseLine(l))
    .filter((p): p is ParsedSubsidiary => p !== null);
  if (parsed.length === 0) return { files: {}, emitted: [] };

  // Build name → scriptid map first so we can resolve parent
  // references in the second pass.
  const nameToScriptid = new Map<string, string>();
  const scriptidsSeen = new Set<string>();
  const subsScriptids: { parsed: ParsedSubsidiary; scriptid: string }[] = [];
  for (const p of parsed) {
    let scriptid = `subsidiary_${slugify(p.name)}`;
    let n = 2;
    while (scriptidsSeen.has(scriptid)) {
      scriptid = `subsidiary_${slugify(p.name)}_${n++}`;
    }
    scriptidsSeen.add(scriptid);
    nameToScriptid.set(p.name, scriptid);
    subsScriptids.push({ parsed: p, scriptid });
  }

  const files: Record<string, string> = {};
  const emitted: EmittedSubsidiary[] = [];

  // Find the root subsidiary for the elimination-entity parent ref:
  // first one whose parentLabel is literally "parent" (case-insensitive).
  let rootScriptid: string | null = null;
  let rootCountry = '';
  let rootCurrency = '';
  for (const { parsed: p, scriptid } of subsScriptids) {
    if (p.parentLabel.toLowerCase() === 'parent') {
      rootScriptid = scriptid;
      rootCountry = inferCountry(p.locationOrCountry);
      rootCurrency = p.currency;
      break;
    }
  }

  for (const { parsed: p, scriptid } of subsScriptids) {
    const country = inferCountry(p.locationOrCountry);
    const isRoot = p.parentLabel.toLowerCase() === 'parent';
    const parentScriptid = isRoot ? '' : (nameToScriptid.get(p.parentLabel) ?? '');
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildSubsidiaryXml({
      scriptid,
      name: p.name,
      country,
      currency: p.currency,
      parentScriptid,
      isElimination: false,
      rawLine: p.rawLine,
    });
    emitted.push({
      filename,
      scriptid,
      name: p.name,
      currency: p.currency,
      country,
      isElimination: false,
    });
  }

  // Elimination entity — only when there are ≥2 subsidiaries (no point
  // having an elimination entity in a single-tenant engagement) AND
  // the wizard answer is non-empty.
  const eliminationName = (input.eliminationEntity ?? '').toString().trim();
  if (parsed.length >= 2 && eliminationName.length > 0 && rootScriptid) {
    let elimScriptid = `subsidiary_${slugify(eliminationName)}`;
    let n = 2;
    while (scriptidsSeen.has(elimScriptid)) {
      elimScriptid = `subsidiary_${slugify(eliminationName)}_${n++}`;
    }
    scriptidsSeen.add(elimScriptid);
    const elimFilename = `Objects/${elimScriptid}.xml`;
    files[elimFilename] = buildSubsidiaryXml({
      scriptid: elimScriptid,
      name: eliminationName,
      country: rootCountry,
      currency: rootCurrency,
      parentScriptid: rootScriptid,
      isElimination: true,
      rawLine: `(elimination entity from ns.foundation.eliminationEntity = "${eliminationName}")`,
    });
    emitted.push({
      filename: elimFilename,
      scriptid: elimScriptid,
      name: eliminationName,
      currency: rootCurrency,
      country: rootCountry,
      isElimination: true,
    });
  }

  return { files, emitted };
}

/**
 * Helper for the orchestrator: extract the deduplicated set of ISO
 * 4217 currency codes from a parsed subsidiary list. The currency
 * generator consumes this array. Empty / null input yields []; codes
 * are uppercased + deduplicated; non-3-letter codes are dropped (they
 * can't be valid ISO 4217 anyway).
 */
export function extractCurrenciesFromSubsidiaries(
  emitted: EmittedSubsidiary[],
): string[] {
  const set = new Set<string>();
  for (const sub of emitted) {
    const code = (sub.currency ?? '').trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) set.add(code);
  }
  return [...set].sort();
}
