import { describe, it, expect } from 'vitest';
import {
  validateFileCount,
  validateFile,
  MAX_FILES,
  MAX_FILE_SIZE,
} from './validation';

// テスト用のダミー File オブジェクトを生成するヘルパ
function makeFile(name: string, type: string, sizeBytes: number): File {
  // File コンストラクタ: new File(parts, name, options)
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

describe('validateFileCount', () => {
  it('ファイルが0件のとき ok:false を返す', () => {
    const result = validateFileCount(0);
    expect(result.ok).toBe(false);
  });

  it('ファイルが1件のとき ok:true を返す', () => {
    const result = validateFileCount(1);
    expect(result.ok).toBe(true);
  });

  it(`ファイルが${MAX_FILES}件ちょうどのとき ok:true を返す`, () => {
    const result = validateFileCount(MAX_FILES);
    expect(result.ok).toBe(true);
  });

  it(`ファイルが${MAX_FILES + 1}件のとき ok:false を返す`, () => {
    const result = validateFileCount(MAX_FILES + 1);
    expect(result.ok).toBe(false);
  });

  it('上限超過時のエラーメッセージに上限数が含まれる', () => {
    const result = validateFileCount(MAX_FILES + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(String(MAX_FILES));
    }
  });
});

describe('validateFile - ファイルタイプ', () => {
  it('PDF ファイルは ok:true を返す', () => {
    const file = makeFile('test.pdf', 'application/pdf', 100);
    expect(validateFile(file).ok).toBe(true);
  });

  it('JPEG ファイルは ok:true を返す', () => {
    const file = makeFile('test.jpg', 'image/jpeg', 100);
    expect(validateFile(file).ok).toBe(true);
  });

  it('PNG ファイルは ok:true を返す', () => {
    const file = makeFile('test.png', 'image/png', 100);
    expect(validateFile(file).ok).toBe(true);
  });

  it('WebP ファイルは ok:true を返す', () => {
    const file = makeFile('test.webp', 'image/webp', 100);
    expect(validateFile(file).ok).toBe(true);
  });

  it('text/plain は ok:false を返す', () => {
    const file = makeFile('test.txt', 'text/plain', 100);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
  });

  it('application/zip は ok:false を返す', () => {
    const file = makeFile('test.zip', 'application/zip', 100);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
  });

  it('image/gif は ok:false を返す（未対応フォーマット）', () => {
    const file = makeFile('test.gif', 'image/gif', 100);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
  });

  it('MIME タイプが空文字列のとき ok:false を返す', () => {
    const file = makeFile('test', '', 100);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
  });

  it('不正なタイプのエラーメッセージにファイルのタイプが含まれる', () => {
    const file = makeFile('test.txt', 'text/plain', 100);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('text/plain');
    }
  });
});

describe('validateFile - ファイルサイズ', () => {
  it('サイズが 0 バイトのファイルは ok:true を返す（空ファイルはタイプ検証後に次工程で検出される）', () => {
    const file = makeFile('test.pdf', 'application/pdf', 0);
    expect(validateFile(file).ok).toBe(true);
  });

  it(`サイズが ${MAX_FILE_SIZE} バイトちょうどのとき ok:true を返す`, () => {
    const file = makeFile('test.pdf', 'application/pdf', MAX_FILE_SIZE);
    expect(validateFile(file).ok).toBe(true);
  });

  it(`サイズが ${MAX_FILE_SIZE + 1} バイトのとき ok:false を返す`, () => {
    const file = makeFile('test.pdf', 'application/pdf', MAX_FILE_SIZE + 1);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
  });

  it('サイズ超過時のエラーメッセージに MB 数が含まれる', () => {
    const file = makeFile('test.pdf', 'application/pdf', MAX_FILE_SIZE + 1);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('MB');
    }
  });

  it('タイプとサイズの両方が不正な場合、タイプエラーが先に返される', () => {
    // タイプのチェックがサイズチェックより先に行われることを確認
    const file = makeFile('test.txt', 'text/plain', MAX_FILE_SIZE + 1);
    const result = validateFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('text/plain');
    }
  });
});
