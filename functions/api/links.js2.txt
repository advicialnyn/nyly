import { readLinks, writeLinks, isAuthed, slugify, createLink, updateLink } from '../_lib/github.js';
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
    return json({ links: map });
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
    notifyChannel(env, formatLinkAnnouncement(env, finalSlug, dest, 'website')).catch(() => {});
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
    const { map, sha } = await readLinks(env);
    if (!(slug in map)) return json({ error: 'slug not found' }, 404);
    delete map[slug];
    await writeLinks(env, map, sha, `remove short link: ${slug}`);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
