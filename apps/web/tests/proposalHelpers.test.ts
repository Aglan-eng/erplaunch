/**
 * Phase 46.8.3 — pure tests for the SalesProposalPage helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  collectProposalFiles,
  deriveProposalStatus,
  type ActivityEntry,
} from '../src/pages/SalesProposalPage';

interface FileTreeNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: FileTreeNode[];
}

const PROPOSAL_TREE: FileTreeNode = {
  name: '',
  type: 'dir',
  children: [
    {
      name: 'Proposal',
      type: 'dir',
      children: [
        { name: 'Cover_Letter.docx', type: 'file', size: 100 },
        { name: 'Executive_Summary.html', type: 'file', size: 200 },
        {
          name: 'sub',
          type: 'dir',
          children: [{ name: 'nested.txt', type: 'file', size: 50 }],
        },
      ],
    },
    {
      name: 'OtherFolder',
      type: 'dir',
      children: [{ name: 'unrelated.json', type: 'file' }],
    },
  ],
};

describe('collectProposalFiles', () => {
  it('returns sorted paths under Proposal/', () => {
    const files = collectProposalFiles(PROPOSAL_TREE);
    expect(files).toContain('Proposal/Cover_Letter.docx');
    expect(files).toContain('Proposal/Executive_Summary.html');
    expect(files).toContain('Proposal/sub/nested.txt');
    // Sort is alphabetical.
    expect([...files].sort()).toEqual(files);
  });

  it('filters out files outside Proposal/', () => {
    const files = collectProposalFiles(PROPOSAL_TREE);
    expect(files.find((f) => f.includes('OtherFolder'))).toBeUndefined();
  });

  it('returns [] for an undefined tree', () => {
    expect(collectProposalFiles(undefined)).toEqual([]);
  });

  it('returns [] when tree has no files', () => {
    expect(collectProposalFiles({ name: '', type: 'dir', children: [] })).toEqual([]);
  });
});

describe('deriveProposalStatus', () => {
  const baseJob = {
    id: 'job-1',
    engagementId: 'eng-1',
    type: 'PROPOSAL',
    status: 'COMPLETE' as const,
    createdAt: '2026-04-10T00:00:00Z',
    completedAt: '2026-04-10T00:01:00Z',
  };

  it('returns null when no job', () => {
    expect(deriveProposalStatus(undefined, [])).toBeNull();
  });

  it('returns DRAFT when job is still running', () => {
    expect(
      deriveProposalStatus({ ...baseJob, status: 'RUNNING', completedAt: null }, []),
    ).toBe('DRAFT');
  });

  it('returns DRAFT when job is complete but no lifecycle activity yet', () => {
    expect(deriveProposalStatus(baseJob, [])).toBe('DRAFT');
  });

  it('returns SENT after PROPOSAL_SENT activity', () => {
    const activity: ActivityEntry[] = [
      { id: 'a', action: 'PROPOSAL_SENT', details: '', createdAt: '2026-04-11T00:00:00Z' },
    ];
    expect(deriveProposalStatus(baseJob, activity)).toBe('SENT');
  });

  it('ACCEPTED beats SENT in the find order', () => {
    const activity: ActivityEntry[] = [
      { id: 'a', action: 'PROPOSAL_ACCEPTED', details: '', createdAt: '2026-04-12T00:00:00Z' },
      { id: 'b', action: 'PROPOSAL_SENT', details: '', createdAt: '2026-04-11T00:00:00Z' },
    ];
    expect(deriveProposalStatus(baseJob, activity)).toBe('ACCEPTED');
  });

  it('DECLINED beats SENT in the find order', () => {
    const activity: ActivityEntry[] = [
      { id: 'a', action: 'PROPOSAL_DECLINED', details: '', createdAt: '2026-04-12T00:00:00Z' },
      { id: 'b', action: 'PROPOSAL_SENT', details: '', createdAt: '2026-04-11T00:00:00Z' },
    ];
    expect(deriveProposalStatus(baseJob, activity)).toBe('DECLINED');
  });

  it('ignores activity older than the latest job', () => {
    const activity: ActivityEntry[] = [
      // SENT before the job was generated — refers to a previous version,
      // not the current one.
      { id: 'a', action: 'PROPOSAL_SENT', details: '', createdAt: '2026-04-01T00:00:00Z' },
    ];
    expect(deriveProposalStatus(baseJob, activity)).toBe('DRAFT');
  });
});
