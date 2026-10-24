import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { sanitizeUploadedImage } from './uploadSecurity';

const file = (bytes: Uint8Array, type: string) => new File([new Uint8Array(bytes)], 'synthetic', { type });
const image = () => sharp({ create: { width: 4, height: 2, channels: 3, background: '#123456' } });

describe('image decoder compatibility after the security update', () => {
  beforeEach(() => vi.stubEnv('MALWARE_SCAN_URL', ''));
  afterEach(() => vi.unstubAllEnvs());

  it.each(['jpeg', 'png', 'webp'] as const)('accepts valid %s and emits WebP', async format => {
    const input = await image().toFormat(format).toBuffer();
    const result = await sanitizeUploadedImage(file(input, `image/${format}`));
    expect(result.contentType).toBe('image/webp');
    expect(result.extension).toBe('webp');
    expect(await sharp(result.bytes).metadata()).toMatchObject({ format: 'webp', width: 4, height: 2 });
  });

  it('applies orientation and removes embedded metadata', async () => {
    const input = await image().jpeg().withMetadata({
      orientation: 6, exif: { IFD0: { ImageDescription: 'Synthetic private metadata' } },
    }).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const result = await sanitizeUploadedImage(file(input, 'image/jpeg'));
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 2, height: 4 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it('rejects a declared MIME that disagrees with the decoded image', async () => {
    const input = await image().png().toBuffer();
    await expect(sanitizeUploadedImage(file(input, 'image/jpeg'))).rejects.toThrow('JPEG、PNG、WebPの正常な画像のみ');
  });

  it.each(['image/svg+xml', 'image/png'])('rejects SVG bytes declared as %s', async type => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2"/></svg>');
    await expect(sanitizeUploadedImage(file(svg, type))).rejects.toThrow('JPEG、PNG、WebPの正常な画像のみ');
  });

  it('rejects malformed image bytes and excessive dimensions', async () => {
    await expect(sanitizeUploadedImage(file(new TextEncoder().encode('invalid'), 'image/png')))
      .rejects.toThrow('JPEG、PNG、WebPの正常な画像のみ');
    const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#123456' } }).png().toBuffer();
    await expect(sanitizeUploadedImage(file(wide, 'image/png'))).rejects.toThrow('JPEG、PNG、WebPの正常な画像のみ');
  });
});
