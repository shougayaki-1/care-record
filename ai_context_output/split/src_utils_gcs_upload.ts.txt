import { Storage } from '@google-cloud/storage';

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

function parseServiceAccountCredentials(): ServiceAccountCredentials | undefined {
  const raw = process.env.GCP_SERVICE_ACCOUNT_KEY_JSON?.trim();
  if (!raw) return undefined;

  const jsonText = raw.startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf-8');

  try {
    const credentials = JSON.parse(jsonText) as ServiceAccountCredentials;
    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    return credentials;
  } catch {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY_JSON の形式が不正です。サービスアカウントJSONまたはBase64化したJSONを設定してください。');
  }
}

export function isGcsBackupConfigured(): boolean {
  return !!(
    process.env.GCP_PROJECT_ID
    && (
      process.env.GCP_SERVICE_ACCOUNT_KEY_JSON
      || process.env.GCP_SERVICE_ACCOUNT_KEY_PATH
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
    )
  );
}

function getStorage(): Storage {
  const projectId = process.env.GCP_PROJECT_ID;
  const credentials = parseServiceAccountCredentials();
  if (credentials) {
    return new Storage({ projectId, credentials });
  }

  if (process.env.GCP_SERVICE_ACCOUNT_KEY_PATH) {
    return new Storage({
      projectId,
      keyFilename: process.env.GCP_SERVICE_ACCOUNT_KEY_PATH,
    });
  }

  return new Storage({
    projectId,
  });
}

export async function uploadToGCS(
  bucketName: string,
  fileName: string,
  content: string,
): Promise<void> {
  const bucket = getStorage().bucket(bucketName);
  await bucket.file(fileName).save(content, {
    metadata: {
      contentType: fileName.endsWith('.json')
        ? 'application/json'
        : fileName.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'text/csv; charset=utf-8',
      cacheControl: 'no-cache',
    },
  });
}

export type GCSFileEntry = {
  name: string;
  updated: string;
  size: number;
};

export async function listGCSFiles(bucketName: string, prefix: string): Promise<GCSFileEntry[]> {
  const [files] = await getStorage().bucket(bucketName).getFiles({ prefix });
  return files.map((f) => ({
    name: f.name,
    updated: f.metadata.updated ?? '',
    size: Number(f.metadata.size ?? 0),
  }));
}

export async function readGCSFile(bucketName: string, filePath: string): Promise<string> {
  const [content] = await getStorage().bucket(bucketName).file(filePath).download();
  return content.toString('utf-8');
}
