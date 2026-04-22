import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParseLib = require('pdf-parse');
const pdfParse = pdfParseLib.default ?? pdfParseLib;
import { readFileSync } from 'fs';

async function extractText(pdfPath: string): Promise<string> {
  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function main() {
  const solutionPath = 'C:\\Users\\Lenovo\\Desktop\\Netsuite Apparel\\Halla Travel Solution Document.pdf';
  const trainingPath = 'C:\\Users\\Lenovo\\Desktop\\Netsuite Apparel\\KPM Training Manual_F.G Purchase To Sell.pdf';

  console.log('\n\n=== SOLUTION DOCUMENT STRUCTURE ===\n');
  const solutionText = await extractText(solutionPath);
  // Print first 6000 chars to capture TOC and early sections
  console.log(solutionText.substring(0, 6000));

  console.log('\n\n=== TRAINING MANUAL STRUCTURE ===\n');
  const trainingText = await extractText(trainingPath);
  console.log(trainingText.substring(0, 6000));
}

main().catch(console.error);
