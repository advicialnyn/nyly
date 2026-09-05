import { createLink, updateLink, deleteLink, readLinks, normalizeLink, slugify, approveUser } from '../_lib/github.js';
import {
  sendMessage, notifyChannel, formatLinkAnnouncement, formatMultiAnnouncement,
  formatBotReply, botReplyButtons, formatMultiReply, multiReplyButtons, formatLinkList
} from '../_lib/telegram.js';

const URL_RE = /https?:\/\/[^\s]+/i;

// Accepts either a bare slug ("myslug") or a full short URL
// ("https://nyly.pages.dev/myslug") and returns just the slug.
function resolveSlug(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return slugify(u.pathname.replace(/^\/+/, ''));
    } catch (e) {
      return '';
    }
  }
  return slugify(trimmed.replace(/^\/+/, ''));
}

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
    if (cmd === '/adduser') return await handleAddUser(env, chatId, rest);
  } catch (e) {
    await sendMessage(env, chatId, `Error: ${e.message}`);
    return new Response('ok');
  }

  return await handleCreate(env, chatId, text);
}

export async function onRequestGet() {
  return new Response('telegram webhook is up', { status: 200 });
}

// ---- help ----

async function handleHelp(env, chatId) {
  await sendMessage(env, chatId,
    'ðŸ”— <b>linkstore bot â€” how it works</b>\n\n' +
    '<b>1. Create a link</b>\n' +
    'Just send a URL:\n<code>https://example.com/page</code>\nâ†’ makes a random short link\n\n' +
    'Add your own slug, before or after the link:\n<code>myvid https://example.com/page</code>\n<code>https://example.com/page myvid</code>\n\n' +
    '<b>2. Create several at once</b>\n' +
    'Send each link on its own line in one message â€” one message, many short links back.\n\n' +
    '<b>3. Manage a link</b>\n' +
    'Every command below accepts either the slug on its own, or the full short link â€” whichever is easier to grab:\n' +
    '<code>/delete myvid</code> or <code>/delete https://nyly.pages.dev/myvid</code>\n\n' +
    'â€¢ <code>/list</code> â€” show your links (<code>/list 15</code> for the next page)\n' +
    'â€¢ <code>/delete slug</code> â€” remove a link\n' +
    'â€¢ <code>/enable slug</code> / <code>/disable slug</code> â€” turn a link on/off without deleting it\n' +
    'â€¢ <code>/expire slug 7</code> â€” expires in 7 days\n' +
    'â€¢ <code>/expire slug 2026-12-31</code> â€” expires on that date\n' +
    'â€¢ <code>/expire slug off</code> â€” remove the expiry\n' +
    'â€¢ <code>/rename slug newslug</code> â€” change the alias\n' +
    'â€¢ <code>/edit slug https://newdestination.com</code> â€” change where it points\n\n' +
    '<b>Accounts</b>\n' +
    'When someone requests an account on the website, you get a message here with a ready-to-send <code>/adduser</code> command â€” just tap and send it to approve them.\n\n' +
    'Every link created here also gets logged to the channel, if one is set up.'
  );
  return new Response('ok');
}

// ---- list ----

async function handleList(env, chatId, rest) {
  const offset = Math.max(0, parseInt(rest, 10) || 0);
  const { map } = await readLinks(env);
  const slugs = Object.keys(map).sort((a, b) => normalizeLink(map[b]).createdAt - normalizeLink(map[a]).createdAt);
  const page = slugs.slice(offset, offset + 15).map((slug) => ({ slug, ...normalizeLink(map[slug]) }));
  await sendMessage(env, chatId, formatLinkList(env, page, offset, slugs.length));
  return new Response('ok');
}

// ---- delete ----

async function handleDelete(env, chatId, rest) {
  const slug = resolveSlug(rest);
  if (!slug) { await sendMessage(env, chatId, 'Usage: /delete slug (or the full short link)'); return new Response('ok'); }
  await deleteLink(env, slug);
  await sendMessage(env, chatId, `ðŸ—‘ Deleted /${slug}`);
  return new Response('ok');
}

// ---- enable / disable ----

async function handleToggle(env, chatId, rest, enabled) {
  const slug = resolveSlug(rest);
  if (!slug) { await sendMessage(env, chatId, `Usage: /${enabled ? 'enable' : 'disable'} slug (or the full short link)`); return new Response('ok'); }
  await updateLink(env, { slug, enabled });
  await sendMessage(env, chatId, `${enabled ? 'âœ… Enabled' : 'â›” Disabled'} /${slug}`);
  return new Response('ok');
}

// ---- expire ----

async function handleExpire(env, chatId, rest) {
  const parts = rest.split(/\s+/);
  const slug = resolveSlug(parts[0] || '');
  const arg = (parts[1] || '').toLowerCase();
  if (!slug || !arg) { await sendMessage(env, chatId, 'Usage: /expire slug 7  Â·  /expire slug 2026-12-31  Â·  /expire slug off'); return new Response('ok'); }

  if (arg === 'off' || arg === 'never' || arg === 'clear') {
    await updateLink(env, { slug, clearExpiry: true });
    await sendMessage(env, chatId, `â™¾ Removed expiry from /${slug}`);
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
  await sendMessage(env, chatId, `â³ /${slug} now expires ${new Date(expiresAt).toLocaleString()}`);
  return new Response('ok');
}

// ---- rename ----

async function handleRename(env, chatId, rest) {
  const rp = rest.split(/\s+/);
  const slug = resolveSlug(rp[0] || '');
  const newSlug = slugify(rp[1] || '');
  if (!slug || !newSlug) { await sendMessage(env, chatId, 'Usage: /rename slug newslug (slug can be the full short link)'); return new Response('ok'); }
  const finalSlug = await updateLink(env, { slug, newSlug });
  await sendMessage(env, chatId, `âœï¸ Renamed to /${finalSlug}`);
  return new Response('ok');
}

// ---- edit destination ----

async function handleEdit(env, chatId, rest) {
  const spaceIdx = rest.indexOf(' ');
  const rawSlug = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const dest = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
  const slug = resolveSlug(rawSlug);
  if (!slug || !/^https?:\/\//i.test(dest)) { await sendMessage(env, chatId, 'Usage: /edit slug https://newdestination.com (slug can be the full short link)'); return new Response('ok'); }
  await updateLink(env, { slug, dest });
  await sendMessage(env, chatId, `âœï¸ Updated destination for /${slug}`);
  return new Response('ok');
}

// ---- approve a signup ----

async function handleAddUser(env, chatId, rest) {
  const parts = rest.split(/\s+/);
  const username = (parts[0] || '').trim().toLowerCase();
  const password = parts.slice(1).join(' ');
  if (!username || !password) {
    await sendMessage(env, chatId, 'Usage: /adduser username password\n\n(copy both straight from the signup notification)');
    return new Response('ok');
  }
  await approveUser(env, username, password);
  await sendMessage(env, chatId, `âœ… Approved <b>${username}</b> â€” they can log in on the website now.`);
  return new Response('ok');
}

// ---- create (single or multi-line) ----

function ownerForChat(env, chatId) {
  try {
    const map = env.TELEGRAM_USER_MAP ? JSON.parse(env.TELEGRAM_USER_MAP) : {};
    if (map[String(chatId)]) return map[String(chatId)];
  } catch (e) {
    // ignore malformed map, fall through
  }
  return 'telegram';
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
    await sendMessage(env, chatId, "Send me a link to shorten, e.g.\nhttps://example.com/page\n\nSend /help to see everything the bot can do.");
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
        message: `add short link via telegram: ${customSlug || '(auto)'}`,
        owner: ownerForChat(env, chatId)
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
        message: `add short link via telegram: ${customSlug || '(auto)'}`,
        owner: ownerForChat(env, chatId)
      });
      const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
      results.push({ line, slug, dest, shortUrl });
    } catch (e) {
      results.push({ line, error: e.message });
    }
  }

  await sendMessage(env, chatId, formatMultiReply(env, results), multiReplyButtons(results));

  const announcement = formatMultiAnnouncement(env, results, 'telegram');
  if (announcement) await notifyChannel(env, announcement);

  return new Response('ok');
}
