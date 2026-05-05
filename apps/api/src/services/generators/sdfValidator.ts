/**
 * SDF structural validator (Phase 8).
 *
 * Why not a real XSD validator? Oracle doesn't publish a stable public XSD
 * set we can redistribute. A 200-line structural validator covers every
 * rule class Fixes #1–#6 touched (root element, required children,
 * forbidden children, enum-valued elements) with zero new dependencies and
 * can be swapped for real XSDs later behind the same validate() seam.
 *
 * Scope:
 *   - manifest.xml           → Fix #3 + general manifest shape
 *   - deploy.xml             → post-Fix-#3 shape (files + objects paths)
 *   - Objects/customrecord_*.xml        → Fix #1
 *   - Objects/custbody_*.xml            → Fix #2 (transaction body field)
 *   - Objects/custentity_*.xml          → entity field
 *   - Objects/customlist_*.xml          → Fix #4 (must have customvalues)
 *   - Objects/cseg_*.xml                → Fix #5 forbids this file entirely
 *
 * Each rule returns {ok, errors[]}; aggregated at the top via
 * validateSDFBundle(). Errors carry the file path + rule id + human-readable
 * message so the generator can fail loudly with actionable detail.
 */

export interface ValidationError {
  file: string;
  rule: string;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasRoot(xml: string, rootTag: string): boolean {
  // Matches <rootTag ...> anywhere — attributes optional. We don't need a
  // DOM to spot the root; the structural rules are narrow.
  const re = new RegExp(`<${rootTag}(\\s|>)`);
  return re.test(xml);
}

function hasChild(xml: string, childTag: string): boolean {
  const re = new RegExp(`<${childTag}(\\s|>)`);
  return re.test(xml);
}

function isRelativePath(pathValue: string): boolean {
  // SDF paths start with ~/ (ACP / SuiteApp root) — anything else is invalid.
  return pathValue.startsWith('~/');
}

// ─── Per-file rules ──────────────────────────────────────────────────────────

function validateManifest(file: string, xml: string): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!hasRoot(xml, 'manifest')) {
    errs.push({ file, rule: 'manifest.root', detail: 'manifest.xml must have <manifest> as its root element' });
    return errs;
  }
  // projecttype must be present as an attribute and be a known value.
  const pt = xml.match(/<manifest[^>]*\sprojecttype="([^"]+)"/);
  if (!pt) {
    errs.push({ file, rule: 'manifest.projecttype', detail: '<manifest> must declare a projecttype attribute' });
  } else if (!['ACCOUNTCUSTOMIZATION', 'SUITEAPP'].includes(pt[1])) {
    errs.push({ file, rule: 'manifest.projecttype.value', detail: `projecttype must be ACCOUNTCUSTOMIZATION or SUITEAPP, got "${pt[1]}"` });
  }
  if (!hasChild(xml, 'projectname')) {
    errs.push({ file, rule: 'manifest.projectname', detail: '<manifest> must contain <projectname>' });
  }
  if (!hasChild(xml, 'frameworkversion')) {
    errs.push({ file, rule: 'manifest.frameworkversion', detail: '<manifest> must contain <frameworkversion>' });
  }
  // Features block — Fix #3 post-change shape: inside <dependencies><features>,
  // each <feature required="true|false">ID</feature>.
  if (hasChild(xml, 'features')) {
    const featureTags = xml.match(/<feature\b[^>]*>/g) ?? [];
    for (const tag of featureTags) {
      if (!/\srequired="(true|false)"/.test(tag)) {
        errs.push({ file, rule: 'manifest.feature.required', detail: `<feature> must carry a required="true|false" attribute (got: ${tag})` });
      }
    }
  }
  return errs;
}

function validateDeploy(file: string, xml: string): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!hasRoot(xml, 'deploy')) {
    errs.push({ file, rule: 'deploy.root', detail: 'deploy.xml must have <deploy> as its root element' });
    return errs;
  }
  // Every <path> value under deploy must be a ~/... relative path.
  const pathValues = Array.from(xml.matchAll(/<path>([^<]+)<\/path>/g)).map((m) => m[1].trim());
  for (const p of pathValues) {
    if (!isRelativePath(p)) {
      errs.push({ file, rule: 'deploy.path.relative', detail: `deploy <path> must start with ~/ (got: ${p})` });
    }
  }
  // Pack C history: the legacy Fix #3 rule blocked AccountConfiguration
  // paths in deploy.xml because the OLD features.xml file emitted by
  // the heavy generator had the wrong shape (<feature id="X">T</feature>
  // instead of the valid <feature label="..."><id>X</id><status>ENABLED
  // </status></feature> form). Pack C ships VALID AccountConfiguration
  // content (companyinformation / accountingpreferences /
  // generalpreferences — distinct from the rejected features.xml), so
  // the AccountConfiguration path is now allowed in deploy.xml. The
  // narrower invariant — features.xml MUST NOT appear under
  // AccountConfiguration — is captured by validateAccountConfigFeaturesXml
  // (no current call site emits features.xml; the rule is forward-looking).
  return errs;
}

function validateCustomRecordType(file: string, xml: string): ValidationError[] {
  const errs: ValidationError[] = [];
  // Fix #1: root must be <customrecordtype>, NOT the legacy <customrecord>.
  if (hasRoot(xml, 'customrecord ') || (hasRoot(xml, 'customrecord') && !hasRoot(xml, 'customrecordtype'))) {
    errs.push({ file, rule: 'customrecordtype.root', detail: 'root must be <customrecordtype>, not <customrecord>' });
  }
  if (!hasRoot(xml, 'customrecordtype')) {
    errs.push({ file, rule: 'customrecordtype.root', detail: 'missing required <customrecordtype> root element' });
  }
  // Required children.
  if (!hasChild(xml, 'recordname')) {
    errs.push({ file, rule: 'customrecordtype.recordname', detail: '<customrecordtype> must contain <recordname>' });
  }
  if (!hasChild(xml, 'customrecordcustomfields')) {
    errs.push({ file, rule: 'customrecordtype.customrecordcustomfields', detail: '<customrecordtype> must contain <customrecordcustomfields> (empty container is valid)' });
  }
  // Forbidden children (Fix #1 dropped these).
  for (const banned of ['description', 'isordered']) {
    if (hasChild(xml, banned)) {
      errs.push({ file, rule: `customrecordtype.no-${banned}`, detail: `<customrecordtype> must not contain <${banned}>` });
    }
  }
  return errs;
}

function validateTransactionBodyCustomField(file: string, xml: string): ValidationError[] {
  const errs: ValidationError[] = [];
  // Fix #2: root must be <transactionbodycustomfield>, NOT <othercustomfield>.
  if (hasRoot(xml, 'othercustomfield')) {
    errs.push({ file, rule: 'custbody.root', detail: 'custbody_* files must use <transactionbodycustomfield>, not <othercustomfield>' });
  }
  if (!hasRoot(xml, 'transactionbodycustomfield')) {
    errs.push({ file, rule: 'custbody.root', detail: 'missing required <transactionbodycustomfield> root element' });
  }
  // Required children.
  if (!hasChild(xml, 'label')) {
    errs.push({ file, rule: 'custbody.label', detail: '<transactionbodycustomfield> must contain <label>' });
  }
  if (!hasChild(xml, 'fieldtype')) {
    errs.push({ file, rule: 'custbody.fieldtype', detail: '<transactionbodycustomfield> must contain <fieldtype>' });
  }
  // fieldtype must be a known enum value. (Narrow list — we only emit a
  // few types from the wizard today; extend if new ones arrive.)
  const validFieldTypes = ['CHECKBOX', 'CURRENCY', 'DATE', 'DATETIME', 'DECIMAL',
    'EMAIL', 'FREEFORMTEXT', 'HELP', 'INLINEHTML', 'INTEGER', 'LONGTEXT',
    'MULTISELECT', 'PASSWORD', 'PERCENT', 'PHONE', 'RICHTEXT', 'SELECT',
    'TEXTAREA', 'TIMEOFDAY', 'URL'];
  const ftMatch = xml.match(/<fieldtype>([^<]+)<\/fieldtype>/);
  if (ftMatch && !validFieldTypes.includes(ftMatch[1].trim())) {
    errs.push({ file, rule: 'custbody.fieldtype.value', detail: `<fieldtype> must be a known enum value (got: ${ftMatch[1]})` });
  }
  // SELECT / MULTISELECT require selectrecordtype.
  if (ftMatch && ['SELECT', 'MULTISELECT'].includes(ftMatch[1].trim()) && !hasChild(xml, 'selectrecordtype')) {
    errs.push({ file, rule: 'custbody.selectrecordtype', detail: `fieldtype=${ftMatch[1]} requires <selectrecordtype>` });
  }
  return errs;
}

function validateEntityCustomField(file: string, xml: string): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!hasRoot(xml, 'entitycustomfield')) {
    errs.push({ file, rule: 'custentity.root', detail: 'custentity_* files must have <entitycustomfield> root' });
  }
  if (!hasChild(xml, 'label')) {
    errs.push({ file, rule: 'custentity.label', detail: '<entitycustomfield> must contain <label>' });
  }
  if (!hasChild(xml, 'fieldtype')) {
    errs.push({ file, rule: 'custentity.fieldtype', detail: '<entitycustomfield> must contain <fieldtype>' });
  }
  return errs;
}

function validateCustomList(file: string, xml: string): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!hasRoot(xml, 'customlist')) {
    errs.push({ file, rule: 'customlist.root', detail: 'customlist_* files must have <customlist> root' });
    return errs;
  }
  // Fix #4: label required (was <name>).
  if (!hasChild(xml, 'label')) {
    errs.push({ file, rule: 'customlist.label', detail: '<customlist> must contain <label>' });
  }
  if (hasChild(xml, 'name')) {
    errs.push({ file, rule: 'customlist.no-name', detail: '<customlist> must not use <name> (use <label>)' });
  }
  // Fix #4: must have at least one <customvalue> under <customvalues>.
  if (!hasChild(xml, 'customvalue')) {
    errs.push({ file, rule: 'customlist.customvalues', detail: '<customlist> must contain at least one <customvalue> — empty lists fail deploy' });
  }
  return errs;
}

function validateForbiddenSegment(file: string): ValidationError[] {
  // Fix #5: cseg_*.xml should NEVER land on disk.
  return [{ file, rule: 'customsegment.forbidden', detail: 'cseg_*.xml files must not be emitted — segments should surface via pendingSegments' }];
}

// ─── Top-level ───────────────────────────────────────────────────────────────

/** Dispatch a single file to its applicable rule set. Files that don't
 *  match any known pattern are left uninspected — validator doesn't flag
 *  things it doesn't understand so adding new file types later is additive. */
export function validateSDFFile(path: string, xml: string): ValidationError[] {
  const base = path.split('/').pop() ?? path;
  if (base === 'manifest.xml') return validateManifest(path, xml);
  if (base === 'deploy.xml') return validateDeploy(path, xml);
  if (base.startsWith('customrecord_') && base.endsWith('.xml')) return validateCustomRecordType(path, xml);
  if (base.startsWith('custbody_') && base.endsWith('.xml')) return validateTransactionBodyCustomField(path, xml);
  if (base.startsWith('custentity_') && base.endsWith('.xml')) return validateEntityCustomField(path, xml);
  if (base.startsWith('customlist_') && base.endsWith('.xml')) return validateCustomList(path, xml);
  if (base.startsWith('cseg_') && base.endsWith('.xml')) return validateForbiddenSegment(path);
  return [];
}

/** Validate every file in an SDF bundle. The `files` map is the shape
 *  emitted by generateSDFPackage().files. Returns aggregated {ok, errors}. */
export function validateSDFBundle(files: Record<string, string>): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [path, body] of Object.entries(files)) {
    // Only XML files are structurally validated; placeholder / binary
    // files (e.g. .gitkeep under FileCabinet/) pass through.
    if (!path.endsWith('.xml')) continue;
    errors.push(...validateSDFFile(path, body));
  }
  return { ok: errors.length === 0, errors };
}

/** True when the SDF_VALIDATE env var is not set to "0". Default on.
 *  Exported so the generation pipeline + tests can share the same read. */
export function isValidationEnabled(): boolean {
  return process.env.SDF_VALIDATE !== '0';
}
