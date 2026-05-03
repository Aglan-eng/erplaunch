/**
 * Lessons Learned Register generator (Pack Y — Component 2).
 *
 * Cross-platform — emits Documentation/Stabilization/Lessons_Learned_Register.md.
 *
 * Structured retro register: 4-column "Theme | What | So what | Now
 * what" table seeded with the 7 canonical theme rows (always render
 * even when consultant doesn't pre-seed). Pre-captured items from
 * lessonsLearnedSeed render as starter rows above the canonical
 * defaults.
 */

import { parseLessons, DEFAULT_LESSON_THEMES, type ParsedLessonRow } from './stabilizationHelpers.js';

export interface LessonsLearnedInput {
  clientName: string;
  adaptorName?: string;
  /** TEXT stabilization.learning.retroFormat. */
  retroFormat?: string | null;
  /** TEXT stabilization.learning.retroDate. */
  retroDate?: string | null;
  /** TEXTAREA stabilization.learning.lessonsLearnedSeed. */
  lessonsLearnedSeed?: string | null;
  /** TEXT stabilization.governance.stabilizationOwner — drives owner row. */
  stabilizationOwner?: string | null;
}

export interface LessonsLearnedOutput {
  markdown: string;
}

function classifyAgenda(format: string): { label: string; agenda: ReadonlyArray<string> } {
  const lower = format.toLowerCase();
  if (lower.includes('half') || lower.includes('4 hour') || lower.includes('4-hour')) {
    return {
      label: 'Half-day workshop',
      agenda: [
        '00:00 — Welcome + ground rules + objectives (10 min)',
        '00:10 — Timeline walk: T-180 (kickoff) → T+30 (hypercare exit) — facilitator-led (30 min)',
        '00:40 — Theme-by-theme breakouts (small groups, 10 min each):',
        '         - Scope discipline · Change management · Data quality',
        '         - Integration testing · Sponsor engagement · Training depth · Hypercare staffing',
        '01:50 — Read-out: each group reports 2 lessons + 1 action (40 min)',
        '02:30 — Coffee break (15 min)',
        '02:45 — Cross-cutting themes: what would we do differently next time? (45 min)',
        '03:30 — Action backlog: assign owner + due date for every "now what" (45 min)',
        '04:15 — Sponsor close-out: thanks, what worked, what we commit to change (15 min)',
        '04:30 — End',
      ],
    };
  }
  // Default 90-minute compact retro.
  return {
    label: '90-minute compact retro',
    agenda: [
      '00:00 — Welcome + objectives (5 min)',
      '00:05 — Timeline walk: kickoff → hypercare exit — facilitator-led (15 min)',
      '00:20 — Brainstorm: what worked / what didn\'t / what surprised us (20 min, silent + post-it style)',
      '00:40 — Theme grouping (15 min)',
      '00:55 — Top 3-5 lessons + actions per theme (25 min)',
      '01:20 — Sponsor close-out + commitments (10 min)',
      '01:30 — End',
    ],
  };
}

function lessonRow(row: ParsedLessonRow): string {
  return [
    `| ${row.theme}`,
    row.what.length > 0 ? row.what : '_[ASSIGN — what happened]_',
    row.soWhat.length > 0 ? row.soWhat : '_[ASSIGN — so what?]_',
    row.nowWhat.length > 0 ? row.nowWhat : '_[ASSIGN — now what?]_',
    '',
  ].join(' | ');
}

function defaultThemeRow(theme: string): string {
  return [
    `| ${theme}`,
    '_[ASSIGN — what happened]_',
    '_[ASSIGN — so what?]_',
    '_[ASSIGN — now what?]_',
    '',
  ].join(' | ');
}

export function generateLessonsLearned(
  input: LessonsLearnedInput,
): LessonsLearnedOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const owner = input.stabilizationOwner?.trim().length
    ? input.stabilizationOwner.trim()
    : '_[ASSIGN stabilization owner]_';
  const retroDate = input.retroDate?.trim().length
    ? input.retroDate.trim()
    : '_[ASSIGN retro date — typically T+45, first Friday of month following hypercare exit]_';
  const retroFormat = input.retroFormat?.trim().length
    ? input.retroFormat.trim()
    : 'Half-day workshop with project + business + ops + sponsor (default)';
  const { label: agendaLabel, agenda } = classifyAgenda(retroFormat);
  const seeds = parseLessons((input.lessonsLearnedSeed ?? '').toString());

  // Render seeded rows first, then canonical defaults for any theme not
  // already covered by a seed (matching by case-insensitive theme name).
  const seededThemes = new Set(seeds.map((s) => s.theme.toLowerCase()));
  const canonicalRows = DEFAULT_LESSON_THEMES.filter(
    (t) => !seededThemes.has(t.toLowerCase()),
  ).map(defaultThemeRow);
  const seededRows = seeds.map(lessonRow);

  const markdown = [
    `# Lessons Learned Register — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Retro Date:** ${retroDate}  `,
    `**Format:** ${retroFormat}  `,
    `**Facilitator:** ${owner} (sustainment owner — see \`Documentation/Stabilization/Stabilization_Roadmap.md\`)  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Structured register for the post-hypercare retrospective. The 4-column ',
    '"Theme / What / So what / Now what" format forces every observation through ',
    'to an action. Pre-seeded items captured during hypercare render at the top; ',
    'canonical theme rows below provide the structural backbone the retro fills in.',
    '',
    '## 1. Retro Logistics',
    '',
    `- **Date:** ${retroDate}`,
    `- **Format:** ${retroFormat}`,
    `- **Attendees:** Project team + ${platformLabel} consultant team + business workstream leads + sponsor + selected power users (~12-20 people typical)`,
    `- **Facilitator:** ${owner}`,
    `- **Recording:** Yes — uploaded to client KB within 48h`,
    `- **Output:** This register, plus an actions backlog rolled into \`Documentation/Stabilization/Process_Improvement_Backlog.md\``,
    '',
    `## 2. Retro Agenda — ${agendaLabel}`,
    '',
    agenda.map((line) => `${line}`).join('\n'),
    '',
    '## 3. Lessons-Learned Register',
    '',
    'Every row follows the **Theme | What happened | So what | Now what** structure. ',
    'Pre-seeded items came from hypercare; canonical theme rows below are starters — ',
    'the retro fills them in.',
    '',
    '| Theme | What happened | So what (impact) | Now what (action) |',
    '|-------|---------------|-------------------|-------------------|',
    seededRows.length > 0 ? seededRows.join('\n') : '',
    canonicalRows.join('\n'),
    '',
    '## 4. Closure & Next Steps',
    '',
    'Every "Now what" action gets logged to the change-request backlog within ',
    '5 business days post-retro. See `Documentation/Stabilization/Process_Improvement_Backlog.md` ',
    'for triage rules + queue (Quick Wins / Enhancements / Phase Two).',
    '',
    'The register also feeds the next-engagement playbook — themes that show up across ',
    'multiple engagements get promoted into the standard implementation method as ',
    'preventive controls.',
    '',
    '## 5. Cross-References',
    '',
    '- Stabilization roadmap: `Documentation/Stabilization/Stabilization_Roadmap.md`',
    '- Process-improvement backlog: `Documentation/Stabilization/Process_Improvement_Backlog.md`',
    '- Continuous-improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- Hypercare plan (precedes this): `Documentation/Hypercare/Hypercare_Plan.md`',
    '- Defect log (hypercare history): `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ]
    .filter((line) => line !== '' || true) // preserve blanks
    .join('\n');

  return { markdown };
}
