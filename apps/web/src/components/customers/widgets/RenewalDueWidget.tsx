import React from 'react';
import { Link } from 'react-router-dom';
import type { StageWidget } from '@/lib/api';
import { Chip, Stat, formatArr } from './shared';

type RenewalDueData = Extract<StageWidget, { kind: 'RENEWAL_DUE' }>;

export function RenewalDueWidget({
  data,
  customerId,
}: {
  data: RenewalDueData;
  customerId: string;
}) {
  const tone: 'red' | 'yellow' | 'brand' =
    data.daysUntilRenewal <= 14 ? 'red' : data.daysUntilRenewal <= 45 ? 'yellow' : 'brand';
  return (
    <div className="space-y-3" data-testid="widget-renewal-due">
      <div className="grid grid-cols-3 gap-4 items-end">
        <div data-testid="widget-renewaldue-countdown">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Renews in
          </div>
          <div
            className={
              tone === 'red'
                ? 'text-3xl font-bold tabular-nums text-rose-700'
                : tone === 'yellow'
                  ? 'text-3xl font-bold tabular-nums text-amber-700'
                  : 'text-3xl font-bold tabular-nums text-brand-700'
            }
          >
            {data.daysUntilRenewal}d
          </div>
        </div>
        <Stat
          label="Value at risk"
          value={formatArr(data.renewalValueArr)}
          tone={data.healthBand === 'red' ? 'red' : 'brand'}
          testid="widget-renewaldue-arr"
        />
        <div data-testid="widget-renewaldue-health">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            Health
          </div>
          <Chip
            tone={
              data.healthBand === 'red'
                ? 'red'
                : data.healthBand === 'yellow'
                  ? 'yellow'
                  : 'green'
            }
          >
            {data.healthBand}
          </Chip>
        </div>
      </div>
      {!data.quoteGenerated && (
        <Link
          to={`/customers/${customerId}?tab=documents`}
          className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          data-testid="widget-renewaldue-generate-quote"
        >
          Generate Renewal Quote →
        </Link>
      )}
    </div>
  );
}
