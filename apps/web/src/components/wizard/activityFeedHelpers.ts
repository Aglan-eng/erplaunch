/**
 * Phase 40.3 — pure helpers for the Activity Feed view.
 *
 * Extracted into a stand-alone module so the test suite can pin
 * grouping, classification, search, and pagination behaviour without
 * standing up React or @tanstack/react-query.
 *
 * The legacy ActivityFeedView (Phase 36-ish) read `activity.description`
 * and `activity.timestamp`, but the API actually surfaces `details` and
 * `createdAt`. The result was a feed that rendered "Activity" with no
 * timestamp for every row — basically a placeholder. This module
 * re-grounds the rendering on the real columns and adds:
 *   - human-readable per-action labels and category palettes
 *   - day-bucket grouping ("Today", "Yesterday", or a date)
 *   - case-insensitive search across action label + details
 *   - category filter pills
 *   - simple page-based pagination
 *
 * Routing: each meta entry exposes a `section` key that the view layer
 * can dispatch to setCurrentSection() so a row click jumps straight to
 * the relevant register/log step.
 */

export const ACTION_CATEGORIES = [
  'risks',
  'issues',
  'decisions',
  'meetings',
  'members',
  'migration',
  'data',
  'notes',
  'system',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export interface ActivityRow {
  id: string;
  engagementId: string;
  firmId: string;
  action: string;
  details: string | null;
  createdAt: string;
}

export interface ActionMeta {
  category: ActionCategory;
  label: string;
  /** Tailwind palette name (red, orange, etc.) — view layer composes the
   * actual class names from this so the palette stays declarative. */
  color: string;
  /** Optional wizard section to navigate to when the row is clicked. */
  section: string | null;
}

// ─── getActionMeta ───────────────────────────────────────────────────────────
//
// The action vocabulary is bounded but grows over time, so we use prefix
// rules instead of an exhaustive switch — every new RISK_* action lands
// in the right bucket without a code change.

const CATEGORY_RULES: Array<{
  match: (action: string) => boolean;
  category: ActionCategory;
  color: string;
  section: string | null;
}> = [
  { match: (a) => a.startsWith('RISK_'), category: 'risks', color: 'red', section: 'risks' },
  { match: (a) => a.startsWith('ISSUE_'), category: 'issues', color: 'orange', section: 'issues' },
  {
    match: (a) => a.startsWith('DECISION_') || a === 'DECISION',
    category: 'decisions',
    color: 'violet',
    section: 'decisions',
  },
  { match: (a) => a.startsWith('MEETING_'), category: 'meetings', color: 'blue', section: 'meetings' },
  { match: (a) => a.startsWith('MEMBER_'), category: 'members', color: 'emerald', section: null },
  {
    match: (a) => a.startsWith('MIGRATION_'),
    category: 'migration',
    color: 'indigo',
    section: 'migration',
  },
  {
    match: (a) => a.startsWith('DATA_') || a === 'CUSTOM_TEMPLATE_CREATED',
    category: 'data',
    color: 'teal',
    section: null,
  },
  {
    match: (a) => a === 'NOTE' || a === 'OBSERVATION' || a === 'TODO',
    category: 'notes',
    color: 'amber',
    section: null,
  },
];

// Human-readable labels for the most common actions. Anything not here
// falls back to a Title-Cased version of the underscore-separated action.
const ACTION_LABELS: Record<string, string> = {
  RISK_ADDED: 'Risk added',
  RISK_UPDATED: 'Risk updated',
  RISK_DELETED: 'Risk deleted',
  ISSUE_OPENED: 'Issue opened',
  ISSUE_UPDATED: 'Issue updated',
  ISSUE_RESOLVED: 'Issue resolved',
  ISSUE_DELETED: 'Issue deleted',
  DECISION_LOGGED: 'Decision logged',
  DECISION_UPDATED: 'Decision updated',
  DECISION_DELETED: 'Decision deleted',
  DECISION: 'Decision',
  MEETING_SCHEDULED: 'Meeting scheduled',
  MEETING_UPDATED: 'Meeting updated',
  MEETING_DELETED: 'Meeting deleted',
  MEMBER_ADDED: 'Team member added',
  MEMBER_REMOVED: 'Team member removed',
  MEMBER_UPDATED: 'Team member updated',
  MIGRATION_ITEM_CREATED: 'Migration item added',
  MIGRATION_ITEM_UPDATED: 'Migration item updated',
  MIGRATION_ITEM_DELETED: 'Migration item removed',
  ENGAGEMENT_CREATED: 'Engagement created',
  ENGAGEMENT_DELETED: 'Engagement deleted',
  LICENSE_UPDATED: 'License updated',
  PROFILE_UPDATED: 'Business profile updated',
  PROFILE_GENERATED: 'AI generated business profile',
  PHASE_UPDATED: 'Project phases updated',
  DATA_TEMPLATES_GENERATED: 'Data collection templates generated',
  CUSTOM_TEMPLATE_CREATED: 'Custom template created',
  DATA_FILE_UPLOADED: 'Data file uploaded',
  DATA_FILE_VALIDATED: 'Data file validated',
  NOTE: 'Note',
  OBSERVATION: 'Observation',
  TODO: 'Todo',
};

function titleCase(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function getActionMeta(action: string): ActionMeta {
  const label = ACTION_LABELS[action] ?? titleCase(action);
  for (const rule of CATEGORY_RULES) {
    if (rule.match(action)) {
      return {
        category: rule.category,
        label,
        color: rule.color,
        section: rule.section,
      };
    }
  }
  // Engagement / license / profile / phase actions are bucketed as "system"
  // since they're auto-emitted lifecycle events without a clear consultant
  // landing surface.
  return { category: 'system', label, color: 'slate', section: null };
}

// ─── groupByDay ──────────────────────────────────────────────────────────────

export interface ActivityGroup {
  /** YYYY-MM-DD key for stable sorting. */
  dateKey: string;
  /** Human-readable bucket label (Today / Yesterday / "7 May 2026"). */
  dateLabel: string;
  items: ActivityRow[];
}

function localYMD(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabelFor(activityIso: string, nowIso: string): string {
  const todayKey = localYMD(nowIso);
  const yesterdayKey = localYMD(new Date(new Date(nowIso).getTime() - 24 * 60 * 60 * 1000).toISOString());
  const activityKey = localYMD(activityIso);
  if (activityKey === todayKey) return 'Today';
  if (activityKey === yesterdayKey) return 'Yesterday';
  return new Date(activityIso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function groupByDay(activities: ActivityRow[], nowIso?: string): ActivityGroup[] {
  if (activities.length === 0) return [];
  const now = nowIso ?? new Date().toISOString();

  // Sort newest-first first so each bucket's items also stay newest-first.
  const sorted = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const buckets = new Map<string, ActivityGroup>();
  for (const a of sorted) {
    const key = localYMD(a.createdAt);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { dateKey: key, dateLabel: dateLabelFor(a.createdAt, now), items: [] };
      buckets.set(key, bucket);
    }
    bucket.items.push(a);
  }

  // Newest day-bucket first.
  return [...buckets.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

// ─── filterAndSearch ─────────────────────────────────────────────────────────

export interface FilterArgs {
  query: string;
  category: ActionCategory | 'all';
}

export function filterAndSearch(activities: ActivityRow[], { query, category }: FilterArgs): ActivityRow[] {
  const q = query.trim().toLowerCase();
  return activities.filter((a) => {
    if (category !== 'all') {
      const meta = getActionMeta(a.action);
      if (meta.category !== category) return false;
    }
    if (!q) return true;
    const meta = getActionMeta(a.action);
    const haystack = `${meta.label} ${a.details ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

// ─── paginate ────────────────────────────────────────────────────────────────

export interface PageResult<T> {
  page: number;
  totalPages: number;
  hasMore: boolean;
  items: T[];
}

export function paginate<T>(items: T[], page: number, pageSize: number): PageResult<T> {
  if (items.length === 0) {
    return { page: 1, totalPages: 0, hasMore: false, items: [] };
  }
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(page, 1), totalPages);
  const start = (clamped - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    page: clamped,
    totalPages,
    hasMore: clamped < totalPages,
    items: slice,
  };
}
