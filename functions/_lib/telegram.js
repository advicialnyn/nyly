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

export function formatLinkAnnouncement(env, slug, dest, source) {
  const shortUrl = `${env.SITE_URL || ''}/${slug}`;
  return (
    `🔗 <b>new short link</b> (${escapeHtml(source)})\n` +
    `/${escapeHtml(slug)} → ${escapeHtml(dest)}\n` +
    (env.SITE_URL ? shortUrl : '')
  );
}
