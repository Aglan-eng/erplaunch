/**
 * Pure helpers for the ArchivedDashboardPage (Phase 38.4).
 *
 * Kept separate from the React file so the filtering / sorting logic can be
 * unit-tested without standing up @testing-library. The React component is
 * exercised by the workspace-wide build + typecheck.
 */

export interface ArchivedEngagement {
  id: string;
  clientName: string;
  status: string;
  previousStatus?: string | null;
  updatedAt: string;
}

/**
 * Filters an engagement list to ARCHIVED rows and sorts by updatedAt
 * descending. Mirrors what the API returns when called with
 * `?includeArchived=true` — the API doesn't sort archived rows separately,
 * so the page does the second pass.
 */
export function selectArchived<T extends { status: string; updatedAt: string }>(rows: T[]): T[] {
  return rows
    .filter((r) => r.status === 'ARCHIVED')
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Human-readable "previously" label. Falls back to "Discovery" (the
 * unarchive default) when the row pre-dates the previousStatus column.
 */
export function previousStatusLabel(prev: string | null | undefined): string {
  if (!prev || typeof prev !== 'string') return 'Discovery';
  // Match the dashboard's existing STATUS_LABELS shape but expressed inline
  // to keep this helper self-contained.
  const labels: Record<string, string> = {
    DISCOVERY: 'Discovery',
    SCOPING: 'Scoping',
    BUILD: 'Build',
    UAT: 'UAT',
    GO_LIVE: 'Go-Live',
    CLOSED: 'Closed',
    ARCHIVED: 'Archived',
  };
  return labels[prev] ?? prev.replace(/_/g, ' ').toLowerCase();
}
