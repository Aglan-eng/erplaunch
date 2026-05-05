import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CircleCheck, Circle, ChevronRight, ChevronDown,
  FolderKanban, TriangleAlert, CircleAlert, BookOpen,
  CalendarClock, Truck, Activity, Settings2, Database,
  Zap, Sparkles, ShieldCheck, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWizardStore } from '@/stores/wizardStore';
import { engagementsApi } from '@/lib/api';
import { bridgeAdaptorSchema } from './adaptorBridge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SidebarItem {
  key: string;
  label: string;
  progress: number;
  icon?: React.ElementType;
}

interface FlowGroup {
  id: string;
  label: string;
  badge: string;
  badgeColor: string;
  accentColor: string;
  sections: SidebarItem[];
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const MGMT_ITEMS: SidebarItem[] = [
  { key: 'risks',           label: 'Risk Register',     progress: 0, icon: TriangleAlert },
  { key: 'issues',          label: 'Issue Tracker',     progress: 0, icon: CircleAlert   },
  { key: 'decisions',       label: 'Decision Log',      progress: 0, icon: BookOpen      },
  { key: 'meetings',        label: 'Meeting Notes',     progress: 0, icon: CalendarClock },
  { key: 'data-collection', label: 'Data Collection',   progress: 0, icon: Database      },
  { key: 'migration',       label: 'Migration Tracker', progress: 0, icon: Truck         },
  { key: 'activity',        label: 'Activity Feed',     progress: 0, icon: Activity      },
];

// Phase 23 — Customizations group. Now contains Custom Fields, Roles
// (Phase 25), and Templates (Phase 26). NetSuite-only feature surface
// today; the structured generators self-gate so opening these sections
// on an Odoo engagement is harmless (the answer simply won't be consumed
// by the SDF pipeline that's not running for Odoo).
const CUSTOMIZATIONS_ITEMS: SidebarItem[] = [
  { key: 'customizations.customFields', label: 'Custom Fields', progress: 0, icon: Settings2 },
  { key: 'customizations.roles',        label: 'Roles',         progress: 0, icon: ShieldCheck },
  { key: 'customizations.templates',    label: 'Templates',     progress: 0, icon: FileText },
];

// NetSuite fallback — used when the adaptor query is still loading, fails,
// or the active engagement hasn't migrated to adaptor-driven sections yet.
// Any other adaptor (Odoo, custom:*) produces its sidebar groups by
// bridging schema.flows into this same shape.
const NETSUITE_FLOW_GROUPS: FlowGroup[] = [
  {
    id: 'r2r', label: 'Record to Report', badge: 'R2R',
    badgeColor: 'bg-blue-100 text-blue-700', accentColor: 'bg-blue-500',
    sections: [
      { key: 'r2r.entities',          label: 'Entities',           progress: 0 },
      { key: 'r2r.segmentation',      label: 'Segmentation',       progress: 0 },
      { key: 'r2r.accountingPeriods', label: 'Accounting Periods', progress: 0 },
      { key: 'r2r.currencies',        label: 'Currencies',         progress: 0 },
      { key: 'r2r.bankTransactions',  label: 'Bank Transactions',  progress: 0 },
      { key: 'r2r.tax',               label: 'Tax',                progress: 0 },
      { key: 'r2r.journalEntries',    label: 'Journal Entries',    progress: 0 },
      { key: 'r2r.fiscalClose',       label: 'Fiscal Close',       progress: 0 },
      { key: 'r2r.reporting',         label: 'Reporting',          progress: 0 },
    ],
  },
  {
    id: 'p2p', label: 'Procure to Pay', badge: 'P2P',
    badgeColor: 'bg-purple-100 text-purple-700', accentColor: 'bg-purple-500',
    sections: [
      { key: 'p2p.vendors',    label: 'Vendors',    progress: 0 },
      { key: 'p2p.purchasing', label: 'Purchasing', progress: 0 },
      { key: 'p2p.receiving',  label: 'Receiving',  progress: 0 },
      { key: 'p2p.bills',      label: 'Bills',      progress: 0 },
      { key: 'p2p.payments',   label: 'Payments',   progress: 0 },
      { key: 'p2p.expenses',   label: 'Expenses',   progress: 0 },
    ],
  },
  {
    id: 'o2c', label: 'Order to Cash', badge: 'O2C',
    badgeColor: 'bg-green-100 text-green-700', accentColor: 'bg-green-500',
    sections: [
      { key: 'o2c.customers',   label: 'Customers',    progress: 0 },
      { key: 'o2c.pricing',     label: 'Pricing',      progress: 0 },
      { key: 'o2c.salesOrders', label: 'Sales Orders', progress: 0 },
      { key: 'o2c.fulfillment', label: 'Fulfillment',  progress: 0 },
      { key: 'o2c.invoicing',   label: 'Invoicing',    progress: 0 },
      { key: 'o2c.collections', label: 'Collections',  progress: 0 },
    ],
  },
  {
    id: 'mfg', label: 'Manufacturing', badge: 'MFG',
    badgeColor: 'bg-orange-100 text-orange-700', accentColor: 'bg-orange-500',
    sections: [
      { key: 'mfg.productionFlow', label: 'Production Flow',   progress: 0 },
      { key: 'mfg.bom',            label: 'BOM Management',    progress: 0 },
      { key: 'mfg.outsourced',     label: 'Outsourced Mfg',    progress: 0 },
      { key: 'mfg.demand',         label: 'Demand Planning',   progress: 0 },
      { key: 'mfg.workOrders',     label: 'Work Orders',       progress: 0 },
      { key: 'mfg.inventory',      label: 'Inventory Control', progress: 0 },
      { key: 'mfg.costing',        label: 'Costing',           progress: 0 },
      { key: 'mfg.quality',        label: 'Quality',           progress: 0 },
    ],
  },
  {
    id: 'rtn', label: 'Returns', badge: 'RTN',
    badgeColor: 'bg-red-100 text-red-700', accentColor: 'bg-red-400',
    sections: [
      { key: 'rtn.customerReturns', label: 'Customer Returns',  progress: 0 },
      { key: 'rtn.vendorReturns',   label: 'Vendor Returns',    progress: 0 },
      { key: 'rtn.processing',      label: 'Return Processing', progress: 0 },
    ],
  },
];

// Visual identity for each wizard flow prefix — kept stable so engagements
// with different adaptors still have consistent color semantics in the UI.
const FLOW_THEME: Record<string, { label: string; badge: string; badgeColor: string; accentColor: string }> = {
  r2r: { label: 'Record to Report', badge: 'R2R', badgeColor: 'bg-blue-100 text-blue-700',   accentColor: 'bg-blue-500' },
  p2p: { label: 'Procure to Pay',   badge: 'P2P', badgeColor: 'bg-purple-100 text-purple-700', accentColor: 'bg-purple-500' },
  o2c: { label: 'Order to Cash',    badge: 'O2C', badgeColor: 'bg-green-100 text-green-700', accentColor: 'bg-green-500' },
  mfg: { label: 'Manufacturing',    badge: 'MFG', badgeColor: 'bg-orange-100 text-orange-700', accentColor: 'bg-orange-500' },
  rtn: { label: 'Returns',          badge: 'RTN', badgeColor: 'bg-red-100 text-red-700',      accentColor: 'bg-red-400' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface WizardSidebarProps {
  engagementId: string;
  sectionProgress: Record<string, number>;
  licenseComplete: boolean;
  projectSetupComplete?: boolean;
}

// ─── Tiny inline progress arc ─────────────────────────────────────────────────

function MiniProgress({ pct, color = 'stroke-brand-400' }: { pct: number; color?: string }) {
  const r = 7;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0 -rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="#e5e7eb" strokeWidth="2" />
      <circle
        cx="9" cy="9" r={r} fill="none"
        className={color}
        strokeWidth="2"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.4s ease' }}
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WizardSidebar({ engagementId, sectionProgress, licenseComplete, projectSetupComplete = false }: WizardSidebarProps) {
  const { currentSection, setCurrentSection } = useWizardStore();

  const adaptorQuery = useQuery({
    queryKey: ['engagement-adaptor', engagementId],
    queryFn: () => engagementsApi.getAdaptor(engagementId),
    enabled: !!engagementId,
    retry: false,
    staleTime: 60_000,
  });

  // Derive the flow groups for the sidebar from the adaptor's schema. If the
  // adaptor exposes at least one flow with sections we use it; otherwise we
  // fall back to the hard-coded NetSuite layout so pilot engagements that
  // predate the adaptor SPI keep working unchanged.
  const flowGroups: FlowGroup[] = useMemo(() => {
    const bridged = bridgeAdaptorSchema(adaptorQuery.data?.schema);
    if (bridged.size === 0) return NETSUITE_FLOW_GROUPS;

    // Group the bridged sections by their flow prefix (r2r / p2p / ...).
    const byFlow = new Map<string, { sectionId: string; label: string; order: number; key: string }[]>();
    for (const [key, section] of bridged.entries()) {
      const prefix = key.split('.')[0];
      if (!byFlow.has(prefix)) byFlow.set(prefix, []);
      byFlow.get(prefix)!.push({
        sectionId: section.sectionId,
        label: section.sectionLabel,
        order: section.sectionOrder,
        key,
      });
    }
    if (byFlow.size === 0) return NETSUITE_FLOW_GROUPS;

    const prefixOrder = ['r2r', 'p2p', 'o2c', 'mfg', 'rtn'];
    const out: FlowGroup[] = [];
    for (const prefix of prefixOrder) {
      const entries = byFlow.get(prefix);
      if (!entries || entries.length === 0) continue;
      entries.sort((a, b) => a.order - b.order);
      const theme = FLOW_THEME[prefix];
      out.push({
        id: prefix,
        label: theme.label,
        badge: theme.badge,
        badgeColor: theme.badgeColor,
        accentColor: theme.accentColor,
        sections: entries.map((e) => ({ key: e.key, label: e.label, progress: 0 })),
      });
    }
    return out.length > 0 ? out : NETSUITE_FLOW_GROUPS;
  }, [adaptorQuery.data]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    mgmt: false,
    customizations: false,
    r2r: false,
    p2p: false,
    o2c: false,
    mfg: false,
    rtn: false,
  });

  const toggle = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  // ── Item renderer ──────────────────────────────────────────────────────────

  const renderItem = (item: SidebarItem, indent = false) => {
    const isActive = currentSection === item.key;
    const isDone   = item.progress === 100;
    const inProg   = item.progress > 0 && item.progress < 100;
    const Icon     = item.icon;

    return (
      <button
        key={item.key}
        onClick={() => setCurrentSection(item.key)}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg text-left transition-all duration-150 group relative',
          indent ? 'px-2.5 py-1.5' : 'px-2.5 py-2',
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
        )}
      >
        {/* Active left bar */}
        {isActive && (
          <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-brand-500 rounded-r-full" />
        )}

        {/* Icon / progress / check */}
        <div className="flex-shrink-0 w-[18px] flex items-center justify-center">
          {isDone ? (
            <CircleCheck className="h-3.5 w-3.5 text-green-500" />
          ) : inProg ? (
            <MiniProgress pct={item.progress} />
          ) : Icon ? (
            <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-brand-500' : 'text-gray-350 group-hover:text-gray-500')} />
          ) : (
            <Circle className={cn('h-3 w-3', isActive ? 'text-brand-400' : 'text-gray-250 group-hover:text-gray-400')} />
          )}
        </div>

        {/* Label */}
        <span className={cn(
          'flex-1 text-xs truncate transition-colors',
          isActive ? 'font-semibold text-brand-700' : 'font-medium'
        )}>
          {item.label}
        </span>

        {/* Progress % badge */}
        {inProg && !isActive && (
          <span className="text-[9px] font-bold text-gray-400 tabular-nums flex-shrink-0">{item.progress}%</span>
        )}

        {isActive && <ChevronRight className="h-3 w-3 text-brand-400 flex-shrink-0" />}
      </button>
    );
  };

  // ── Collapsible section header ─────────────────────────────────────────────

  const renderSectionHeader = ({
    id, label, badge, badgeColor, accentColor, completedCount, total, hasActive,
  }: {
    id: string; label: string; badge?: string; badgeColor?: string; accentColor?: string;
    completedCount?: number; total?: number; hasActive: boolean;
  }) => {
    const isOpen = !collapsed[id];
    const pct = total && completedCount !== undefined ? Math.round((completedCount / total) * 100) : 0;

    return (
      <button
        onClick={() => toggle(id)}
        className={cn(
          'w-full flex items-center justify-between px-2.5 py-2.5 rounded-lg transition-colors group',
          hasActive ? 'bg-brand-50/50' : 'hover:bg-gray-50/80'
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {badge ? (
            <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded flex-shrink-0 tracking-wide', badgeColor)}>
              {badge}
            </span>
          ) : (
            <FolderKanban className={cn('h-3.5 w-3.5 flex-shrink-0', hasActive ? 'text-brand-500' : 'text-gray-400')} />
          )}
          <div className="min-w-0 flex-1">
            <span className={cn('text-xs font-semibold truncate block', hasActive ? 'text-brand-700' : 'text-gray-600')}>
              {label}
            </span>
            {total !== undefined && completedCount !== undefined && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', accentColor ?? 'bg-brand-400')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-gray-400 tabular-nums flex-shrink-0">{completedCount}/{total}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 ml-2">
          {isOpen
            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 transition-colors" />
            : <ChevronRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 transition-colors" />
          }
        </div>
      </button>
    );
  };

  const renderMgmtSection = () => {
    const hasActive = MGMT_ITEMS.some((i) => currentSection === i.key);
    return (
      <div>
        {renderSectionHeader({ id: 'mgmt', label: 'Project Mgmt', hasActive })}
        {!collapsed.mgmt && (
          <div className="mt-0.5 space-y-0.5 pl-1">
            {MGMT_ITEMS.map((item) => renderItem(item))}
          </div>
        )}
      </div>
    );
  };

  // Phase 23 — Customizations group. Sits between Project Mgmt and
  // Business Flows in the sidebar.
  const renderCustomizationsSection = () => {
    const hasActive = CUSTOMIZATIONS_ITEMS.some((i) => currentSection === i.key);
    return (
      <div>
        {renderSectionHeader({ id: 'customizations', label: 'Customizations', hasActive })}
        {!collapsed.customizations && (
          <div className="mt-0.5 space-y-0.5 pl-1">
            {CUSTOMIZATIONS_ITEMS.map((item) => renderItem(item))}
          </div>
        )}
      </div>
    );
  };

  const renderFlowGroup = (group: FlowGroup) => {
    const sections = group.sections.map((s) => {
      const subKey = s.key.replace(`${group.id}.`, '');
      return { ...s, progress: sectionProgress[`${group.id}.${subKey}`] ?? 0 };
    });
    const completedCount = sections.filter((s) => s.progress === 100).length;
    const hasActive = sections.some((s) => currentSection === s.key);

    return (
      <div key={group.id}>
        {renderSectionHeader({
          id: group.id,
          label: group.label,
          badge: group.badge,
          badgeColor: group.badgeColor,
          accentColor: group.accentColor,
          completedCount,
          total: group.sections.length,
          hasActive,
        })}
        {!collapsed[group.id] && (
          <div className="mt-0.5 space-y-0.5 pl-1 pb-1">
            {sections.map((s) => renderItem(s, true))}
          </div>
        )}
      </div>
    );
  };

  const projectItem: SidebarItem = { key: 'project', label: 'Project Setup',   progress: projectSetupComplete ? 100 : 0, icon: Settings2 };
  const licenseItem: SidebarItem = { key: 'license', label: 'License Profile', progress: licenseComplete     ? 100 : 0 };

  return (
    <aside className="w-64 flex-shrink-0 bg-white border-r border-slate-200/70 flex flex-col overflow-hidden z-10 shadow-[2px_0_12px_rgba(0,0,0,0.04)]">

      {/* Foundation — pinned */}
      <div className="flex-shrink-0 px-2.5 pt-4 pb-2.5 border-b border-slate-100">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 mb-2">Foundation</p>
        <div className="space-y-0.5">
          {renderItem(projectItem)}
          {renderItem(licenseItem)}
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#e2e8f0 transparent' }}>
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 pt-1 pb-1.5">Project Mgmt</p>
        {renderMgmtSection()}

        <div className="h-px bg-slate-100 my-2.5 mx-1" />

        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 pt-1 pb-1.5">Customizations</p>
        {renderCustomizationsSection()}

        <div className="h-px bg-slate-100 my-2.5 mx-1" />

        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 pt-1 pb-1.5">Business Flows</p>
        {flowGroups.map(renderFlowGroup)}
      </div>

      {/* Action buttons — pinned bottom */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-slate-100 bg-white space-y-2">
        <button
          onClick={() => setCurrentSection('ai-profile')}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 active:scale-[0.98]',
            currentSection === 'ai-profile'
              ? 'bg-gradient-to-r from-violet-600 to-brand-600 text-white shadow-lg shadow-violet-200'
              : 'bg-gradient-to-r from-violet-50 to-purple-50 text-violet-700 hover:from-violet-100 hover:to-purple-100 border border-violet-100'
          )}
        >
          <Sparkles className="h-4 w-4" />
          AI Auto-Fill
        </button>
        <button
          onClick={() => setCurrentSection('generate')}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 active:scale-[0.98]',
            currentSection === 'generate'
              ? 'bg-brand-600 text-white shadow-lg shadow-brand-200'
              : 'bg-gradient-to-r from-brand-50 to-blue-50 text-brand-700 hover:from-brand-100 hover:to-blue-100 border border-brand-100'
          )}
        >
          <Zap className="h-4 w-4" />
          Generate Package
        </button>
      </div>
    </aside>
  );
}
