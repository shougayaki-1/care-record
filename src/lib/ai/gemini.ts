import { VertexAI } from '@google-cloud/vertexai';

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
    throw new Error(
      'GCP_SERVICE_ACCOUNT_KEY_JSON の形式が不正です。サービスアカウントJSONまたはBase64化したJSONを設定してください。'
    );
  }
}

const project = process.env.GCP_PROJECT_ID;
if (!project) throw new Error('GCP_PROJECT_ID is required');
const location = process.env.VERTEX_AI_LOCATION ?? 'asia-northeast1';

const credentials = parseServiceAccountCredentials();

export const vertexAI = new VertexAI({
  project,
  location,
  ...(credentials
    ? {
        googleAuthOptions: {
          credentials,
        },
      }
    : {}),
});

export const MODEL_NAME = 'gemini-2.0-flash-001';

export function getGenerativeModel() {
  return vertexAI.getGenerativeModel({ model: MODEL_NAME });
}
