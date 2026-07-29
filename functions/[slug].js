import { readLinks, normalizeLink } from './_lib/github.js';

export async function onRequestGet(context) {
  const { params, env } = context;
  const slug = params.slug;

  try {
    const { map } = await readLinks(env);
    if (map[slug]) {
      const link = normalizeLink(map[slug]);
      if (!link.enabled) return new Response(statusHtml(slug, 'this link is disabled'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (link.expiresAt && Date.now() > link.expiresAt) return new Response(statusHtml(slug, 'this link has expired'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
      return Response.redirect(link.url, 302);
    }
  } catch (e) {
    // fall through to 404
  }

  return new Response(statusHtml(slug, 'no link found for'), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

function statusHtml(slug, message) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>not found</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0F1420;color:#E8ECF1;font-family:ui-monospace,monospace;padding:24px;}
  .card{max-width:420px;text-align:center;}
  .slug{color:#FFB454;font-size:20px;margin:10px 0 18px;word-break:break-all;}
  a{color:#FFB454;}
</style></head>
<body><div class="card">
  <div>${message}</div>
  <div class="slug">/${slug}</div>
  <div><a href="/">go to dashboard</a></div>
</div></body></html>`;
}
