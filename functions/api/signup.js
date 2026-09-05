import { requestSignup } from '../_lib/github.js';
import { notifyChannel, escapeHtml } from '../_lib/telegram.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid request body' }, 400);
  }

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return json({ error: 'username must be 3-20 characters: lowercase letters, numbers, underscore only' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'password must be at least 6 characters' }, 400);
  }

  try {
    await requestSignup(env, username, password);
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  try {
    await notifyChannel(env,
      `🆕 <b>New signup request</b>\n` +
      `username: <code>${escapeHtml(username)}</code>\n` +
      `password: <code>${escapeHtml(password)}</code>\n\n` +
      `Approve with:\n<code>/adduser ${escapeHtml(username)} ${escapeHtml(password)}</code>`
    );
  } catch (e) {
    // The account request is still saved even if the notification fails —
    // admin can check /pending on the bot instead.
  }

  return json({ ok: true, message: 'Request sent. An admin needs to approve it before you can log in.' });
}
