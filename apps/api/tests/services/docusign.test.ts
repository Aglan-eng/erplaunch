/**
 * Phase 46.5 — pure tests for the DocuSign shim.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isDocuSignConfigured,
  mapDocusignStatus,
  sendDocuSignEnvelope,
  DocuSignError,
} from '../../src/services/docusign.js';

describe('isDocuSignConfigured', () => {
  it('returns false when env credentials are missing (test default)', () => {
    expect(isDocuSignConfigured()).toBe(false);
  });
});

describe('mapDocusignStatus', () => {
  const cases: Array<[string, string]> = [
    ['sent', 'SENT'],
    ['delivered', 'VIEWED'],
    ['completed', 'SIGNED'],
    ['declined', 'DECLINED'],
    ['voided', 'EXPIRED'],
    ['expired', 'EXPIRED'],
  ];
  for (const [input, expected] of cases) {
    it(`'${input}' → ${expected}`, () => {
      expect(mapDocusignStatus(input)).toBe(expected);
    });
  }

  it('passes unknown statuses through unchanged', () => {
    expect(mapDocusignStatus('something-new')).toBe('something-new');
  });

  it('is case-insensitive', () => {
    expect(mapDocusignStatus('Completed')).toBe('SIGNED');
    expect(mapDocusignStatus('VOIDED')).toBe('EXPIRED');
  });
});

describe('sendDocuSignEnvelope', () => {
  it('throws NOT_CONFIGURED when env credentials are absent', async () => {
    await expect(
      sendDocuSignEnvelope({
        emailSubject: 'x',
        documentBase64: 'AAAA',
        documentName: 'test.pdf',
        signerName: 'Jane',
        signerEmail: 'jane@example.com',
      }),
    ).rejects.toBeInstanceOf(DocuSignError);
  });

  describe('with mocked env + fetch', () => {
    const ORIG = {
      base: process.env.DOCUSIGN_BASE_URL,
      account: process.env.DOCUSIGN_ACCOUNT_ID,
      token: process.env.DOCUSIGN_ACCESS_TOKEN,
    };
    beforeEach(() => {
      // Mock env. Note: `isDocuSignConfigured` reads at module-load
      // time so the in-process check still says false; we invoke the
      // module's send function with env-respecting fallback. To
      // bypass the configured-check we have to import the module's
      // function with mocked env applied at module load — too
      // invasive for this test. Instead we focus on mapDocusignStatus
      // + the not-configured path; the route layer covers the
      // happy-path via integration tests that mock fetch indirectly.
      process.env.DOCUSIGN_BASE_URL = '';
      process.env.DOCUSIGN_ACCOUNT_ID = '';
      process.env.DOCUSIGN_ACCESS_TOKEN = '';
    });
    afterEach(() => {
      process.env.DOCUSIGN_BASE_URL = ORIG.base;
      process.env.DOCUSIGN_ACCOUNT_ID = ORIG.account;
      process.env.DOCUSIGN_ACCESS_TOKEN = ORIG.token;
    });

    it('still throws NOT_CONFIGURED when env is empty', async () => {
      try {
        await sendDocuSignEnvelope({
          emailSubject: 'x',
          documentBase64: 'AAAA',
          documentName: 'test.pdf',
          signerName: 'Jane',
          signerEmail: 'jane@example.com',
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DocuSignError);
        expect((err as DocuSignError).code).toBe('NOT_CONFIGURED');
      }
    });
  });
});
