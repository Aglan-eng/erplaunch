import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { r2rQuestions, p2pQuestions, o2cQuestions, mfgQuestions, rtnQuestions } from '@ofoq/shared';
import type { Question } from '@ofoq/shared';
import { SectionIntroCard } from '../SectionIntroCard';
import { QuestionCard } from '../QuestionCard';
import { SectionSuggestionPanel } from '../SectionSuggestionPanel';
import { StepComments } from '../StepComments';
import { ImageUpload } from '../ImageUpload';
import { AIAdvisorPanel } from '../AIAdvisorPanel';
import { ApprovalChainEditor } from '../ApprovalChainEditor';

// Phase 24 — approval-boolean question id → structured chain editor wiring.
// When a boolean is rendered AND its current value is true, the editor
// drops in immediately below it. Mirrors the 5 entries in
// approvalChainHelpers.APPROVAL_FLOW_KEYS (kept as a small static map
// here to avoid pulling the api package into the web bundle).
const APPROVAL_EDITORS: Record<string, { structuredKey: string; flowLabel: string }> = {
  'p2p.purchasing.poApprovalRequired': {
    structuredKey: 'p2p.purchasing.approvalChainStructured',
    flowLabel: 'Purchase Order Approval',
  },
  'p2p.bills.billApprovalRequired': {
    structuredKey: 'p2p.bills.approvalChainStructured',
    flowLabel: 'Vendor Bill Approval',
  },
  'o2c.salesOrders.soApprovalRequired': {
    structuredKey: 'o2c.salesOrders.approvalChainStructured',
    flowLabel: 'Sales Order Approval',
  },
  'r2r.journalEntries.approvalRequired': {
    structuredKey: 'r2r.journalEntries.approvalChainStructured',
    flowLabel: 'Journal Entry Approval',
  },
  'p2p.expenses.expenseApproval': {
    structuredKey: 'p2p.expenses.approvalChainStructured',
    flowLabel: 'Expense Report Approval',
  },
};
import { useWizardProgress } from '@/hooks/useWizardProgress';
import { useWizardStore } from '@/stores/wizardStore';
import { engagementsApi } from '@/lib/api';
import { bridgeAdaptorSchema } from '../adaptorBridge';

// ── NetSuite legacy banks — fallback only ────────────────────────────────────
// Kept so an engagement can still render if the adaptor fetch fails (e.g.
// offline dev or old data). New platforms (Odoo, custom:*) always route
// through the bridged adaptor schema instead.
const NETSUITE_FALLBACK_QUESTIONS: Question[] = [
  ...r2rQuestions,
  ...p2pQuestions,
  ...o2cQuestions,
  ...mfgQuestions,
  ...rtnQuestions,
];

// ── Section metadata ──────────────────────────────────────────────────────────
const SECTION_META: Record<string, { title: string; description: string }> = {
  // R2R
  'r2r.entities':          { title: 'Entities',          description: 'Define the legal entity structure. This determines if OneWorld is required.' },
  'r2r.segmentation':      { title: 'Segmentation',      description: 'Configure reporting dimensions — departments, classes, and locations.' },
  'r2r.accountingPeriods': { title: 'Accounting Periods', description: 'Set the fiscal calendar, period locking behaviour, and adjustment period configuration.' },
  'r2r.currencies':        { title: 'Currencies',        description: 'Configure base currency and multi-currency requirements.' },
  'r2r.bankTransactions':  { title: 'Bank Transactions', description: 'Define bank accounts, reconciliation frequency, and opening balance requirements.' },
  'r2r.tax':               { title: 'Tax',               description: 'Configure tax regimes, VAT rates, and registration details.' },
  'r2r.journalEntries':    { title: 'Journal Entries',   description: 'Define manual journal entry requirements and approval workflows.' },
  'r2r.fiscalClose':       { title: 'Fiscal Close',      description: 'Configure period close procedures, checklist requirements, and automated locking.' },
  'r2r.reporting':         { title: 'Reporting',         description: 'Define standard and custom reporting needs and consolidation requirements.' },
  // P2P
  'p2p.vendors':    { title: 'Vendors',    description: 'Configure the vendor master, payment terms, withholding tax, and vendor approval controls.' },
  'p2p.purchasing': { title: 'Purchasing', description: 'Define purchase order workflow, approval thresholds, and budget commitment controls.' },
  'p2p.receiving':  { title: 'Receiving',  description: 'Configure goods receipt, 3-way matching, and vendor returns processing.' },
  'p2p.bills':      { title: 'Bills',      description: 'Define vendor bill entry, approval workflows, and recurring billing requirements.' },
  'p2p.payments':   { title: 'Payments',   description: 'Configure payment methods, payment run frequency, and bank file export requirements.' },
  'p2p.expenses':   { title: 'Expenses',   description: 'Set up employee expense reports, categories, corporate cards, and reimbursement policies.' },
  // O2C
  'o2c.customers':   { title: 'Customers',    description: 'Configure customer master, credit limits, payment terms, and customer onboarding controls.' },
  'o2c.pricing':     { title: 'Pricing',      description: 'Define price levels, quantity discounts, promotions, and multi-currency pricing.' },
  'o2c.salesOrders': { title: 'Sales Orders', description: 'Configure sales order workflow, approval thresholds, quotations, and backorder handling.' },
  'o2c.fulfillment': { title: 'Fulfillment',  description: 'Define warehouse operations, pick-pack-ship process, and multi-location inventory.' },
  'o2c.invoicing':   { title: 'Invoicing',    description: 'Configure invoice triggers, e-invoicing compliance, credit memos, and revenue recognition.' },
  'o2c.collections': { title: 'Collections',  description: 'Set up AR aging, dunning procedures, cash application, and bad debt provisioning.' },
  // MFG
  'mfg.productionFlow': { title: 'Production Flow', description: 'Define how products are built, tracking requirements for labor and machine time.' },
  'mfg.bom':            { title: 'BOM Management',  description: 'Configure Bill of Materials structure, revisions, and phantom assembly usage.' },
  'mfg.outsourced':     { title: 'Outsourced Mfg',  description: 'Set up external manufacturing processes and raw material transfers.' },
  'mfg.demand':         { title: 'Demand Planning', description: 'Configure forecasting, planning time fences, and automated work order suggestions.' },
  // RTN
  'rtn.customerReturns': { title: 'Customer Returns', description: 'Define RMA workflows, refund policies, and customer return authorization.' },
  'rtn.vendorReturns':   { title: 'Vendor Returns',   description: 'Configure the process for returning faulty materials or stock to suppliers.' },
  'rtn.processing':      { title: 'Return Processing', description: 'Set up quality inspection, restocking fees, and warehouse receipt flows.' },
};

interface FlowSectionStepProps {
  /** Full section key, e.g. "r2r.entities" or "p2p.vendors" */
  sectionKey: string;
  engagementId: string;
}

export function FlowSectionStep({ sectionKey, engagementId }: FlowSectionStepProps) {
  const answers = useWizardStore((s) => s.answers);
  const { sectionProgress } = useWizardProgress(answers);

  const adaptorQuery = useQuery({
    queryKey: ['engagement-adaptor', engagementId],
    queryFn: () => engagementsApi.getAdaptor(engagementId),
    enabled: !!engagementId,
    retry: false,
    staleTime: 60_000,
  });

  // Phase 3C: if the active adaptor exposes the requested flow.section,
  // render its questions. Otherwise fall back to the hard-coded NetSuite
  // banks so legacy NetSuite engagements keep working unchanged.
  const { questions, title, description } = useMemo(() => {
    const bridged = bridgeAdaptorSchema(adaptorQuery.data?.schema);
    const adaptorSection = bridged.get(sectionKey);
    if (adaptorSection && adaptorSection.questions.length > 0) {
      const meta = SECTION_META[sectionKey];
      return {
        questions: adaptorSection.questions,
        title: meta?.title ?? adaptorSection.sectionLabel,
        description: meta?.description ?? '',
      };
    }
    const meta = SECTION_META[sectionKey] ?? { title: sectionKey, description: '' };
    return {
      questions: NETSUITE_FALLBACK_QUESTIONS.filter((q) => q.id.startsWith(`${sectionKey}.`)),
      title: meta.title,
      description: meta.description,
    };
  }, [adaptorQuery.data, sectionKey]);

  const progress = sectionProgress[sectionKey] ?? 0;

  return (
    <div className="max-w-2xl mx-auto">
      <SectionIntroCard
        title={title}
        description={description}
        progress={progress}
        questionCount={questions.length}
      />

      {/* AI Suggestion Panel — offer to auto-fill unanswered questions */}
      <SectionSuggestionPanel
        engagementId={engagementId}
        sectionKey={sectionKey}
        questions={questions}
      />

      <div className="space-y-4">
        {questions.map((q) => {
          // Phase 24 — when this question is one of the 5 approval booleans
          // AND the current answer is true, drop the structured chain editor
          // in beneath it. The editor reads/writes its own answer key so
          // QuestionCard above is unchanged.
          const editorWiring = APPROVAL_EDITORS[q.id];
          const showEditor = editorWiring && answers[q.id] === true;
          return (
            <React.Fragment key={q.id}>
              <QuestionCard question={q} engagementId={engagementId} />
              {showEditor && (
                <ApprovalChainEditor
                  engagementId={engagementId}
                  structuredKey={editorWiring.structuredKey}
                  flowLabel={editorWiring.flowLabel}
                />
              )}
            </React.Fragment>
          );
        })}

        {questions.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
            No questions defined for this section yet.
          </div>
        )}
      </div>

      {/* Comments, Images & AI Advisor */}
      <div className="mt-8 space-y-4">
        <StepComments engagementId={engagementId} sectionKey={sectionKey} />
        <ImageUpload engagementId={engagementId} sectionKey={sectionKey} />
        <AIAdvisorPanel engagementId={engagementId} sectionKey={sectionKey} />
      </div>
    </div>
  );
}

