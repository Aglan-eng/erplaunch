import { initDb, getDb, listEngagements, createJob, replaceConflicts } from './src/db/index.ts';
import { processJob } from './src/services/generation.ts';
import * as db from './src/db/index.ts';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function verify() {
  await initDb();
  console.log('--- Sprint 4 Verification ---');

  const engagements = await listEngagements((await getDb().execute('SELECT id FROM Firm LIMIT 1')).rows[0].id as string);
  const engagement = engagements[0];
  const id = engagement.id as string;

  // 1. Inject some conflicts for the Risk Register
  await replaceConflicts(id, [
    {
       ruleId: 'MFG-999',
       type: 'LICENSING',
       severity: 'BLOCK',
       questionIds: ['mfg.bom.type'],
       message: 'Work Center module required for advanced routings.',
       resolution: 'Upsell WIP & Routings bundle.'
    }
  ]);

  // 2. Create a Job
  const job = await createJob(id, 'STRATEGIC_handoff');
  console.log(`Created Job: ${job.id}`);

  // 3. Process Job
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one-off sprint-verification script; db namespace import shape conflicts with processJob's narrower DbClient param.
  await processJob(job.id as string, db as any);

  // 4. Verify Folder Structure
  const rootOutputDir = path.join(__dirname, 'outputs', job.id as string);
  
  const docDir = path.join(rootOutputDir, 'Documentation');
  const sdfDir = path.join(rootOutputDir, 'SDF');
  const ssDir = path.join(rootOutputDir, 'SuiteScript');

  const dirs = [docDir, sdfDir, ssDir];
  for (const d of dirs) {
     const exists = await fs.access(d).then(() => true).catch(() => false);
     if (!exists) {
        console.error(`❌ Missing directory: ${d}`);
        process.exit(1);
     }
  }
  console.log('✅ Folder structure verified.');

  // 5. Verify Strategic Artifacts
  const docFiles = await fs.readdir(docDir);
  const expectedDocs = ['BRD.md', 'BRD.html', 'BRD.pdf', 'Risk_Register.md', 'UAT_Plan.md'];
  const missingDocs = expectedDocs.filter(f => !docFiles.includes(f));

  if (missingDocs.length === 0) {
    console.log('✅ All strategic documentation generated successfully (including PDF).');
  } else {
    console.error(`❌ Missing documents: ${missingDocs.join(', ')}`);
    // Note: Puppeteer might take time, but we wait in processJob
    process.exit(1);
  }

  // Check Risk Register content
  const riskReg = await fs.readFile(path.join(docDir, 'Risk_Register.md'), 'utf-8');
  if (riskReg.includes('Work Center module required')) {
    console.log('✅ Risk Register content verified.');
  }

  process.exit(0);
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
