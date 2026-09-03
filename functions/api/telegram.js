import { createLink, updateLink, deleteLink, readLinks, normalizeLink, slugify } from '../_lib/github.js';
import {
  sendMessage, notifyChannel, formatLinkAnnouncement,
  formatBotReply, botReplyButtons, formatMultiReply, multiReplyButtons, formatLinkList
} from '../_lib/telegram.js';

const URL_RE = /https?:\/\/[^\s]+/i;

export async function onRequestPost(context) {
  const { request, env } = context;

  const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response('bad request', { status: 400 });
  }

  const msg = update.message || update.channel_post;
  if (!msg || !msg.text) return new Response('ok');

  const chatId = msg.chat && msg.chat.id;
  const allowed = (env.TELEGRAM_ALLOWED_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(String(chatId))) {
    return new Response('ok');
  }

  const text = msg.text.trim();
  const parts0 = text.split(/\s+/);
  const cmd = (parts0[0] || '').toLowerCase();
  const rest = parts0.slice(1).join(' ');

  try {
    if (cmd === '/start' || cmd === '/help') return await handleHelp(env, chatId);
    if (cmd === '/list') return await handleList(env, chatId, rest);
    if (cmd === '/delete') return await handleDelete(env, chatId, rest);
    if (cmd === '/enable') return await handleToggle(env, chatId, rest, true);
    if (cmd === '/disable') return await handleToggle(env, chatId, rest, false);
    if (cmd === '/expire') return await handleExpire(env, chatId, rest);
    if (cmd === '/rename') return await handleRename(env, chatId, rest);
    if (cmd === '/edit') return await handleEdit(env, chatId, rest);
  } catch (e) {
    await sendMessage(env, chatId, `Error: ${e.message}`);
    return new Response('ok');
  }

  return await handleCreate(env, chatId, text);
}

export async function onRequestGet() {
  return new Response('telegram webhook is up', { status: 200 });
}

async function handleHelp(env, chatId) {
  await sendMessage(env, chatId,
    '🔗 <b>linkstore bot</b>\n\n' +
    '<b>Create</b>\n' +
    'Send a link → random slug.\n' +
    '<code>myvid https://example.com</code> or <code>https://example.com myvid</code> → custom slug.\n' +
    'Send several links, one per line, to shorten them all at once.\n\n' +
    '<b>Manage</b>\n' +
    '/list — show your links\n' +
    '/delete slug\n' +
    '/enable slug · /disable slug\n' +
    '/expire slug 7 — expires in 7 days\n' +
    '/expire slug 2026-12-31 — expires on a date\n' +
    '/expire slug off — remove expiry\n' +
    '/rename oldslug newslug\n' +
    '/edit slug https://newdestination.com'
  );
  return new Response('ok');
}

async function handleList(env, chatId, rest) {
  const offset = Math.max(0, parseInt(rest, 10) || 0);
  const { map } = await readLinks(env);
  const slugs = Object.keys(map).sort((a, b) => normalizeLink(map[b]).createdAt - normalizeLink(map[a]).createdAt);
  const page = slugs.slice(offset, offset + 15).map((slug) => ({ slug, ...normalizeLink(map[slug]) }));
  await sendMessage(env, chatId, formatLinkList(env, page, offset, slugs.length));
  return new Response('ok');
}

async function handleDelete(env, chatId, rest) {
  const slug = slugify(rest);
  if (!slug) { await sendMessage(env, chatId, 'Usage: /delete slug'); return new Response('ok'); }
  await deleteLink(env, slug);
  await sendMessage(env, chatId, `🗑 Deleted /${slug}`);
  return new Response('ok');
}

async function handleToggle(env, chatId, rest, enabled) {
  const slug = slugify(rest);
  if (!slug) { await sendMessage(env, chatId, `Usage: /${enabled ? 'enable' : 'disable'} slug`); return new Response('ok'); }
  await updateLink(env, { slug, enabled });
  await sendMessage(env, chatId, `${enabled ? '✅ Enabled' : '⛔ Disabled'} /${slug}`);
  return new Response('ok');
}

async function handleExpire(env, chatId, rest) {
  const parts = rest.split(/\s+/);
  const slug = slugify(parts[0] || '');
  const arg = (parts[1] || '').toLowerCase();
  if (!slug || !arg) { await sendMessage(env, chatId, 'Usage: /expire slug 7  ·  /expire slug 2026-12-31  ·  /expire slug off'); return new Response('ok'); }

  if (arg === 'off' || arg === 'never' || arg === 'clear') {
    await updateLink(env, { slug, clearExpiry: true });
    await sendMessage(env, chatId, `♾ Removed expiry from /${slug}`);
    return new Response('ok');
  }

  let expiresAt;
  if (/^\d+$/.test(arg)) {
    expiresAt = Date.now() + Number(arg) * 24 * 60 * 60 * 1000;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    expiresAt = new Date(arg + 'T23:59:59').getTime();
  } else {
    await sendMessage(env, chatId, 'Give a number of days (7) or a date (2026-12-31), or "off".');
    return new Response('ok');
  }
  await updateLink(env, { slug, expiresAt });
  await sendMessage(env, chatId, `⏳ /${slug} now expires ${new Date(expiresAt).toLocaleString()}`);
  return new Response('ok');
}

async function handleRename(env, chatId, rest) {
  const rp = rest.split(/\s+/);
  const slug = slugify(rp[0] || '');
  const newSlug = slugify(rp[1] || '');
  if (!slug || !newSlug) { await sendMessage(env, chatId, 'Usage: /rename oldslug newslug'); return new Response('ok'); }
  const finalSlug = await updateLink(env, { slug, newSlug });
  await sendMessage(env, chatId, `✏️ Renamed to /${finalSlug}`);
  return new Response('ok');
}

async function handleEdit(env, chatId, rest) {
  const spaceIdx = rest.indexOf(' ');
  const slug = slugify(spaceIdx === -1 ? rest : rest.slice(0, spaceIdx));
  const dest = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
  if (!slug || !/^https?:\/\//i.test(dest)) { await sendMessage(env, chatId, 'Usage: /edit slug https://newdestination.com'); return new Response('ok'); }
  await updateLink(env, { slug, dest });
  await sendMessage(env, chatId, `✏️ Updated destination for /${slug}`);
  return new Response('ok');
}

function extractCustomSlug(line, match) {
  const before = line.slice(0, match.index).trim();
  const after = line.slice(match.index + match[0].length).trim();
  if (before && !/\s/.test(before)) return before.toLowerCase();
  if (after && !/\s/.test(after)) return after.toLowerCase();
  return null;
}

async function handleCreate(env, chatId, text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const candidates = lines
    .map((line) => ({ line, match: line.match(URL_RE) }))
    .filter((c) => c.match);

  if (!candidates.length) {
    await sendMessage(env, chatId, "Send me a link to shorten, e.g.\nhttps://example.com/page\n\nSend /help for more.");
    return new Response('ok');
  }

  if (candidates.length === 1) {
    const { line, match } = candidates[0];
    const dest = match[0];
    const customSlug = extractCustomSlug(line, match);
    try {
      const slug = await createLink(env, {
        slug: customSlug ? customSlug.replace(/[^a-z0-9-_]+/g, '-') : null,
        dest,
        message: `add short link via telegram: ${customSlug || '(auto)'}`
      });
      const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
      await sendMessage(env, chatId, formatBotReply(env, shortUrl, dest), botReplyButtons(dest));
      await notifyChannel(env, formatLinkAnnouncement(env, slug, dest, 'telegram'));
    } catch (e) {
      await sendMessage(env, chatId, `Couldn't create that link: ${e.message}`);
    }
    return new Response('ok');
  }

  const results = [];
  for (const { line, match } of candidates) {
    const dest = match[0];
    const customSlug = extractCustomSlug(line, match);
    try {
      const slug = await createLink(env, {
        slug: customSlug ? customSlug.replace(/[^a-z0-9-_]+/g, '-') : null,
        dest,
        message: `add short link via telegram: ${customSlug || '(auto)'}`
      });
      const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
      results.push({ line, slug, dest, shortUrl });
      await notifyChannel(env, formatLinkAnnouncement(env, slug, dest, 'telegram'));
    } catch (e) {
      results.push({ line, error: e.message });
    }
  }

  await sendMessage(env, chatId, formatMultiReply(env, results), multiReplyButtons(results));
  return new Response('ok');
}
