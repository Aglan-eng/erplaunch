/**
 * Phase 40.5 — pure helpers for the Bulk Auto-Fill panel.
 *
 * The Bulk Auto-Fill page lets the consultant pick multiple wizard
 * sections at once, run AI suggestion against all of them, and then
 * accept/skip each suggested answer individually. State is split into
 * three independent slices:
 *   - which sections are SELECTED for the suggest call
 *   - which sections have RECEIVED suggestions back
 *   - which individual suggestions have been ACCEPTED / SKIPPED
 *
 * Keeping the helpers pure means the orchestration state machine is
 * unit-testable without React; the Panel component composes them with
 * useReducer-style updates.
 *
 * `buildEngagementContextSummary` is shared with the server-side prompt
 * builder so risks/decisions/members influence Claude's suggestions
 * — running the same summariser client-side keeps the test pinned to a
 * single source of truth.
 */

// ─── Selection helpers ───────────────────────────────────────────────────────

export function toggleSectionSelection(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function selectAllSections(keys: readonly string[]): Set<string> {
  return new Set(keys);
}

export function clearSectionSelection(): Set<string> {
  return new Set();
}

// ─── Suggestion state ────────────────────────────────────────────────────────

export interface SectionSuggestion {
  suggestedAnswers: Record<string, unknown>;
  reasoning: Record<string, string>;
}

export type SuggestionMap = Record<string, SectionSuggestion>;

export interface AutoFillState {
  /** sectionKey → set of question ids accepted */
  accepted: Record<string, Set<string>>;
  /** sectionKey → set of question ids explicitly skipped */
  skipped: Record<string, Set<string>>;
}

function withSetUpdate(
  bucket: Record<string, Set<string>>,
  sectionKey: string,
  questionId: string,
  add: boolean
): Record<string, Set<string>> {
  const existing = bucket[sectionKey] ?? new Set<string>();
  const next = new Set(existing);
  if (add) next.add(questionId);
  else next.delete(questionId);
  return { ...bucket, [sectionKey]: next };
}

export function acceptSuggestion(state: AutoFillState, sectionKey: string, questionId: string): AutoFillState {
  return {
    accepted: withSetUpdate(state.accepted, sectionKey, questionId, true),
    skipped: withSetUpdate(state.skipped, sectionKey, questionId, false),
  };
}

export function skipSuggestion(state: AutoFillState, sectionKey: string, questionId: string): AutoFillState {
  return {
    accepted: withSetUpdate(state.accepted, sectionKey, questionId, false),
    skipped: withSetUpdate(state.skipped, sectionKey, questionId, true),
  };
}

export function isSuggestionResolved(
  state: AutoFillState,
  sectionKey: string,
  questionId: string
): boolean {
  return (
    state.accepted[sectionKey]?.has(questionId) === true ||
    state.skipped[sectionKey]?.has(questionId) === true
  );
}

export function countUnresolvedSuggestions(suggestions: SuggestionMap, state: AutoFillState): number {
  let count = 0;
  for (const [sectionKey, sec] of Object.entries(suggestions)) {
    for (const qId of Object.keys(sec.suggestedAnswers)) {
      if (!isSuggestionResolved(state, sectionKey, qId)) count++;
    }
  }
  return count;
}

// ─── Engagement context summary (shared shape with server) ──────────────────

export interface EngagementContextInput {
  risks: Array<{ title: string; severity?: string }>;
  decisions: Array<{ title: string }>;
  members: Array<{ name: string; role: string }>;
}

const MAX_LIST_ITEMS = 10;

export function buildEngagementContextSummary(input: EngagementContextInput): string {
  const lines: string[] = [];

  if (input.risks.length > 0) {
    const items = input.risks.slice(0, MAX_LIST_ITEMS).map((r) => {
      const sev = r.severity ? ` [${r.severity}]` : '';
      return `- ${r.title}${sev}`;
    });
    lines.push('Risks:', ...items);
    if (input.risks.length > MAX_LIST_ITEMS) {
      lines.push(`(…and ${input.risks.length - MAX_LIST_ITEMS} more)`);
    }
  }

  if (input.decisions.length > 0) {
    if (lines.length > 0) lines.push('');
    const items = input.decisions.slice(0, MAX_LIST_ITEMS).map((d) => `- ${d.title}`);
    lines.push('Decisions:', ...items);
    if (input.decisions.length > MAX_LIST_ITEMS) {
      lines.push(`(…and ${input.decisions.length - MAX_LIST_ITEMS} more)`);
    }
  }

  if (input.members.length > 0) {
    if (lines.length > 0) lines.push('');
    const items = input.members.slice(0, MAX_LIST_ITEMS).map((m) => `- ${m.name} (${m.role})`);
    lines.push('Team:', ...items);
  }

  return lines.join('\n');
}
