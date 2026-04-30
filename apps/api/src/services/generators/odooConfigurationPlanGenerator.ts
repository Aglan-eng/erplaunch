import MarkdownIt from 'markdown-it';
import type { AdaptorContext } from './brdGenerator.js';

const md = new MarkdownIt({ html: true, typographer: true });

/**
 * Configuration Plan — the non-NetSuite build artefact.
 *
 * Replaces the NetSuite-only SDF + SuiteScript bundle for Odoo (and any
 * future or firm-authored adaptor). Lists the concrete steps an Odoo
 * consultant takes after Discovery sign-off:
 *
 *   1. Module install plan (license modules + l10n_<country>)
 *   2. Studio export reminder (when Studio is in scope)
 *   3. Fiscal year setup (MM-DD from wizard answers)
 *   4. Multi-company setup checklist (when multiCompany answer is true)
 *
 * Mirrors the shape of every other generator in this directory:
 *   - generateOdooConfigurationPlan(...): markdown
 *   - generateOdooConfigurationPlanHtml(...): styled HTML wrapper
 *
 * Orchestrator (services/generation.ts) calls this only when
 * adaptorId !== 'netsuite'. The "Odoo" name in this file's identifier
 * is shorthand — the generator works for any non-NetSuite adaptor that
 * carries the same Odoo-shaped answer namespace.
 */
export interface OdooConfigurationPlanData {
  clientName: string;
  /** Adaptor context — required so prose flexes per platform. The
   *  module list and answer keys are Odoo-shaped, but the title /
   *  byline / footer pick up the adaptor name (Odoo, or a custom:*
   *  adaptor's manifest.name). */
  adaptor: AdaptorContext;
  license: { edition: string; modules: string[] };
  answers: Record<string, unknown>;
  comments?: unknown[];
  images?: unknown[];
  aiAdvice?: unknown[];
}

/**
 * Currency → Odoo l10n_<country> module mapping. Covers the markets
 * we've seen in the seed data plus the most common Odoo localizations
 * the consultant is likely to start from. EUR is multi-country (DE/FR
 * /NL/etc.) so we map it to the generic chart-of-accounts module — the
 * consultant picks the country-specific one before deploy.
 */
const CURRENCY_TO_L10N: Record<string, string> = {
  AED: 'l10n_ae',
  USD: 'l10n_us',
  CAD: 'l10n_ca',
  GBP: 'l10n_uk',
  EUR: 'l10n_generic_coa',
  EGP: 'l10n_eg',
  SAR: 'l10n_sa',
  KWD: 'l10n_kw',
  QAR: 'l10n_qa',
  BHD: 'l10n_bh',
  OMR: 'l10n_om',
  JOD: 'l10n_jo',
  TRY: 'l10n_tr',
  INR: 'l10n_in',
  AUD: 'l10n_au',
  CHF: 'l10n_ch',
};

function resolveLocalizationModule(currency: string | undefined): string | null {
  if (!currency) return null;
  return CURRENCY_TO_L10N[currency.toUpperCase()] ?? null;
}

export function generateOdooConfigurationPlan(data: OdooConfigurationPlanData): string {
  const { clientName, adaptor, license, answers } = data;
  const now = new Date().toLocaleDateString();

  const currency = answers['odoo.company.currency'] as string | undefined;
  const fiscalYearStart = answers['odoo.company.fiscalYearStart'] as string | undefined;
  const multiCompany = answers['odoo.company.multiCompany'] === true;
  const studioInScope = license.modules.some((m) => /STUDIO/i.test(m));
  const l10nModule = resolveLocalizationModule(currency);

  let doc = `# ${adaptor.name} Configuration Plan\n\n`;
  doc += `**Client:** ${clientName}  \n**Date:** ${now}  \n**Prepared by:** ERPLaunch\n\n`;
  doc += `---\n\n`;

  // ── Introduction ──
  doc += `## 1. Introduction\n\n`;
  doc += `This Configuration Plan is the build-phase hand-off for the ${adaptor.name} implementation at **${clientName}**. `;
  doc += `It enumerates the modules to install, the localisation package to apply, fiscal-year and multi-company setup, and any platform-specific export steps the consultant must run before promoting configuration to higher environments.\n\n`;
  doc += `Use this document alongside the Solution Design Document and Implementation Plan — together they form the full discovery → build hand-off package.\n\n`;
  doc += `---\n\n`;

  // ── Module Install Plan ──
  doc += `## 2. Module Install Plan\n\n`;
  doc += `Install the following modules in order. The localisation package is listed first because it seeds the chart of accounts and tax rules every other module depends on.\n\n`;
  doc += `| Order | Module | Notes |\n| :--- | :--- | :--- |\n`;
  let order = 1;
  if (l10nModule) {
    const tag = currency ? ` (${currency.toUpperCase()})` : '';
    doc += `| ${order++} | \`${l10nModule}\` | Localisation package${tag} — chart of accounts, taxes, fiscal positions. Install before any other module. |\n`;
  } else {
    doc += `| ${order++} | _Localisation package — TBD_ | Pick the country-specific \`l10n_<country>\` module that matches the client's primary jurisdiction. The wizard didn't capture currency so this hasn't been auto-resolved. |\n`;
  }
  for (const mod of license.modules) {
    doc += `| ${order++} | \`${mod}\` | Provisioned in license. |\n`;
  }
  doc += `\n`;

  // ── Studio export reminder (only when Studio is in scope) ──
  if (studioInScope) {
    doc += `### 2.1 Studio Customisations — Export to XML\n\n`;
    doc += `**Studio is in scope.** Customisations made via Studio (custom fields, views, automations) live in the database by default and don't promote across environments unless they're exported as XML data files.\n\n`;
    doc += `For every Studio change the consultant makes during build:\n\n`;
    doc += `1. Build the customisation in the lowest-tier environment (sandbox / dev).\n`;
    doc += `2. From the Studio panel, click **Export** → **XML**.\n`;
    doc += `3. Save the resulting \`*.xml\` data files into your version-controlled deploy package alongside the rest of the configuration.\n`;
    doc += `4. Promote via your standard CI/CD or by importing the XML into the next-tier environment.\n\n`;
    doc += `Without this discipline, every Studio change is a one-environment-only change and will be lost on Enterprise upgrade or fresh-environment provisioning.\n\n`;
  }
  doc += `---\n\n`;

  // ── Fiscal Year ──
  doc += `## 3. Fiscal Year Setup\n\n`;
  if (fiscalYearStart) {
    doc += `Configure the company's fiscal year start to **${fiscalYearStart}** (MM-DD). `;
    doc += `Path: **Accounting → Configuration → Settings → Fiscal Year**. Apply to every company under this engagement.\n\n`;
  } else {
    doc += `_Fiscal year start not yet configured in the wizard._ The consultant should capture this with the client before configuration begins; it drives every accounting period and the timing of year-end closing reports.\n\n`;
  }
  doc += `---\n\n`;

  // ── Multi-Company ──
  if (multiCompany) {
    doc += `## 4. Multi-Company Setup\n\n`;
    doc += `Multi-company is enabled for this engagement. Follow the checklist below to provision each legal entity correctly:\n\n`;
    doc += `1. **Create one company per legal entity** — Settings → Users & Companies → Companies → Create. Don't share a single company across two legal entities (audit trail breaks).\n`;
    doc += `2. **Set the currency per company** — each company's default currency lives on its own record. Do this before booking any transactions.\n`;
    doc += `3. **Configure intercompany rules** — Accounting → Configuration → Intercompany Transactions. Decide synchronous (auto-mirror invoices/POs) vs manual; document the choice in the SDD.\n`;
    doc += `4. **Set per-company chart-of-accounts strategy** — share the same CoA across companies (consolidation-friendly) or fork per company (jurisdiction-specific). Match the client's existing accounting convention.\n`;
    doc += `5. **Per-user company access** — multi-company access lives on the user record. Confirm with the client which users need access to which companies before go-live.\n`;
    doc += `6. **Test consolidation reporting** — run the Consolidated P&L and Balance Sheet against test data before signing off the multi-company configuration.\n\n`;
    doc += `---\n\n`;
  }

  // ── Sign-off ──
  doc += `## ${multiCompany ? '5' : '4'}. Sign-off\n\n`;
  doc += `By signing below, the parties confirm that this Configuration Plan accurately reflects the agreed build-phase scope:\n\n`;
  doc += `| Role | Name | Signature | Date |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| Client Project Sponsor | | | |\n`;
  doc += `| Implementation Lead (ERPLaunch) | | | |\n`;
  doc += `| ${adaptor.name} Functional Lead | | | |\n`;
  doc += `| ${adaptor.name} Technical Lead | | | |\n\n`;

  return doc;
}

export function generateOdooConfigurationPlanHtml(data: OdooConfigurationPlanData): string {
  const content = md.render(generateOdooConfigurationPlan(data));
  const adaptorName = data.adaptor.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${adaptorName} Configuration Plan — ${data.clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 900px; margin: 40px auto; padding: 0 24px 80px; }
    .header { background: linear-gradient(135deg, #064e3b 0%, #0f766e 60%, #0891b2 100%); color: white; padding: 48px 48px 36px; border-radius: 20px; margin-bottom: 40px; }
    .header-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; opacity: 0.65; text-transform: uppercase; margin-bottom: 12px; }
    .header h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .sub { opacity: 0.8; font-size: 15px; }
    h2 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 44px 0 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 15px; font-weight: 700; color: #0f766e; margin: 28px 0 12px; }
    h4 { font-size: 13px; font-weight: 600; color: #475569; margin: 20px 0 8px; }
    p { color: #475569; line-height: 1.75; margin-bottom: 14px; font-size: 14px; }
    blockquote { background: #ecfeff; border-left: 4px solid #06b6d4; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; font-size: 14px; color: #155e75; }
    ul, ol { padding-left: 24px; margin-bottom: 14px; }
    li { color: #475569; line-height: 1.75; font-size: 14px; margin-bottom: 4px; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 40px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 24px; }
    thead { background: #064e3b; color: white; }
    thead th { padding: 11px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:hover { background: #fafbfc; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 600; color: #0f172a; }
    code { font-family: 'JetBrains Mono', 'Fira Code', monospace; background: #f1f5f9; color: #0f766e; padding: 1px 6px; border-radius: 4px; font-size: 0.875em; }
    strong { color: #0f172a; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-badge">${adaptorName} Implementation</div>
      <h1>Configuration Plan</h1>
      <div class="sub">${data.clientName}</div>
    </div>
    ${content}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()} — Confidential</div>
  </div>
</body>
</html>`;
}
