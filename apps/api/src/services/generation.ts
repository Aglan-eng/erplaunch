import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type * as dbModule from '../db/index.js';
import { generateBRD, generateBRDHtml } from './generators/brdGenerator.js';
import { generateSDFPackage } from './generators/sdfGenerator.js';
import { generateScripts } from './generators/scriptGenerator.js';
import { generateRiskRegister } from './generators/riskGenerator.js';
import { generateUATPlan, generateUATPlanHtml } from './generators/uatGenerator.js';
import { generateSolutionDoc, generateSolutionDocHtml } from './generators/solutionDocGenerator.js';
import { generateTrainingManual, generateTrainingManualHtml } from './generators/trainingManualGenerator.js';
import { generateImplementationPlanHtml } from './generators/planGenerator.js';
import { convertHtmlToPdf } from './pdfService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DbModule = typeof dbModule;

/**
 * Generation pipeline — Phase 6: adaptor-aware
 *
 * Branches on the engagement's adaptor:
 *   - NetSuite (built-in): emits the full pack the pilot always produced —
 *     BRD + Risk Register + UAT + Solution Design + Training + Plan PLUS
 *     the NetSuite-only SDF package and SuiteScript scaffolds.
 *   - Everything else (Odoo, published custom adaptors): emits the
 *     platform-neutral document pack only. SDF / SuiteScript are NetSuite
 *     artifacts and would be meaningless against an Odoo or in-house system,
 *     so the runner skips them and lets the catalog decide which other
 *     documents land in the bundle.
 *
 * This is a pragmatic first cut — the six "document" generators already
 * work off clientName + answers + comments + images + aiAdvice with no
 * NetSuite-specific data, so they can run against any adaptor. A later
 * phase can replace the static calls with a dispatch table keyed on
 * generator id when more adaptor-native generators (Odoo .po modules,
 * Dynamics extensions, etc.) arrive.
 */
export async function processJob(jobId: string, db: DbModule) {
  try {
    await db.updateJob(jobId, { status: 'RUNNING' });

    const job = await db.findJobById(jobId) as Record<string, any> | null;
    if (!job) return;

    const eng = await db.findEngagementById(job.engagementId as string) as Record<string, any> | null;
    if (!eng) return;

    const adaptorId = (eng.adaptorId as string | undefined) ?? 'netsuite';
    const isNetSuite = adaptorId === 'netsuite';

    const rootOutputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    const docDir = path.join(rootOutputDir, 'Documentation');
    await fs.mkdir(docDir, { recursive: true });

    const license = (eng.license ?? {}) as Record<string, any>;
    const profile = (eng.profile ?? {}) as Record<string, any>;
    const answers = profile.answers ?? {};

    // Load rich content (comments, images, AI advice)
    const comments = await db.getSectionComments(eng.id);
    const images = await db.getSectionImages(eng.id);
    const aiAdvice = await db.getAllAIAdvice(eng.id);

    // ── 1. Platform-neutral document pack (runs for every adaptor) ──────────
    const brdData = {
      clientName: eng.clientName as string,
      license: {
        edition: license.edition ?? (isNetSuite ? 'MID_MARKET' : 'DEFAULT'),
        modules: license.modules ?? [],
      },
      answers,
      comments,
      images,
      aiAdvice,
    };

    await fs.writeFile(path.join(docDir, 'BRD.md'), generateBRD(brdData));
    const brdHtml = generateBRDHtml(brdData);
    await fs.writeFile(path.join(docDir, 'BRD.html'), brdHtml);
    await convertHtmlToPdf(brdHtml, path.join(docDir, 'BRD.pdf'));

    const riskContent = generateRiskRegister({
      clientName: eng.clientName as string,
      conflicts: eng.conflicts?.filter((c: any) => c.severity === 'BLOCK') ?? [],
      warnings: eng.conflicts?.filter((c: any) => c.severity === 'WARN') ?? [],
    });
    await fs.writeFile(path.join(docDir, 'Risk_Register.md'), riskContent);

    const uatData = { clientName: eng.clientName as string, answers, comments, images, aiAdvice };
    await fs.writeFile(path.join(docDir, 'UAT_Plan.md'), generateUATPlan(uatData));
    await fs.writeFile(path.join(docDir, 'UAT_Plan.html'), generateUATPlanHtml(uatData));

    const sddData = {
      clientName: eng.clientName as string,
      license: brdData.license,
      answers,
      conflicts: eng.conflicts ?? [],
      comments,
      images,
      aiAdvice,
    };
    await fs.writeFile(path.join(docDir, 'Solution_Design.html'), generateSolutionDocHtml(sddData));

    const trainingData = { clientName: eng.clientName as string, answers, comments, images, aiAdvice };
    await fs.writeFile(path.join(docDir, 'Training_Manual.html'), generateTrainingManualHtml(trainingData));

    await fs.writeFile(
      path.join(docDir, 'Implementation_Plan.html'),
      generateImplementationPlanHtml({
        clientName: eng.clientName as string,
        license: brdData.license,
        answers,
        conflicts: eng.conflicts ?? [],
      }),
    );

    // ── 2. NetSuite-only artifacts: SDF + SuiteScript ───────────────────────
    if (isNetSuite) {
      const sdfDir = path.join(rootOutputDir, 'SDF');
      const ssDir = path.join(rootOutputDir, 'SuiteScript');
      await fs.mkdir(sdfDir, { recursive: true });
      await fs.mkdir(ssDir, { recursive: true });

      const { files: sdfFiles } = generateSDFPackage({
        modules: license.modules ?? [],
        answers,
        clientName: eng.clientName as string,
      });
      for (const [relPath, content] of Object.entries(sdfFiles)) {
        const fullPath = path.join(sdfDir, relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }

      const scriptFiles = generateScripts({
        clientName: eng.clientName as string,
        answers,
        modules: license.modules ?? [],
      });
      for (const [filename, content] of Object.entries(scriptFiles)) {
        await fs.writeFile(path.join(ssDir, filename), content);
      }
    }

    // ── 3. Manifest: record which artifacts actually landed ─────────────────
    const manifest = {
      jobId,
      engagementId: eng.id as string,
      adaptorId,
      clientName: eng.clientName as string,
      completedAt: new Date().toISOString(),
      artifacts: {
        documentation: ['BRD.md', 'BRD.html', 'BRD.pdf', 'Risk_Register.md', 'UAT_Plan.md', 'UAT_Plan.html', 'Solution_Design.html', 'Training_Manual.html', 'Implementation_Plan.html'],
        ...(isNetSuite ? { sdf: 'SDF/', suiteScript: 'SuiteScript/' } : {}),
      },
    };
    await fs.writeFile(path.join(rootOutputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // ── 4. Mark job complete ────────────────────────────────────────────────
    await db.updateJob(jobId, {
      status: 'COMPLETE',
      outputUrl: `/outputs/${jobId}`,
      completedAt: new Date().toISOString(),
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Job ${jobId} complete (adaptor=${adaptorId}). Artifacts generated in ${rootOutputDir}`);
    }
  } catch (error) {
    console.error(`[generation] Job ${jobId} failed:`, error);
    await db.updateJob(jobId, { status: 'FAILED', error: String(error) });
  }
}
