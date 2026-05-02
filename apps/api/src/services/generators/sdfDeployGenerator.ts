/**
 * SDF Deploy generator — emits a minimal valid Oracle SuiteCloud
 * `deploy.xml` that tells SuiteCloud CLI which paths in the project
 * to push to NetSuite during `suitecloud project:deploy`.
 *
 * Why a separate module (vs. the existing sdfGenerator.ts)?
 *   - Same reason as sdfManifestGenerator.ts: the demo bundle driver
 *     and wizard-led packs need a slim deploy.xml at the SDF root
 *     without invoking the full feature-deriving sdfGenerator.ts. This
 *     generator emits the 4-line deploy file every ACP needs and
 *     nothing more.
 *   - Output passes the structural validator in sdfValidator.ts:
 *     <deploy> root, every <path> is ~/-prefixed (relative to the
 *     SDF project root), no AccountConfiguration paths (Fix #3
 *     dropped that block).
 *
 * Sources:
 *   - Oracle NetSuite SDF Deploy documentation:
 *     https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4724963992.html
 *   - sdfValidator.ts validateDeploy() rule set
 */

/**
 * Emit the deploy.xml body. Static content — the demo bundle ships
 * scripts under ~/FileCabinet/SuiteScripts/* and objects under
 * ~/Objects/*. No parameters needed today; if a future pack needs a
 * different layout (e.g. multiple FileCabinet subdirs or a Translations
 * folder) we can grow this signature, but right now every ACP we ship
 * has the same two-path shape.
 */
export function generateSdfDeploy(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<deploy>
  <files>
    <path>~/FileCabinet/SuiteScripts/*</path>
  </files>
  <objects>
    <path>~/Objects/*</path>
  </objects>
</deploy>
`;
}
