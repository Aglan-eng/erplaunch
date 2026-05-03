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
 * scripts under ~/FileCabinet/SuiteScripts/*, objects under
 * ~/Objects/*, and account-config files under
 * ~/AccountConfiguration/* (Pack C).
 *
 * Pack C history note: pre-Pack-C the validator rejected
 * AccountConfiguration paths in deploy.xml because the original
 * features.xml file emitted by the heavy generateSDFPackage path had
 * the wrong shape (Fix #3). Pack C ships VALID accountconfig files
 * (companyinformation / accountingpreferences / generalpreferences)
 * so the path is back in. The validator's old rule was relaxed to
 * accept correctly-shaped accountconfig content — see sdfValidator.ts.
 *
 * No parameters needed today; if a future pack needs a different
 * layout (e.g. multiple FileCabinet subdirs or a Translations folder)
 * we can grow this signature.
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
  <configuration>
    <path>~/AccountConfiguration/*</path>
  </configuration>
</deploy>
`;
}
