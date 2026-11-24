import { sendDiscord } from './discord.mjs';

// Compatibility adapter for the existing backup shell notification payload.
// Payload on stdin, secret in env; neither appears in argv or error output.
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error();
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
  await sendDiscord(process.env.DISCORD_ALERT_WEBHOOK_URL, payload);
} catch {
  console.error('discord_delivery_failed');
  process.exitCode = 1;
}
