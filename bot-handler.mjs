import { renderScreen, passKeyboard } from './bot-ui.mjs';
import { readControls, updateControls, readSnapshot } from './bot-storage.mjs';
import { telegramApi, sendTelegram } from './telegram.mjs';

const labels = { '📡 Status': 'status', '🎟 Recent finds': 'latest', '⚙️ Settings': 'settings', '❔ Help': 'help' };

export async function handleUpdate(update, services = {}) {
  const getControls = services.readControls || readControls;
  const changeControls = services.updateControls || updateControls;
  const getSnapshot = services.readSnapshot || readSnapshot;
  const api = services.telegramApi || telegramApi;
  const send = services.sendTelegram || sendTelegram;
  const owner = String(services.owner || process.env.TELEGRAM_CHAT_ID);
  const callback = update.callback_query;
  const message = callback?.message || update.message;
  const sender = callback?.from || message?.from;
  if (String(message?.chat?.id) !== owner || String(sender?.id) !== owner) return { ignored: true };
  if (!Number.isInteger(update.update_id)) return { ignored: true };

  if (callback) {
    try { await api('answerCallbackQuery', { callback_query_id: callback.id }); }
    catch (error) { if (error.code !== 400) throw error; }
  }
  const raw = callback?.data || message.text || '';
  let action = labels[raw] || raw.replace(/^\//, '').split(/[\s@]/)[0];
  if (action === 'start') action = 'menu';
  if (action === 'noop') return { ignored: true };
  let controls = await getControls();
  if (update.update_id <= controls.lastUpdateId) return { duplicate: true };
  const snapshot = await getSnapshot();
  let screen = action;
  let notice = '';

  if (action.startsWith('used:')) {
    const hash = action.slice(5);
    if (!/^[a-f0-9]{32}$/.test(hash)) {
      return { ignored: true };
    }
    controls = await changeControls(current => ({ ...current, used: [...new Set([...current.used, hash])].slice(-500) }));
    screen = 'latest';
    notice = '✓ Marked as used.\n\n';
  } else if (action === 'pause' || action === 'resume') {
    controls = await changeControls(current => ({ ...current, paused: action === 'pause' }));
    screen = 'menu';
    notice = action === 'pause' ? '⏸ Searches and new alerts are paused.\n\n' : '▶️ Monitoring resumed. Your next scheduled check will run automatically.\n\n';
  } else if (/^interval:(30|60|120)$/.test(action)) {
    controls = await changeControls(current => ({ ...current, intervalMinutes: Number(action.split(':')[1]) }));
    screen = 'settings';
    notice = '✓ Check interval updated.\n\n';
  } else if (!['menu', 'status', 'sources', 'budget', 'latest', 'settings', 'help'].includes(action)) {
    screen = 'menu';
    notice = 'Choose a button below, or use /help.\n\n';
  }

  const card = renderScreen(screen, controls, snapshot);
  card.text = notice + card.text;
  const originalPasses = (snapshot.recent || []).filter(pass => pass.messageId === message.message_id).sort((a, b) => a.batchIndex - b.batchIndex);
  if (callback && action.startsWith('used:')) {
    // The alert can be tapped before the scanner publishes its latest snapshot.
    // Its own Telegram keyboard already contains everything needed for this edit.
    let keyboard = message.reply_markup || passKeyboard(originalPasses, controls.used);
    keyboard = { inline_keyboard: keyboard.inline_keyboard.map(row => row.some(button => button.callback_data === action)
      ? [{ text: '✓ Marked used', callback_data: 'noop' }, ...row.filter(button => button.text === 'Source')]
      : row) };
    await api('editMessageReplyMarkup', { chat_id: owner, message_id: message.message_id, reply_markup: keyboard });
  } else if (callback && !originalPasses.length) {
    try {
      await api('editMessageText', { chat_id: owner, message_id: message.message_id, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...card });
    } catch (error) {
      if (error.code !== 400) throw error;
      // An unchanged screen or an old uneditable message is harmless.
      if (notice) await send(card.text, { reply_markup: card.reply_markup });
    }
  } else {
    await send(card.text, { reply_markup: card.reply_markup });
  }
  if (notice && controls.menuMessageId && (!callback || message.message_id !== controls.menuMessageId)) {
    try {
      await api('editMessageText', { chat_id: owner, message_id: controls.menuMessageId, parse_mode: 'HTML', ...renderScreen('menu', controls, snapshot) });
    } catch { console.warn('Pinned menu refresh deferred'); }
  }
  // Commit the update offset after successful replies, allowing delivery retries on failure.
  await changeControls(current => update.update_id <= current.lastUpdateId ? null : { ...current, lastUpdateId: update.update_id });
  return { handled: true, screen };
}
