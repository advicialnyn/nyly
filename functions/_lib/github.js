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

// Supports multiple accounts via the ADMIN_USERS env var, a JSON object like
// {"nyn":"secret1","friend":"secret2"}. ADMIN_PASSWORD (if set) still works
// too, as a built-in account named "admin", so existing setups keep working.
export async function deleteLink(env, slug) {
  const { map, sha } = await readLinks(env);
  if (!(slug in map)) throw new Error(`slug "${slug}" not found`);
  delete map[slug];
  await writeLinks(env, map, sha, `remove short link: ${slug}`);
}

export function isAuthed(request, env) {
  const user = request.headers.get('x-admin-user') || '';
  const pass = request.headers.get('x-admin-password') || '';
  if (!user || !pass) return false;

  let users = {};
  try {
    users = env.ADMIN_USERS ? JSON.parse(env.ADMIN_USERS) : {};
  } catch (e) {
    users = {};
  }
  if (env.ADMIN_PASSWORD && !users.admin) users.admin = env.ADMIN_PASSWORD;

  return !!users[user] && users[user] === pass;
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

// Normalizes either the old plain-string format or the new object format
// into one shape, so old links keep working after this update.
export function normalizeLink(value) {
  if (typeof value === 'string') {
    return { url: value, createdAt: 0, enabled: true, expiresAt: null };
  }
  return {
    url: value.url,
    createdAt: value.createdAt || 0,
    enabled: value.enabled !== false,
    expiresAt: value.expiresAt || null
  };
}

export function isLinkLive(link) {
  const n = normalizeLink(link);
  if (!n.enabled) return false;
  if (n.expiresAt && Date.now() > n.expiresAt) return false;
  return true;
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
  map[finalSlug] = { url: dest, createdAt: Date.now(), enabled: true, expiresAt: null };
  await writeLinks(env, map, sha, message || `add short link: ${finalSlug}`);
  return finalSlug;
}

// Updates an existing link: rename (slug -> newSlug), change destination,
// enable/disable, or set/clear an expiry — any subset of these at once.
export async function updateLink(env, { slug, newSlug, dest, enabled, expiresAt, clearExpiry }) {
  const { map, sha } = await readLinks(env);
  if (!(slug in map)) throw new Error(`slug "${slug}" not found`);
  const current = normalizeLink(map[slug]);

  const finalSlug = newSlug && newSlug !== slug ? newSlug : slug;
  if (finalSlug !== slug && map[finalSlug]) {
    throw new Error(`slug "${finalSlug}" already exists`);
  }

  const updated = {
    url: dest !== undefined ? dest : current.url,
    createdAt: current.createdAt,
    enabled: enabled !== undefined ? enabled : current.enabled,
    expiresAt: clearExpiry ? null : (expiresAt !== undefined ? expiresAt : current.expiresAt)
  };

  if (finalSlug !== slug) delete map[slug];
  map[finalSlug] = updated;

  await writeLinks(env, map, sha, `update short link: ${slug}${finalSlug !== slug ? ' -> ' + finalSlug : ''}`);
  return finalSlug;
}
