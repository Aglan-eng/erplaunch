import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractTextFromDocument, _testOnlyExtractAll } from '../../src/services/customAdaptorParse.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erplaunch-extract-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(filename: string, content: string): { absPath: string; storedName: string } {
  const storedName = `fixture-${filename}`;
  const absPath = path.join(tmpDir, storedName);
  fs.writeFileSync(absPath, content, 'utf8');
  return { absPath, storedName };
}

describe('extractTextFromDocument — single-document extraction', () => {
  it('extracts UTF-8 text from a .md file by extension', async () => {
    const content = '# JDE Primer\n\nThis is the JDE primer content.\n';
    const { absPath } = writeFixture('jde-primer.md', content);
    const text = await extractTextFromDocument({
      absPath,
      originalName: 'jde-primer.md',
      mimeType: 'text/markdown',
    });
    expect(text).toBe(content);
  });

  it('extracts UTF-8 text from a .txt file', async () => {
    const content = 'Plain text version of the JDE primer.';
    const { absPath } = writeFixture('jde-primer.txt', content);
    const text = await extractTextFromDocument({
      absPath,
      originalName: 'jde-primer.txt',
      mimeType: 'text/plain',
    });
    expect(text).toBe(content);
  });

  it('extracts via mimeType when the originalName has no recognizable extension', async () => {
    // Edge case: browser uploads with a generic filename, mimeType is the
    // load-bearing signal.
    const content = '## Methodology\nFive phases.\n';
    const { absPath } = writeFixture('upload-blob', content);
    const text = await extractTextFromDocument({
      absPath,
      originalName: 'upload',
      mimeType: 'text/markdown',
    });
    expect(text).toBe(content);
  });

  it('extracts via mimeType when the originalName is empty', async () => {
    const content = '# Heading\nbody.\n';
    const { absPath } = writeFixture('no-name', content);
    const text = await extractTextFromDocument({
      absPath,
      originalName: '',
      mimeType: 'text/markdown',
    });
    expect(text).toBe(content);
  });

  it('returns an empty string when the file does not exist', async () => {
    const text = await extractTextFromDocument({
      absPath: path.join(tmpDir, 'missing.md'),
      originalName: 'missing.md',
      mimeType: 'text/markdown',
    });
    expect(text).toBe('');
  });
});

describe('extractFromSourceDocuments — full pipeline', () => {
  it('extracts the full byte content of a JDE-primer-style markdown upload', async () => {
    // Mirror the prod scenario: 2954-byte markdown primer with phase headings
    // and structured sections. Earlier versions would route a .md upload
    // through a fallback that produced empty text.
    const jdePrimer = [
      '# JDE Primer',
      '',
      'JD Edwards EnterpriseOne is an Oracle ERP suite.',
      '',
      'PHASES (5):',
      '1. Define / Discovery — high-level scoping...',
      '2. Configure — system configuration...',
      '3. Train — role-based training...',
      '4. Test / UAT — rigorous validation...',
      '5. Go-Live / Refine — final data migration...',
      '',
      'MODULES:',
      '- General Ledger (GL)',
      '- Accounts Payable (AP)',
      '- Accounts Receivable (AR)',
      '',
      'Trailing fluff to push the byte count up so we can assert the full body survives extraction. '.repeat(20),
    ].join('\n');
    const { storedName } = writeFixture('jde-primer.md', jdePrimer);
    const concatenated = await _testOnlyExtractAll(
      [{ filename: storedName, originalName: 'jde-primer.md', mimeType: 'text/markdown' }],
      tmpDir,
    );
    expect(concatenated).toContain('PHASES (5):');
    expect(concatenated).toContain('Define / Discovery');
    expect(concatenated).toContain('Go-Live / Refine');
    // The header decorator wraps each doc — strip it for the byte-equality check.
    const body = concatenated.replace(/^=== Source: [^\n]+ ===\n/, '').trim();
    expect(body).toContain(jdePrimer.trim());
  });

  it('skips a file whose absPath is missing without aborting other docs', async () => {
    const { storedName } = writeFixture('survivor.md', 'survivor content');
    const concatenated = await _testOnlyExtractAll(
      [
        { filename: 'does-not-exist.md', originalName: 'ghost.md', mimeType: 'text/markdown' },
        { filename: storedName, originalName: 'survivor.md', mimeType: 'text/markdown' },
      ],
      tmpDir,
    );
    expect(concatenated).toContain('survivor content');
  });
});
