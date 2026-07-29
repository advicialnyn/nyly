// Server-side only. Runs on Cloudflare's servers, never shipped to the browser,
// so env.GITHUB_TOKEN and env.ADMIN_PASSWORD are never exposed to visitors.

function b64EncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function b64DecodeUnicode(str) {
  const bin = atob(str.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function contentsUrl(env) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/links.json`;
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'linkstore-worker'
  };
}

export async function readLinks(env) {
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${contentsUrl(env)}?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(env),
    cf: { cacheTtl: 0 }
  });
  if (res.status === 404) return { map: {}, sha: null };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub read failed (${res.status})`);
  }
  const data = await res.json();
  let map = {};
  try {
    map = JSON.parse(b64DecodeUnicode(data.content));
  } catch (e) {
    map = {};
  }
  return { map, sha: data.sha };
}

export async function writeLinks(env, map, sha, message) {
  const branch = env.GITHUB_BRANCH || 'main';
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(map, null, 2) + '\n'),
    branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(contentsUrl(env), {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub write failed (${res.status})`);
  }
  return res.json();
}

export function isAuthed(request, env) {
  const supplied = request.headers.get('x-admin-password') || '';
  return !!env.ADMIN_PASSWORD && supplied === env.ADMIN_PASSWORD;
}

export function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const RANDOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no 0/o/1/l ambiguity

export function randomSlug(len = 6) {
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += RANDOM_ALPHABET[bytes[i] % RANDOM_ALPHABET.length];
  return out;
}

// Adds a link, auto-generating a random slug when none is given.
export async function createLink(env, { slug, dest, message }) {
  const { map, sha } = await readLinks(env);
  let finalSlug = slug;
  if (!finalSlug) {
    do {
      finalSlug = randomSlug();
    } while (map[finalSlug]);
  } else if (map[finalSlug]) {
    throw new Error(`slug "${finalSlug}" already exists`);
  }
  map[finalSlug] = dest;
  await writeLinks(env, map, sha, message || `add short link: ${finalSlug}`);
  return finalSlug;
}
