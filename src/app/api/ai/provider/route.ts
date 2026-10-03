import { getAuthedUser } from '@/utils/supabase/auth';
import { getAiExtractProvider, isAiImportEnabled } from '@/lib/env/server';
import { MODEL_NAME, OPENAI_MODEL_NAME } from '@/lib/ai/model';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isAiImportEnabled()) return new Response('Not Found', { status: 404 });
  try {
    await getAuthedUser();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const provider = getAiExtractProvider();
  return Response.json({
    provider,
    model: provider === 'openai' ? OPENAI_MODEL_NAME : MODEL_NAME,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
