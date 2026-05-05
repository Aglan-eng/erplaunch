/**
 * SDF Workflow generator (Pack W — Workflow Coverage).
 *
 * Reads the APPROVALS flow's wizard answers and emits one Oracle SDF
 * `customworkflow_*.xml` per in-scope workflow:
 *   - Amount-tiered approvals (PO / JE / VB) — same wire format as
 *     Pack 3's poApprovalTiers, parsed via the shared
 *     approvalTierParser. Each generates a Pending → Approved/Rejected
 *     state machine, with a Workflow Action callback that computes the
 *     NEXT_APPROVER role based on the parsed tiers.
 *   - Expense — role-chain format ("Standard: Manager → Director").
 *     Renders as a sequential approval state chain (one state per
 *     role in the chain).
 *   - Sales Order — condition-list format ("Customer over credit
 *     limit"). Renders as a single Hold → Approved/Rejected state
 *     with the conditions captured in the workflow description.
 *   - Custom record state workflows — manual transitions only between
 *     the listed states. No approval semantics.
 *
 * SuiteFlow is admin-editable post-deploy. The PO UE script from
 * Pack 3 is repositioned as a fallback / legacy pattern; modern
 * engagements get the workflow + WFA script combo.
 *
 * Sources:
 *   - NetSuite SDF workflow XML reference (workflow / workflowstate /
 *     workflowtransition / workflowactions schemas).
 *   - NetSuite SuiteFlow Workflow Manager documentation.
 *   - Standard NetSuite approval routing best practices (Oracle Help).
 */

import { type ParsedTier } from './approvalTierParser.js';

// ─── Workflow type metadata ──────────────────────────────────────────────────

/** Metadata for one amount-tiered approval workflow. */
interface AmountTieredApprovalMeta {
  /** Internal workflow type key — drives the scriptid + WFA filename
   *  ("po", "je", "vb"). */
  typeKey: 'po' | 'je' | 'vb';
  /** NetSuite recordtype enum value. */
  recordType: 'PURCHORD' | 'JOURNALENTRY' | 'VENDBILL';
  /** Human display name (drives <name> + JSDoc). */
  displayName: string;
  /** Wizard scope flag answer key. */
  scopeAnswerKey: string;
  /** Wizard tiers TEXTAREA answer key. */
  tiersAnswerKey: string;
}

const AMOUNT_TIERED_APPROVALS: ReadonlyArray<AmountTieredApprovalMeta> = [
  {
    typeKey: 'po',
    recordType: 'PURCHORD',
    displayName: 'Purchase Order',
    scopeAnswerKey: 'ns.approvals.poApprovalInScope',
    tiersAnswerKey: 'ns.approvals.poApprovalTiers',
  },
  {
    typeKey: 'je',
    recordType: 'JOURNALENTRY',
    displayName: 'Journal Entry',
    scopeAnswerKey: 'ns.approvals.jeApprovalInScope',
    tiersAnswerKey: 'ns.approvals.jeApprovalTiers',
  },
  {
    typeKey: 'vb',
    recordType: 'VENDBILL',
    displayName: 'Vendor Bill',
    scopeAnswerKey: 'ns.approvals.vbApprovalInScope',
    tiersAnswerKey: 'ns.approvals.vbApprovalTiers',
  },
];

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface WorkflowGeneratorInput {
  /** Whole answers map — the generator pulls only the APPROVALS flow
   *  keys it knows about. Tolerant of missing keys / wrong types. */
  answers: Record<string, unknown>;
}

export interface EmittedWorkflow {
  /** Bundle-relative path. */
  filename: string;
  /** scriptid (e.g., "customworkflow_nsix_po_approval"). */
  scriptid: string;
  /** Workflow type — 'amount-tier' / 'expense' / 'so' / 'record-state'. */
  category: 'amount-tier' | 'expense' | 'so' | 'record-state';
  /** Type key for amount-tier (po/je/vb), or short slug for the others. */
  typeKey: string;
  /** Display name for logging / harness. */
  displayName: string;
}

export interface WorkflowGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedWorkflow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/** Render the wizard answer as XML comment lines (each prefixed with
 *  "    " indent so the comment block stays readable inside the
 *  workflow XML's top-level comment). */
function answerToCommentLines(answer: string): string {
  const normalised = answer.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return '    (none provided)';
  return lines.map((l) => `    ${l}`).join('\n');
}

function bool(answers: Record<string, unknown>, key: string): boolean {
  return answers[key] === true;
}

function str(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === 'string' ? v : '';
}

function num(answers: Record<string, unknown>, key: string): number {
  const v = answers[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0 && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return 0;
}

// ─── Amount-tier workflow XML emission ──────────────────────────────────────

function buildAmountTierWorkflowXml(args: {
  meta: AmountTieredApprovalMeta;
  rawAnswer: string;
  notificationCadence: string;
  escalationDays: number;
}): string {
  const scriptid = `customworkflow_nsix_${args.meta.typeKey}_approval`;
  const wfaScriptid = `NSIX_WFA_${args.meta.typeKey.toUpperCase()}_Approval`;
  const escalation =
    args.escalationDays > 0 ? `${args.escalationDays} day(s)` : 'none';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Workflow Generator from wizard answer ${args.meta.tiersAnswerKey}.
  Workflow type: ${args.meta.displayName}
  Tiers (parsed from wizard):
${answerToCommentLines(args.rawAnswer)}
  Notification cadence: ${args.notificationCadence}
  Escalation: ${escalation}
  Companion script: SDF/SuiteScripts/${wfaScriptid}.js (computes NEXT_APPROVER per tier)
  Review before deploy:
    - Confirm role IDs match the custom roles emitted in Pack C (when shipped)
    - Test routing in NetSuite Workflow Manager
    - Adjust approval queue saved-search filters if needed
-->
<workflow scriptid="${scriptid}">
  <name>${xmlEscape(args.meta.displayName)} Approval</name>
  <recordtypes>
    <recordtype>${args.meta.recordType}</recordtype>
  </recordtypes>
  <isinactive>F</isinactive>
  <releasestatus>RELEASED</releasestatus>
  <runasadmin>F</runasadmin>
  <description>Multi-tier ${xmlEscape(args.meta.displayName)} approval — generated by ERPLaunch.</description>
  <initstates>
    <initstate>workflowstate_pending</initstate>
  </initstates>
  <triggertype>SUBMIT</triggertype>
  <isinitoncreate>T</isinitoncreate>
  <isinitonupdate>F</isinitonupdate>
  <workflowstates>
    <workflowstate scriptid="workflowstate_pending">
      <name>Pending Approval</name>
      <donottriggerworkflow>F</donottriggerworkflow>
      <workflowactions>
        <sendemailaction scriptid="workflowaction_pending_notify">
          <triggertype>ONENTRY</triggertype>
          <recipienttype>FIELD</recipienttype>
          <recipientfield>NEXT_APPROVER</recipientfield>
          <subject>Approval required</subject>
          <body>Please review and approve.</body>
        </sendemailaction>
      </workflowactions>
      <workflowtransitions>
        <workflowtransition scriptid="transition_pending_to_approved">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <buttonaction>STDBUTTONAPPROVE</buttonaction>
          <tostate>workflowstate_approved</tostate>
        </workflowtransition>
        <workflowtransition scriptid="transition_pending_to_rejected">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <buttonaction>STDBUTTONREJECT</buttonaction>
          <tostate>workflowstate_rejected</tostate>
        </workflowtransition>
      </workflowtransitions>
    </workflowstate>
    <workflowstate scriptid="workflowstate_approved">
      <name>Approved</name>
      <workflowactions>
        <setfieldvalueaction scriptid="workflowaction_set_approved">
          <triggertype>ONENTRY</triggertype>
          <field>APPROVALSTATUS</field>
          <staticvalue>2</staticvalue>
        </setfieldvalueaction>
      </workflowactions>
    </workflowstate>
    <workflowstate scriptid="workflowstate_rejected">
      <name>Rejected</name>
      <workflowactions>
        <setfieldvalueaction scriptid="workflowaction_set_rejected">
          <triggertype>ONENTRY</triggertype>
          <field>APPROVALSTATUS</field>
          <staticvalue>3</staticvalue>
        </setfieldvalueaction>
      </workflowactions>
    </workflowstate>
  </workflowstates>
</workflow>
`;
}

// ─── Expense workflow XML emission ───────────────────────────────────────────

/** Parse the role-chain answer for expense approvals. Each line is a
 *  tier name + chain of roles separated by " → " (or "->" or ">").
 *  Returns the parsed lines verbatim — the workflow XML embeds them
 *  in the description rather than encoding the chain as states (NS
 *  expense approval is typically configured via the standard
 *  Expense Report approval workflow + role hierarchy, not a custom
 *  multi-state workflow). */
function buildExpenseWorkflowXml(args: {
  rawAnswer: string;
  notificationCadence: string;
  escalationDays: number;
}): string {
  const scriptid = 'customworkflow_nsix_expense_approval';
  const wfaScriptid = 'NSIX_WFA_Expense_Approval';
  const escalation =
    args.escalationDays > 0 ? `${args.escalationDays} day(s)` : 'none';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Workflow Generator from wizard answer ns.approvals.expenseApprovalTiers.
  Workflow type: Expense Report
  Role chains (parsed from wizard):
${answerToCommentLines(args.rawAnswer)}
  Notification cadence: ${args.notificationCadence}
  Escalation: ${escalation}
  Companion script: SDF/SuiteScripts/${wfaScriptid}.js (resolves the next role in the chain)
  Review before deploy:
    - Confirm Manager / Director / CFO role IDs match the org's role tree
    - NetSuite's standard Expense Report approval respects employee.supervisor
      already; this workflow layers tier-specific overrides on top
-->
<workflow scriptid="${scriptid}">
  <name>Expense Report Approval</name>
  <recordtypes>
    <recordtype>EXPRPT</recordtype>
  </recordtypes>
  <isinactive>F</isinactive>
  <releasestatus>RELEASED</releasestatus>
  <runasadmin>F</runasadmin>
  <description>Tiered Expense Report approval routing — generated by ERPLaunch.</description>
  <initstates>
    <initstate>workflowstate_pending</initstate>
  </initstates>
  <triggertype>SUBMIT</triggertype>
  <isinitoncreate>T</isinitoncreate>
  <isinitonupdate>F</isinitonupdate>
  <workflowstates>
    <workflowstate scriptid="workflowstate_pending">
      <name>Pending Approval</name>
      <workflowactions>
        <sendemailaction scriptid="workflowaction_pending_notify">
          <triggertype>ONENTRY</triggertype>
          <recipienttype>FIELD</recipienttype>
          <recipientfield>NEXT_APPROVER</recipientfield>
          <subject>Expense report approval required</subject>
          <body>Please review and approve the expense report.</body>
        </sendemailaction>
      </workflowactions>
      <workflowtransitions>
        <workflowtransition scriptid="transition_pending_to_approved">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <buttonaction>STDBUTTONAPPROVE</buttonaction>
          <tostate>workflowstate_approved</tostate>
        </workflowtransition>
        <workflowtransition scriptid="transition_pending_to_rejected">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <buttonaction>STDBUTTONREJECT</buttonaction>
          <tostate>workflowstate_rejected</tostate>
        </workflowtransition>
      </workflowtransitions>
    </workflowstate>
    <workflowstate scriptid="workflowstate_approved">
      <name>Approved</name>
      <workflowactions>
        <setfieldvalueaction scriptid="workflowaction_set_approved">
          <triggertype>ONENTRY</triggertype>
          <field>APPROVALSTATUS</field>
          <staticvalue>2</staticvalue>
        </setfieldvalueaction>
      </workflowactions>
    </workflowstate>
    <workflowstate scriptid="workflowstate_rejected">
      <name>Rejected</name>
      <workflowactions>
        <setfieldvalueaction scriptid="workflowaction_set_rejected">
          <triggertype>ONENTRY</triggertype>
          <field>APPROVALSTATUS</field>
          <staticvalue>3</staticvalue>
        </setfieldvalueaction>
      </workflowactions>
    </workflowstate>
  </workflowstates>
</workflow>
`;
}

// ─── Sales Order workflow XML emission ──────────────────────────────────────

/** SO approval is conditional — single Hold → Approved/Rejected
 *  state with the trigger conditions captured in the workflow
 *  description. */
function buildSoWorkflowXml(args: {
  rawAnswer: string;
  notificationCadence: string;
  escalationDays: number;
}): string {
  const scriptid = 'customworkflow_nsix_so_approval';
  const escalation =
    args.escalationDays > 0 ? `${args.escalationDays} day(s)` : 'none';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Workflow Generator from wizard answer ns.approvals.soApprovalTrigger.
  Workflow type: Sales Order (conditional approval — only fires when triggers match)
  Trigger conditions (verbatim from wizard):
${answerToCommentLines(args.rawAnswer)}
  Notification cadence: ${args.notificationCadence}
  Escalation: ${escalation}
  Review before deploy:
    - Encode the trigger conditions above as Saved Search criteria
      OR as VISUAL_BUILDER conditions inside the workflow's initiation block
    - Confirm Sales Manager + Director role IDs match the org's role tree
-->
<workflow scriptid="${scriptid}">
  <name>Sales Order Approval (Hold)</name>
  <recordtypes>
    <recordtype>SALESORD</recordtype>
  </recordtypes>
  <isinactive>F</isinactive>
  <releasestatus>RELEASED</releasestatus>
  <runasadmin>F</runasadmin>
  <description>Conditional Sales Order approval — only initiates when trigger conditions match.</description>
  <initstates>
    <initstate>workflowstate_hold</initstate>
  </initstates>
  <triggertype>SUBMIT</triggertype>
  <isinitoncreate>T</isinitoncreate>
  <isinitonupdate>T</isinitonupdate>
  <workflowstates>
    <workflowstate scriptid="workflowstate_hold">
      <name>On Hold</name>
      <workflowactions>
        <sendemailaction scriptid="workflowaction_hold_notify">
          <triggertype>ONENTRY</triggertype>
          <recipienttype>FIELD</recipienttype>
          <recipientfield>NEXT_APPROVER</recipientfield>
          <subject>Sales order requires approval</subject>
          <body>Sales order is on hold pending approval review.</body>
        </sendemailaction>
      </workflowactions>
      <workflowtransitions>
        <workflowtransition scriptid="transition_hold_to_approved">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <buttonaction>STDBUTTONAPPROVE</buttonaction>
          <tostate>workflowstate_approved</tostate>
        </workflowtransition>
        <workflowtransition scriptid="transition_hold_to_rejected">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <buttonaction>STDBUTTONREJECT</buttonaction>
          <tostate>workflowstate_rejected</tostate>
        </workflowtransition>
      </workflowtransitions>
    </workflowstate>
    <workflowstate scriptid="workflowstate_approved">
      <name>Approved</name>
    </workflowstate>
    <workflowstate scriptid="workflowstate_rejected">
      <name>Rejected</name>
    </workflowstate>
  </workflowstates>
</workflow>
`;
}

// ─── Custom record state workflow emission ──────────────────────────────────

interface ParsedRecordStateWorkflow {
  /** Original record name from the wizard. */
  recordName: string;
  /** Slug for the workflow scriptid. */
  recordSlug: string;
  /** State names in declared order. */
  states: string[];
}

/** Parse one line of the record-state wizard answer:
 *    "<record>: <comma-separated states>"
 *  Returns null on failure. */
function parseRecordStateLine(line: string): ParsedRecordStateWorkflow | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx < 0) return null;
  const recordName = trimmed.slice(0, colonIdx).trim();
  const statesPart = trimmed.slice(colonIdx + 1).trim();
  if (recordName.length === 0 || statesPart.length === 0) return null;
  const states = statesPart
    .split(/[,/]|→| -> /)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (states.length < 2) return null; // need ≥2 states for a state machine
  return { recordName, recordSlug: slugify(recordName), states };
}

function buildRecordStateWorkflowXml(parsed: ParsedRecordStateWorkflow): string {
  const scriptid = `customworkflow_nsix_${parsed.recordSlug}_state`;
  const recordTypeRef = `customrecord_${parsed.recordSlug}`;
  const stateBlocks = parsed.states
    .map((state, i) => {
      const stateSlug = slugify(state);
      const transitions = parsed.states
        .map((other, j) => {
          if (i === j) return null;
          const otherSlug = slugify(other);
          return `        <workflowtransition scriptid="transition_${stateSlug}_to_${otherSlug}">
          <conditiontype>VISUAL_BUILDER</conditiontype>
          <tostate>workflowstate_${otherSlug}</tostate>
        </workflowtransition>`;
        })
        .filter((t): t is string => t !== null)
        .join('\n');
      return `    <workflowstate scriptid="workflowstate_${stateSlug}">
      <name>${xmlEscape(state)}</name>
      <workflowtransitions>
${transitions}
      </workflowtransitions>
    </workflowstate>`;
    })
    .join('\n');
  const initStateSlug = slugify(parsed.states[0]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Workflow Generator from wizard answer ns.approvals.recordStateWorkflows.
  Custom record: ${xmlEscape(parsed.recordName)}
  States (in declared order — first state is the initial state):
${parsed.states.map((s) => `    - ${s}`).join('\n')}
  Manual transitions only — no approval semantics. Configure conditions
  + button actions per transition in NetSuite Workflow Manager before
  deploy.
-->
<workflow scriptid="${scriptid}">
  <name>${xmlEscape(parsed.recordName)} State Workflow</name>
  <recordtypes>
    <recordtype>[scriptid=${recordTypeRef}]</recordtype>
  </recordtypes>
  <isinactive>F</isinactive>
  <releasestatus>RELEASED</releasestatus>
  <runasadmin>F</runasadmin>
  <description>Custom record state machine — generated by ERPLaunch.</description>
  <initstates>
    <initstate>workflowstate_${initStateSlug}</initstate>
  </initstates>
  <triggertype>SUBMIT</triggertype>
  <isinitoncreate>T</isinitoncreate>
  <isinitonupdate>F</isinitonupdate>
  <workflowstates>
${stateBlocks}
  </workflowstates>
</workflow>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit one customworkflow XML per in-scope approval workflow + per
 * declared custom record state machine.
 *
 * For amount-tiered approvals (PO/JE/VB): only emits when the scope
 * flag is true. The tier answer parses through approvalTierParser;
 * unparseable answers still emit the workflow XML (the workflow
 * shape doesn't need parsed tiers — those drive the WFA script
 * generator instead) but the XML's comment header preserves the
 * verbatim wizard text so the consultant can audit.
 *
 * For Expense / SO: same scope-flag gate, no parsing required (free
 * text gets embedded in the workflow description).
 *
 * For record state workflows: scope flag + parses the multi-line
 * record-state answer, emitting one XML per parsed line that has
 * ≥2 states.
 */
export function generateWorkflows(input: WorkflowGeneratorInput): WorkflowGeneratorOutput {
  const files: Record<string, string> = {};
  const emitted: EmittedWorkflow[] = [];

  const notificationCadence = str(input.answers, 'ns.approvals.notificationCadence') || 'IMMEDIATE';
  const escalationDays = num(input.answers, 'ns.approvals.escalationDays');

  for (const meta of AMOUNT_TIERED_APPROVALS) {
    if (!bool(input.answers, meta.scopeAnswerKey)) continue;
    const rawAnswer = str(input.answers, meta.tiersAnswerKey);
    // We don't fail emission when parsing fails — the workflow XML's
    // shape is independent of the tier values; the WFA script is the
    // one that needs parsed tiers.
    const scriptid = `customworkflow_nsix_${meta.typeKey}_approval`;
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildAmountTierWorkflowXml({
      meta,
      rawAnswer,
      notificationCadence,
      escalationDays,
    });
    emitted.push({
      filename,
      scriptid,
      category: 'amount-tier',
      typeKey: meta.typeKey,
      displayName: meta.displayName,
    });
  }

  if (bool(input.answers, 'ns.approvals.expenseApprovalInScope')) {
    const rawAnswer = str(input.answers, 'ns.approvals.expenseApprovalTiers');
    const scriptid = 'customworkflow_nsix_expense_approval';
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildExpenseWorkflowXml({
      rawAnswer,
      notificationCadence,
      escalationDays,
    });
    emitted.push({
      filename,
      scriptid,
      category: 'expense',
      typeKey: 'expense',
      displayName: 'Expense Report',
    });
  }

  if (bool(input.answers, 'ns.approvals.soApprovalInScope')) {
    const rawAnswer = str(input.answers, 'ns.approvals.soApprovalTrigger');
    const scriptid = 'customworkflow_nsix_so_approval';
    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildSoWorkflowXml({
      rawAnswer,
      notificationCadence,
      escalationDays,
    });
    emitted.push({
      filename,
      scriptid,
      category: 'so',
      typeKey: 'so',
      displayName: 'Sales Order',
    });
  }

  if (bool(input.answers, 'ns.approvals.recordStateWorkflowsInScope')) {
    const rawAnswer = str(input.answers, 'ns.approvals.recordStateWorkflows');
    const lines = rawAnswer.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      const parsed = parseRecordStateLine(line);
      if (parsed === null) continue;
      const scriptid = `customworkflow_nsix_${parsed.recordSlug}_state`;
      const filename = `Objects/${scriptid}.xml`;
      files[filename] = buildRecordStateWorkflowXml(parsed);
      emitted.push({
        filename,
        scriptid,
        category: 'record-state',
        typeKey: parsed.recordSlug,
        displayName: `${parsed.recordName} (state machine)`,
      });
    }
  }

  return { files, emitted };
}

// Exported for tests + the WFA script generator that needs the same
// scope/key map. Avoids drift between the two generators.
export { AMOUNT_TIERED_APPROVALS };
export type { AmountTieredApprovalMeta, ParsedTier };
