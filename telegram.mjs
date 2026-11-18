export async function telegramApi(method, payload = {}, request = fetch) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('Telegram bot token is missing');
  try {
    const response = await request(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) {
      const error = new Error(`Telegram ${method} failed (HTTP ${response.status})`);
      error.code = data.error_code;
      throw error;
    }
    return data.result;
  } catch (error) {
    // Never propagate a fetch exception containing the credential-bearing request URL.
    if (error.code) throw error;
    throw new Error(`Telegram ${method} request failed`);
  }
}

export function sendTelegram(text, options = {}) {
  return telegramApi('sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...options,
  });
}
