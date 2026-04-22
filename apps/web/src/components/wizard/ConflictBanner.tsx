import React from 'react';
import { TriangleAlert, CircleX, Info, ArrowRight } from 'lucide-react';
import { useConflictStore } from '@/stores/conflictStore';
import { useWizardStore } from '@/stores/wizardStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LICENSE_TYPES = new Set(['LICENSE_GAP', 'LICENSING', 'LICENSE']);


function getSectionLabel(section: string): string {
  const map: Record<string, string> = {
    'license':              'License Profile',
    'r2r.entities':         'Entities',
    'r2r.segmentation':     'Segmentation',
    'r2r.accountingPeriods':'Accounting Periods',
    'r2r.currencies':       'Currencies',
    'r2r.bankTransactions': 'Bank Transactions',
    'r2r.tax':              'Tax',
    'r2r.journalEntries':   'Journal Entries',
    'r2r.fiscalClose':      'Fiscal Close',
    'r2r.reporting':        'Reporting',
    'p2p.vendors':          'Vendors',
    'p2p.purchasing':       'Purchasing',
    'p2p.receiving':        'Receiving',
    'p2p.bills':            'Bills',
    'p2p.payments':         'Payments',
    'p2p.expenses':         'Expenses',
    'o2c.customers':        'Customers',
    'o2c.pricing':          'Pricing',
    'o2c.salesOrders':      'Sales Orders',
    'o2c.fulfillment':      'Fulfillment',
    'o2c.invoicing':        'Invoicing',
    'o2c.collections':      'Collections',
    'mfg.productionFlow':   'Production Flow',
    'mfg.bom':              'BOM Management',
    'mfg.outsourced':       'Outsourced Mfg',
    'mfg.demand':           'Demand Planning',
    'mfg.workOrders':       'Work Orders',
    'mfg.inventory':        'Inventory Control',
    'mfg.costing':          'Costing',
    'mfg.quality':          'Quality',
    'rtn.customerReturns':  'Customer Returns',
    'rtn.vendorReturns':    'Vendor Returns',
    'rtn.processing':       'Return Processing',
  };
  return map[section] ?? section;
}

// ─── Fix Link ─────────────────────────────────────────────────────────────────

function NavButton({
  section,
  color,
}: {
  section: string;
  color: 'red' | 'amber';
}) {
  const setCurrentSection = useWizardStore((s) => s.setCurrentSection);
  const label = getSectionLabel(section);
  const cls =
    color === 'red'
      ? 'text-red-600 hover:text-red-800 decoration-red-400'
      : 'text-amber-600 hover:text-amber-800 decoration-amber-400';

  return (
    <button
      onClick={() => setCurrentSection(section)}
      className={`inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2 transition-colors ${cls}`}
    >
      Go to {label}
      <ArrowRight className="h-3 w-3" />
    </button>
  );
}

function FixLink({
  conflict,
  color,
}: {
  conflict: { type: string; questionIds: string[] };
  color: 'red' | 'amber';
}) {
  const isLicenseGap = LICENSE_TYPES.has(conflict.type);

  // Derive the question section (e.g. "mfg.productionFlow") from questionIds
  const questionSection =
    conflict.questionIds.length > 0
      ? (() => {
          const parts = conflict.questionIds[0].split('.');
          return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : '';
        })()
      : '';

  // LICENSE_GAP with a question section → show both links (two resolution paths)
  if (isLicenseGap && questionSection) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        <NavButton section="license" color={color} />
        <NavButton section={questionSection} color={color} />
      </div>
    );
  }

  // Pure license gap (no question context) → link to License Profile only
  if (isLicenseGap) {
    return (
      <div className="mt-1.5">
        <NavButton section="license" color={color} />
      </div>
    );
  }

  // Non-license conflict → link to the relevant question section
  if (questionSection) {
    return (
      <div className="mt-1.5">
        <NavButton section={questionSection} color={color} />
      </div>
    );
  }

  return null;
}

// ─── Main Banner ──────────────────────────────────────────────────────────────

export function ConflictBanner() {
  const conflicts = useConflictStore((s) => s.conflicts);

  const blocks = conflicts.filter((c) => c.severity === 'BLOCK');
  const warns  = conflicts.filter((c) => c.severity === 'WARN');

  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-2">
      {blocks.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <CircleX className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-800">
                {blocks.length} blocking issue{blocks.length !== 1 ? 's' : ''} must be resolved
              </p>
              <ul className="mt-2 space-y-3">
                {blocks.map((b) => (
                  <li key={b.ruleId}>
                    <div className="flex items-start gap-1.5 min-w-0">
                      <span className="font-mono text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                        {b.ruleId}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-red-700 block leading-relaxed">{b.message}</span>
                        {b.resolution && (
                          <p className="mt-1 text-xs text-red-600/70 italic font-medium">
                            Resolution: {b.resolution}
                          </p>
                        )}
                        <FixLink conflict={b} color="red" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {warns.length > 0 && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 backdrop-blur-sm px-4 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="bg-amber-100/80 p-1.5 rounded-lg border border-amber-200/50">
              <TriangleAlert className="h-4 w-4 text-amber-600 flex-shrink-0" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-amber-900 uppercase tracking-tight">
                {warns.length} Warning{warns.length !== 1 ? 's' : ''} to review
              </p>
              <ul className="mt-2 space-y-3">
                {warns.map((w) => (
                  <li key={w.ruleId}>
                    <div className="flex items-start gap-1.5 min-w-0">
                      <span className="font-mono text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                        {w.ruleId}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-amber-700 block leading-relaxed">{w.message}</span>
                        {w.resolution && (
                          <p className="mt-1 text-xs text-amber-600/70 italic font-medium">
                            Resolution: {w.resolution}
                          </p>
                        )}
                        <FixLink conflict={w} color="amber" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline (per-question) ────────────────────────────────────────────────────

export function ConflictInline({ questionId }: { questionId: string }) {
  const conflictsForQuestion = useConflictStore((s) => s.conflictsForQuestion);
  const relevant = conflictsForQuestion(questionId);

  if (relevant.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {relevant.map((c) => (
        <div
          key={c.ruleId}
          className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${
            c.severity === 'BLOCK'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : c.severity === 'WARN'
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}
        >
          {c.severity === 'BLOCK' ? (
            <CircleX className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          ) : c.severity === 'WARN' ? (
            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          ) : (
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          )}
          <div>
            <span className="font-medium">{c.message}</span>
            <p className="mt-0.5 opacity-80">{c.resolution}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
