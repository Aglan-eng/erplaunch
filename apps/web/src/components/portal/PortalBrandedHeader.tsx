import React from 'react';
import { cn } from '@/lib/utils';

/**
 * PortalBrandedHeader (Phase 27).
 *
 * Shared firm-branded header tile + display label used by both the post-auth
 * ClientPortalPage and the pre-auth PortalLoginPage. Reads firm branding
 * (displayName, logoUrl, primaryColor, secondaryColor) and renders:
 *
 *   - Logo when set (object-contain on a white tile so transparent logos
 *     and wider-than-tall logos both render cleanly)
 *   - First-letter fallback over a primary→secondary gradient when no logo
 *   - "<displayName> · Client Project Portal" prefix label
 *   - Optional client name (rendered as the H1 below the prefix label)
 *
 * The colour application uses CSS custom properties on the wrapper so
 * Tailwind arbitrary-value classes (`bg-[var(--portal-primary)]`) drive
 * the visual treatment without scattering hex strings across JSX. The
 * caller is responsible for setting the custom properties on a parent
 * element via `getPortalBrandingStyle(branding)` (exported below).
 */

export interface FirmBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}

export interface PortalBrandedHeaderProps {
  branding: FirmBranding;
  /** Optional engagement client name (e.g. "Acme Industries"). When provided,
   *  rendered as the H1 below the prefix label. When absent, only the prefix
   *  label is rendered (used by PortalLoginPage where no engagement context
   *  is loaded yet). */
  clientName?: string | null;
  /** Optional className applied to the outer wrapper for layout flexing. */
  className?: string;
  /** Right-side slot (status badge, "On track" indicator, etc.). */
  rightSlot?: React.ReactNode;
}

/**
 * Inline style object the caller spreads onto the outermost portal wrapper
 * so `bg-[var(--portal-primary)]` Tailwind classes resolve. Returned as a
 * separate helper so PortalLoginPage and ClientPortalPage can both apply
 * it to whichever element makes most sense for them (page root vs. header).
 */
export function getPortalBrandingStyle(branding: FirmBranding): React.CSSProperties {
  return {
    // Cast required because React.CSSProperties doesn't type custom props.
    ['--portal-primary' as never]: branding.primaryColor,
    ['--portal-secondary' as never]: branding.secondaryColor,
  };
}

export function PortalBrandedHeader({
  branding,
  clientName,
  className,
  rightSlot,
}: PortalBrandedHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="flex items-center gap-4">
        {branding.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={branding.displayName}
            // object-contain (not -cover) preserves the consultant's brand
            // aspect ratio. bg-white gives transparent-PNG logos a clean
            // canvas. Fixed 11×11 box keeps the header rhythm consistent
            // across firms with different logo dimensions.
            className="h-11 w-11 rounded-xl object-contain bg-white flex-shrink-0 shadow-md"
          />
        ) : (
          <div
            className="h-11 w-11 rounded-xl bg-gradient-to-br from-[var(--portal-primary)] to-[var(--portal-secondary)] flex items-center justify-center flex-shrink-0 shadow-md"
            data-testid="portal-tile-fallback"
          >
            <span className="text-white font-black text-sm">
              {branding.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            <span data-testid="portal-firm-name">{branding.displayName}</span>
            <span className="mx-1.5 text-gray-300">·</span>
            Client Project Portal
          </p>
          {clientName && (
            <h1 className="text-xl font-black text-gray-900 mt-0.5">{clientName}</h1>
          )}
        </div>
      </div>
      {rightSlot}
    </div>
  );
}
