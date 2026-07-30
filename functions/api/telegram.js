import { createLink } from '../_lib/github.js';
import { sendMessage, notifyChannel, formatLinkAnnouncement, formatBotReply, botReplyButtons } from '../_lib/telegram.js';

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

  if (text === '/start' || text === '/help') {
    await sendMessage(env, chatId,
      '🔗 <b>linkstore bot</b>\n\n' +
      'Send me any link and I\'ll shorten it.\n\n' +
      '<b>Just a URL:</b>\n<code>https://example.com/page</code>\n→ random short slug\n\n' +
      '<b>URL with a custom slug in front:</b>\n<code>myvid https://example.com/page</code>\n→ uses <code>myvid</code> as the slug\n\n' +
      'Every link you create here also gets logged to the channel, if one is set up.'
    );
    return new Response('ok');
  }

  const urlMatch = text.match(URL_RE);
  if (!urlMatch) {
    await sendMessage(env, chatId, "Send me a link to shorten, e.g.\nhttps://example.com/page\n\nSend /help for more.");
    return new Response('ok');
  }

  const dest = urlMatch[0];
  const before = text.slice(0, urlMatch.index).trim();
  const customSlug = before && !/\s/.test(before) ? before.toLowerCase() : null;

  try {
    const slug = await createLink(env, {
      slug: customSlug ? customSlug.replace(/[^a-z0-9-_]+/g, '-') : null,
      dest,
      message: `add short link via telegram: ${customSlug || '(auto)'}`
    });
    const shortUrl = `${(env.SITE_URL || '').replace(/\/$/, '')}/${slug}`;
    await sendMessage(env, chatId, formatBotReply(env, shortUrl, dest), botReplyButtons(dest));
    await notifyChannel(env, formatLinkAnnouncement(env, slug, dest));
  } catch (e) {
    await sendMessage(env, chatId, `Couldn't create that link: ${e.message}`);
  }

  return new Response('ok');
}

export async function onRequestGet() {
  return new Response('telegram webhook is up', { status: 200 });
}
