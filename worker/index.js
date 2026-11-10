// Wesley's Website: submissions API.
//
// Visitors submit memories, photos, lion-hearted acts, and time capsule
// letters from forms on the site. Each submission is stored privately in
// Cloudflare KV as "pending". Nothing is public until the family's review bot
// approves it and publishes it to the repository (assets/memories.json,
// assets/sunsets/, assets/photos/, assets/acts.json). Letters are the
// exception: an approved letter is sealed here in KV, never in the
// repository, and its words are only served from its opening day on.
//
// Public endpoints (used by the site's forms):
//   POST /api/memory          JSON {name, memory, website}
//   POST /api/sunset          multipart {photo, name?, place?, website}
//   POST /api/photo           multipart {photo (image or video), name?, website}
//   POST /api/act             JSON {name?, act, place?, website}   (a lion-hearted act)
//   POST /api/letter          JSON {from, to, openOn, title?, letter, website}
//   GET  /api/letters         sealed time capsule letters: who, for whom, and
//                             when they open; the text only once opened
//
// Review endpoints (require "Authorization: Bearer <BOT_KEY>"):
//   GET    /api/pending              list pending submissions, oldest first
//   GET    /api/pending/:id/photo    download a pending sunset photo
//   DELETE /api/pending/:id          remove a submission after review
//   POST   /api/letters/:id/seal     approve a pending letter: it moves into the
//                                    sealed store (never to GitHub) and the
//                                    pending copy is removed
//   DELETE /api/letters/:id          remove a sealed letter
//   GET    /api/letters/backup       every sealed letter in full, for a private
//                                    backup (never commit it to the repository)
//
// Every other request is served from the static site files.

const MAX_NAME = 80;
const MAX_MEMORY = 2000;
const MAX_PLACE = 100;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
// Cloudflare KV values max out at 25 MiB; leave headroom.
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
const SUBMISSIONS_PER_IP_PER_HOUR = 10;
const MAX_ACT = 600;
const MAX_LETTER = 8000;
const MAX_TITLE = 120;
const LETTER_RECIPIENTS = ['Vada', 'Riley', 'Jimmy', 'Vada, Riley, and Jimmy'];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
            try {
                return await handleApi(request, env, url);
            } catch (err) {
                console.error(err);
                return json({ error: 'Something went wrong. Please try again.' }, 500);
            }
        }
        return env.ASSETS.fetch(request);
    },
};

async function handleApi(request, env, url) {
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/memory' && method === 'POST') return submitMemory(request, env);
    if (path === '/api/sunset' && method === 'POST') return submitMedia(request, env, 'sunset');
    if (path === '/api/photo' && method === 'POST') return submitMedia(request, env, 'photo');
    if (path === '/api/act' && method === 'POST') return submitAct(request, env);
    if (path === '/api/letter' && method === 'POST') return submitLetter(request, env);
    if (path === '/api/letters' && method === 'GET') return listLetters(env);
    if (path === '/api/letters/backup' && method === 'GET') {
        if (!configuredKey(env)) {
            return json({ error: 'BOT_KEY is not set on this worker. Add it under Settings > Variables and Secrets as type Secret.' }, 503);
        }
        if (!(await isAuthorized(request, env))) return json({ error: 'Unauthorized: the key does not match.' }, 401);
        return backupLetters(env);
    }

    const letterMatch = path.match(/^\/api\/letters\/([\w-]+)(\/seal)?$/);
    if (letterMatch && ((letterMatch[2] && method === 'POST') || (!letterMatch[2] && method === 'DELETE'))) {
        if (!configuredKey(env)) {
            return json({ error: 'BOT_KEY is not set on this worker. Add it under Settings > Variables and Secrets as type Secret.' }, 503);
        }
        if (!(await isAuthorized(request, env))) return json({ error: 'Unauthorized: the key does not match.' }, 401);
        return letterMatch[2] ? sealLetter(env, letterMatch[1]) : deleteLetter(env, letterMatch[1]);
    }

    if (path === '/api/pending' || path.startsWith('/api/pending/')) {
        // Tell "no key configured" apart from "wrong key" so setup problems
        // are easy to diagnose. Neither response reveals anything about the key.
        if (!configuredKey(env)) {
            return json({ error: 'BOT_KEY is not set on this worker. Add it under Settings > Variables and Secrets as type Secret.' }, 503);
        }
        if (!(await isAuthorized(request, env))) return json({ error: 'Unauthorized: the key does not match.' }, 401);
        if (path === '/api/pending' && method === 'GET') return listPending(env);
        const photoMatch = path.match(/^\/api\/pending\/([\w-]+)\/photo$/);
        if (photoMatch && method === 'GET') return getPhoto(env, photoMatch[1]);
        const idMatch = path.match(/^\/api\/pending\/([\w-]+)$/);
        if (idMatch && method === 'DELETE') return deletePending(env, idMatch[1]);
    }

    return json({ error: 'Not found' }, 404);
}

// ---------- Public submissions ----------

async function submitMemory(request, env) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid request.' }, 400);
    }
    // Honeypot: real visitors never fill this hidden field. Pretend success.
    if (clean(body.website)) return json({ ok: true });

    const name = clean(body.name);
    const memory = clean(body.memory);
    if (!name || !memory) return json({ error: 'Please include your name and a memory.' }, 400);
    if (name.length > MAX_NAME || memory.length > MAX_MEMORY) {
        return json({ error: 'That message is too long.' }, 400);
    }
    if (!(await withinRateLimit(request, env))) {
        return json({ error: 'Too many submissions. Please try again later.' }, 429);
    }

    const id = newId();
    await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify({
        id, type: 'memory', name, memory, received: new Date().toISOString(),
    }));
    return json({ ok: true });
}

async function readJSON(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

async function submitAct(request, env) {
    const body = await readJSON(request);
    if (!body) return json({ error: 'Invalid request.' }, 400);
    if (clean(body.website)) return json({ ok: true });
    const act = clean(body.act);
    const name = clean(body.name).slice(0, MAX_NAME);
    const place = clean(body.place).slice(0, MAX_PLACE);
    if (!act) return json({ error: 'Please tell us what you did.' }, 400);
    if (act.length > MAX_ACT) return json({ error: 'That message is too long.' }, 400);
    if (!(await withinRateLimit(request, env))) {
        return json({ error: 'Too many submissions. Please try again later.' }, 429);
    }
    const id = newId();
    await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify({
        id, type: 'act', name, act, place, received: new Date().toISOString(),
    }));
    return json({ ok: true });
}

function todayISO() {
    // The family is on US Eastern time; letters open on that calendar day.
    return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function submitLetter(request, env) {
    const body = await readJSON(request);
    if (!body) return json({ error: 'Invalid request.' }, 400);
    if (clean(body.website)) return json({ ok: true });
    const from = clean(body.from).slice(0, MAX_NAME);
    const to = clean(body.to);
    const openOn = clean(body.openOn);
    const title = clean(body.title).slice(0, MAX_TITLE);
    const letter = clean(body.letter);
    if (!from || !letter) return json({ error: 'Please include your name and your letter.' }, 400);
    if (!LETTER_RECIPIENTS.includes(to)) return json({ error: 'Please choose who the letter is for.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openOn) || openOn <= todayISO() || openOn > '2075-12-31') {
        return json({ error: 'Please choose an opening date in the future.' }, 400);
    }
    if (letter.length > MAX_LETTER) return json({ error: 'That letter is too long.' }, 400);
    if (!(await withinRateLimit(request, env))) {
        return json({ error: 'Too many submissions. Please try again later.' }, 429);
    }
    const id = newId();
    await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify({
        id, type: 'letter', from, to, openOn, title, letter, received: new Date().toISOString(),
    }));
    return json({ ok: true });
}

// Sealed letters live only here, in private storage. The page learns who
// wrote each one, for whom, and when it opens; the words themselves are
// sent only on or after the opening day.
async function listLetters(env) {
    const today = todayISO();
    const letters = [];
    let cursor;
    do {
        const page = await env.SUBMISSIONS.list({ prefix: 'letter:', cursor });
        for (const key of page.keys) {
            const v = await env.SUBMISSIONS.get(key.name, 'json');
            if (!v) continue;
            const open = v.openOn <= today;
            letters.push({
                id: v.id, from: v.from, to: v.to, openOn: v.openOn, title: v.title || '',
                open, letter: open ? v.letter : undefined,
            });
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    letters.sort((a, b) => a.openOn.localeCompare(b.openOn));
    return new Response(JSON.stringify({ letters }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
}

async function backupLetters(env) {
    const letters = [];
    let cursor;
    do {
        const page = await env.SUBMISSIONS.list({ prefix: 'letter:', cursor });
        for (const key of page.keys) {
            const v = await env.SUBMISSIONS.get(key.name, 'json');
            if (v) letters.push(v);
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    letters.sort((a, b) => a.openOn.localeCompare(b.openOn));
    return json({ exported: new Date().toISOString(), letters });
}

async function sealLetter(env, id) {
    const pending = await env.SUBMISSIONS.get(`sub:${id}`, 'json');
    if (!pending || pending.type !== 'letter') return json({ error: 'No pending letter with that id.' }, 404);
    await env.SUBMISSIONS.put(`letter:${id}`, JSON.stringify({ ...pending, sealed: new Date().toISOString() }));
    await env.SUBMISSIONS.delete(`sub:${id}`);
    return json({ ok: true, openOn: pending.openOn });
}

async function deleteLetter(env, id) {
    await env.SUBMISSIONS.delete(`letter:${id}`);
    return json({ ok: true });
}

// Sunsets accept images only; photos of Wesley accept images or short videos.
async function submitMedia(request, env, kind) {
    let form;
    try {
        form = await request.formData();
    } catch {
        return json({ error: 'Invalid request. If this is a video, it may be too large.' }, 400);
    }
    if (clean(form.get('website'))) return json({ ok: true });

    const file = form.get('photo');
    if (!file || typeof file === 'string' || !file.size) {
        return json({ error: kind === 'photo' ? 'Please choose a photo or video.' : 'Please choose a photo.' }, 400);
    }
    const type = file.type || '';
    const isImage = type.startsWith('image/');
    const isVideo = type.startsWith('video/');
    if (kind === 'sunset' && !isImage) return json({ error: 'Please choose an image file.' }, 400);
    if (kind === 'photo' && !isImage && !isVideo) {
        return json({ error: 'Please choose a photo or video file.' }, 400);
    }
    if (isImage && file.size > MAX_PHOTO_BYTES) return json({ error: 'That photo is too large.' }, 400);
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
        return json({ error: 'That video is too large. Please choose one under 24 MB (about 20 seconds).' }, 400);
    }

    const name = clean(form.get('name')).slice(0, MAX_NAME);
    const place = kind === 'sunset' ? clean(form.get('place')).slice(0, MAX_PLACE) : undefined;
    if (!(await withinRateLimit(request, env))) {
        return json({ error: 'Too many submissions. Please try again later.' }, 429);
    }

    const id = newId();
    await env.SUBMISSIONS.put(`photo:${id}`, await file.arrayBuffer(), {
        metadata: { contentType: type },
    });
    const record = {
        id, type: kind, name, received: new Date().toISOString(),
        photo: {
            kind: isVideo ? 'video' : 'image',
            contentType: type,
            bytes: file.size,
            url: `/api/pending/${id}/photo`,
        },
    };
    if (kind === 'sunset') record.place = place;
    await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify(record));
    return json({ ok: true });
}

// ---------- Review (bot only) ----------

async function listPending(env) {
    const items = [];
    let cursor;
    do {
        const page = await env.SUBMISSIONS.list({ prefix: 'sub:', cursor });
        for (const key of page.keys) {
            const value = await env.SUBMISSIONS.get(key.name, 'json');
            if (value) items.push(value);
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    items.sort((a, b) => a.received.localeCompare(b.received));
    return json({ pending: items });
}

async function getPhoto(env, id) {
    const { value, metadata } = await env.SUBMISSIONS.getWithMetadata(`photo:${id}`, 'arrayBuffer');
    if (!value) return json({ error: 'Not found' }, 404);
    return new Response(value, {
        headers: {
            'Content-Type': (metadata && metadata.contentType) || 'application/octet-stream',
            'Cache-Control': 'no-store',
        },
    });
}

async function deletePending(env, id) {
    await env.SUBMISSIONS.delete(`sub:${id}`);
    await env.SUBMISSIONS.delete(`photo:${id}`);
    return json({ ok: true });
}

// ---------- Helpers ----------

function configuredKey(env) {
    return typeof env.BOT_KEY === 'string' ? env.BOT_KEY.trim() : '';
}

async function isAuthorized(request, env) {
    // Accept "Bearer <key>" with any capitalization and ignore stray
    // whitespace on either side (a common copy-paste difference).
    const header = (request.headers.get('Authorization') || '').trim();
    const match = header.match(/^bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : '';
    const key = configuredKey(env);
    if (!key || !token) return false;
    // Compare digests so the check takes the same time whatever the input.
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(token)),
        crypto.subtle.digest('SHA-256', enc.encode(key)),
    ]);
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

async function withinRateLimit(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hour = Math.floor(Date.now() / 3600000);
    const key = `rl:${ip}:${hour}`;
    const count = parseInt((await env.SUBMISSIONS.get(key)) || '0', 10);
    if (count >= SUBMISSIONS_PER_IP_PER_HOUR) return false;
    await env.SUBMISSIONS.put(key, String(count + 1), { expirationTtl: 3600 });
    return true;
}

function newId() {
    return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
