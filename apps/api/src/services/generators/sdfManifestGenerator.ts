/**
 * SDF Manifest generator — emits a minimal valid Oracle SuiteCloud
 * `manifest.xml` for an Account Customization Project (ACP).
 *
 * Why a separate module (vs. the existing sdfGenerator.ts)?
 *   - sdfGenerator.ts derives a feature set from license modules + a
 *     dozen business-profile answer keys (multi-currency, multi-entity,
 *     segmentation flags, etc.) and emits a fat manifest geared at the
 *     full mapping-driven SDF package. The demo bundle driver and the
 *     wizard-led pack pipeline don't run that generator — they emit a
 *     focused "Objects/customrecord_*.xml" subset via
 *     sdfCustomRecordsGenerator.ts. Those subset bundles still need a
 *     manifest + deploy at the SDF root for SuiteCloud CLI to deploy
 *     them, but they don't need (and shouldn't carry) the inferred-
 *     feature complexity.
 *   - This generator is the lean counterpart: it always declares the
 *     two features any ACP needs to deploy customrecord types
 *     (CUSTOMRECORDS, SERVERSIDESCRIPTING) and lets caller pass through
 *     firm + client names for the projectname tag. Add features later
 *     if/when the demo bundle starts emitting workflows or scripts.
 *   - Output passes the structural validator in sdfValidator.ts:
 *     <manifest projecttype="ACCOUNTCUSTOMIZATION">, <projectname>,
 *     <frameworkversion>, every <feature required="..."/> tagged.
 *
 * Sources:
 *   - Oracle NetSuite SDF Manifest documentation:
 *     https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4724963992.html
 *   - sdfValidator.ts validateManifest() rule set
 */

export interface SdfManifestInput {
  /** Implementing firm name. Drives the <projectname> tag prefix.
   *  e.g. "NSIX" or "Ofoq". */
  firmName: string;
  /** Client (engagement) name. Drives the <projectname> tag suffix.
   *  e.g. "Atlas Manufacturing". */
  clientName: string;
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

/**
 * Emit the manifest.xml body. Hardcoded ACP shape with the two features
 * any custom-record-shipping bundle needs:
 *   - CUSTOMRECORDS — required to deploy customrecordtype objects
 *   - SERVERSIDESCRIPTING — required because future packs will start
 *     shipping User Event scripts attached to those record types; we
 *     declare it now so the manifest doesn't churn when scripts arrive.
 *
 * Both are marked required="true" — SuiteCloud will refuse to install
 * the bundle into accounts that don't have these features turned on,
 * which is the correct safety stance for an ACP.
 */
export function generateSdfManifest(input: SdfManifestInput): string {
  const projectName = xmlEscape(`${input.firmName} ${input.clientName}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>${projectName}</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="true">CUSTOMRECORDS</feature>
      <feature required="true">SERVERSIDESCRIPTING</feature>
    </features>
  </dependencies>
</manifest>
`;
}
