/**
 * Phase 53.1 — HelpTip.
 *
 * A small "?" button. Hover, focus, or click reveals a popover with
 * a short plain-English explanation. Fully keyboard-accessible; the
 * popover is always present in the DOM (display toggled via state +
 * CSS) so SSR can pin both the label and the body in one render.
 */
import React, { useId, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HelpTipProps {
  /** Short label — read by screen readers, e.g. "What is a health score?" */
  label: string;
  /** 1–3 plain-English sentences shown in the popover. */
  body: string;
  /** Optional positioning hint when the trigger is near a viewport edge. */
  placement?: 'right' | 'left' | 'top' | 'bottom';
  className?: string;
  testid?: string;
}

export function HelpTip({
  label,
  body,
  placement = 'bottom',
  className,
  testid,
}: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const popoverId = `helptip-${reactId}`;

  const placementClass = {
    right: 'left-full ml-2 top-0',
    left: 'right-full mr-2 top-0',
    top: 'bottom-full mb-2 left-0',
    bottom: 'top-full mt-2 left-0',
  }[placement];

  return (
    <span className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popoverId}
        data-testid={testid ?? 'help-tip'}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center justify-center rounded-full text-gray-400 hover:text-brand-600 focus:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 transition-colors"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={popoverId}
        role="tooltip"
        data-testid={testid ? `${testid}-body` : 'help-tip-body'}
        className={cn(
          'absolute z-40 w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700 shadow-lg',
          placementClass,
          open ? 'block' : 'hidden',
        )}
      >
        <span className="block font-semibold text-gray-900 mb-0.5">{label}</span>
        <span className="block text-gray-600">{body}</span>
      </span>
    </span>
  );
}
