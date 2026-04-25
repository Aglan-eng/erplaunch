import { describe, it, expect } from 'vitest';
import {
  toSlug,
  resolveCreatePayload,
} from '../src/pages/customAdaptorsHelpers';

/**
 * Regression net for the Custom Adaptors CreateModal.
 *
 * The bug: clicking "Create adaptor" without manually editing the slug
 * field used to send `{ slug: '' }` to the API because the submit handler
 * read `slug` from React state closure that hadn't applied yet. The API
 * 400'd on SlugRegex.
 *
 * These tests pin the resolution rules in a pure function so the same
 * mistake can't return through a refactor.
 *
 * SlugRegex (from @ofoq/shared schemas):
 *   /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/
 * → 3-40 chars, lowercase, dashes ok but no leading/trailing/double dashes.
 */
const SlugRegex = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

describe('toSlug', () => {
  it('lowercases and dashes spaces', () => {
    expect(toSlug('My Factory ERP')).toBe('my-factory-erp');
  });

  it('strips characters outside [a-z0-9 -]', () => {
    expect(toSlug('Acme & Co!')).toBe('acme-co');
  });

  it('collapses repeated whitespace into single dashes', () => {
    expect(toSlug('Hello   World')).toBe('hello-world');
  });

  it('collapses repeated dashes', () => {
    expect(toSlug('foo---bar')).toBe('foo-bar');
  });

  it('caps at 40 chars', () => {
    const long = 'abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij'; // 50+
    expect(toSlug(long).length).toBeLessThanOrEqual(40);
  });

  it('produces a SlugRegex-valid output for typical names', () => {
    for (const name of ['MyFactory', 'Acme ERP', 'Tier 3 Logistics', 'X-Corp 2030']) {
      const slug = toSlug(name);
      expect(slug, `${name} → ${slug}`).toMatch(SlugRegex);
    }
  });
});

describe('resolveCreatePayload', () => {
  it('REGRESSION: auto-derives slug from name when slugDirty=false (the original bug)', () => {
    // Before the fix: handler called createMutation.mutate() which read
    // `slug` from closure (still empty) → API got `{slug: ''}` → 400.
    const result = resolveCreatePayload({ name: 'MyFactory', slug: '', slugDirty: false });
    expect(result).not.toBeNull();
    expect(result!.slug).toBe('myfactory');
    expect(result!.slug).toMatch(SlugRegex);
  });

  it('honours user-typed slug when slugDirty=true', () => {
    const result = resolveCreatePayload({ name: 'MyFactory', slug: 'custom-slug', slugDirty: true });
    expect(result).toEqual({ name: 'MyFactory', slug: 'custom-slug' });
  });

  it('trims whitespace on both fields', () => {
    const result = resolveCreatePayload({ name: '  MyFactory  ', slug: '  custom  ', slugDirty: true });
    expect(result).toEqual({ name: 'MyFactory', slug: 'custom' });
  });

  it('returns null when name is empty/whitespace', () => {
    expect(resolveCreatePayload({ name: '   ', slug: 'foo', slugDirty: true })).toBeNull();
    expect(resolveCreatePayload({ name: '', slug: '', slugDirty: false })).toBeNull();
  });

  it('returns null when auto-derived slug would be empty (name is all symbols)', () => {
    expect(resolveCreatePayload({ name: '!!!', slug: '', slugDirty: false })).toBeNull();
  });

  it('returns null when user manually cleared the slug field', () => {
    expect(resolveCreatePayload({ name: 'MyFactory', slug: '', slugDirty: true })).toBeNull();
  });

  it('produces a SlugRegex-valid slug for the auto-derived path on typical names', () => {
    // Sweep — the bug only manifested on the auto-derived branch, so cover it densely.
    for (const name of ['MyFactory', 'Acme ERP', 'Tier 3 Logistics', 'X-Corp 2030', 'Aurora Foods Ltd']) {
      const result = resolveCreatePayload({ name, slug: '', slugDirty: false });
      expect(result, `${name} should produce a valid payload`).not.toBeNull();
      expect(result!.slug, `${name} → ${result!.slug}`).toMatch(SlugRegex);
    }
  });
});
