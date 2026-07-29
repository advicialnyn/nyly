import { createLink } from '../_lib/github.js';
import { sendMessage, notifyChannel, formatLinkAnnouncement } from '../_lib/telegram.js';

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
      "Send me a link and I'll shorten it.\n\n" +
      "Just a URL → random slug.\n" +
      "<code>myslug https://example.com</code> → custom slug."
    );
    return new Response('ok');
  }

  const urlMatch = text.match(URL_RE);
  if (!urlMatch) {
    await sendMessage(env, chatId, "Send me a link to shorten, e.g.\nhttps://example.com/page");
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
    const shortUrl = `${env.SITE_URL || ''}/${slug}`;
    await sendMessage(env, chatId, `✅ <b>${shortUrl}</b>`);
    await notifyChannel(env, formatLinkAnnouncement(env, slug, dest, 'telegram'));
  } catch (e) {
    await sendMessage(env, chatId, `Couldn't create that link: ${e.message}`);
  }

  return new Response('ok');
}

export async function onRequestGet() {
  return new Response('telegram webhook is up', { status: 200 });
}
