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

const DIVIDER = '••••••••••••••••••••••••••••••••••••••••••••';

// One entry: short link (tap to copy) then the full destination underneath.
// Optional status tag (e.g. "off", "expired") and source tag (e.g. "telegram").
function block(shortUrl, dest, opts) {
  opts = opts || {};
  const tag = opts.status ? ` [${opts.status}]` : '';
  const via = opts.source ? `via - ${escapeHtml(opts.source)}\n` : '';
  return `${via}🔗 <code>${escapeHtml(shortUrl)}</code>${tag}\n${escapeHtml(dest)}`;
}

function withDividers(blocks) {
  return DIVIDER + '\n' + blocks.join('\n' + DIVIDER + '\n') + '\n' + DIVIDER;
}

export function botReplyButtons(dest) {
  return { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Open', url: dest }]] }) };
}

// Single link created — private reply to whoever used the bot.
export function formatBotReply(env, shortUrl, dest) {
  const host = (env.SITE_URL || shortUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `🔗 <b>Shortened with ${escapeHtml(host)}</b>\n\n` + withDividers([block(shortUrl, dest)]);
}

// Several links created at once — same block/divider pattern, one per link.
export function formatMultiReply(env, results) {
  const host = (env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const okCount = results.filter((r) => !r.error).length;
  const blocks = results.map((r) => {
    if (r.error) return `✘ ${escapeHtml(r.line)}\n   ${escapeHtml(r.error)}`;
    return block(r.shortUrl, r.dest);
  });
  return `🔗 <b>Shortened ${okCount} link(s) with ${escapeHtml(host)}</b>\n\n` + withDividers(blocks);
}

export function multiReplyButtons(results) {
  const rows = results
    .filter((r) => !r.error)
    .slice(0, 10)
    .map((r) => [{ text: `Open /${r.slug}`, url: r.dest }]);
  if (!rows.length) return {};
  return { reply_markup: JSON.stringify({ inline_keyboard: rows }) };
}

// /list — same divider pattern, with an [off]/[expired] tag where relevant.
export function formatLinkList(env, entries, offset, total) {
  const host = (env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!entries.length) return 'No links yet.';
  const blocks = entries.map((e) => {
    const status = !e.enabled ? 'off' : (e.expiresAt && Date.now() > e.expiresAt ? 'expired' : null);
    const shortUrl = `${host}/${e.slug}`;
    return block(shortUrl, e.url, { status: status });
  });
  let out = `🔗 <b>Links ${offset + 1}–${offset + entries.length} of ${total}</b> (on ${escapeHtml(host)})\n\n` + withDividers(blocks);
  if (offset + entries.length < total) out += `\n\nSend /list ${offset + entries.length} to see more.`;
  return out;
}

// Channel log — same divider pattern, with a "via - source" line per entry.
export function formatLinkAnnouncement(env, slug, dest, source) {
  const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
  return withDividers([block(shortUrl, dest, { source: source })]);
}

// Multiple links announced to the channel at once — same pattern, one call.
export function formatMultiAnnouncement(env, results, source) {
  const blocks = results.filter((r) => !r.error).map((r) => block(r.shortUrl, r.dest, { source: source }));
  if (!blocks.length) return null;
  return withDividers(blocks);
}
