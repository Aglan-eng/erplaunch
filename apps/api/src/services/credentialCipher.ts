import crypto from 'crypto';

/**
 * AES-256-GCM symmetric encryption for at-rest credential storage.
 *
 * Ciphertext format: base64( iv(12) || authTag(16) || ciphertext )
 *
 * The master key is read from ERPLAUNCH_MASTER_KEY (64 hex chars = 32 bytes).
 * In dev, if the env var is missing we derive a deterministic local key from a
 * fixed seed and warn on stderr — encrypted blobs are NOT portable across
 * machines that way, but it unblocks local development.
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let _warnedDev = false;

export function deriveDevKey(): string {
  // Deterministic, development-only. 32 bytes = 64 hex chars.
  return crypto
    .createHash('sha256')
    .update('erplaunch-dev-master-key-DO-NOT-USE-IN-PRODUCTION')
    .digest('hex');
}

function getKey(): Buffer {
  const hex = process.env.ERPLAUNCH_MASTER_KEY;
  if (hex && hex.length === KEY_LEN * 2 && /^[0-9a-fA-F]+$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ERPLAUNCH_MASTER_KEY must be a 64-char hex string in production');
  }
  if (!_warnedDev) {
    _warnedDev = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[credentialCipher] ERPLAUNCH_MASTER_KEY missing or invalid — deriving dev key. ' +
        'Set a real 64-hex key in .env before production.',
    );
  }
  return Buffer.from(deriveDevKey(), 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
