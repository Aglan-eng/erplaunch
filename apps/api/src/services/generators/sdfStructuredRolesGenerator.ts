/**
 * Structured Roles generator (Phase 25).
 *
 * Reads the wizard's structured answer key `ns.design.standardRolesStructured`
 * (a JSON-stringified array of StructuredRole) and emits one Oracle SDF
 * customrole_*.xml per row.
 *
 * Phase 25 contract over the legacy free-text TEXTAREA
 * (`ns.design.standardRoleCustomization` consumed by sdfRoleGenerator.ts):
 *   - Per-row OVERRIDES for center, permissions, and restriction.
 *     NULL/undefined override = use the legacy generator's keyword
 *     classifier + starter set + restriction default.
 *   - The customizationNotes text still flows through the legacy generator's
 *     applyOverlay() for read-only / group-wide / subsidiary-scoped /
 *     remove-approve patterns. Reuses the proven parser instead of
 *     re-implementing it.
 *   - Editor-side dedup is enforced; this generator ALSO dedups defensively
 *     (engagement could be mutated via API outside the wizard UI).
 *
 * Adaptor gate: this generator self-gates on adaptorId === 'netsuite'. Any
 * other adaptor returns { files: {}, emitted: [], errors: [] } — keeps the
 * Sahel/Odoo bundle banlist-clean even if the structured key somehow ends
 * up populated on a non-NetSuite engagement.
 *
 * Naming convention: identical to the legacy role generator —
 *   customrole_nsix_<slug>     where <slug> = slugify(name)
 *
 * Sources:
 *   - sdfRoleGenerator.ts — exports classifyRole + applyOverlay + slugify +
 *     buildRoleXml + the CenterId / PermLevel / SubsidiaryRestriction / Permission
 *     types this module reuses.
 *   - sdfStructuredCustomFieldsGenerator.ts (Phase 23) — same precedence-helper
 *     and parallel-emitter pattern this module mirrors.
 */

import {
  classifyRole,
  applyOverlay,
  slugify,
  buildRoleXml,
  type CenterId,
  type PermLevel,
  type Permission,
  type SubsidiaryRestriction,
} from './sdfRoleGenerator.js';

// ─── Public types ────────────────────────────────────────────────────────────

const ALLOWED_CENTERS: ReadonlySet<CenterId> = new Set<CenterId>([
  'CLASSIC',
  'ACCOUNTING_CENTER',
  'SALES_CENTER',
  'INVENTORY_CENTER',
  'PURCHASE_CENTER',
  'MANUFACTURING_CENTER',
  'EXECUTIVE_CENTER',
]);

const ALLOWED_PERMLEVELS: ReadonlySet<PermLevel> = new Set<PermLevel>([
  'NONE',
  'VIEW',
  'CREATE',
  'EDIT',
  'FULL',
]);

const ALLOWED_RESTRICTIONS: ReadonlySet<SubsidiaryRestriction> = new Set<SubsidiaryRestriction>([
  'NONE',
  'OWN',
  'OWN_AND_HIERARCHY',
]);

export interface StructuredRole {
  /** Role display name (also drives the scriptid slug). Required. */
  name: string;
  /** Optional center override. NULL/undefined → use classifyRole keyword
   *  classifier from the legacy generator. */
  centerOverride: CenterId | null;
  /** Optional explicit permission list. NULL/undefined → use the starter
   *  set from classifyRole. When provided, the customizationNotes overlay
   *  still applies on top. */
  permissionOverrides: Permission[] | null;
  /** Optional restriction override. NULL/undefined → use classifyRole's
   *  defaultRestriction. */
  restrictionOverride: SubsidiaryRestriction | null;
  /** Free-text overlay hints — read-only / group-wide / subsidiary-scoped /
   *  remove-approve patterns. Empty string is fine (no overlay). */
  customizationNotes: string;
}

export interface StructuredRolesInput {
  /** Adaptor id from the engagement (gate: only 'netsuite' emits anything). */
  adaptorId: string;
  /** The structured answer payload. Either an already-parsed array or a
   *  JSON string from the wizardStore. Empty / null / undefined yields
   *  empty output. */
  structuredAnswer: string | null | undefined | StructuredRole[];
}

export interface StructuredEmittedRole {
  filename: string;
  scriptid: string;
  roleName: string;
  center: CenterId;
  permissions: Permission[];
  restrictionbysubsidiary: SubsidiaryRestriction;
  /** Provenance trail — overrides applied + overlay rules fired. */
  appliedOverlays: string[];
}

export interface StructuredRolesValidationError {
  /** Position within the input array (0-indexed). -1 for root-level errors. */
  rowIndex: number;
  /** "name" / "centerOverride" / "permissionOverrides[2].permlevel" / etc. */
  field: string;
  /** Human-readable diagnostic. */
  message: string;
}

export interface StructuredRolesOutput {
  files: Record<string, string>;
  emitted: StructuredEmittedRole[];
  errors: StructuredRolesValidationError[];
}

// ─── Precedence helper ──────────────────────────────────────────────────────

/**
 * Phase 25 precedence rule: when the structured editor's answer is
 * populated, the legacy TEXTAREA `ns.design.standardRoleCustomization` is
 * treated as empty so sdfRoleGenerator stops emitting — preventing
 * double-emission during the migration window.
 *
 * Used by generation.ts to compute the effective TEXTAREA value passed
 * to sdfRoleGenerator (Pack C). Downstream consumers that ALSO read the
 * legacy textarea (perRoleTrainingGuideGenerator, signOffMatrixGenerator)
 * pick up the same effective value via the same wiring — consistent with
 * Phase 23's approach for ns.design.customFieldsScope.
 *
 * Returns:
 *   - undefined when structured is populated (structured wins)
 *   - the legacy TEXTAREA when structured is empty / null / undefined
 *   - undefined when both are empty
 */
export function resolveLegacyStandardRoleCustomization(
  legacyTextareaAnswer: string | null | undefined,
  structuredAnswer: string | null | undefined,
): string | undefined {
  // Structured wins when present + non-whitespace.
  if (typeof structuredAnswer === 'string' && structuredAnswer.trim().length > 0) {
    // Cheap shape-sanity: structured payload should parse to a non-empty
    // array. If it parses to an empty array, fall through to the legacy
    // textarea (matches Phase 23 behaviour for empty structured object).
    try {
      const parsed = JSON.parse(structuredAnswer.trim());
      if (Array.isArray(parsed) && parsed.length > 0) return undefined;
    } catch {
      // Malformed JSON — be conservative and treat structured as empty
      // so the legacy textarea (if any) still flows. The structured
      // generator itself surfaces the parse error in errors[].
    }
  }
  // Object/array form also counts as "populated" — be defensive in case
  // the wizard ever switches to storing the parsed array directly.
  if (Array.isArray(structuredAnswer) && structuredAnswer.length > 0) {
    return undefined;
  }
  // Normalise empty / whitespace legacy TEXTAREA to undefined so the
  // contract is single-valued ("nothing to emit" → undefined, never '').
  if (typeof legacyTextareaAnswer !== 'string' || legacyTextareaAnswer.trim().length === 0) {
    return undefined;
  }
  return legacyTextareaAnswer;
}

// ─── Validation ──────────────────────────────────────────────────────────────

interface RowValidationOk {
  ok: true;
  role: StructuredRole;
}
interface RowValidationFail {
  ok: false;
  errors: StructuredRolesValidationError[];
}

function validateRow(rowIndex: number, raw: unknown): RowValidationOk | RowValidationFail {
  const errs: StructuredRolesValidationError[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errs.push({ rowIndex, field: '_root', message: 'row must be an object' });
    return { ok: false, errors: errs };
  }
  const obj = raw as Record<string, unknown>;

  // name (required, alphanumeric must produce a non-empty slug)
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (name.length === 0) {
    errs.push({ rowIndex, field: 'name', message: 'name is required' });
  } else if (slugify(name) === 'unnamed') {
    errs.push({
      rowIndex,
      field: 'name',
      message: `name "${name}" produces an empty slug; use at least one alphanumeric character`,
    });
  }

  // centerOverride: null or one of ALLOWED_CENTERS
  let centerOverride: CenterId | null = null;
  if (obj.centerOverride !== null && obj.centerOverride !== undefined) {
    if (typeof obj.centerOverride !== 'string' || !ALLOWED_CENTERS.has(obj.centerOverride as CenterId)) {
      errs.push({
        rowIndex,
        field: 'centerOverride',
        message: `centerOverride must be null or one of ${[...ALLOWED_CENTERS].join('/')} (got ${JSON.stringify(obj.centerOverride)})`,
      });
    } else {
      centerOverride = obj.centerOverride as CenterId;
    }
  }

  // restrictionOverride: null or one of ALLOWED_RESTRICTIONS
  let restrictionOverride: SubsidiaryRestriction | null = null;
  if (obj.restrictionOverride !== null && obj.restrictionOverride !== undefined) {
    if (
      typeof obj.restrictionOverride !== 'string' ||
      !ALLOWED_RESTRICTIONS.has(obj.restrictionOverride as SubsidiaryRestriction)
    ) {
      errs.push({
        rowIndex,
        field: 'restrictionOverride',
        message: `restrictionOverride must be null or one of NONE/OWN/OWN_AND_HIERARCHY (got ${JSON.stringify(obj.restrictionOverride)})`,
      });
    } else {
      restrictionOverride = obj.restrictionOverride as SubsidiaryRestriction;
    }
  }

  // permissionOverrides: null or array of {permkey: string, permlevel: PermLevel}
  let permissionOverrides: Permission[] | null = null;
  if (obj.permissionOverrides !== null && obj.permissionOverrides !== undefined) {
    if (!Array.isArray(obj.permissionOverrides)) {
      errs.push({
        rowIndex,
        field: 'permissionOverrides',
        message: 'permissionOverrides must be null or an array',
      });
    } else {
      const perms: Permission[] = [];
      for (let i = 0; i < obj.permissionOverrides.length; i++) {
        const p = obj.permissionOverrides[i] as unknown;
        if (p === null || typeof p !== 'object') {
          errs.push({
            rowIndex,
            field: `permissionOverrides[${i}]`,
            message: 'permission row must be an object',
          });
          continue;
        }
        const pObj = p as Record<string, unknown>;
        const permkey = typeof pObj.permkey === 'string' ? pObj.permkey.trim() : '';
        const permlevel = pObj.permlevel;
        if (permkey.length === 0) {
          errs.push({
            rowIndex,
            field: `permissionOverrides[${i}].permkey`,
            message: 'permkey is required',
          });
        }
        if (typeof permlevel !== 'string' || !ALLOWED_PERMLEVELS.has(permlevel as PermLevel)) {
          errs.push({
            rowIndex,
            field: `permissionOverrides[${i}].permlevel`,
            message: `permlevel must be one of NONE/VIEW/CREATE/EDIT/FULL (got ${JSON.stringify(permlevel)})`,
          });
          continue;
        }
        if (permkey.length > 0) {
          perms.push({ permkey, permlevel: permlevel as PermLevel });
        }
      }
      permissionOverrides = perms;
    }
  }

  // customizationNotes: optional string
  if (obj.customizationNotes !== undefined && typeof obj.customizationNotes !== 'string') {
    errs.push({
      rowIndex,
      field: 'customizationNotes',
      message: 'customizationNotes must be a string',
    });
  }
  const customizationNotes =
    typeof obj.customizationNotes === 'string' ? obj.customizationNotes : '';

  if (errs.length > 0) return { ok: false, errors: errs };

  return {
    ok: true,
    role: {
      name,
      centerOverride,
      permissionOverrides,
      restrictionOverride,
      customizationNotes,
    },
  };
}

/**
 * Parse the input payload (string-or-array) into a normalised array.
 */
function parseStructuredAnswer(
  raw: StructuredRolesInput['structuredAnswer'],
):
  | { ok: true; rows: unknown[] }
  | { ok: false; error: StructuredRolesValidationError } {
  if (raw === null || raw === undefined) return { ok: true, rows: [] };
  if (Array.isArray(raw)) return { ok: true, rows: raw as unknown[] };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, rows: [] };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: {
            rowIndex: -1,
            field: '_root',
            message: 'structured payload must be a JSON array of role rows',
          },
        };
      }
      return { ok: true, rows: parsed };
    } catch (err) {
      return {
        ok: false,
        error: {
          rowIndex: -1,
          field: '_root',
          message: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }
  return {
    ok: false,
    error: { rowIndex: -1, field: '_root', message: 'unsupported structured payload type' },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the structured role XMLs.
 *
 *   - adaptorId !== 'netsuite' → empty output (gate; Sahel/Odoo banlist).
 *   - Empty / undefined / null structuredAnswer → empty output.
 *   - Per-row validation errors are collected in `errors[]` and that row
 *     does NOT emit. Other rows still emit. Caller decides whether to
 *     fail-the-job on errors.length > 0.
 *   - Same-name dedup — first row wins, subsequent duplicates are flagged
 *     in `errors[]` (matches Phase 23 dedup contract; the editor enforces
 *     uniqueness at input time so duplicates indicate a bug or external
 *     mutation).
 */
export function generateSdfStructuredRoles(
  input: StructuredRolesInput,
): StructuredRolesOutput {
  // Adaptor gate — non-NetSuite engagements get nothing.
  if (input.adaptorId !== 'netsuite') {
    return { files: {}, emitted: [], errors: [] };
  }

  const parsed = parseStructuredAnswer(input.structuredAnswer);
  if (!parsed.ok) {
    return { files: {}, emitted: [], errors: [parsed.error] };
  }

  const files: Record<string, string> = {};
  const emitted: StructuredEmittedRole[] = [];
  const errors: StructuredRolesValidationError[] = [];
  const seenSlugs = new Set<string>();

  for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex++) {
    const result = validateRow(rowIndex, parsed.rows[rowIndex]);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    const role = result.role;

    // Compose the effective spec: start from the keyword classifier,
    // then apply overrides, then run customizationNotes overlay.
    const starter = classifyRole(role.name);
    const center = role.centerOverride ?? starter.center;
    const startingPermissions = role.permissionOverrides ?? starter.permissions;
    const defaultRestriction = role.restrictionOverride ?? starter.defaultRestriction;

    // applyOverlay's signature takes RoleStarterSpec — synthesise one
    // from the post-override values so the overlay's read-only /
    // group-wide / remove-approve regexes operate on the consultant's
    // effective starter set, not the keyword-classifier defaults.
    const overlaySpec = {
      center,
      permissions: startingPermissions,
      defaultRestriction,
    };
    const overlay = applyOverlay(overlaySpec, role.customizationNotes);

    // Compose provenance trail.
    const appliedOverlays: string[] = [];
    if (role.centerOverride !== null) {
      appliedOverlays.push(`center override: ${role.centerOverride} (classifier suggested ${starter.center})`);
    }
    if (role.permissionOverrides !== null) {
      appliedOverlays.push(
        `permissions override: ${role.permissionOverrides.length} explicit perm(s) supersede classifier's ${starter.permissions.length}-perm starter`,
      );
    }
    if (role.restrictionOverride !== null) {
      appliedOverlays.push(
        `restriction override: ${role.restrictionOverride} (classifier defaulted to ${starter.defaultRestriction})`,
      );
    }
    appliedOverlays.push(...overlay.appliedOverlays);

    // Slug + scriptid + dedup. Editor enforces uniqueness, but be
    // defensive — if a duplicate slips through (API mutation /
    // case-collision), flag and skip rather than silently overwrite.
    const slug = slugify(role.name);
    const scriptid = `customrole_nsix_${slug}`;
    if (seenSlugs.has(scriptid)) {
      errors.push({
        rowIndex,
        field: 'name',
        message: `duplicate scriptid "${scriptid}" derived from name "${role.name}" — names must be unique after slugify`,
      });
      continue;
    }
    seenSlugs.add(scriptid);

    const filename = `Objects/${scriptid}.xml`;
    const xml = buildRoleXml({
      scriptid,
      roleName: role.name,
      center,
      restriction: overlay.restriction,
      permissions: overlay.permissions,
      rawLine: `[structured row ${rowIndex}] ${role.name}: ${role.customizationNotes}`,
      appliedOverlays,
    });

    files[filename] = xml;
    emitted.push({
      filename,
      scriptid,
      roleName: role.name,
      center,
      permissions: overlay.permissions,
      restrictionbysubsidiary: overlay.restriction,
      appliedOverlays,
    });
  }

  return { files, emitted, errors };
}
