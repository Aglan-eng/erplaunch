/**
 * Shared approval-tier parser (Pack W support).
 *
 * Extracted from sdfPoApprovalScriptGenerator so the SuiteFlow
 * Workflow generator + Workflow Action Script generator can re-use
 * the same wire format for amount-tiered approvals (PO / JE / VB).
 *
 * Wire format (one tier per line):
 *   "<$X: <approver>"        e.g., "<$5,000: auto-approve"
 *   "$X-$Y: <approver>"      e.g., "$5,000-$50,000: Department Manager"
 *   ">$Y: <approver>"        e.g., ">$250,000: CFO + Steering"
 *
 * Currency symbols ($, £, €, ¥, AED) and comma-thousands are stripped
 * before numeric parsing. Range separators accept hyphen / en-dash /
 * em-dash for human-pasted answers. The "auto-approve" sentinel
 * (case-insensitive, optional hyphen) maps to approver='auto'.
 *
 * Parsing is conservative: any line that doesn't match one of the
 * three patterns yields null, and callers that demand all-or-nothing
 * resolution flip the whole output to fallback mode on a single
 * failure (the SuiteScript UE generator behaves this way; the
 * SuiteFlow workflow generator does the same so the bundle stays
 * consistent across the two artefacts).
 */

export interface ParsedTier {
  /** Original range token from the wizard line (e.g. "<$5,000",
   *  "$5,000-$50,000", ">$250,000") — preserved for the JSDoc /
   *  comment header so the consultant can audit the parse. */
  label: string;
  /** Lower bound in numeric form. 0 for "<$X" tiers. */
  minAmount: number;
  /** Upper bound in numeric form. Infinity for ">$Y" tiers. */
  maxAmount: number;
  /** Approver role / name verbatim, OR 'auto' when the line specified
   *  the auto-approve sentinel. */
  approver: string;
}

/** Strip currency symbols + comma-thousands. "$1,250,000" → 1250000. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$£€¥AED\s]/g, '').replace(/,/g, '');
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Parse one tier line. Returns null on any failure.
 *
 * Three patterns supported (matched in order):
 *   <$X: approver         → minAmount=0,        maxAmount=X
 *   $X-$Y: approver       → minAmount=X,        maxAmount=Y
 *   >$Y: approver         → minAmount=Y,        maxAmount=Infinity
 */
export function parseApprovalTierLine(line: string): ParsedTier | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx < 0) return null;
  const rangePart = trimmed.slice(0, colonIdx).trim();
  const approverPart = trimmed.slice(colonIdx + 1).trim();
  if (approverPart.length === 0) return null;
  const approver = /^auto[\s-]?approve$/i.test(approverPart) ? 'auto' : approverPart;

  // <$X
  const ltMatch = rangePart.match(/^<\s*([$£€¥AED\d,\s]+)$/);
  if (ltMatch) {
    const max = parseAmount(ltMatch[1]);
    if (max === null) return null;
    return { label: rangePart, minAmount: 0, maxAmount: max, approver };
  }

  // >$Y
  const gtMatch = rangePart.match(/^>\s*([$£€¥AED\d,\s]+)$/);
  if (gtMatch) {
    const min = parseAmount(gtMatch[1]);
    if (min === null) return null;
    return { label: rangePart, minAmount: min, maxAmount: Infinity, approver };
  }

  // $X-$Y range — accept "-", "–", "—" as separators
  const rangeMatch = rangePart.match(/^([$£€¥AED\d,\s]+?)\s*[-–—]\s*([$£€¥AED\d,\s]+)$/);
  if (rangeMatch) {
    const min = parseAmount(rangeMatch[1]);
    const max = parseAmount(rangeMatch[2]);
    if (min === null || max === null || max < min) return null;
    return { label: rangePart, minAmount: min, maxAmount: max, approver };
  }

  return null;
}

export interface ParseApprovalTiersResult {
  /** True when EVERY non-empty line parsed cleanly. False when ≥1
   *  failed — caller decides whether to flip to fallback mode. */
  allOk: boolean;
  /** Parsed tiers in input order. Only meaningful when allOk=true;
   *  partial results may be empty when an early line failed. */
  tiers: ParsedTier[];
  /** Verbatim wizard answer (CRLF normalised). Useful for fallback
   *  mode where the consultant needs to see the original text in a
   *  TODO comment. */
  rawAnswer: string;
}

/**
 * Parse the full TEXTAREA answer. CRLF is normalised; empty input
 * yields {allOk: true, tiers: []} (vacuous-truth — no tiers to
 * parse, nothing failed).
 */
export function parseApprovalTiers(rawAnswer: string | null | undefined): ParseApprovalTiersResult {
  const raw = (rawAnswer ?? '').toString();
  const normalised = raw.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { allOk: true, tiers: [], rawAnswer: normalised };

  const tiers: ParsedTier[] = [];
  for (const line of lines) {
    const tier = parseApprovalTierLine(line);
    if (tier === null) return { allOk: false, tiers: [], rawAnswer: normalised };
    tiers.push(tier);
  }
  return { allOk: true, tiers, rawAnswer: normalised };
}
