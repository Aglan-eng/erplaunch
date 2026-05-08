/**
 * Phase 46.5 — Thin DocuSign integration shim.
 *
 * Two surfaces:
 *
 *   - isDocuSignConfigured()          — true when env credentials are
 *                                       set so the route layer can
 *                                       gracefully disable the
 *                                       "Send via DocuSign" button.
 *   - sendDocuSignEnvelope(input)     — POSTs to the DocuSign REST
 *                                       API; returns the envelope id
 *                                       and the embedded signing URL.
 *                                       Throws DocuSignError on any
 *                                       non-2xx response so the route
 *                                       layer can surface a friendly
 *                                       error to the sales rep.
 *
 * This shim is intentionally minimal — we don't host DocuSign UI;
 * the recipient is emailed by DocuSign and clicks through to their
 * site. The webhook endpoint (Phase 46.5 routes) then updates the
 * EngagementSowSignature row.
 *
 * Required env:
 *   DOCUSIGN_BASE_URL           — e.g. https://demo.docusign.net
 *   DOCUSIGN_ACCOUNT_ID         — UUID
 *   DOCUSIGN_ACCESS_TOKEN       — Bearer token (JWT-issued externally)
 *
 * The API client treats DOCUSIGN_ACCESS_TOKEN as opaque — the
 * separate admin task of refreshing it via JWT grant lives outside
 * this shim. When the token is rejected we surface a 401-class
 * error and the route layer asks the firm admin to reauthorise.
 */

const BASE_URL = process.env.DOCUSIGN_BASE_URL ?? '';
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID ?? '';
const ACCESS_TOKEN = process.env.DOCUSIGN_ACCESS_TOKEN ?? '';

export type DocuSignErrorCode =
  | 'NOT_CONFIGURED'
  | 'TOKEN_INVALID'
  | 'PROVIDER_ERROR'
  | 'INVALID_RECIPIENT';

export class DocuSignError extends Error {
  public readonly code: DocuSignErrorCode;
  public readonly status?: number;
  public readonly providerBody?: string;
  constructor(code: DocuSignErrorCode, message: string, status?: number, providerBody?: string) {
    super(message);
    this.name = 'DocuSignError';
    this.code = code;
    this.status = status;
    this.providerBody = providerBody;
  }
}

export function isDocuSignConfigured(): boolean {
  return BASE_URL.length > 0 && ACCOUNT_ID.length > 0 && ACCESS_TOKEN.length > 0;
}

export interface SendEnvelopeInput {
  /** A short, human-readable name for the envelope. */
  emailSubject: string;
  /** Optional body sent in the DocuSign-generated email. */
  emailBlurb?: string;
  /** The PDF bytes to e-sign. */
  documentBase64: string;
  /** Display filename inside DocuSign. */
  documentName: string;
  /** Recipient details. */
  signerName: string;
  signerEmail: string;
  /** Optional anchor for the signature tab. We use a literal magic
   *  string the SOW PDF already contains ("Signature: ___") so the
   *  recipient sees the field aligned with the on-page line. */
  signatureAnchor?: string;
}

export interface SendEnvelopeResult {
  envelopeId: string;
  status: string;
}

interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}

/**
 * Lookup the global fetch — Node 18+ has it natively. Cast through
 * unknown so TypeScript doesn't complain about lib-dom typing
 * differences in the test environment.
 */
function getFetch(): FetchLike {
  return globalThis.fetch as unknown as FetchLike;
}

export async function sendDocuSignEnvelope(
  input: SendEnvelopeInput,
  opts?: { fetchImpl?: FetchLike },
): Promise<SendEnvelopeResult> {
  if (!isDocuSignConfigured()) {
    throw new DocuSignError('NOT_CONFIGURED', 'DocuSign integration is not configured.');
  }
  const fetchImpl = opts?.fetchImpl ?? getFetch();

  // Minimal envelope definition. DocuSign's API accepts JSON+base64
  // documents directly; for production we'd switch to multipart for
  // larger PDFs but the SOW is comfortably under the 25 MB JSON
  // limit (typical SOW is < 1 MB).
  const body = {
    emailSubject: input.emailSubject,
    emailBlurb: input.emailBlurb ?? '',
    documents: [
      {
        documentBase64: input.documentBase64,
        name: input.documentName,
        fileExtension: 'pdf',
        documentId: '1',
      },
    ],
    recipients: {
      signers: [
        {
          email: input.signerEmail,
          name: input.signerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [
              {
                anchorString: input.signatureAnchor ?? 'Signature: ____________________________________________',
                anchorYOffset: '-2',
                anchorUnits: 'pixels',
                anchorIgnoreIfNotPresent: 'false',
              },
            ],
          },
        },
      ],
    },
    status: 'sent',
  };

  const url = `${BASE_URL.replace(/\/$/, '')}/restapi/v2.1/accounts/${ACCOUNT_ID}/envelopes`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 401) {
      throw new DocuSignError('TOKEN_INVALID', 'DocuSign rejected the access token.', resp.status, text);
    }
    if (resp.status === 400 && /email/i.test(text)) {
      throw new DocuSignError('INVALID_RECIPIENT', 'DocuSign rejected the recipient email.', resp.status, text);
    }
    throw new DocuSignError('PROVIDER_ERROR', `DocuSign returned ${resp.status}: ${text}`, resp.status, text);
  }
  const json = (await resp.json()) as { envelopeId?: string; status?: string };
  if (!json.envelopeId) {
    throw new DocuSignError('PROVIDER_ERROR', 'DocuSign response missing envelopeId.');
  }
  return { envelopeId: json.envelopeId, status: json.status ?? 'sent' };
}

/**
 * Map a DocuSign envelope status (from a webhook event) to our
 * internal SowSignatureStatus. Unknown statuses pass through as
 * the input string for the route layer to log + ignore.
 */
export function mapDocusignStatus(s: string): string {
  const norm = s.toLowerCase();
  switch (norm) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'VIEWED';
    case 'completed':
      return 'SIGNED';
    case 'declined':
      return 'DECLINED';
    case 'voided':
    case 'expired':
      return 'EXPIRED';
    default:
      return s;
  }
}
