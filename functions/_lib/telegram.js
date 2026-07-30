// Server-side only. env.TELEGRAM_BOT_TOKEN never reaches the browser.

export async function sendMessage(env, chatId, text, extra) {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return;
  const body = Object.assign(
    { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
    extra || {}
  );
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json().catch(() => null);
}

export async function notifyChannel(env, text) {
  if (!env.TELEGRAM_CHANNEL_ID) return;
  return sendMessage(env, env.TELEGRAM_CHANNEL_ID, text);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncateUrl(url, max = 46) {
  if (url.length <= max) return url;
  return url.slice(0, max) + '…';
}

// Private reply to whoever used the bot: short link in mono, a truncated
// (but still clickable) version of the destination, and an "Open" button.
export function formatBotReply(env, shortUrl, dest) {
  const host = (env.SITE_URL || shortUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    `🔗 <b>Shortened with ${escapeHtml(host)}</b>\n\n` +
    `<code>${escapeHtml(shortUrl)}</code>\n\n` +
    `📎 <a href="${dest}">${escapeHtml(truncateUrl(dest))}</a>`
  );
}

export function botReplyButtons(dest) {
  return { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Open', url: dest }]] }) };
}

// Channel log: just the short link (mono) and the full destination — nothing else.
export function formatLinkAnnouncement(env, slug, dest) {
  const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
  return `<code>${escapeHtml(shortUrl)}</code>\n${escapeHtml(dest)}`;
}
