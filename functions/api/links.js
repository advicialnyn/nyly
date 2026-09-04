import { readLinks, isAuthed, slugify, createLink, updateLink, deleteLink, readCounts } from '../_lib/github.js';
import { notifyChannel, formatLinkAnnouncement } from '../_lib/telegram.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return json({ error: 'unauthorized' }, 401);
  try {
    const { map } = await readLinks(env);
    let counts = {};
    try {
      counts = (await readCounts(env)).map;
    } catch (e) {
      // counts.json may not exist yet — that's fine, just show 0s
    }
    return json({ links: map, counts: counts });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid request body' }, 400);
  }
  const slug = slugify(body.slug || '');
  const dest = String(body.dest || '').trim();
  if (!dest) return json({ error: 'destination is required' }, 400);
  if (!/^https?:\/\//i.test(dest)) return json({ error: 'destination must start with http:// or https://' }, 400);

  try {
    const finalSlug = await createLink(env, { slug: slug || null, dest, message: `add short link: ${slug || '(auto)'}` });
    try {
      await notifyChannel(env, formatLinkAnnouncement(env, finalSlug, dest, 'website'));
    } catch (e) {
      // Don't fail link creation just because the Telegram announcement failed.
    }
    return json({ ok: true, slug: finalSlug, dest });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid request body' }, 400);
  }
  const slug = slugify(body.slug || '');
  if (!slug) return json({ error: 'slug is required' }, 400);

  const patch = { slug };
  if (body.newSlug !== undefined) patch.newSlug = slugify(body.newSlug);
  if (body.dest !== undefined) {
    const dest = String(body.dest).trim();
    if (!/^https?:\/\//i.test(dest)) return json({ error: 'destination must start with http:// or https://' }, 400);
    patch.dest = dest;
  }
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.clearExpiry) patch.clearExpiry = true;
  else if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt ? Number(body.expiresAt) : null;

  try {
    const finalSlug = await updateLink(env, patch);
    return json({ ok: true, slug: finalSlug });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isAuthed(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid request body' }, 400);
  }
  const slug = slugify(body.slug || '');
  if (!slug) return json({ error: 'slug is required' }, 400);

  try {
    await deleteLink(env, slug);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
