/**
 * Phase 46.4 — SOW (Statement of Work) generator.
 *
 * Produces a single comprehensive PDF representing the legal contract
 * between the firm and the client. The Proposal (Phase 46.3) is the
 * sales artifact; the SOW is the e-signable artifact.
 *
 * Two exports:
 *
 *   - buildSowMarkdown(input)        — pure function returning the
 *                                       canonical text content of the
 *                                       SOW. Useful for tests + for
 *                                       any non-PDF surface (web
 *                                       preview, email body).
 *   - generateSowPdf(input)          — async; renders the SOW into a
 *                                       Buffer using pdfkit. Pulled
 *                                       in lazily to keep the cold
 *                                       start of unrelated jobs fast.
 *
 * Versioning: the route layer stamps a version number on each
 * regeneration. The generator just renders the input it's given.
 */

export interface SowInput {
  // Engagement context
  clientName: string;
  clientLegalEntity?: string | null;
  adaptorId: string;
  adaptorName: string;

  // Firm context
  firmName: string;
  firmLegalEntity?: string | null;
  firmAddress?: string | null;
  firmContactEmail?: string | null;

  // Pulled from Discovery Lite + Proposal pricing.
  modulesOfInterest: ReadonlyArray<{ id: string; label: string }>;
  estimatedUsers: number;
  estimatedLocations: number;
  geographyMultiEntity: 'single' | 'single-country-multi-entity' | 'multi-country';

  // Pricing (from computeProposalPricing — see Phase 46.3).
  totalAnnualLicense: number;
  implementationServices: number;
  totalFirstYear: number;
  pricingPhases: ReadonlyArray<{ label: string; amount: number }>;
  validUntil: string;

  // SOW-specific fields
  effectiveDate: string;     // ISO date — when the engagement starts
  estimatedDurationDays: number; // Used to compute contract end
  /** Auto-incremented per regeneration. The route layer manages this. */
  version: number;
  /** When set, the document footer shows "Supersedes v{N}" so the
   *  signer knows they're looking at a newer rev. */
  supersedesVersion?: number | null;
  preparedAt: string;
  preparedByName?: string | null;
}

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure helper — produces the canonical SOW text. The pdfkit renderer
 * walks this same structure so a future plain-text or HTML surface
 * can render without re-implementing the document.
 */
export function buildSowSections(input: SowInput): ReadonlyArray<{ heading: string; body: string }> {
  const contractEnd = addDaysIso(input.effectiveDate, input.estimatedDurationDays);
  const clientEntity = input.clientLegalEntity?.trim() || input.clientName;
  const firmEntity = input.firmLegalEntity?.trim() || input.firmName;

  const sections: Array<{ heading: string; body: string }> = [];

  sections.push({
    heading: '1. Parties',
    body:
      `This Statement of Work ("SOW"), dated ${input.preparedAt}, is entered into by ` +
      `and between ${firmEntity} ("Provider") and ${clientEntity} ("Client").`,
  });

  sections.push({
    heading: '2. Recitals',
    body:
      `Provider is engaged in the business of implementing ${input.adaptorName} ` +
      `enterprise resource planning systems. Client wishes to engage Provider to ` +
      `implement ${input.adaptorName} for its operations covering ` +
      `${input.estimatedLocations} location${input.estimatedLocations === 1 ? '' : 's'} ` +
      `and approximately ${input.estimatedUsers} user${input.estimatedUsers === 1 ? '' : 's'}, ` +
      `under the terms and conditions set forth herein.`,
  });

  sections.push({
    heading: '3. Scope of Work',
    body:
      `Provider will deliver an implementation of ${input.adaptorName} covering the following modules:\n\n` +
      input.modulesOfInterest.map((m) => `  • ${m.label}`).join('\n'),
  });

  sections.push({
    heading: '4. Deliverables',
    body:
      `The deliverables for this engagement include:\n\n` +
      `  • Configured ${input.adaptorName} environment matching the agreed module list\n` +
      `  • Data migration from Client's existing systems for in-scope objects\n` +
      `  • Integration scaffolding for the systems identified during Discovery\n` +
      `  • Role + permission matrix for all in-scope users\n` +
      `  • Training documentation and end-user training sessions\n` +
      `  • A 30-day Hypercare window post go-live before SLA handover`,
  });

  sections.push({
    heading: '5. Timeline',
    body:
      `Effective Date: ${input.effectiveDate}\n` +
      `Estimated Contract End: ${contractEnd} (${input.estimatedDurationDays} days)\n\n` +
      `The implementation is delivered in the following phases:\n` +
      `  • Discovery — finalise scope, build the project plan\n` +
      `  • Configure — system build-out, data migration, integration scaffolding\n` +
      `  • UAT — user acceptance testing, training, defect triage\n` +
      `  • Go-Live — cutover orchestration, hypercare standby\n` +
      `  • Hypercare — 30-day stabilisation window before SLA handover`,
  });

  sections.push({
    heading: '6. Pricing Schedule',
    body:
      `Annual licence fees: ${dollars(input.totalAnnualLicense)}\n` +
      `Implementation services: ${dollars(input.implementationServices)}\n` +
      `Total first-year investment: ${dollars(input.totalFirstYear)}\n\n` +
      `Implementation services are delivered and invoiced in phases:\n\n` +
      input.pricingPhases.map((p) => `  • ${p.label}: ${dollars(p.amount)}`).join('\n'),
  });

  sections.push({
    heading: '7. Payment Terms',
    body:
      `  • 50% on phase kickoff (Discovery)\n` +
      `  • 25% on UAT entry\n` +
      `  • 25% on go-live\n` +
      `  • Annual licence invoice issued on go-live date\n\n` +
      `Invoices are due net-30 from issue date. Late payments accrue ` +
      `interest at 1.5% per month or the maximum allowed by law, ` +
      `whichever is lower.`,
  });

  sections.push({
    heading: '8. Acceptance Criteria',
    body:
      `Each deliverable is deemed accepted when (a) Client confirms in ` +
      `writing or (b) seven (7) calendar days have passed without ` +
      `written rejection citing specific defects against the deliverable's ` +
      `acceptance criteria as documented in the project plan.`,
  });

  sections.push({
    heading: '9. Change Order Process',
    body:
      `Any work outside the Scope of Work in Section 3 requires a ` +
      `written Change Order signed by both parties. Change Orders ` +
      `state the additional scope, impact on timeline, and additional ` +
      `fees. Verbal change requests are treated as informational only.`,
  });

  sections.push({
    heading: '10. Term & Termination',
    body:
      `This SOW is effective from the Effective Date and continues ` +
      `until the deliverables in Section 4 are accepted or the ` +
      `parties terminate in writing. Either party may terminate with ` +
      `thirty (30) days written notice. Work completed prior to ` +
      `termination is invoiced pro-rata.`,
  });

  sections.push({
    heading: '11. Confidentiality',
    body:
      `Each party agrees to treat the other's non-public information ` +
      `as confidential and not to disclose it to any third party ` +
      `without prior written consent, except as required by law.`,
  });

  sections.push({
    heading: '12. Limitation of Liability',
    body:
      `Each party's aggregate liability under this SOW is capped at ` +
      `the fees paid by Client to Provider in the twelve (12) months ` +
      `preceding the event giving rise to the claim. Neither party ` +
      `is liable for indirect, consequential, or punitive damages.`,
  });

  sections.push({
    heading: '13. Dispute Resolution',
    body:
      `The parties will first attempt to resolve disputes through ` +
      `good-faith negotiation. If a dispute cannot be resolved within ` +
      `thirty (30) days, the parties may proceed to mediation or ` +
      `binding arbitration as agreed in writing at the time.`,
  });

  sections.push({
    heading: '14. Entire Agreement',
    body:
      `This SOW, together with any signed Change Orders, constitutes ` +
      `the entire agreement between the parties with respect to the ` +
      `subject matter and supersedes all prior negotiations, ` +
      `proposals, and understandings, whether oral or written.` +
      (input.supersedesVersion
        ? ` This SOW supersedes version ${input.supersedesVersion}.`
        : ''),
  });

  return sections;
}

/**
 * Render the SOW into a PDF buffer. Lazy-imports pdfkit so unrelated
 * generators don't pay the pdfkit-load cost on every job.
 */
export async function generateSowPdf(input: SowInput): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const sections = buildSowSections(input);

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      doc.fontSize(20).font('Helvetica-Bold').text('STATEMENT OF WORK');
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica').fillColor('#444');
      doc.text(`${input.firmName}  ↔  ${input.clientName}`);
      doc.text(`Version ${input.version} · Prepared ${input.preparedAt}`);
      if (input.supersedesVersion) {
        doc.fillColor('#a00').text(`Supersedes version ${input.supersedesVersion}`);
        doc.fillColor('#444');
      }
      doc.moveDown(1);
      doc.strokeColor('#888').moveTo(60, doc.y).lineTo(552, doc.y).stroke();
      doc.moveDown(1);

      // Sections
      for (const s of sections) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#111').text(s.heading);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').fillColor('#222').text(s.body, { lineGap: 2 });
        doc.moveDown(0.8);
      }

      // Signature blocks
      doc.addPage();
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#111').text('Signatures');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#222');
      doc.text('By signing below, each party acknowledges they have read, understood, ' +
              'and agree to the terms of this Statement of Work.');
      doc.moveDown(2);

      // Two side-by-side signature blocks.
      const blockY = doc.y;
      const signatureBlock = (label: string, x: number, y: number) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text(label, x, y);
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica').fillColor('#444');
        doc.text('Signature: ____________________________________________', x, doc.y);
        doc.moveDown(1.5);
        doc.text('Name: ____________________________________________', x, doc.y);
        doc.moveDown(1.5);
        doc.text('Title: ____________________________________________', x, doc.y);
        doc.moveDown(1.5);
        doc.text('Date: ____________________________________________', x, doc.y);
      };

      signatureBlock('PROVIDER', 60, blockY);
      const providerEndY = doc.y;
      signatureBlock('CLIENT', 320, blockY);
      const clientEndY = doc.y;
      // Move past whichever block is longer.
      doc.y = Math.max(providerEndY, clientEndY) + 24;

      // Footer
      doc.fontSize(8).fillColor('#888').font('Helvetica');
      doc.text(
        `${input.firmName} · ${input.preparedByName ?? 'Sales'} · ${input.preparedAt}`,
        60,
        doc.page.height - 50,
        { align: 'center', width: doc.page.width - 120 },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
