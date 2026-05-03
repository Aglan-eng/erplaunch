/**
 * Migration Load Sequencing generator (Pack Z — Component 5).
 *
 * Cross-platform — emits Documentation/Data_Migration/Load_Sequencing.md.
 *
 * Renders a Mermaid `graph TD` DAG showing FK dependencies across all
 * objects in scope plus the load-order numbered list. Reference data
 * has no parents, master data depends on reference, open balances
 * depend on master.
 *
 * The Mermaid diagram is the visual; the numbered load-order list is
 * the executable contract migration teams follow during dry-runs.
 */

import {
  objectsInScope,
  loadOrder,
  type MigrationObject,
} from './migrationHelpers.js';

export interface MigrationLoadSequencingInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
}

export interface MigrationLoadSequencingOutput {
  markdown: string;
}

function mermaidNodeId(obj: MigrationObject): string {
  // Mermaid node ids must be alphanumeric — strip everything else.
  return obj.id.replace(/[^a-zA-Z0-9]/g, '');
}

function mermaidNodeLabel(obj: MigrationObject): string {
  return `${mermaidNodeId(obj)}["${obj.label}<br/>${obj.csvFilename}"]`;
}

function categoryClassDef(category: MigrationObject['category']): string {
  switch (category) {
    case 'reference': return 'classRef';
    case 'master': return 'classMaster';
    case 'open-balance': return 'classOpenBal';
    case 'transactional': return 'classTrans';
  }
}

export function generateMigrationLoadSequencing(
  input: MigrationLoadSequencingInput,
): MigrationLoadSequencingOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = objectsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const order = loadOrder(inScope);

  const inScopeIds = new Set(inScope.map((o) => o.id));

  const nodeLines = order.map((obj) => `  ${mermaidNodeLabel(obj)}`);
  const edgeLines: string[] = [];
  for (const obj of order) {
    for (const dep of obj.dependsOn) {
      if (!inScopeIds.has(dep)) continue;
      const depObj = inScope.find((o) => o.id === dep)!;
      edgeLines.push(`  ${mermaidNodeId(depObj)} --> ${mermaidNodeId(obj)}`);
    }
  }
  const classAssignments = order
    .map((obj) => `  class ${mermaidNodeId(obj)} ${categoryClassDef(obj.category)};`)
    .join('\n');

  const mermaid = [
    '```mermaid',
    'graph TD',
    nodeLines.join('\n'),
    edgeLines.join('\n'),
    '',
    '  classDef classRef fill:#e0f2fe,stroke:#0369a1;',
    '  classDef classMaster fill:#dcfce7,stroke:#15803d;',
    '  classDef classOpenBal fill:#fef9c3,stroke:#a16207;',
    '  classDef classTrans fill:#fce7f3,stroke:#be185d;',
    classAssignments,
    '```',
  ].join('\n');

  const orderTable = order
    .map(
      (obj, idx) =>
        `| ${idx + 1} | ${obj.csvFilename} | ${obj.label} | ${obj.category} | ${obj.dependsOn.length > 0 ? obj.dependsOn.join(', ') : '(none)'} |`,
    )
    .join('\n');

  const refCount = order.filter((o) => o.category === 'reference').length;
  const masterCount = order.filter((o) => o.category === 'master').length;
  const openBalCount = order.filter((o) => o.category === 'open-balance').length;

  const markdown = [
    `# Load Sequencing — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Objects in scope:** ${order.length} (${refCount} reference / ${masterCount} master / ${openBalCount} open-balance)  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'FK dependency DAG + executable load order. Reference data (subsidiaries / ',
    'companies, COA, taxes, locations) loads first because nothing else can resolve ',
    'foreign keys without it. Master data loads next; open balances last.',
    '',
    '## Dependency Diagram',
    '',
    mermaid,
    '',
    '## Load Order (executable)',
    '',
    'Run order during dry-runs and the cutover load. Any deviation requires the ',
    'migration lead\'s sign-off.',
    '',
    '| # | Filename | Object | Category | Depends on |',
    '|---|----------|--------|----------|------------|',
    orderTable,
    '',
    '## Sequencing Rules',
    '',
    '1. **Strict topological order.** A child object never loads before its parents. ',
    '   Violating this produces FK rejects that are time-consuming to debug.',
    '2. **Block on rejects.** If load N produces > threshold rejects, halt and ',
    '   investigate — do NOT proceed to N+1. See `./Reject_Handling_Playbook.md`.',
    '3. **Reconcile after each load.** Run the count + financial-total check from ',
    '   `./Reconciliation_Queries.md`. Score the result in `./Data_Quality_Scorecard.md`.',
    '4. **Snapshot before open-balance loads.** Open AR / AP / GL / inventory loads ',
    '   are financially consequential — take a database snapshot before each so ',
    '   rollback is a one-step operation.',
    '5. **Final sign-off only after step ' + order.length + '.** No partial sign-offs.',
    '',
    '## Cross-References',
    '',
    '- CSV import templates: `./Templates/`',
    '- Field mapping workbook: `./Field_Mapping_Workbook.md`',
    '- Reconciliation queries: `./Reconciliation_Queries.md`',
    '- Reject handling: `./Reject_Handling_Playbook.md`',
    '- Migration runbook: `./Migration_Runbook.md`',
    '',
    '_Generated by ERPLaunch — Pack Z (Data Migration Assets)._',
    '',
  ].join('\n');

  return { markdown };
}
