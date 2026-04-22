/**
 * HelpTip — small ℹ icon that shows a rich tooltip popover on hover/click.
 * Used in portal settings, preset cards, and anywhere inline guidance is needed.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HelpTipProps {
  title: string;
  body: string;
  /** Optional bullet points shown below the body */
  bullets?: string[];
  /** Optional note shown at the bottom (e.g., "⚡ Recommended for all projects") */
  note?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  className?: string;
}

export function HelpTip({ title, body, bullets, note, size = 'sm', className }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={cn(
          'rounded-full transition-colors',
          size === 'sm' ? 'p-0.5 text-gray-350 hover:text-brand-500' : 'p-1 text-gray-400 hover:text-brand-600',
        )}
        aria-label="Help"
      >
        <Info className={cn(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      </button>

      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="absolute left-6 top-0 z-50 w-72 rounded-xl bg-white border border-gray-200 shadow-xl p-4 space-y-2 animate-in fade-in slide-in-from-left-1 duration-150"
        >
          <p className="text-xs font-bold text-gray-900">{title}</p>
          <p className="text-xs text-gray-600 leading-relaxed">{body}</p>
          {bullets && bullets.length > 0 && (
            <ul className="space-y-1">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                  <span className="text-brand-400 font-bold mt-px">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {note && (
            <p className="text-[11px] text-brand-600 font-semibold bg-brand-50 rounded-lg px-2.5 py-1.5 border border-brand-100">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
