import { Storage } from '@google-cloud/storage';

function getStorage(): Storage {
  return new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY_JSON ?? '{}'),
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
