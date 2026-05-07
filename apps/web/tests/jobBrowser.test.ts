import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  formatBytes,
  countFiles,
  flattenTree,
  type FileTreeNode,
} from '../src/pages/jobBrowser';

describe('classifyFile', () => {
  it('classifies HTML, MD, JSON, CSV, PDF correctly', () => {
    expect(classifyFile('BRD.html')).toBe('html');
    expect(classifyFile('BRD.md')).toBe('markdown');
    expect(classifyFile('config.json')).toBe('json');
    expect(classifyFile('rows.csv')).toBe('csv');
    expect(classifyFile('BRD.pdf')).toBe('pdf');
  });

  it('classifies code-like extensions as code', () => {
    expect(classifyFile('script.js')).toBe('code');
    expect(classifyFile('manifest.xml')).toBe('code');
    expect(classifyFile('migrate.sql')).toBe('code');
    expect(classifyFile('README.txt')).toBe('code');
  });

  it('classifies images as image', () => {
    expect(classifyFile('logo.png')).toBe('image');
    expect(classifyFile('chart.svg')).toBe('image');
    expect(classifyFile('photo.JPG')).toBe('image'); // case-insensitive
  });

  it('classifies unknown extensions as binary', () => {
    expect(classifyFile('archive.tar.gz')).toBe('binary');
    expect(classifyFile('mystery.bin')).toBe('binary');
    expect(classifyFile('no-extension')).toBe('binary');
  });
});

describe('formatBytes', () => {
  it('returns empty string for invalid inputs', () => {
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(NaN)).toBe('');
  });

  it('formats small sizes as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes / megabytes with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('countFiles', () => {
  it('counts only file leaves, not directories', () => {
    const tree: FileTreeNode = {
      name: '',
      type: 'dir',
      children: [
        { name: 'README.md', type: 'file', size: 100 },
        {
          name: 'Documentation', type: 'dir', children: [
            { name: 'BRD.md', type: 'file', size: 1000 },
            { name: 'BRD.html', type: 'file', size: 2000 },
          ],
        },
        {
          name: 'SDF', type: 'dir', children: [
            { name: 'manifest.xml', type: 'file', size: 50 },
          ],
        },
      ],
    };
    expect(countFiles(tree)).toBe(4);
  });

  it('returns 0 for an empty tree', () => {
    expect(countFiles({ name: '', type: 'dir', children: [] })).toBe(0);
  });
});

describe('flattenTree', () => {
  it('produces a flat list with forward-slash paths', () => {
    const tree: FileTreeNode = {
      name: '',
      type: 'dir',
      children: [
        { name: 'README.md', type: 'file' },
        {
          name: 'Documentation', type: 'dir', children: [
            { name: 'BRD.md', type: 'file' },
          ],
        },
      ],
    };
    const flat = flattenTree(tree);
    const paths = flat.map((e) => e.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('Documentation');
    expect(paths).toContain('Documentation/BRD.md');
  });
});
