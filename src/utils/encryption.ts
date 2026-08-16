import crypto from 'crypto';

const LEGACY_KEY = 'c5IcvhwIPeTsiNboVnw3i6rUN73JpFjj';

export function encryptRequest(input: string): string {
  const inputLen = input.length;
  const keyLen = LEGACY_KEY.length;

  if (inputLen === 0) return '';

  let result = '';
  for (let i = 0; i < inputLen; ++i) {
    result += String.fromCharCode(
      input.charCodeAt(i) ^ LEGACY_KEY.charCodeAt(i % keyLen)
    );
  }
  return result;
}

export function decryptRequest(input: string): string {
  return encryptRequest(input);
}

export function encryptAES(text: string, key: string): string {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(key.padEnd(32, '0').slice(0, 32)),
    Buffer.from('00000000000000000000000000000000')
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('hex');
}

export function decryptAES(text: string, key: string): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(key.padEnd(32, '0').slice(0, 32)),
    Buffer.from('00000000000000000000000000000000')
  );
  let decrypted = decipher.update(Buffer.from(text, 'hex'));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

export function generateToken(key: string, hwid: string): string {
  const utcTime = new Date().toUTCString();
  const tokenBuffer = key + hwid + utcTime;
  const tokenMd5 = crypto.createHash('md5').update(tokenBuffer).digest('base64');
  return tokenMd5;
}
