import React from 'react';
import { cn } from '@/lib/utils';
import type { FirmBranding } from './PortalBrandedHeader';

/**
 * PortalSupportFooter (Phase 27).
 *
 * Shared "need help?" footer rendered on both the post-auth ClientPortalPage
 * and the pre-auth PortalLoginPage. Renders nothing when supportEmail is
 * null, so firms that haven't configured a support address don't get an
 * awkward broken link. Mailto link uses the firm's primary colour via the
 * CSS custom property the parent sets.
 *
 * Designed for reuse by upcoming Phase 25/26 surfaces (consultant
 * acknowledge / pending review patterns in §5) — kept stateless and
 * branding-prop-driven so the same footer can drop into any portal-side
 * page once its parent applies `getPortalBrandingStyle()`.
 */

export interface PortalSupportFooterProps {
  branding: FirmBranding;
  /** Layout className applied to the outer <p>. Typical values:
   *  "mt-8 text-center" (page footer) or "mt-2" (inline below a card). */
  className?: string;
}

export function PortalSupportFooter({ branding, className }: PortalSupportFooterProps) {
  if (!branding.supportEmail) return null;
  return (
    <p className={cn('text-xs text-gray-400', className)}>
      Need help?{' '}
      <a
        href={`mailto:${branding.supportEmail}`}
        className="text-[var(--portal-primary)] hover:underline"
        data-testid="portal-support-link"
      >
        Contact {branding.displayName}
      </a>
    </p>
  );
}
