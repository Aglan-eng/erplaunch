import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt, deriveDevKey } from '../../src/services/credentialCipher.js';

const ORIGINAL_KEY = process.env.ERPLAUNCH_MASTER_KEY;

beforeAll(() => {
  // Force a deterministic key for these tests
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
});

afterAll(() => {
  if (ORIGINAL_KEY !== undefined) process.env.ERPLAUNCH_MASTER_KEY = ORIGINAL_KEY;
  else delete process.env.ERPLAUNCH_MASTER_KEY;
});

describe('credentialCipher: encrypt/decrypt roundtrip', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'my-super-secret-smtp-password!@#$';
    const cipher = encrypt(plaintext);
    expect(cipher).not.toContain(plaintext);
    expect(decrypt(cipher)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it('handles empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('handles unicode', () => {
    const plaintext = 'パスワード→secret🔑';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('rejects tampered ciphertext (authTag check)', () => {
    const cipher = encrypt('original');
    const tampered = cipher.slice(0, -4) + 'XXXX';
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects ciphertext encrypted with a different key', () => {
    process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
    const cipher = encrypt('payload');
    process.env.ERPLAUNCH_MASTER_KEY = 'b'.repeat(64);
    expect(() => decrypt(cipher)).toThrow();
    process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  });
});

describe('credentialCipher: dev key derivation', () => {
  it('deriveDevKey returns a stable 32-byte hex string', () => {
    const k1 = deriveDevKey();
    const k2 = deriveDevKey();
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(k1)).toBe(true);
  });

  it('works without ERPLAUNCH_MASTER_KEY in dev (warns, auto-derives)', () => {
    const saved = process.env.ERPLAUNCH_MASTER_KEY;
    delete process.env.ERPLAUNCH_MASTER_KEY;
    const plaintext = 'dev-mode-secret';
    const cipher = encrypt(plaintext);
    expect(decrypt(cipher)).toBe(plaintext);
    process.env.ERPLAUNCH_MASTER_KEY = saved;
  });
});
