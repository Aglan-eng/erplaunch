import React from 'react';
import { usePermissions, type PermissionAction, type PermissionResource } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';

/**
 * Phase 44.4 — wrapper that disables an action button when the
 * current user lacks the matrix-required permission and surfaces the
 * "Requires <ROLE> to <verb> <resource>" tooltip on hover.
 *
 * Three modes:
 *   1. Allowed — renders the button as-is (props.disabled still
 *      respected so callers can layer their own disabled state on
 *      top, e.g. mid-mutation).
 *   2. Permissions still loading — renders disabled but with no
 *      tooltip, to avoid flashing "Requires …" copy briefly on
 *      first paint.
 *   3. Denied — renders disabled, applies a muted style, and sets
 *      title= so native browser tooltip shows on hover. Click is
 *      blocked even if onClick was wired (defensive — the disabled
 *      attribute already prevents events).
 *
 * Defaults to the same visual styling as the existing dashboard
 * primary button (bg-brand-600). Callers can override via className.
 */

export interface PermissionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** What the user needs to be able to do — drives both the gate
   *  decision and the tooltip copy. */
  action: PermissionAction;
  resource: PermissionResource;
  /** Optional engagement context — when provided, the hook scopes
   *  the lookup to the engagement's stage. Omit for firm-level
   *  buttons (custom adaptors, team page, etc.). */
  engagementId?: string | null;
  /** Optional: when true and disabled, render with a slightly different
   *  style cue (40 % opacity instead of muted). */
  subtleDisabled?: boolean;
}

export function PermissionButton({
  action,
  resource,
  engagementId,
  subtleDisabled,
  disabled: extraDisabled,
  className,
  title,
  children,
  ...rest
}: PermissionButtonProps) {
  const { canOrTooltip, isLoading } = usePermissions(engagementId ?? null);
  const verdict = canOrTooltip(action, resource);

  // Compose disabled state: external `disabled` prop OR not allowed.
  const isDisabled = !!extraDisabled || !verdict.allowed;
  const tooltipFromVerdict = verdict.tooltip;
  const finalTitle = title ?? (isDisabled ? tooltipFromVerdict : undefined);

  return (
    <button
      {...rest}
      disabled={isDisabled}
      title={finalTitle}
      data-permission-allowed={verdict.allowed}
      data-permission-loading={isLoading || undefined}
      className={cn(
        className,
        // Apply a subtle muted state when permission denies. Callers
        // that want their own disabled style can override via className.
        !verdict.allowed && (subtleDisabled
          ? 'opacity-40 cursor-not-allowed'
          : 'opacity-60 cursor-not-allowed'),
      )}
    >
      {children}
    </button>
  );
}
