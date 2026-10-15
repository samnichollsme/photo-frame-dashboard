// Spotify now-playing and remote control through the Web API. Sign in once at /api/spotify/login
// (on the Mac at http://127.0.0.1:5174, or on the deployed address); the refresh token is kept in
// the STORE KV namespace.
// Playback control (play/pause/skip) needs Spotify Premium.

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
// The redirect must be listed in the Spotify app: http://127.0.0.1:5174/api/spotify/callback for
// local sign-in (Spotify only allows plain http on a loopback IP) and the https workers.dev one.
const redirectFor = (url) => `${url.origin}/api/spotify/callback`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const page = (text, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><body style="font:18px sans-serif;margin:3em">${text}</body>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

let access = null; // { token, expires }

async function tokenRequest(env, params) {
  const r = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams(params),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`spotify token: ${d.error_description || d.error || r.status}`);
  return d;
}

async function accessToken(env) {
  if (access && Date.now() < access.expires - 60e3) return access.token;
  const refresh = await env.STORE.get('spotify_refresh');
  if (!refresh) return null;
  const d = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
  if (d.refresh_token) await env.STORE.put('spotify_refresh', d.refresh_token);
  access = { token: d.access_token, expires: Date.now() + d.expires_in * 1000 };
  return access.token;
}

async function api(env, method, path) {
  const token = await accessToken(env);
  if (!token) return { status: 401 };
  const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  if (r.status === 401) access = null;
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, body };
}

export async function spotify(request, env, url) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return json({ configured: false });
  const path = url.pathname.replace(/^\/api\/spotify\/?/, '');

  if (path === 'login') {
    const state = crypto.randomUUID();
    await env.STORE.put(`spotify_state:${state}`, '1', { expirationTtl: 600 });
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env.SPOTIFY_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: redirectFor(url),
      state,
    });
    return Response.redirect(`${ACCOUNTS}/authorize?${q}`, 302);
  }

  if (path === 'callback') {
    const state = url.searchParams.get('state') || '';
    if (!(await env.STORE.get(`spotify_state:${state}`))) return page('Sign-in expired. Start again from /api/spotify/login.', 400);
    await env.STORE.delete(`spotify_state:${state}`);
    if (url.searchParams.get('error')) return page(`Spotify said: ${url.searchParams.get('error')}`, 400);
    const d = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code') || '',
      redirect_uri: redirectFor(url),
    });
    await env.STORE.put('spotify_refresh', d.refresh_token);
    access = { token: d.access_token, expires: Date.now() + d.expires_in * 1000 };
    return page('Spotify is connected. You can close this tab; the frame shows what is playing.');
  }

  // Remote control from the frame's buttons.
  const actions = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] };
  if (actions[path]) {
    if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
    const r = await api(env, ...actions[path]);
    const premium = r.status === 403 ? 'Playback control needs Spotify Premium' : undefined;
    return json({ ok: r.status < 300, status: r.status, error: premium }, r.status < 300 ? 200 : 502);
  }

  if (path !== '') return json({ error: 'not found' }, 404);

  // Now playing. 204 means nothing is active on any device.
  const r = await api(env, 'GET', '/me/player?additional_types=episode');
  if (r.status === 401) return json({ configured: true, connected: false });
  if (r.status === 204 || !r.body || !r.body.item) return json({ configured: true, connected: true, item: null });
  if (r.status >= 300) throw new Error(`spotify ${r.status}`);
  const p = r.body;
  const it = p.item;
  const images = (it.album && it.album.images) || (it.images) || [];
  const art = (images.find((i) => i.width && i.width <= 320) || images[0] || {}).url || '';
  return json({
    configured: true,
    connected: true,
    isPlaying: p.is_playing,
    progress: p.progress_ms,
    duration: it.duration_ms,
    device: p.device && p.device.name,
    item: {
      title: it.name,
      artist: it.artists ? it.artists.map((a) => a.name).join(', ') : (it.show && it.show.name) || '',
      album: it.album ? it.album.name : '',
      art: art ? `/api/art?u=${encodeURIComponent(art)}` : '',
      artLarge: images[0] ? `/api/art?u=${encodeURIComponent(images[0].url)}` : '',
    },
  });
}

// Album art comes from Spotify's image CDN; pass it through like the crests.
export async function art(url) {
  const u = url.searchParams.get('u') || '';
  if (!/^https:\/\/i\.scdn\.co\/image\/[0-9a-f]+$/.test(u)) return json({ error: 'bad art url' }, 400);
  const r = await fetch(u, { cf: { cacheTtl: 7 * 86400 } });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=604800' },
  });
}
