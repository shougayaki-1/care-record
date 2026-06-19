import 'server-only';

import sharp from 'sharp';

const MAX_PIXELS = 40_000_000;

async function malwareScan(bytes: Buffer): Promise<void> {
  const url = process.env.MALWARE_SCAN_URL;
  const token = process.env.MALWARE_SCAN_TOKEN;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ファイル検査サービスが設定されていません');
    }
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: new Uint8Array(bytes),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('ファイル検査に失敗しました');
    const result = await response.json() as { clean?: boolean };
    if (result.clean !== true) throw new Error('安全でないファイルはアップロードできません');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 宣言されたMIMEを信用せず画像デコーダで検証し、向き補正・再エンコードによって
 * EXIF/GPS/コメント等のメタデータと付加ペイロードを除去する。
 */
export async function sanitizeUploadedImage(file: File): Promise<{ bytes: Buffer; contentType: 'image/webp'; extension: 'webp' }> {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('画像サイズは10MB以下にしてください');
  const original = Buffer.from(await file.arrayBuffer());
  await malwareScan(original);
  try {
    const image = sharp(original, { failOn: 'error', limitInputPixels: MAX_PIXELS });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new Error('unsupported');
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) throw new Error('too_large');
    const bytes = await image.rotate().webp({ quality: 90, effort: 4 }).toBuffer();
    return { bytes, contentType: 'image/webp', extension: 'webp' };
  } catch {
    throw new Error('JPEG、PNG、WebPの正常な画像のみアップロードできます');
  }
}
