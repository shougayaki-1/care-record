'use server';

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL!;

// 修正: payloadの型を any から Record<string, unknown> に変更
export async function callGasApi(payload: Record<string, unknown>) {
  if (!GAS_API_URL) throw new Error('GAS_API_URL is not defined');

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // GASのリダイレクトを追跡する
      redirect: 'follow', 
    });

    if (!response.ok) {
        throw new Error(`GAS API responded with status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('GAS Action Error:', error);
    return { status: 'error', message: String(error) };
  }
}