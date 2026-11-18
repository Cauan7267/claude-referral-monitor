import { timingSafeEqual } from 'node:crypto';
import { handleUpdate } from '../bot-handler.mjs';

export function hasWebhookSecret(value, expected) {
  if (typeof value !== 'string' || !expected) return false;
  const supplied = Buffer.from(value);
  const secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

export async function webhook(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false });
  if (!hasWebhookSecret(request.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return response.status(403).json({ ok: false });
  }
  try {
    const update = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!update || typeof update !== 'object') return response.status(400).json({ ok: false });
    await handleUpdate(update);
    return response.status(200).json({ ok: true });
  } catch {
    console.error('Telegram update processing failed');
    return response.status(500).json({ ok: false });
  }
}

export default webhook;
