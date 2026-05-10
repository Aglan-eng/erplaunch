/**
 * Phase 47.1 — Microsoft Project Schedule XML generator.
 *
 * Pure function. Produces a Microsoft Project 2003 XML Schedule
 * Interchange document that opens natively in Microsoft Project
 * Desktop via File → Open → "MS Project Schedule (*.xml)". The PO's
 * desktop tool saves it as a .mpp on first save, so the consultant
 * ends up with a real .mpp without us needing to write the .mpp
 * binary format.
 *
 * Schema reference:
 *   learn.microsoft.com/office-project/xml-data-interchange/
 *     microsoft-project-2003-xml-data-interchange-schema-reference
 *
 * Output structure:
 *   /Project_Plan.xml — single file. Bundles into the standard
 *                       BUSINESS_PROFILE ZIP (Phase 47.2 also exposes
 *                       a standalone MS_PROJECT_PLAN job type).
 *
 * Mapping rules (locked by tests in tests/services/generators/
 * msProjectPlanGenerator.test.ts):
 *
 *   - 5 lifecycle stages (DISCOVERY / SCOPING / BUILD / UAT / GOLIVE)
 *     become 5 summary tasks (OutlineLevel=1, Summary=1) in canonical
 *     order. They chain FinishToStart (Type=1).
 *   - Open ActionItems (status != CLOSED) become sub-tasks
 *     (OutlineLevel=2) under their stage's summary. Default-bucketed
 *     to DISCOVERY when stage is unknown.
 *   - Decisions with needsAction=true become sub-tasks under their
 *     stage with a "Decision: " prefix.
 *   - Each CONSULTANT-team member becomes a Resource (CLIENT-team
 *     members are project stakeholders, not project resources, and
 *     are excluded — MS Project treats Resources as the people who
 *     get TIME ALLOCATED).
 *   - Module-scoped consultants get Assignments to Scoping/Build/UAT.
 *     Module-agnostic ones (PM, lead) get Assignments to all 5.
 *
 * Default phase durations (sum to 27 weeks): Discovery 4w, Scoping 6w,
 * Build 12w, UAT 4w, GoLive 1w. Locked in PHASE_DEFAULTS so the
 * pricing math, project-plan generator, and timeline UI can all read
 * the same source.
 */

// ─── Public types ───────────────────────────────────────────────────────────

export type LifecycleStage = 'DISCOVERY' | 'SCOPING' | 'BUILD' | 'UAT' | 'GOLIVE';

export interface MsProjectMember {
  name: string;
  role: string | null;
  team: string | null;
  /** EngagementRole.assignedModules — null = not module-scoped (covers
   *  all modules), [] same effect as null, ['p2p','r2r'] = module-scoped. */
  assignedModules: string[] | null;
}

export interface MsProjectActionItem {
  title: string;
  priority: string;
  /** Optional ISO date (YYYY-MM-DD). When set, overrides the phase
   *  default duration for this sub-task. */
  dueDate: string | null;
  status: string;
  /** Stage the task belongs to. Falls back to DISCOVERY when unknown. */
  stage: LifecycleStage | null;
}

export interface MsProjectDecision {
  title: string;
  stage: LifecycleStage | null;
  needsAction: boolean;
}

export interface MsProjectPlanInput {
  clientName: string;
  /** ISO date or null (we'll default to today). */
  startDate: string | null;
  /** ISO date or null (we'll default to startDate + total duration). */
  contractEndDate: string | null;
  projectManagerName: string | null;
  members: ReadonlyArray<MsProjectMember>;
  actionItems: ReadonlyArray<MsProjectActionItem>;
  decisions: ReadonlyArray<MsProjectDecision>;
}

// ─── Phase defaults ─────────────────────────────────────────────────────────

export const PHASE_DEFAULTS: Record<LifecycleStage, { name: string; weeks: number }> = {
  DISCOVERY: { name: 'Discovery', weeks: 4 },
  SCOPING: { name: 'Scoping', weeks: 6 },
  BUILD: { name: 'Build', weeks: 12 },
  UAT: { name: 'UAT', weeks: 4 },
  GOLIVE: { name: 'Go-Live', weeks: 1 },
};

const PHASE_ORDER: ReadonlyArray<LifecycleStage> = [
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
  'GOLIVE',
];

// ─── XML helpers ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format an ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) into MS
 * Project's expected `YYYY-MM-DDTHH:MM:SS` form. No timezone.
 */
function fmtDate(iso: string): string {
  // Strip any timezone or millisecond suffix.
  const trimmed = iso.length >= 19 ? iso.slice(0, 19) : `${iso.slice(0, 10)}T00:00:00`;
  return trimmed;
}

/**
 * MS Project's ISO 8601 duration form: PT{hours}H{minutes}M{seconds}S.
 * Always emit minutes + seconds even when zero — Project's parser
 * rejects truncated forms.
 */
function fmtDuration(weeks: number): string {
  // 1 week = 5 working days × 8 hours = 40 hours.
  const hours = Math.max(1, Math.round(weeks * 40));
  return `PT${hours}H0M0S`;
}

/** Add `days` working days to an ISO date string and return ISO date. */
function addWeeks(iso: string, weeks: number): string {
  const d = new Date(iso.length >= 19 ? iso : `${iso.slice(0, 10)}T00:00:00`);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return d.toISOString().slice(0, 19);
}

// ─── Pure generator ─────────────────────────────────────────────────────────

interface TaskRow {
  uid: number;
  id: number;
  name: string;
  outlineLevel: number;
  isSummary: boolean;
  start: string;
  finish: string;
  durationWeeks: number;
  predecessorUid?: number;
}

interface ResourceRow {
  uid: number;
  id: number;
  name: string;
}

interface AssignmentRow {
  uid: number;
  taskUid: number;
  resourceUid: number;
}

export function generateMsProjectPlan(input: MsProjectPlanInput): Record<string, string> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const startIso = input.startDate ?? todayIso;
  const totalWeeks = PHASE_ORDER.reduce((sum, s) => sum + PHASE_DEFAULTS[s].weeks, 0);
  const finishIso = input.contractEndDate ?? addWeeks(startIso, totalWeeks).slice(0, 10);

  // ── Build tasks ─────────────────────────────────────────────────────────
  const tasks: TaskRow[] = [];
  let nextUid = 1;
  let nextId = 1;
  const phaseUidByStage = new Map<LifecycleStage, number>();
  const phaseStartIsoByStage = new Map<LifecycleStage, string>();
  let cursor = startIso.length >= 19 ? startIso : `${startIso.slice(0, 10)}T00:00:00`;
  let prevPhaseUid: number | undefined;

  for (const stage of PHASE_ORDER) {
    const def = PHASE_DEFAULTS[stage];
    const weeks = def.weeks;
    const phaseStart = cursor;
    const phaseFinish = addWeeks(phaseStart, weeks);
    const uid = nextUid++;
    tasks.push({
      uid,
      id: nextId++,
      name: def.name,
      outlineLevel: 1,
      isSummary: true,
      start: phaseStart,
      finish: phaseFinish,
      durationWeeks: weeks,
      predecessorUid: prevPhaseUid,
    });
    phaseUidByStage.set(stage, uid);
    phaseStartIsoByStage.set(stage, phaseStart);
    prevPhaseUid = uid;
    cursor = phaseFinish;

    // Sub-tasks: open action items + needsAction decisions in this stage.
    const stageActionItems = input.actionItems.filter(
      (a) => (a.stage ?? 'DISCOVERY') === stage && a.status !== 'CLOSED',
    );
    for (const ai of stageActionItems) {
      const subStart = phaseStart;
      const subFinish = ai.dueDate
        ? fmtDate(ai.dueDate)
        : addWeeks(phaseStart, Math.max(0.2, weeks / Math.max(1, stageActionItems.length)));
      tasks.push({
        uid: nextUid++,
        id: nextId++,
        name: ai.title,
        outlineLevel: 2,
        isSummary: false,
        start: subStart,
        finish: subFinish,
        // Sub-task duration: a fraction of the phase, capped to whole-week
        // sane defaults so MS Project doesn't show "0d" rows.
        durationWeeks: Math.max(0.2, weeks / Math.max(1, stageActionItems.length)),
      });
    }
    const stageDecisions = input.decisions.filter(
      (d) => (d.stage ?? 'DISCOVERY') === stage && d.needsAction,
    );
    for (const dec of stageDecisions) {
      tasks.push({
        uid: nextUid++,
        id: nextId++,
        name: `Decision: ${dec.title}`,
        outlineLevel: 2,
        isSummary: false,
        start: phaseStart,
        finish: addWeeks(phaseStart, 0.5),
        durationWeeks: 0.5,
      });
    }
  }

  // ── Build resources from CONSULTANT-team members ─────────────────────────
  const resources: ResourceRow[] = [];
  const resourceUidByName = new Map<string, number>();
  let resUid = 1;
  let resId = 1;
  for (const m of input.members) {
    if ((m.team ?? '').toUpperCase() !== 'CONSULTANT') continue;
    const uid = resUid++;
    resources.push({ uid, id: resId++, name: m.name });
    resourceUidByName.set(m.name, uid);
  }

  // ── Build assignments ────────────────────────────────────────────────────
  // Module-agnostic consultants (no assignedModules) → all phase summaries.
  // Module-scoped consultants → Scoping/Build/UAT (the implementation arc
  // where their module work lives).
  const ASSIGN_TO_ALL_PHASES = PHASE_ORDER;
  const MODULE_SCOPED_PHASES: LifecycleStage[] = ['SCOPING', 'BUILD', 'UAT'];
  const assignments: AssignmentRow[] = [];
  let assignUid = 1;
  for (const m of input.members) {
    const ruid = resourceUidByName.get(m.name);
    if (ruid === undefined) continue;
    const phasesForMember =
      m.assignedModules && m.assignedModules.length > 0
        ? MODULE_SCOPED_PHASES
        : ASSIGN_TO_ALL_PHASES;
    for (const stage of phasesForMember) {
      const taskUid = phaseUidByStage.get(stage);
      if (taskUid === undefined) continue;
      assignments.push({
        uid: assignUid++,
        taskUid,
        resourceUid: ruid,
      });
    }
  }

  // ── Render XML ──────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<Project xmlns="http://schemas.microsoft.com/project">');
  lines.push(`  <Title>${esc(input.clientName)}</Title>`);
  lines.push(`  <Manager>${esc(input.projectManagerName ?? '')}</Manager>`);
  lines.push(`  <StartDate>${fmtDate(startIso)}</StartDate>`);
  lines.push(`  <FinishDate>${fmtDate(finishIso)}</FinishDate>`);
  // CalendarUID 1 = the standard 8h/day, 5d/week default that ships
  // with every Project install. Not strictly required but Project
  // displays "(no calendar)" warnings when omitted.
  lines.push('  <CalendarUID>1</CalendarUID>');

  // Tasks block.
  lines.push('  <Tasks>');
  for (const t of tasks) {
    lines.push('    <Task>');
    lines.push(`      <UID>${t.uid}</UID>`);
    lines.push(`      <ID>${t.id}</ID>`);
    lines.push(`      <Name>${esc(t.name)}</Name>`);
    lines.push(`      <Type>1</Type>`);
    lines.push(`      <OutlineLevel>${t.outlineLevel}</OutlineLevel>`);
    lines.push(`      <Summary>${t.isSummary ? 1 : 0}</Summary>`);
    lines.push(`      <Start>${fmtDate(t.start)}</Start>`);
    lines.push(`      <Finish>${fmtDate(t.finish)}</Finish>`);
    lines.push(`      <Duration>${fmtDuration(t.durationWeeks)}</Duration>`);
    lines.push(`      <Active>1</Active>`);
    lines.push(`      <Manual>0</Manual>`);
    if (t.predecessorUid !== undefined) {
      lines.push('      <PredecessorLink>');
      lines.push(`        <PredecessorUID>${t.predecessorUid}</PredecessorUID>`);
      lines.push('        <Type>1</Type>');
      lines.push('        <CrossProject>0</CrossProject>');
      lines.push('        <LinkLag>0</LinkLag>');
      lines.push('        <LagFormat>7</LagFormat>');
      lines.push('      </PredecessorLink>');
    }
    lines.push('    </Task>');
  }
  lines.push('  </Tasks>');

  // Resources block — always present, even if empty.
  lines.push('  <Resources>');
  for (const r of resources) {
    lines.push('    <Resource>');
    lines.push(`      <UID>${r.uid}</UID>`);
    lines.push(`      <ID>${r.id}</ID>`);
    lines.push(`      <Name>${esc(r.name)}</Name>`);
    lines.push('      <Type>1</Type>');
    lines.push('      <IsNull>0</IsNull>');
    lines.push('    </Resource>');
  }
  lines.push('  </Resources>');

  // Assignments block — always present, even if empty.
  lines.push('  <Assignments>');
  for (const a of assignments) {
    lines.push('    <Assignment>');
    lines.push(`      <UID>${a.uid}</UID>`);
    lines.push(`      <TaskUID>${a.taskUid}</TaskUID>`);
    lines.push(`      <ResourceUID>${a.resourceUid}</ResourceUID>`);
    lines.push('      <Units>1</Units>');
    lines.push('    </Assignment>');
  }
  lines.push('  </Assignments>');

  lines.push('</Project>');

  return { 'Project_Plan.xml': lines.join('\n') + '\n' };
}
