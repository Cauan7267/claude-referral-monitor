import assert from 'node:assert/strict';
import { readControls } from './bot-storage.mjs';
import { telegramApi } from './telegram.mjs';

const endpoint = new URL(process.env.BOT_WEBHOOK_URL);
assert.equal(endpoint.protocol, 'https:');
assert.ok(endpoint.hostname.endsWith('.vercel.app'));
const health = await fetch(new URL('/api/health', endpoint), { signal: AbortSignal.timeout(20_000) });
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ready');
const rejected = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(rejected.status, 403);
const controls = await readControls();
// Run these synthetic owner callbacks before registering Telegram delivery. Small IDs
// precede this bot's already-observed Telegram update IDs and cannot block real input.
assert.ok(controls.lastUpdateId < 10, 'Live updates already started. Do not replay setup verification.');
const owner = Number(process.env.TELEGRAM_CHAT_ID);
for (const [index, action] of ['status', 'interval:60', 'interval:30', 'pause', 'resume', 'menu'].entries()) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify({ update_id: index, callback_query: { id: `setup-check-${index}`, from: { id: owner }, message: { chat: { id: owner }, message_id: controls.menuMessageId }, data: action } }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `${action} webhook response`);
  const updated = await readControls();
  if (action.startsWith('interval:')) assert.equal(updated.intervalMinutes, Number(action.split(':')[1]));
  if (action === 'pause') assert.equal(updated.paused, true);
  if (action === 'resume') assert.equal(updated.paused, false);
}
await telegramApi('setWebhook', { url: endpoint.href, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
const webhook = await telegramApi('getWebhookInfo');
assert.equal(webhook.url, endpoint.href);
console.log('Verified public health, webhook authentication, live status, pause/resume, and interval controls. Telegram webhook registered.');
