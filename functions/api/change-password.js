import { getAuthedUser, changePassword } from '../_lib/github.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getAuthedUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid request body' }, 400);
  }

  const oldPassword = request.headers.get('x-admin-password') || '';
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 6) return json({ error: 'new password must be at least 6 characters' }, 400);

  try {
    await changePassword(env, user, oldPassword, newPassword);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}
