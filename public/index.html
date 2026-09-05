function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export async function onRequestGet() {
  return json({ ok: true, note: 'POST { username, password } here to request an account.' });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Import here, inside the try/catch, so a broken _lib file produces a
  // real JSON error instead of crashing before any response is sent.
  let lib, tg;
  try {
    lib = await import('../_lib/github.js');
    tg = await import('../_lib/telegram.js');
  } catch (e) {
    return json({ error: 'server misconfiguration: ' + e.message }, 500);
  }

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
    await lib.requestSignup(env, username, password);
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  try {
    await tg.notifyChannel(env,
      `🆕 <b>New signup request</b>\n` +
      `username: <code>${tg.escapeHtml(username)}</code>\n` +
      `password: <code>${tg.escapeHtml(password)}</code>\n\n` +
      `Approve with:\n<code>/adduser ${tg.escapeHtml(username)} ${tg.escapeHtml(password)}</code>`
    );
  } catch (e) {
    // The account request is still saved even if the notification fails.
  }

  return json({ ok: true, message: 'Request sent. An admin needs to approve it before you can log in.' });
}
