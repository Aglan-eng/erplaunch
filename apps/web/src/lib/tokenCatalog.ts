/**
 * Phase 50.5 — Client-side mirror of the api's TOKEN_CATALOG.
 *
 * Lives in `apps/web/src/lib/` so the variable palette doesn't have to
 * fetch a catalog endpoint on render. The list is duplicated rather
 * than fetched because:
 *   - The vocabulary is small (under 25 entries) and changes per
 *     phase, not per session.
 *   - The palette renders inline in the editor; a fetch round-trip
 *     would noticeably delay the first paint.
 *   - The server-side renderer is the source of truth — anything
 *     here that drifts surfaces immediately when an author tries
 *     to use a non-existent token (the api echoes `missingTokens`
 *     in the from-template response).
 *
 * Keep in sync with apps/api/src/services/templateRenderer.ts:TOKEN_CATALOG.
 */

export type TokenGroup =
  | 'Firm'
  | 'Engagement'
  | 'People'
  | 'Decisions'
  | 'Risks'
  | 'Action Items'
  | 'System';

export interface TokenEntry {
  group: TokenGroup;
  token: string;
  description: string;
}

export const TOKEN_CATALOG: ReadonlyArray<TokenEntry> = [
  { group: 'Firm', token: 'firm.name', description: 'Display name (falls back to legal name).' },
  { group: 'Firm', token: 'firm.tagline', description: 'Tagline from the Brand Pack.' },
  { group: 'Firm', token: 'firm.contactEmail', description: 'Firm support email.' },
  { group: 'Firm', token: 'firm.logoUrl', description: 'Firm logo URL.' },
  { group: 'Firm', token: 'firm.primaryColor', description: 'Primary brand color (hex).' },
  { group: 'Firm', token: 'firm.secondaryColor', description: 'Secondary brand color (hex).' },

  { group: 'Engagement', token: 'engagement.client', description: 'Client / company name.' },
  { group: 'Engagement', token: 'engagement.code', description: 'Internal engagement code.' },
  { group: 'Engagement', token: 'engagement.status', description: 'Current lifecycle stage.' },
  { group: 'Engagement', token: 'engagement.startDate', description: 'Kickoff date (YYYY-MM-DD).' },
  { group: 'Engagement', token: 'engagement.targetGoLive', description: 'Target go-live (YYYY-MM-DD).' },
  { group: 'Engagement', token: 'engagement.modules', description: 'Comma-joined list of licensed modules.' },
  { group: 'Engagement', token: 'engagement.cutoverStrategy', description: 'BIG_BANG | PHASED.' },

  { group: 'People', token: 'client.lead.name', description: 'Client-side project lead.' },
  { group: 'People', token: 'client.sponsor.name', description: 'Client-side sponsor.' },
  { group: 'People', token: 'consultant.lead.name', description: 'Firm-side implementation lead.' },

  { group: 'Decisions', token: 'decisions.signedOff', description: 'Bullet list of signed-off decisions.' },
  { group: 'Decisions', token: 'decisions.pending', description: 'Bullet list of pending decisions.' },

  { group: 'Risks', token: 'risks.top5', description: 'Markdown table of top 5 risks by score.' },

  { group: 'Action Items', token: 'actionItems.open', description: 'Bullet list of open action items.' },

  { group: 'System', token: 'today', description: 'Current date (YYYY-MM-DD).' },
];

/** Stable group order — matches the palette UI's display order. */
export const TOKEN_GROUPS_IN_ORDER: ReadonlyArray<TokenGroup> = [
  'Firm',
  'Engagement',
  'People',
  'Decisions',
  'Risks',
  'Action Items',
  'System',
];

/** Group the catalog into a Map<group, entries[]> for easy rendering. */
export function tokensByGroup(): Map<TokenGroup, TokenEntry[]> {
  const out = new Map<TokenGroup, TokenEntry[]>();
  for (const group of TOKEN_GROUPS_IN_ORDER) out.set(group, []);
  for (const entry of TOKEN_CATALOG) {
    const list = out.get(entry.group);
    if (list) list.push(entry);
  }
  return out;
}
