import React from 'react';
import { ExternalLink, MessageSquare, FileSignature, Inbox, CheckCircle2 } from 'lucide-react';

/**
 * Phase 41.3 — richer portal preview panel for the firm Settings page.
 *
 * Replaces the original 80px header strip with a full mock of what the
 * consultant's clients see when they sign into the portal: branded
 * header (with the chosen logo + gradient), a fake engagement title,
 * three of the actual portal sections rendered in miniature, and a
 * primary-colour CTA button so the consultant can sanity-check that
 * their colour pair has enough contrast on white.
 *
 * The preview deliberately mirrors the real `PortalBrandedHeader` and
 * `PortalLayout` styling — same gradient, same chips, same support
 * link colour treatment — so what the consultant sees here is what
 * they'll see at /portal/<engagementId>. No animations or live data,
 * just a static snapshot driven entirely by the form state, so tweaks
 * to the colour pickers or display name update the panel in real
 * time.
 *
 * Pure component: takes its inputs as props and writes nothing to
 * state, so it can be reused (e.g. on the future portal-settings
 * Email Domain page in Phase 41.4) without adapter glue.
 */

export interface PortalPreviewPanelProps {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string | null;
}

export function PortalPreviewPanel({
  displayName,
  logoUrl,
  primaryColor,
  secondaryColor,
  supportEmail,
}: PortalPreviewPanelProps) {
  // CSS-variable plumbing matches the real portal so swapping in the
  // production component instead of this mock is a one-line change
  // when we move to live preview later.
  const styleVars: React.CSSProperties = {
    ['--portal-primary' as never]: primaryColor,
    ['--portal-secondary' as never]: secondaryColor,
  };
  const gradient = `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`;

  return (
    <div
      className="rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white"
      style={styleVars}
      data-testid="portal-preview-panel"
    >
      {/* Header — matches PortalBrandedHeader (logo tile + prefix label + H1) */}
      <div
        className="px-4 py-4"
        style={{ background: gradient }}
      >
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img
              src={logoUrl}
              className="h-9 w-9 rounded-lg object-contain bg-white flex-shrink-0 shadow"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
          ) : (
            <div
              className="h-9 w-9 rounded-lg bg-white/30 ring-1 ring-white/40 flex items-center justify-center flex-shrink-0 shadow text-white font-bold"
              data-testid="portal-preview-tile-fallback"
            >
              {displayName.charAt(0).toUpperCase() || 'F'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-white/80 uppercase tracking-wider truncate">
              <span data-testid="portal-preview-firm-name">{displayName}</span>
              <span className="mx-1.5 text-white/50">·</span>
              Client Project Portal
            </p>
            <p className="text-sm font-bold text-white drop-shadow-sm truncate">
              Acme Industries Implementation
            </p>
          </div>
        </div>
      </div>

      {/* Body — mock of the portal layout the client lands on */}
      <div className="p-4 space-y-3">
        {/* Greeting */}
        <div>
          <p className="text-sm font-semibold text-slate-900">Hi Alex,</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Welcome to your project portal. A few things need your attention.
          </p>
        </div>

        {/* Mini section list — three of the real portal surfaces */}
        <div className="space-y-1.5">
          <PreviewSectionRow
            icon={Inbox}
            label="3 questions waiting for your answers"
            primaryColor={primaryColor}
          />
          <PreviewSectionRow
            icon={MessageSquare}
            label="1 new message from the team"
            primaryColor={primaryColor}
          />
          <PreviewSectionRow
            icon={FileSignature}
            label="Decision sign-off ready to review"
            primaryColor={primaryColor}
          />
        </div>

        {/* Primary CTA — gives the consultant a button to eyeball
            against their primary colour */}
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          className="w-full rounded-lg text-white text-xs font-semibold px-3 py-2 inline-flex items-center justify-center gap-1.5 shadow-sm"
          style={{ background: primaryColor }}
          data-testid="portal-preview-cta"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Open my engagement
        </button>

        {/* Support footer — same pattern as PortalSupportFooter */}
        {supportEmail && (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">
              Need help?
            </p>
            <a
              href={`mailto:${supportEmail}`}
              onClick={(e) => e.preventDefault()}
              className="text-[11px] font-semibold inline-flex items-center gap-1"
              style={{ color: primaryColor }}
              data-testid="portal-preview-support-link"
            >
              {supportEmail}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewSectionRow({
  icon: Icon,
  label,
  primaryColor,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  primaryColor: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: primaryColor }} />
      <p className="text-[11px] text-slate-700 truncate">{label}</p>
    </div>
  );
}
