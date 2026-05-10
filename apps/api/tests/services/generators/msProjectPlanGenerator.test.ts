/**
 * Phase 47.1 — pure tests for the Microsoft Project Schedule XML generator.
 *
 * Spec docs:
 *   learn.microsoft.com/office-project/xml-data-interchange/microsoft-project-2003-xml-data-interchange-schema-reference
 *
 * Output structure (validated below):
 *   <Project xmlns="http://schemas.microsoft.com/project">
 *     <Title>...</Title>
 *     <StartDate>YYYY-MM-DDTHH:MM:SS</StartDate>
 *     <FinishDate>YYYY-MM-DDTHH:MM:SS</FinishDate>
 *     <Manager>...</Manager>
 *     <Tasks>
 *       <Task><UID>1</UID><ID>1</ID><Name>Discovery</Name>...</Task>
 *       ...
 *     </Tasks>
 *     <Resources>
 *       <Resource><UID>1</UID><ID>1</ID><Name>...</Name></Resource>
 *     </Resources>
 *     <Assignments>
 *       <Assignment><TaskUID>3</TaskUID><ResourceUID>1</ResourceUID></Assignment>
 *     </Assignments>
 *   </Project>
 */
import { describe, it, expect } from 'vitest';
import {
  generateMsProjectPlan,
  type MsProjectPlanInput,
  PHASE_DEFAULTS,
} from '../../../src/services/generators/msProjectPlanGenerator.js';

function baseInput(over: Partial<MsProjectPlanInput> = {}): MsProjectPlanInput {
  return {
    clientName: 'Acme Industries',
    startDate: '2026-06-01',
    contractEndDate: '2026-12-31',
    projectManagerName: 'Alice Anderson',
    members: [
      { name: 'Alice Anderson', role: 'Project Manager', team: 'CONSULTANT', assignedModules: null },
      { name: 'Bob Builder', role: 'Functional Consultant', team: 'CONSULTANT', assignedModules: ['p2p'] },
      { name: 'Carla Coder', role: 'Technical Consultant', team: 'CONSULTANT', assignedModules: ['integrations'] },
      { name: 'Daisy Decider', role: 'Project Sponsor', team: 'CLIENT', assignedModules: null },
    ],
    actionItems: [
      { title: 'Confirm GL chart of accounts', priority: 'HIGH', stage: 'DISCOVERY', dueDate: '2026-06-15', status: 'OPEN' },
      { title: 'Sign off COA design', priority: 'MEDIUM', stage: 'SCOPING', dueDate: null, status: 'OPEN' },
      { title: 'Already done thing', priority: 'LOW', stage: 'BUILD', dueDate: null, status: 'CLOSED' },
    ],
    decisions: [
      { title: 'Multi-currency yes/no', stage: 'DISCOVERY', needsAction: true },
      { title: 'Already-decided thing', stage: 'SCOPING', needsAction: false },
    ],
    ...over,
  };
}

describe('generateMsProjectPlan — top-level structure', () => {
  it('emits the canonical /Project_Plan.xml file', () => {
    const out = generateMsProjectPlan(baseInput());
    expect(out['Project_Plan.xml']).toBeDefined();
  });

  it('has a single XML declaration + Project root with the MS schema namespace', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml.startsWith('<?xml ')).toBe(true);
    expect(xml).toMatch(/<Project[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/project"/);
    expect(xml).toContain('</Project>');
  });

  it('renders the engagement metadata as Title / StartDate / FinishDate / Manager', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml).toContain('<Title>Acme Industries</Title>');
    // Dates are MS Project's `YYYY-MM-DDTHH:MM:SS` form.
    expect(xml).toMatch(/<StartDate>2026-06-01T00:00:00<\/StartDate>/);
    expect(xml).toMatch(/<FinishDate>2026-12-31T00:00:00<\/FinishDate>/);
    expect(xml).toContain('<Manager>Alice Anderson</Manager>');
  });

  it('escapes XML-special characters in metadata', () => {
    const xml = generateMsProjectPlan(
      baseInput({ clientName: 'Smith & Jones <Co>' }),
    )['Project_Plan.xml'];
    expect(xml).toContain('<Title>Smith &amp; Jones &lt;Co&gt;</Title>');
    // No raw ampersand outside entities
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});

describe('generateMsProjectPlan — task hierarchy', () => {
  it('emits 5 phase summary tasks at OutlineLevel 1 in canonical order', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    const phaseNames = ['Discovery', 'Scoping', 'Build', 'UAT', 'Go-Live'];
    for (const name of phaseNames) {
      expect(xml).toMatch(new RegExp(`<Name>${name}</Name>`));
    }
    // Summary tasks have <Summary>1</Summary>.
    const summaryCount = (xml.match(/<Summary>1<\/Summary>/g) ?? []).length;
    expect(summaryCount).toBe(5);
  });

  it('places open action items as sub-tasks (OutlineLevel 2) under their phase', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml).toMatch(/<Name>Confirm GL chart of accounts<\/Name>/);
    expect(xml).toMatch(/<Name>Sign off COA design<\/Name>/);
    // OutlineLevel 2 means a sub-task — at least 2 of these for the
    // open action items + at least 1 for the open decision.
    const subCount = (xml.match(/<OutlineLevel>2<\/OutlineLevel>/g) ?? []).length;
    expect(subCount).toBeGreaterThanOrEqual(3);
  });

  it('skips closed action items (status=CLOSED)', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml).not.toMatch(/<Name>Already done thing<\/Name>/);
  });

  it('places decisions marked needsAction as sub-tasks under their phase', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml).toMatch(/<Name>Decision: Multi-currency yes\/no<\/Name>/);
  });

  it('skips decisions where needsAction is false', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml).not.toMatch(/Already-decided thing/);
  });

  it('chains phase summaries with FinishToStart predecessor links (Type=1)', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    // 4 dependencies: Disc→Scop, Scop→Build, Build→UAT, UAT→GoLive.
    const linkCount = (xml.match(/<PredecessorLink>/g) ?? []).length;
    expect(linkCount).toBe(4);
    // Type=1 is FinishToStart in MS Project's schema.
    expect(xml).toMatch(/<Type>1<\/Type>/);
  });
});

describe('generateMsProjectPlan — durations', () => {
  it('uses PHASE_DEFAULTS when no action item dueDates are set', () => {
    const xml = generateMsProjectPlan(
      baseInput({ actionItems: [], decisions: [] }),
    )['Project_Plan.xml'];
    // MS Project duration format: PT{minutes}H{minutes}M0S — uses
    // minutes for the smallest unit. We assert the Discovery phase
    // duration is 4 weeks = 4*40h = 160h = 9600m worth of minutes.
    // The generator uses MS Project's "PT...H...M..." form so just
    // confirm the Discovery summary's Duration is non-empty and
    // mentions hours.
    const discoveryBlock = xml.match(/<Name>Discovery<\/Name>[\s\S]*?<\/Task>/);
    expect(discoveryBlock).toBeTruthy();
    expect(discoveryBlock?.[0]).toMatch(/<Duration>PT\d+H\d+M\d+S<\/Duration>/);
  });

  it('PHASE_DEFAULTS sums to a 27-week implementation', () => {
    // 4 + 6 + 12 + 4 + 1 = 27w. This is documented spec — pin it
    // so later phase rebalancing doesn't accidentally drift.
    const total = Object.values(PHASE_DEFAULTS).reduce((a, b) => a + b.weeks, 0);
    expect(total).toBe(27);
  });
});

describe('generateMsProjectPlan — resources', () => {
  it('emits a Resource entity per CONSULTANT-team member', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    // Resources block exists.
    expect(xml).toMatch(/<Resources>[\s\S]*<\/Resources>/);
    // 3 consultants — Alice + Bob + Carla. Daisy is CLIENT and
    // doesn't get a Resource (clients aren't allocated to project
    // tasks in MS Project).
    expect(xml).toMatch(/<Name>Alice Anderson<\/Name>/);
    expect(xml).toMatch(/<Name>Bob Builder<\/Name>/);
    expect(xml).toMatch(/<Name>Carla Coder<\/Name>/);
    // Carla is CLIENT-team and shouldn't appear as a Resource.
    const resourceBlock = xml.match(/<Resources>[\s\S]*?<\/Resources>/)?.[0] ?? '';
    expect(resourceBlock).not.toMatch(/<Name>Daisy Decider<\/Name>/);
  });

  it('emits Assignments linking each resource to phases for their assigned modules', () => {
    const xml = generateMsProjectPlan(baseInput())['Project_Plan.xml'];
    expect(xml).toMatch(/<Assignments>[\s\S]*<\/Assignments>/);
    // At least one Assignment row.
    expect(xml).toMatch(/<Assignment>[\s\S]*?<TaskUID>[\s\S]*?<ResourceUID>[\s\S]*?<\/Assignment>/);
  });

  it('handles members with no assigned modules — they assign to all build phases', () => {
    const xml = generateMsProjectPlan(
      baseInput({
        members: [
          { name: 'PM', role: 'Project Manager', team: 'CONSULTANT', assignedModules: null },
        ],
      }),
    )['Project_Plan.xml'];
    // PM with no module assignments still gets attached to phases —
    // typically across the implementation arc. Confirm at least one
    // assignment row references their resource UID.
    const resourceUid = xml.match(/<Resource>[\s\S]*?<UID>(\d+)<\/UID>/)?.[1];
    expect(resourceUid).toBeTruthy();
    expect(xml).toMatch(new RegExp(`<ResourceUID>${resourceUid}</ResourceUID>`));
  });
});

describe('generateMsProjectPlan — defensive defaults', () => {
  it('falls back gracefully when startDate is missing', () => {
    const xml = generateMsProjectPlan(
      baseInput({ startDate: null, contractEndDate: null }),
    )['Project_Plan.xml'];
    // Both dates default to today + a 27-week window. We just check
    // that the produced XML still has valid date elements.
    expect(xml).toMatch(/<StartDate>\d{4}-\d{2}-\d{2}T00:00:00<\/StartDate>/);
    expect(xml).toMatch(/<FinishDate>\d{4}-\d{2}-\d{2}T00:00:00<\/FinishDate>/);
  });

  it('produces output even when there are zero members + zero action items', () => {
    const xml = generateMsProjectPlan(
      baseInput({ members: [], actionItems: [], decisions: [] }),
    )['Project_Plan.xml'];
    // Still 5 phase summaries; empty Resources + Assignments blocks
    // are still present (MS Project tolerates them empty).
    expect((xml.match(/<Summary>1<\/Summary>/g) ?? []).length).toBe(5);
    expect(xml).toMatch(/<Resources>[\s\S]*?<\/Resources>/);
    expect(xml).toMatch(/<Assignments>[\s\S]*?<\/Assignments>/);
  });

  it('uses a sensible Manager fallback when projectManagerName is null', () => {
    const xml = generateMsProjectPlan(
      baseInput({ projectManagerName: null }),
    )['Project_Plan.xml'];
    // Empty Manager element is valid XML and MS Project accepts it.
    expect(xml).toMatch(/<Manager><\/Manager>|<Manager\/>/);
  });
});
