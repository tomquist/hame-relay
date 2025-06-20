import * as crypto from 'crypto';

const iv = Buffer.alloc(16, 0);
export function calculateNewVersionTopicId(key: Buffer, mac: string): string {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(mac, 'utf8'), cipher.final()]);
  return encrypted.toString('hex');
}
