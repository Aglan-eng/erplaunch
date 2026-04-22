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

// Generation pipeline — v2: fixed answer-key lookups in SDF + SuiteScript generators
export async function processJob(jobId: string, db: DbModule) {
  try {
    await db.updateJob(jobId, { status: 'RUNNING' });

    const job = await db.findJobById(jobId) as Record<string, any> | null;
    if (!job) return;

    const eng = await db.findEngagementById(job.engagementId as string) as Record<string, any> | null;
    if (!eng) return;

    const rootOutputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    const docDir = path.join(rootOutputDir, 'Documentation');
    const sdfDir = path.join(rootOutputDir, 'SDF');
    const ssDir = path.join(rootOutputDir, 'SuiteScript');

    await fs.mkdir(docDir, { recursive: true });
    await fs.mkdir(sdfDir, { recursive: true });
    await fs.mkdir(ssDir, { recursive: true });

    const license = (eng.license ?? {}) as Record<string, any>;
    const profile = (eng.profile ?? {}) as Record<string, any>;
    const answers = profile.answers ?? {};

    // Load new rich content
    const comments = await db.getSectionComments(eng.id);
    const images = await db.getSectionImages(eng.id);
    const aiAdvice = await db.getAllAIAdvice(eng.id);

    // 1. Documentation
    const brdData = {
      clientName: eng.clientName as string,
      license: {
        edition: license.edition ?? 'MID_MARKET',
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

    // Convert to PDF
    await convertHtmlToPdf(brdHtml, path.join(docDir, 'BRD.pdf'));
    
    // Risk Register
    const riskContent = generateRiskRegister({
      clientName: eng.clientName as string,
      conflicts: eng.conflicts?.filter((c: any) => c.severity === 'BLOCK') ?? [],
      warnings: eng.conflicts?.filter((c: any) => c.severity === 'WARN') ?? [],
    });
    await fs.writeFile(path.join(docDir, 'Risk_Register.md'), riskContent);

    // UAT Plan
    const uatData = { clientName: eng.clientName as string, answers, comments, images, aiAdvice };
    await fs.writeFile(path.join(docDir, 'UAT_Plan.md'), generateUATPlan(uatData));
    await fs.writeFile(path.join(docDir, 'UAT_Plan.html'), generateUATPlanHtml(uatData));

    // Solution Design Document
    const sddData = { 
      clientName: eng.clientName as string, 
      license: brdData.license, 
      answers, 
      conflicts: eng.conflicts ?? [],
      comments,
      images,
      aiAdvice
    };
    await fs.writeFile(path.join(docDir, 'Solution_Design.html'), generateSolutionDocHtml(sddData));

    // Training Manual
    const trainingData = { clientName: eng.clientName as string, answers, comments, images, aiAdvice };
    await fs.writeFile(path.join(docDir, 'Training_Manual.html'), generateTrainingManualHtml(trainingData));

    // Implementation Plan
    await fs.writeFile(path.join(docDir, 'Implementation_Plan.html'), generateImplementationPlanHtml({ clientName: eng.clientName as string, license: brdData.license, answers, conflicts: eng.conflicts ?? [] }));

    // 2. SDF Package
    const sdfFiles = generateSDFPackage({
      modules: license.modules ?? [],
      answers,
      clientName: eng.clientName as string,
    });

    for (const [relPath, content] of Object.entries(sdfFiles)) {
      const fullPath = path.join(sdfDir, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    // 3. SuiteScript Scaffolds
    const scriptFiles = generateScripts({
      clientName: eng.clientName as string,
      answers,
      modules: license.modules ?? [],
    });

    for (const [filename, content] of Object.entries(scriptFiles)) {
      await fs.writeFile(path.join(ssDir, filename), content);
    }

    // 4. Update Job
    await db.updateJob(jobId, {
      status: 'COMPLETE',
      outputUrl: `/outputs/${jobId}`,
      completedAt: new Date().toISOString(),
    });
    
    if (process.env.NODE_ENV !== 'production') console.log(`Job ${jobId} complete. Artifacts generated in ${rootOutputDir}`);
  } catch (error) {
    console.error(`[generation] Job ${jobId} failed:`, error);
    await db.updateJob(jobId, { status: 'FAILED', error: String(error) });
  }
}
