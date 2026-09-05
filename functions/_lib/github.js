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

function contentsUrl(env, filename) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filename}`;
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'linkstore-worker'
  };
}

async function readJsonFile(env, filename) {
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${contentsUrl(env, filename)}?ref=${encodeURIComponent(branch)}`, {
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

async function writeJsonFile(env, filename, map, sha, message) {
  const branch = env.GITHUB_BRANCH || 'main';
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(map, null, 2) + '\n'),
    branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(contentsUrl(env, filename), {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 409) {
    const err = new Error('conflict');
    err.conflict = true;
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub write failed (${res.status})`);
  }
  return res.json();
}

export async function readLinks(env) {
  return readJsonFile(env, 'links.json');
}

export async function writeLinks(env, map, sha, message) {
  return writeJsonFile(env, 'links.json', map, sha, message);
}

// --- click counts, stored separately in counts.json so they never touch links.json ---

export async function readCounts(env) {
  return readJsonFile(env, 'counts.json');
}

export async function writeCounts(env, map, sha, message) {
  return writeJsonFile(env, 'counts.json', map, sha, message);
}

// Increments one link's count, retrying a few times if another click is
// writing at the same moment (GitHub rejects the write with a 409 if the
// file changed since we read it â€” we just re-read and try again).
export async function incrementCount(env, slug, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const { map, sha } = await readCounts(env);
    map[slug] = (map[slug] || 0) + 1;
    try {
      await writeCounts(env, map, sha, `+1 click: ${slug}`);
      return map[slug];
    } catch (e) {
      if (!e.conflict || i === attempts - 1) throw e;
      // small backoff before retrying with the latest sha
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

async function deleteCount(env, slug) {
  try {
    const { map, sha } = await readCounts(env);
    if (slug in map) {
      delete map[slug];
      await writeCounts(env, map, sha, `remove click count: ${slug}`);
    }
  } catch (e) {
    // best-effort â€” a stray leftover counter is harmless
  }
}

async function renameCount(env, oldSlug, newSlug) {
  try {
    const { map, sha } = await readCounts(env);
    if (oldSlug in map) {
      map[newSlug] = map[oldSlug];
      delete map[oldSlug];
      await writeCounts(env, map, sha, `move click count: ${oldSlug} -> ${newSlug}`);
    }
  } catch (e) {
    // best-effort
  }
}

// Supports multiple accounts via the ADMIN_USERS env var, a JSON object like
// {"nyn":"secret1","friend":"secret2"}. ADMIN_PASSWORD (if set) still works
// too, as a built-in account named "admin", so existing setups keep working.
export async function deleteLink(env, slug) {
  const { map, sha } = await readLinks(env);
  if (!(slug in map)) throw new Error(`slug "${slug}" not found`);
  delete map[slug];
  await writeLinks(env, map, sha, `remove short link: ${slug}`);
  await deleteCount(env, slug);
}

// --- accounts, stored in users.json ---
// Shape: { approved: { username: sha256hex }, pending: { username: { hash, requestedAt } } }
// "admin" is special: it authenticates against ADMIN_PASSWORD / legacy ADMIN_USERS
// (Cloudflare env vars) rather than users.json, since a Worker can't rewrite its
// own env vars â€” those still have to be changed by hand in the dashboard.

export async function readUsers(env) {
  return readJsonFile(env, 'users.json');
}

export async function writeUsers(env, data, sha, message) {
  return writeJsonFile(env, 'users.json', data, sha, message);
}

export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function legacyAdminUsers(env) {
  try {
    return env.ADMIN_USERS ? JSON.parse(env.ADMIN_USERS) : {};
  } catch (e) {
    return {};
  }
}

export async function verifyCredential(env, username, password) {
  if (username === 'admin') {
    if (env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) return true;
    const legacy = legacyAdminUsers(env);
    if (legacy.admin && legacy.admin === password) return true;
    return false;
  }
  try {
    const { map } = await readUsers(env);
    const approved = map.approved || {};
    if (approved[username]) {
      return approved[username] === (await sha256Hex(password));
    }
  } catch (e) {
    // fall through
  }
  // Back-compat: usernames set directly via ADMIN_USERS still work as plaintext.
  const legacy = legacyAdminUsers(env);
  if (legacy[username] && legacy[username] === password) return true;
  return false;
}

export function isAuthed(request, env) {
  return getAuthedUser(request, env).then((u) => !!u);
}

// Returns the username making the request if credentials are valid, or null.
export async function getAuthedUser(request, env) {
  const user = request.headers.get('x-admin-user') || '';
  const pass = request.headers.get('x-admin-password') || '';
  if (!user || !pass) return null;
  return (await verifyCredential(env, user, pass)) ? user : null;
}

export async function requestSignup(env, username, password) {
  username = String(username || '').trim().toLowerCase();
  if (username === 'admin') throw new Error('that username is reserved');
  const { map, sha } = await readUsers(env);
  map.approved = map.approved || {};
  map.pending = map.pending || {};
  if (map.approved[username]) throw new Error('that username is already taken');
  if (map.pending[username]) throw new Error('a request for that username is already waiting for approval');
  map.pending[username] = { hash: await sha256Hex(password), requestedAt: Date.now() };
  await writeUsers(env, map, sha, `signup request: ${username}`);
}

export async function approveUser(env, username, password) {
  username = String(username || '').trim().toLowerCase();
  const { map, sha } = await readUsers(env);
  map.approved = map.approved || {};
  map.pending = map.pending || {};
  map.approved[username] = await sha256Hex(password);
  delete map.pending[username];
  await writeUsers(env, map, sha, `approve user: ${username}`);
}

export async function changePassword(env, username, oldPassword, newPassword) {
  const ok = await verifyCredential(env, username, oldPassword);
  if (!ok) throw new Error('current password is incorrect');
  if (username === 'admin') {
    throw new Error('the admin password can only be changed via ADMIN_PASSWORD in Cloudflare settings');
  }
  const { map, sha } = await readUsers(env);
  map.approved = map.approved || {};
  if (!map.approved[username]) throw new Error('account not found');
  map.approved[username] = await sha256Hex(newPassword);
  await writeUsers(env, map, sha, `change password: ${username}`);
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
    return { url: value, createdAt: 0, enabled: true, expiresAt: null, owner: null };
  }
  return {
    url: value.url,
    createdAt: value.createdAt || 0,
    enabled: value.enabled !== false,
    expiresAt: value.expiresAt || null,
    owner: value.owner || null
  };
}

export function isLinkLive(link) {
  const n = normalizeLink(link);
  if (!n.enabled) return false;
  if (n.expiresAt && Date.now() > n.expiresAt) return false;
  return true;
}

// Adds a link, auto-generating a random slug when none is given.
export async function createLink(env, { slug, dest, message, owner }) {
  const { map, sha } = await readLinks(env);
  let finalSlug = slug;
  if (!finalSlug) {
    do {
      finalSlug = randomSlug();
    } while (map[finalSlug]);
  } else if (map[finalSlug]) {
    throw new Error(`slug "${finalSlug}" already exists`);
  }
  map[finalSlug] = { url: dest, createdAt: Date.now(), enabled: true, expiresAt: null, owner: owner || null };
  await writeLinks(env, map, sha, message || `add short link: ${finalSlug}`);
  return finalSlug;
}

// Updates an existing link: rename (slug -> newSlug), change destination,
// enable/disable, or set/clear an expiry â€” any subset of these at once.
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
    expiresAt: clearExpiry ? null : (expiresAt !== undefined ? expiresAt : current.expiresAt),
    owner: current.owner
  };

  if (finalSlug !== slug) delete map[slug];
  map[finalSlug] = updated;

  await writeLinks(env, map, sha, `update short link: ${slug}${finalSlug !== slug ? ' -> ' + finalSlug : ''}`);
  if (finalSlug !== slug) await renameCount(env, slug, finalSlug);
  return finalSlug;
}
