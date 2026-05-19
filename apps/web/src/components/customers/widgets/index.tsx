/**
 * Phase 52.7 — Stage-specific widget dispatcher.
 *
 * Renders the right widget component for the customer's current
 * stage. Each widget receives the typed sub-payload from the
 * `stageWidget` discriminated union on `CustomerDetail`.
 */
import React from 'react';
import type { CustomerDetail } from '@/lib/api';
import { LeadWidget } from './LeadWidget';
import { ProposalWidget } from './ProposalWidget';
import { WonWidget } from './WonWidget';
import { DiscoveryWidget } from './DiscoveryWidget';
import { ScopingWidget } from './ScopingWidget';
import { BuildWidget } from './BuildWidget';
import { UatWidget } from './UatWidget';
import { GoLiveWidget } from './GoLiveWidget';
import { HypercareWidget } from './HypercareWidget';
import { LiveSlaWidget } from './LiveSlaWidget';
import { RenewalDueWidget } from './RenewalDueWidget';
import { RenewedWidget } from './RenewedWidget';
import { LostWidget } from './LostWidget';
import { ChurnedWidget } from './ChurnedWidget';

interface StageWidgetProps {
  detail: CustomerDetail;
}

export function StageWidget({ detail }: StageWidgetProps) {
  const w = detail.stageWidget;
  const body = ((): React.ReactElement => {
    switch (w.kind) {
      case 'LEAD':
      case 'QUALIFIED':
        return <LeadWidget data={w} />;
      case 'PROPOSAL':
      case 'NEGOTIATION':
        return <ProposalWidget data={w} customerId={detail.id} />;
      case 'WON':
        return <WonWidget data={w} />;
      case 'DISCOVERY':
        return <DiscoveryWidget data={w} />;
      case 'SCOPING':
        return <ScopingWidget data={w} />;
      case 'BUILD':
        return <BuildWidget data={w} customerId={detail.id} />;
      case 'UAT':
        return <UatWidget data={w} customerId={detail.id} />;
      case 'GOLIVE':
        return <GoLiveWidget data={w} />;
      case 'HYPERCARE':
        return <HypercareWidget data={w} />;
      case 'LIVE_SLA':
        return <LiveSlaWidget data={w} />;
      case 'RENEWAL_DUE':
        return <RenewalDueWidget data={w} customerId={detail.id} />;
      case 'RENEWED':
        return <RenewedWidget data={w} />;
      case 'LOST':
        return <LostWidget data={w} />;
      case 'CHURNED':
        return <ChurnedWidget data={w} />;
    }
  })();

  return (
    <section
      className="bg-white border border-gray-200 rounded-xl p-5"
      data-testid="stage-widget"
      data-stage-widget-kind={w.kind}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Stage focus</h2>
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
          {w.kind.replace('_', ' ')}
        </span>
      </header>
      {body}
    </section>
  );
}
