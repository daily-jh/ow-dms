import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 후원자 연락처 애플리케이션 암호화(AES-256-GCM). 키는 DB·저장소에 두지 않고 환경/KMS에서 주입한다.
 * 저장 형식: [keyVersion는 컬럼] iv(12) | tag(16) | ciphertext
 */
export class PiiCipher {
  private readonly key: Buffer;
  constructor(base64Key: string, readonly keyVersion = 1) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('PII key must be 32 bytes (base64)');
  }
  encrypt(plain: object): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }
  decrypt<T>(blob: Buffer): T {
    const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8')) as T;
  }
}

export function maskPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}
