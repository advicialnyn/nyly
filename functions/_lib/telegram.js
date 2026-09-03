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

// Reply after shortening several links at once — one line per result.
export function formatMultiReply(env, results) {
  const host = (env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const lines = results.map((r) => {
    if (r.error) return `✘ ${escapeHtml(r.line)}\n   ${escapeHtml(r.error)}`;
    return `✅ <code>${escapeHtml(r.shortUrl)}</code>\n   → ${escapeHtml(truncateUrl(r.dest))}`;
  });
  return `🔗 <b>Shortened ${results.filter((r) => !r.error).length} link(s) with ${escapeHtml(host)}</b>\n\n` + lines.join('\n\n');
}

export function multiReplyButtons(results) {
  const rows = results
    .filter((r) => !r.error)
    .slice(0, 10)
    .map((r) => [{ text: `Open /${r.slug}`, url: r.dest }]);
  if (!rows.length) return {};
  return { reply_markup: JSON.stringify({ inline_keyboard: rows }) };
}

// Plain-text summary for /list — Telegram messages have a length limit, so
// this caps how many links are shown at once.
export function formatLinkList(env, entries, offset, total) {
  const host = (env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!entries.length) return 'No links yet.';
  const lines = entries.map((e) => {
    const status = !e.enabled ? ' [off]' : (e.expiresAt && Date.now() > e.expiresAt ? ' [expired]' : '');
    return `/${escapeHtml(e.slug)}${status}\n${escapeHtml(e.url)}`;
  });
  let out = `🔗 <b>Links ${offset + 1}–${offset + entries.length} of ${total}</b> (on ${escapeHtml(host)})\n\n` + lines.join('\n\n');
  if (offset + entries.length < total) out += `\n\nSend /list ${offset + entries.length} to see more.`;
  return out;
}

// Channel log: short link (mono) + source tag, then the full destination.
export function formatLinkAnnouncement(env, slug, dest, source) {
  const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
  return `<code>${escapeHtml(shortUrl)}</code> · ${escapeHtml(source)}\n${escapeHtml(dest)}`;
}
