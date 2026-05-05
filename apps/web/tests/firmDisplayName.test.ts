import { describe, it, expect } from 'vitest';
import { firmDisplayName } from '../src/lib/firmDisplayName';

describe('firmDisplayName', () => {
  it('returns displayName when present', () => {
    expect(firmDisplayName({ name: 'acme-firm', displayName: 'Acme Advisory' })).toBe('Acme Advisory');
  });

  it('falls back to name when displayName is null', () => {
    expect(firmDisplayName({ name: 'Xelerate', displayName: null })).toBe('Xelerate');
  });

  it('falls back to name when displayName is undefined', () => {
    expect(firmDisplayName({ name: 'Xelerate' })).toBe('Xelerate');
  });

  it('falls back to name when displayName is whitespace-only', () => {
    expect(firmDisplayName({ name: 'Xelerate', displayName: '   ' })).toBe('Xelerate');
  });

  it('returns empty string when neither field is set', () => {
    expect(firmDisplayName({ name: '', displayName: null })).toBe('');
  });

  it('handles a null firm by returning empty string', () => {
    expect(firmDisplayName(null)).toBe('');
  });
});
