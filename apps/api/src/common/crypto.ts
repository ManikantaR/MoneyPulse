/**
 * AES-256-GCM envelope encryption for PII columns.
 *
 * Encrypted values are stored as: iv:authTag:ciphertext (hex-encoded)
 * The ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32',
    );
  }
  _key = Buffer.from(hex, 'hex');
  return _key;
}

/** Encrypt a plaintext string → "iv:tag:ciphertext" (all hex). */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt an "iv:tag:ciphertext" string → plaintext. Returns original string if not encrypted. */
export function decryptField(encrypted: string): string {
  if (!encrypted || !encrypted.includes(':')) return encrypted;
  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted; // not encrypted format
  const [ivHex, tagHex, cipherHex] = parts;
  if (ivHex.length !== IV_LENGTH * 2 || tagHex.length !== TAG_LENGTH * 2) {
    return encrypted; // not our format
  }
  try {
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return encrypted; // decryption failed — return as-is (might be plaintext)
  }
}

/** Check if a value appears to be encrypted (matches iv:tag:ciphertext hex format). */
export function isEncrypted(value: string): boolean {
  if (!value || !value.includes(':')) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivHex, tagHex] = parts;
  return ivHex.length === IV_LENGTH * 2 && tagHex.length === TAG_LENGTH * 2;
}
