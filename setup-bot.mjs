import { readFile } from 'node:fs/promises';
import { commands, replyKeyboard, renderScreen } from './bot-ui.mjs';
import { telegramApi, sendTelegram } from './telegram.mjs';
import { readControls, updateControls, publishSnapshot, readSnapshot } from './bot-storage.mjs';

await telegramApi('setMyName', { name: 'Claude Pass Radar' });
await telegramApi('setMyShortDescription', { short_description: 'Fresh Claude Pro guest passes, with simple controls and a free-credit budget.' });
await telegramApi('setMyDescription', { description: 'Find fresh public Claude Pro guest passes from X and other sources. Get compact alerts, open the original post, mark used links, and manage the pace from the menu. Default checks run every 30 minutes. Guest-pass availability is unverified.' });
await telegramApi('setMyCommands', { commands });
await telegramApi('setChatMenuButton', { chat_id: Number(process.env.TELEGRAM_CHAT_ID), menu_button: { type: 'commands' } });
await updateControls(current => current);
const state = JSON.parse(await readFile(new URL('./state.json', import.meta.url), 'utf8'));
await publishSnapshot(state);
const controls = await readControls();
const card = renderScreen('menu', controls, await readSnapshot());
if (controls.menuMessageId) {
  try {
    await telegramApi('editMessageText', { chat_id: process.env.TELEGRAM_CHAT_ID, message_id: controls.menuMessageId, parse_mode: 'HTML', ...card });
  } catch (error) { if (!error.notModified) throw error; }
} else {
  await sendTelegram('<b>Your radar has a new menu</b>\n\nUse the buttons below to check status, see recent finds, or change settings.', { reply_markup: replyKeyboard });
  const message = await sendTelegram(card.text, { reply_markup: card.reply_markup });
  await updateControls(current => ({ ...current, menuMessageId: message.message_id }));
  await telegramApi('pinChatMessage', { chat_id: process.env.TELEGRAM_CHAT_ID, message_id: message.message_id, disable_notification: true });
}
if (process.env.BOT_WEBHOOK_URL) {
  await telegramApi('setWebhook', { url: process.env.BOT_WEBHOOK_URL, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
}
console.log('Bot menu, commands, and private controls configured');
