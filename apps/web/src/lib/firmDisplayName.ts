/**
 * Phase 39.1 — small helper that picks the right firm name to render in
 * consultant-facing UI (dashboard header, settings page, etc.).
 *
 * Firms have two name fields:
 *   - `name`: the legal / registration string set during sign-up. Often a
 *     slug-y placeholder until the firm admin fills in the branding tab.
 *   - `displayName`: the brand name added in Phase 6.8 white-label. This
 *     is what should surface in the UI when set; it's also what end clients
 *     see on the portal.
 *
 * Phase 38.5 wired the dashboard header to `firm.name` directly which
 * meant a firm with `displayName: 'Xelerate'` and `name: 'xelerate-llc'`
 * showed the slug-ish form. This helper swaps that with a fallback so
 * legacy firms that never set a displayName still render their `name`.
 */

interface FirmNameSource {
  name: string;
  displayName?: string | null;
}

export function firmDisplayName(firm: FirmNameSource | null | undefined): string {
  if (!firm) return '';
  const display = firm.displayName?.trim();
  if (display) return display;
  return firm.name ?? '';
}
