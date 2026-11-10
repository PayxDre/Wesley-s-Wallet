// Wesley's Website

const CONFIG = {
    // The family gift address (bitcoin) for Vada, Riley, and Jimmy.
    walletAddress: 'bc1qhrvv3xjwlluq7fzkp6evhg00j5e9mqhunlshuf',
    // Optional caption shown under the framed Featured photo.
    featuredCaption: '',
    birth: new Date('2025-04-20T00:00:00'),
    passing: new Date('2026-04-25T00:00:00'),
};

const $ = (sel) => document.querySelector(sel);

// The gift page shows only how many gifts have arrived, never amounts or
// value. (Incoming payments, including ones still confirming.)
async function loadGiftCount() {
    const el = document.getElementById('gift-count');
    if (!el || !CONFIG.walletAddress) return;
    try {
        const res = await fetch(`https://blockstream.info/api/address/${CONFIG.walletAddress}`);
        if (!res.ok) return;
        const d = await res.json();
        const n = d.chain_stats.funded_txo_count + d.mempool_stats.funded_txo_count;
        if (n > 0) {
            el.textContent = `${n.toLocaleString()} ${n === 1 ? 'gift' : 'gifts'} received so far, with love`;
            el.hidden = false;
        }
    } catch (e) {
        console.warn('gift count unavailable', e);
    }
}

const GALLERY_REPO = 'PayxDre/Wesley-s-Wallet';
const GALLERY_PATH = 'assets/photos';
// The branch Cloudflare deploys from goes first, so each visit normally
// needs a single GitHub API call (GitHub allows ~60/hour per network).
const GALLERY_BRANCHES = ['claude/memorial-bitcoin-wallet-8wg6q', 'main'];
let galleryBranch = GALLERY_BRANCHES[0];
const GALLERY_CACHE_KEY = 'wesley-photos-v7';
const GALLERY_CACHE_TTL = 10 * 60 * 1000;
const IMAGE_RX = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO_RX = /\.(mp4|webm|ogg)$/i;
const MEDIA_RX = /\.(jpe?g|png|webp|gif|mp4|webm|ogg)$/i;
const POSTER_RX = /-poster\.(jpe?g|png|webp)$/i;
const MAIN_RX = /^main\./i;
const FEATURED_RX = /^featured\./i;

async function getPhotoNames() {
    let names = readPhotoCache();
    if (!names) {
        names = await fetchPhotoList();
        if (names.length) writePhotoCache(names);
    }
    return names;
}

// The home page shows the Main.* photo at the top.
async function loadHeroPhoto() {
    if (!document.getElementById('hero-photo')) return;
    const names = await getPhotoNames();
    const mainName = names.find((n) => MAIN_RX.test(n) && IMAGE_RX.test(n));
    if (mainName) applyHeroPhoto(mainName);
}

// On pages without photos of him, Wesley's main photo rests softly at the
// side of the screen while people read, faded so it never competes with
// the words. Pages opt in with <body data-companion>.
async function addCompanionPhoto() {
    if (!document.body.hasAttribute('data-companion')) return;
    const names = await getPhotoNames();
    const mainName = names.find((n) => MAIN_RX.test(n) && IMAGE_RX.test(n));
    if (!mainName) return;
    const wrap = document.createElement('div');
    wrap.className = 'companion';
    wrap.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => wrap.classList.add('is-shown'));
    let triedLocal = false;
    img.addEventListener('error', () => {
        if (!triedLocal) { triedLocal = true; img.src = localPhotoURL(mainName); } else { wrap.remove(); }
    });
    img.src = thumbPhotoURL(mainName, 900);
    wrap.appendChild(img);
    document.body.prepend(wrap);
}

async function loadGallery() {
    const grid = document.getElementById('photo-grid');
    const empty = document.getElementById('gallery-empty');
    if (!grid) return;

    let names = await getPhotoNames();

    // Posters live alongside videos; never display them as standalone tiles.
    const allNames = names.slice();
    const posters = new Set(allNames.filter((n) => POSTER_RX.test(n)));
    names = allNames.filter((n) => !POSTER_RX.test(n));

    // Main.* is the home page's hero photo; keep it out of the photo wall.
    names = names.filter((n) => !MAIN_RX.test(n));

    const featuredName = names.find((n) => FEATURED_RX.test(n) && IMAGE_RX.test(n));
    if (featuredName) {
        applyFeaturedPhoto(featuredName);
        names = names.filter((n) => n !== featuredName);
    }

    if (!names.length) {
        if (empty) empty.hidden = false;
        return;
    }

    // A stable starting order, then each tile is placed next to photos that
    // look as different from it as possible (see placeGallery).
    names.sort((a, b) => stableHash(a) - stableHash(b));
    const items = names.map((name) => {
        const video = VIDEO_RX.test(name);
        return { name, video, poster: video ? findPosterFor(name, posters) : null };
    });

    const count = document.getElementById('photo-count');
    if (count) {
        const v = items.filter((it) => it.video).length;
        const p = items.length - v;
        const parts = [];
        if (p) parts.push(`${p} ${p === 1 ? 'photo' : 'photos'}`);
        if (v) parts.push(`${v} ${v === 1 ? 'video' : 'videos'}`);
        count.textContent = parts.join(' and ');
        count.hidden = false;
    }

    await addPhotoSignatures(items);
    items.forEach((it) => { it.figure = makePhotoTile(it); });

    let columns = 0;
    const layout = () => {
        const n = grid.clientWidth >= 640 ? 3 : 2;
        if (n === columns) return;
        columns = n;
        placeGallery(grid, items, n);
    };
    layout();
    let t;
    window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(layout, 150);
    });
}

// ----- Keeping look-alike photos apart -----
// Each photo gets a tiny color "fingerprint" (a 6x6 grid of average
// colors, from a 48px copy) plus its shape. Fingerprints are cached so
// return visits don't fetch them again.
const PHOTO_SIG_KEY = 'wesley-photo-sigs-v1';

function readSigCache() {
    try { return JSON.parse(localStorage.getItem(PHOTO_SIG_KEY)) || {}; } catch { return {}; }
}

function photoSignature(name) {
    return new Promise((resolve) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), 4000);
        im.onload = () => {
            clearTimeout(timer);
            const ratio = im.naturalHeight / im.naturalWidth;
            try {
                const c = document.createElement('canvas');
                c.width = 6;
                c.height = 6;
                const x = c.getContext('2d', { willReadFrequently: true });
                x.imageSmoothingQuality = 'high';
                x.drawImage(im, 0, 0, 6, 6);
                const d = x.getImageData(0, 0, 6, 6).data;
                const sig = [];
                for (let i = 0; i < d.length; i += 4) sig.push(d[i], d[i + 1], d[i + 2]);
                resolve({ ratio, sig });
            } catch {
                resolve({ ratio, sig: null });
            }
        };
        im.onerror = () => { clearTimeout(timer); resolve(null); };
        im.src = thumbPhotoURL(name, 48);
    });
}

async function addPhotoSignatures(items) {
    const cache = readSigCache();
    await Promise.all(items.map(async (it) => {
        const source = it.video ? it.poster : it.name;
        if (!source) return;
        let s = cache[source];
        if (!s) {
            s = await photoSignature(source);
            if (s && s.sig) cache[source] = s;
        }
        if (s) { it.ratio = s.ratio; it.sig = s.sig; }
    }));
    try { localStorage.setItem(PHOTO_SIG_KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}

// Photos from the same shoot have neighboring file numbers (DSC07302,
// DSC07320). Treat those as alike even when their colors differ.
function shootCloseness(a, b) {
    const ma = a.match(/^([a-z_-]*?)(\d{3,})/i);
    const mb = b.match(/^([a-z_-]*?)(\d{3,})/i);
    if (!ma || !mb || ma[1].toLowerCase() !== mb[1].toLowerCase()) return 0;
    const gap = Math.abs(parseInt(ma[2], 10) - parseInt(mb[2], 10));
    return Math.max(0, 1 - gap / 300);
}

function photoDistance(a, b) {
    let visual = 0.25; // unknown: assume moderately different
    if (a.sig && b.sig) {
        let s = 0;
        for (let i = 0; i < a.sig.length; i++) s += Math.abs(a.sig[i] - b.sig[i]);
        visual = s / a.sig.length / 255;
    }
    let d = visual * (1 - 0.75 * shootCloseness(a.name, b.name));
    if (a.video && b.video) d *= 0.6; // spread the videos out too
    return d;
}

const PHOTO_VARIANTS = 8;
const isCircleVariant = (v) => v === 3 || v === 7;

// Masonry by hand: each next tile goes into the shortest column, and the
// photo chosen for that spot is the one least like its neighbors (the
// tile above it and the tiles beside it in the next columns).
function placeGallery(grid, items, n) {
    grid.innerHTML = '';
    const cols = Array.from({ length: n }, () => {
        const col = document.createElement('div');
        col.className = 'photo-col';
        grid.appendChild(col);
        return { el: col, height: 0, tiles: [] };
    });
    const remaining = items.slice();
    const order = [];
    while (remaining.length) {
        let c = 0;
        cols.forEach((col, i) => { if (col.height < cols[c].height - 0.01) c = i; });
        const variant = (order.length % PHOTO_VARIANTS) + 1;
        const top = cols[c].height;
        let best = 0;
        let bestScore = -1;
        remaining.forEach((it, k) => {
            const h = isCircleVariant(variant) ? 1 : (it.ratio || 1.25);
            // Everything within about a screen's reach counts, the closest
            // tiles most: the one right above, then side by side, then
            // further across or further up.
            let score = 1;
            cols.forEach((col, ci) => {
                col.tiles.forEach((t) => {
                    const gapY = Math.max(0, top - t.bottom, t.top - (top + h));
                    if (gapY > 1.2) return;
                    const across = Math.abs(ci - c);
                    const reach = 1 + 0.45 * Math.max(0, across - 1) + 0.6 * gapY + (across ? 0.1 : 0);
                    score = Math.min(score, photoDistance(it, t.item) * reach);
                });
            });
            if (score > bestScore + 1e-9) { bestScore = score; best = k; }
        });
        const it = remaining.splice(best, 1)[0];
        const h = isCircleVariant(variant) ? 1 : (it.ratio || 1.25);
        cols[c].tiles.push({ item: it, top, bottom: top + h });
        cols[c].height = top + h + 0.08;
        it.figure.className = `photo v${variant}${it.video ? ' photo--video' : ''}`;
        it.index = order.length;
        order.push(it);
        cols[c].el.appendChild(it.figure);
    }
    galleryOrder = order;
}

let galleryOrder = [];

function makePhotoTile(it) {
    const figure = document.createElement('figure');
    figure.tabIndex = 0;
    figure.setAttribute('role', 'button');
    let element;
    if (it.video) {
        element = document.createElement('video');
        element.src = localPhotoURL(it.name);
        element.autoplay = true;
        element.loop = true;
        element.muted = true;
        element.defaultMuted = true;
        element.playsInline = true;
        element.setAttribute('muted', '');
        element.setAttribute('playsinline', '');
        element.preload = 'metadata';
        if (it.poster) element.poster = localPhotoURL(it.poster);
        element.addEventListener('error', () => figure.classList.add('is-missing'));
        figure.setAttribute('aria-label', 'Play this video of Wesley');
    } else {
        element = document.createElement('img');
        element.alt = 'Wesley';
        element.loading = 'lazy';
        setImageWithFallback(element, it.name, 700, figure);
        figure.setAttribute('aria-label', 'View this photo of Wesley');
    }
    const open = () => openPhotoViewer(it.index);
    figure.addEventListener('click', open);
    figure.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    figure.appendChild(element);
    if (it.video) {
        const badge = document.createElement('span');
        badge.className = 'photo-play';
        badge.setAttribute('aria-hidden', 'true');
        badge.innerHTML = '&#9654;';
        figure.appendChild(badge);
    }
    return figure;
}

function localPhotoURL(name, dir = GALLERY_PATH) {
    return `${dir}/${encodeURIComponent(name)}`;
}

// Originals straight off the phone run 2-4 MB each; with a wall of them the
// page costs tens of megabytes. Serve gallery thumbnails through the free
// wsrv.nl resizing proxy (reading from raw.githubusercontent.com), and fall
// back to the local original if the proxy is ever unreachable.
function thumbPhotoURL(name, width, dir = GALLERY_PATH) {
    const raw = `https://raw.githubusercontent.com/${GALLERY_REPO}/${galleryBranch}/${dir}/${name}`;
    return `https://wsrv.nl/?url=${encodeURIComponent(raw)}&w=${width}&q=78&output=jpg`;
}

function setImageWithFallback(img, name, width, figure, dir = GALLERY_PATH) {
    let triedLocal = false;
    img.addEventListener('error', () => {
        if (!triedLocal) {
            triedLocal = true;
            img.src = localPhotoURL(name, dir);
        } else if (figure) {
            figure.classList.add('is-missing');
        }
    });
    img.src = thumbPhotoURL(name, width, dir);
}

function stableHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function findPosterFor(videoName, posters) {
    const base = videoName.replace(VIDEO_RX, '');
    for (const p of posters) {
        if (p.toLowerCase().startsWith(base.toLowerCase() + '-poster.')) return p;
    }
    return null;
}

function applySpotlightPhoto(containerId, imgId, name, width) {
    const container = document.getElementById(containerId);
    const img = document.getElementById(imgId);
    if (!container || !img) return;
    let triedLocal = false;
    img.addEventListener('load', () => { container.hidden = false; });
    img.addEventListener('error', () => {
        if (!triedLocal) {
            triedLocal = true;
            img.src = localPhotoURL(name);
        } else {
            container.hidden = true;
        }
    });
    img.src = thumbPhotoURL(name, width);
}

function applyHeroPhoto(name) {
    applySpotlightPhoto('hero-photo', 'hero-photo-img', name, 640);
}

function applyFeaturedPhoto(name) {
    applySpotlightPhoto('featured-photo', 'featured-photo-img', name, 1400);
    const featuredImg = document.getElementById('featured-photo-img');
    if (featuredImg) featuredImg.addEventListener('click', () => openLightbox(localPhotoURL(name)));
    const caption = document.getElementById('featured-caption');
    if (caption && CONFIG.featuredCaption) {
        caption.textContent = CONFIG.featuredCaption;
        caption.hidden = false;
    }
}

function setupShareButton() {
    const btn = document.getElementById('share-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const url = window.location.origin + window.location.pathname;
        const shareData = {
            title: "Wesley's Website",
            text: 'A place to remember Wesley.',
            url,
        };
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            const original = btn.textContent;
            btn.textContent = 'Link copied';
            setTimeout(() => { btn.textContent = original; }, 2200);
        } catch (e) {
            console.warn('share failed', e);
        }
    });
}

async function fetchPhotoList() {
    for (const branch of GALLERY_BRANCHES) {
        try {
            const url = `https://api.github.com/repos/${GALLERY_REPO}/contents/${GALLERY_PATH}?ref=${encodeURIComponent(branch)}`;
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            if (!Array.isArray(data)) continue;
            const names = data
                .filter((f) => f.type === 'file' && MEDIA_RX.test(f.name))
                .map((f) => f.name);
            if (names.length) {
                galleryBranch = branch;
                return names;
            }
        } catch (e) {
            console.warn('photo list fetch failed for', branch, e);
        }
    }
    return [];
}

function readPhotoCache() {
    try {
        const raw = localStorage.getItem(GALLERY_CACHE_KEY);
        if (!raw) return null;
        const { t, names, branch } = JSON.parse(raw);
        if (Date.now() - t > GALLERY_CACHE_TTL) return null;
        if (branch) galleryBranch = branch;
        return Array.isArray(names) ? names : null;
    } catch {
        return null;
    }
}

function writePhotoCache(names) {
    try {
        localStorage.setItem(
            GALLERY_CACHE_KEY,
            JSON.stringify({ t: Date.now(), names, branch: galleryBranch })
        );
    } catch {}
}

function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CANDLE_KEY = 'wesley-candle-lit';
const CANDLE_COUNTER_BASE = 'https://abacus.jasoncameron.dev';
const CANDLE_COUNTER_NS = 'wesleyswallet';
const CANDLE_COUNTER_KEY = 'candles';

async function fetchCandleCount(key = CANDLE_COUNTER_KEY) {
    try {
        const res = await fetch(
            `${CANDLE_COUNTER_BASE}/get/${CANDLE_COUNTER_NS}/${key}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
    } catch (e) {
        console.warn('candle count fetch failed', e);
        return null;
    }
}

async function incrementCandleCount(key = CANDLE_COUNTER_KEY) {
    try {
        const res = await fetch(
            `${CANDLE_COUNTER_BASE}/hit/${CANDLE_COUNTER_NS}/${key}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
    } catch (e) {
        console.warn('candle count increment failed', e);
        return null;
    }
}

function displayCandleCount(n) {
    if (n == null) return;
    const wrap = document.getElementById('candle-count');
    const num = document.getElementById('candle-count-number');
    const noun = document.getElementById('candle-count-noun');
    if (!wrap || !num || !noun) return;
    num.textContent = n.toLocaleString();
    noun.textContent = n === 1 ? 'candle lit in his memory' : 'candles lit in his memory';
    wrap.hidden = false;
}

// ---------- His days: April 20 (birthday) and April 25 (remembrance) ----------
function ordinal(n) {
    const v = n % 100;
    const suffix = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${suffix}`;
}

// Returns 'birthday', 'remembrance', or null for today (?day= overrides,
// for previewing).
function wesleyDay(now = new Date()) {
    const forced = new URLSearchParams(location.search).get('day');
    if (forced === 'birthday' || forced === 'remembrance') return forced;
    if (now.getMonth() === 3 && now.getDate() === 20) return 'birthday';
    if (now.getMonth() === 3 && now.getDate() === 25) return 'remembrance';
    return null;
}

function todayKey(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function setupWesleyDay() {
    const day = wesleyDay();
    if (!day) return;
    document.body.classList.add(`is-${day}`);
    const banner = document.getElementById('day-banner');
    if (!banner) return;
    const year = new Date().getFullYear();
    if (day === 'birthday') {
        const n = Math.max(1, year - CONFIG.birth.getFullYear());
        banner.innerHTML = `<strong>Happy ${ordinal(n)} birthday, Wesley.</strong> <span>Light a candle for him today &darr;</span>`;
    } else {
        const n = Math.max(1, year - CONFIG.passing.getFullYear());
        banner.innerHTML = `<strong>Today we remember Wesley, ${n === 1 ? 'one year' : `${n} years`} on.</strong> <span>Light a candle for him &darr;</span>`;
    }
    banner.hidden = false;
}

function setupCandle() {
    const btn = document.getElementById('candle-btn');
    const status = document.getElementById('candle-status');
    if (!btn || !status) return;

    // Load global count without incrementing.
    fetchCandleCount().then(displayCandleCount);

    // On his birthday and remembrance day everyone can light a fresh candle,
    // and the page shows how many were lit that day.
    const day = wesleyDay();
    const dayKey = day ? `candles-${todayKey()}` : null;
    const litKey = day ? `${CANDLE_KEY}-${todayKey()}` : CANDLE_KEY;
    const todayEl = document.getElementById('candle-today');
    const showToday = (n) => {
        if (!todayEl || n == null) return;
        todayEl.textContent = `${n.toLocaleString()} ${n === 1 ? 'candle' : 'candles'} lit for him today`;
        todayEl.hidden = false;
    };
    if (dayKey) fetchCandleCount(dayKey).then(showToday);

    let alreadyLit = false;
    try { alreadyLit = !!localStorage.getItem(litKey); } catch { /* private mode */ }
    if (alreadyLit) {
        btn.classList.add('lit');
        status.classList.add('is-lit');
        status.textContent = 'Your candle is lit for Wesley.';
    }

    btn.addEventListener('click', async () => {
        if (btn.classList.contains('lit')) return;
        btn.classList.add('lit');
        status.classList.add('is-lit');
        status.textContent = 'Your candle is lit for Wesley.';
        try { localStorage.setItem(litKey, new Date().toISOString()); } catch {}
        const [newCount, dayCount] = await Promise.all([
            incrementCandleCount(),
            dayKey ? incrementCandleCount(dayKey) : null,
        ]);
        if (newCount != null) displayCandleCount(newCount);
        showToday(dayCount);
    });
}

async function loadMemories() {
    const container = document.getElementById('memory-list');
    if (!container) return;

    let memories = [];
    try {
        const res = await fetch('assets/memories.json', { cache: 'no-cache' });
        if (res.ok) memories = await res.json();
    } catch (e) {
        console.warn('memories fetch failed', e);
    }

    if (!Array.isArray(memories) || memories.length === 0) {
        container.innerHTML = '';
        return;
    }

    memories.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    container.innerHTML = '';
    memories.forEach((m) => {
        const card = document.createElement('article');
        card.className = 'memory-card';
        const dateStr = m.date
            ? new Date(m.date).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
              })
            : '';
        const bodyHTML = escapeHTML(m.memory || '').replace(/\n/g, '<br />');
        card.innerHTML = `
            <p class="memory-author">${escapeHTML(m.name || '')}</p>
            <p class="memory-body">${bodyHTML}</p>
            ${dateStr ? `<p class="memory-date">${dateStr}</p>` : ''}
        `;
        container.appendChild(card);
    });
}

// Memory Wall submissions go to the site's own /api/memory endpoint
// (worker/index.js), which stores them privately as pending. The family's
// review bot approves them and publishes to assets/memories.json.
function setupMemoryForm() {
    const form = document.getElementById('memory-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            name: form.elements.name.value,
            memory: form.elements.memory.value,
            website: form.elements.website ? form.elements.website.value : '',
        };
        await submitToSite(form, '/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }, 'Thank you. Your memory has been received and will appear here after a brief review.');
    });
}

// Shared submit flow: disable the button, send, then swap the form for a
// thank-you message or show the error under the form.
async function submitToSite(form, url, options, successText) {
    const button = form.querySelector('button[type="submit"]');
    const note = form.querySelector('.form-note');
    const originalText = button.textContent;
    const originalNote = note ? note.textContent : '';
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Sorry, that could not be sent. Please try again in a moment.');
        const done = document.createElement('p');
        done.className = 'form-success';
        done.textContent = successText;
        form.replaceWith(done);
        // The message is much shorter than the form it replaces, so bring
        // it into view; otherwise it can end up off-screen or under the menu.
        done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
        button.disabled = false;
        button.textContent = originalText;
        if (note) {
            note.textContent = err.message && !/fetch|network/i.test(err.message)
                ? err.message
                : 'Sorry, that could not be sent. Please check your connection and try again.';
            note.classList.add('form-error');
            setTimeout(() => {
                note.textContent = originalNote;
                note.classList.remove('form-error');
            }, 8000);
        }
    }
}

// ---------- Small shared helpers ----------
async function fetchJSONList(url) {
    try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function fmtLongDate(iso) {
    const d = parseLocalDate(iso);
    return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
}

// A JSON form that posts to the site's own API (see worker/index.js).
function setupJSONForm(formId, url, fields, successText) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = { website: form.elements.website ? form.elements.website.value : '' };
        fields.forEach((f) => { payload[f] = form.elements[f] ? form.elements[f].value : ''; });
        await submitToSite(form, url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }, successText);
    });
}

// ---------- Lion-hearted acts ----------
async function loadActs() {
    const list = document.getElementById('acts-list');
    if (!list) return;
    const acts = await fetchJSONList('assets/acts.json');
    if (!acts.length) return;
    acts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const count = document.getElementById('acts-count');
    if (count) {
        count.textContent = `${acts.length.toLocaleString()} lion-hearted ${acts.length === 1 ? 'act' : 'acts'} and counting`;
        count.hidden = false;
    }
    const empty = document.getElementById('acts-empty');
    if (empty) empty.hidden = true;
    list.innerHTML = '';
    acts.forEach((a) => {
        const card = document.createElement('article');
        card.className = 'act-card';
        const meta = [a.name, a.place, fmtLongDate(a.date)].filter(Boolean).map(escapeHTML).join(' &middot; ');
        card.innerHTML = `
            <p class="act-body">${escapeHTML(a.act || '').replace(/\n/g, '<br />')}</p>
            ${meta ? `<p class="act-meta">${meta}</p>` : ''}`;
        list.appendChild(card);
    });
}

// ---------- Events ----------
// assets/events.json: [{"date": "2027-04-20", "title": "...", "time": "...",
// "place": "...", "details": "...", "link": "https://..."}]. Past events hide
// themselves; the section stays hidden when nothing is coming up.
async function loadEvents() {
    const section = document.getElementById('events');
    const list = document.getElementById('events-list');
    if (!section || !list) return;
    const today = todayKey();
    const events = (await fetchJSONList('assets/events.json'))
        .filter((e) => e.date && e.title && e.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (!events.length) return;
    list.innerHTML = '';
    events.forEach((e) => {
        const d = parseLocalDate(e.date);
        const card = document.createElement('article');
        card.className = 'event-card';
        const link = /^https:\/\//.test(e.link || '') ? `<a class="event-link" href="${escapeHTML(e.link)}" target="_blank" rel="noopener">Details &rarr;</a>` : '';
        card.innerHTML = `
            <div class="event-date" aria-hidden="true">
                <span>${d.toLocaleDateString('en-US', { month: 'short' })}</span>
                <strong>${d.getDate()}</strong>
            </div>
            <div class="event-info">
                <h4>${escapeHTML(e.title)}</h4>
                <p class="event-meta">${[fmtLongDate(e.date), e.time, e.place].filter(Boolean).map(escapeHTML).join(' &middot; ')}</p>
                ${e.details ? `<p>${escapeHTML(e.details)}</p>` : ''}
                ${link}
            </div>`;
        list.appendChild(card);
    });
    section.hidden = false;
}

// ---------- Map of Wesley in the Wild ----------
function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'assets/vendor/leaflet-1.9.4/leaflet.css';
        document.head.appendChild(css);
        const js = document.createElement('script');
        js.src = 'assets/vendor/leaflet-1.9.4/leaflet.js';
        js.onload = resolve;
        js.onerror = reject;
        document.head.appendChild(js);
    });
}

function setupWildMap(items) {
    const el = document.getElementById('sr-map');
    if (!el) return () => {};
    let map = null;
    return async () => {
        if (map) { map.invalidateSize(); return; }
        const placed = items.filter((it) => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lon)));
        const note = document.getElementById('sr-map-note');
        try {
            await loadLeaflet();
        } catch {
            if (note) note.textContent = 'The map could not load right now.';
            return;
        }
        map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true });
        // OpenStreetMap's own tiles: free, no key, attribution required.
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        const points = [];
        placed.forEach((it) => {
            const ll = [Number(it.lat), Number(it.lon)];
            points.push(ll);
            const pop = document.createElement('div');
            pop.className = 'sr-map-pop';
            const img = document.createElement('img');
            img.alt = it.place || 'A moment shared for Wesley';
            setImageWithFallback(img, it.file, 320, null, SUNSET_PATH);
            const cap = document.createElement('p');
            cap.innerHTML = `<strong>${escapeHTML(it.place || 'Wesley in the wild')}</strong><br />${[it.name, fmtShortDate(it.date)].filter(Boolean).map(escapeHTML).join(' &middot; ')}`;
            pop.append(img, cap);
            L.circleMarker(ll, { radius: 9, color: '#fffaf2', weight: 2, fillColor: '#d9932f', fillOpacity: 0.95 })
                .addTo(map).bindPopup(pop, { maxWidth: 240 });
        });
        if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 9 });
        else if (points.length === 1) map.setView(points[0], 8);
        else map.setView([30, -40], 2);
        if (note) {
            const n = placed.length;
            note.textContent = n
                ? `${n} ${n === 1 ? 'moment' : 'moments'} on the map. Tap a dot to see it.`
                : 'Places will appear here as moments are shared.';
        }
    };
}

// ---------- Keepsake book ----------
async function setupKeepsake() {
    const book = document.getElementById('keepsake-book');
    const yearSel = document.getElementById('keepsake-year');
    if (!book || !yearSel) return;
    document.getElementById('keepsake-print').addEventListener('click', () => window.print());

    const [memories, acts, wild, names] = await Promise.all([
        fetchJSONList('assets/memories.json'),
        fetchJSONList('assets/acts.json'),
        loadSunriseItems().catch(() => []),
        getPhotoNames().catch(() => []),
    ]);
    const photos = names.filter((n) => IMAGE_RX.test(n) && !POSTER_RX.test(n));

    const thisYear = new Date().getFullYear();
    const years = [];
    for (let y = thisYear; y >= 2025; y--) years.push(y);
    yearSel.innerHTML = `<option value="all">Everything so far</option>${years.map((y) => `<option value="${y}">${y}</option>`).join('')}`;

    const inYear = (iso, y) => y === 'all' || (iso || '').slice(0, 4) === String(y);
    const render = () => {
        const y = yearSel.value;
        const mem = memories.filter((m) => inYear(m.date, y));
        const act = acts.filter((a) => inYear(a.date, y));
        const wl = wild.filter((w) => inYear(w.date, y));
        const label = y === 'all' ? 'Everything shared so far' : `The year ${y}`;
        const section = (title, inner) => inner ? `<section class="kb-section"><h3>${title}</h3>${inner}</section>` : '';
        book.innerHTML = `
            <section class="kb-cover">
                <img src="assets/lion-plush.png" alt="" width="170" />
                <p class="kb-eyebrow">In loving memory of</p>
                <h2>Wesley Robert Prisuta</h2>
                <p class="kb-dates">April 20, 2025 &middot; April 25, 2026</p>
                <p class="kb-label">${escapeHTML(label)}</p>
            </section>
            ${section('Photos', photos.length ? `<div class="kb-photos">${photos.map((n) =>
                `<img src="${thumbPhotoURL(n, 600)}" data-local="${localPhotoURL(n)}" alt="Wesley" loading="eager" />`).join('')}</div>` : '')}
            ${section('Memories', mem.map((m) => `<blockquote class="kb-quote"><p>${escapeHTML(m.memory || '').replace(/\n/g, '<br />')}</p><cite>${escapeHTML(m.name || '')}${m.date ? `, ${fmtLongDate(m.date)}` : ''}</cite></blockquote>`).join(''))}
            ${section('Wesley in the Wild', wl.length ? `<div class="kb-wild">${wl.map((w) =>
                `<figure><img src="${thumbPhotoURL(w.file, 600, SUNSET_PATH)}" data-local="${localPhotoURL(w.file, SUNSET_PATH)}" alt="" loading="eager" /><figcaption>${escapeHTML(w.place || '')}${w.name ? ` &middot; ${escapeHTML(w.name)}` : ''}${w.date ? ` &middot; ${fmtShortDate(w.date)}` : ''}</figcaption></figure>`).join('')}</div>` : '')}
            ${section('Lion-Hearted Acts', act.map((a) => `<blockquote class="kb-quote"><p>${escapeHTML(a.act || '')}</p><cite>${[a.name, a.place, fmtLongDate(a.date)].filter(Boolean).map(escapeHTML).join(', ')}</cite></blockquote>`).join(''))}
            <p class="kb-end">For Wesley. Always loved, always remembered.</p>`;
        book.querySelectorAll('img[data-local]').forEach((img) => {
            img.addEventListener('error', () => {
                if (img.src.indexOf(img.dataset.local) === -1) img.src = img.dataset.local;
            }, { once: true });
        });
    };
    yearSel.addEventListener('change', render);
    render();
}

// ---------- Photo viewer (lightbox with arrows, swipe, and videos) ----------
let viewerIndex = 0;

function viewerParts() {
    const box = document.getElementById('lightbox');
    if (!box) return null;
    if (!box.querySelector('.lb-arrow')) {
        box.insertAdjacentHTML('beforeend', `
            <button type="button" class="lb-arrow lb-prev" aria-label="Previous photo">&#8249;</button>
            <button type="button" class="lb-arrow lb-next" aria-label="Next photo">&#8250;</button>
            <video class="lb-video" controls playsinline hidden></video>
            <p class="lb-count" aria-live="polite"></p>`);
        box.querySelector('.lb-prev').addEventListener('click', (e) => { e.stopPropagation(); showPhoto(viewerIndex - 1); });
        box.querySelector('.lb-next').addEventListener('click', (e) => { e.stopPropagation(); showPhoto(viewerIndex + 1); });
        box.querySelector('.lb-video').addEventListener('click', (e) => e.stopPropagation());
        let sx = null;
        let sy = null;
        box.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
        box.addEventListener('touchend', (e) => {
            if (sx === null) return;
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;
            sx = null;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) showPhoto(viewerIndex + (dx < 0 ? 1 : -1));
        });
        box.querySelector('img').addEventListener('click', (e) => {
            // Tapping the photo itself moves on; tapping the dark area closes.
            if (galleryOrder.length > 1) { e.stopPropagation(); showPhoto(viewerIndex + 1); }
        });
    }
    return {
        box,
        img: box.querySelector('img'),
        video: box.querySelector('.lb-video'),
        count: box.querySelector('.lb-count'),
        arrows: box.querySelectorAll('.lb-arrow'),
    };
}

function showPhoto(i) {
    const v = viewerParts();
    if (!v || !galleryOrder.length) return;
    const n = galleryOrder.length;
    viewerIndex = ((i % n) + n) % n;
    const it = galleryOrder[viewerIndex];
    v.video.pause();
    if (it.video) {
        v.img.hidden = true;
        v.img.removeAttribute('src');
        v.video.hidden = false;
        v.video.poster = it.poster ? localPhotoURL(it.poster) : '';
        v.video.src = localPhotoURL(it.name);
        v.video.play().catch(() => {});
    } else {
        v.video.hidden = true;
        v.video.removeAttribute('src');
        v.video.load();
        v.img.hidden = false;
        let triedLocal = false;
        v.img.onerror = () => {
            if (!triedLocal) { triedLocal = true; v.img.src = localPhotoURL(it.name); }
        };
        v.img.src = thumbPhotoURL(it.name, 1600);
    }
    v.count.textContent = `${viewerIndex + 1} of ${n}`;
    v.arrows.forEach((a) => { a.hidden = n < 2; });
    // Warm up the neighbors so arrows feel instant.
    [viewerIndex + 1, viewerIndex - 1].forEach((j) => {
        const nb = galleryOrder[((j % n) + n) % n];
        if (nb && !nb.video) new Image().src = thumbPhotoURL(nb.name, 1600);
    });
}

function openPhotoViewer(i) {
    const v = viewerParts();
    if (!v) return;
    showPhoto(i);
    v.box.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('lightbox-close')?.focus();
}

// Single image (no arrows), e.g. the featured photo.
function openLightbox(src) {
    const v = viewerParts();
    if (!v) return;
    v.video.pause();
    v.video.hidden = true;
    v.img.hidden = false;
    v.img.onerror = null;
    v.img.src = src;
    v.count.textContent = '';
    v.arrows.forEach((a) => { a.hidden = true; });
    v.box.dataset.single = '1';
    v.box.hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const box = document.getElementById('lightbox');
    if (!box) return;
    box.hidden = true;
    delete box.dataset.single;
    const img = document.getElementById('lightbox-img');
    if (img) img.removeAttribute('src');
    const video = box.querySelector('.lb-video');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    document.body.style.overflow = '';
}

function setupLightbox() {
    const box = document.getElementById('lightbox');
    if (!box) return;
    box.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => {
        if (box.hidden) return;
        if (e.key === 'Escape') closeLightbox();
        if (box.dataset.single) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); showPhoto(viewerIndex + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); showPhoto(viewerIndex - 1); }
    });
}

function setupReveals() {
    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    const targets = document.querySelectorAll('main .section, .footer');
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        },
        { rootMargin: '0px 0px -8% 0px' }
    );
    targets.forEach((el) => {
        el.classList.add('will-reveal');
        observer.observe(el);
    });
}

// ---------- Sunsets for Wesley ----------
// Photos live in assets/sunsets/ (added after review, like the gallery).
// The list is read from GitHub the same way the gallery is.
const SUNSET_PATH = 'assets/sunsets';
const SUNSET_CACHE_KEY = 'wesley-sunsets-v1';

async function fetchSunsetList() {
    try {
        const raw = localStorage.getItem(SUNSET_CACHE_KEY);
        if (raw) {
            const { t, names } = JSON.parse(raw);
            if (Date.now() - t < GALLERY_CACHE_TTL && Array.isArray(names)) return names;
        }
    } catch {}
    for (const branch of GALLERY_BRANCHES) {
        try {
            const res = await fetch(
                `https://api.github.com/repos/${GALLERY_REPO}/contents/${SUNSET_PATH}?ref=${encodeURIComponent(branch)}`
            );
            if (!res.ok) continue;
            const data = await res.json();
            if (!Array.isArray(data)) continue;
            const names = data
                .filter((f) => f.type === 'file' && IMAGE_RX.test(f.name))
                .map((f) => f.name);
            if (names.length) {
                try {
                    localStorage.setItem(SUNSET_CACHE_KEY, JSON.stringify({ t: Date.now(), names }));
                } catch {}
                return names;
            }
        } catch (e) {
            console.warn('sunset list fetch failed for', branch, e);
        }
    }
    return [];
}

// ---------- Sunrise list ----------
// assets/sunsets.json holds each published sunrise's date, place, and the
// sharer's name (the review bot adds an entry when it publishes). Photos in
// the folder without an entry still show, with date and place read from the
// file name.
const SUNRISE_MANIFEST = 'assets/sunsets.json';

function parseLocalDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function fmtShortDate(iso, withYear = true) {
    const d = parseLocalDate(iso);
    if (!d) return '';
    return d.toLocaleDateString('en-US', withYear
        ? { month: 'short', day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric' });
}

function placeFromFileName(file) {
    const slug = file.replace(/\.[^.]+$/, '').replace(/^\d{4}-\d{2}-\d{2}-?/, '')
        .replace(/-\d+$/, '').replace(/^(sunset|sunrise)$/i, '');
    return slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

async function loadSunriseItems() {
    let manifest = [];
    try {
        const res = await fetch(SUNRISE_MANIFEST, { cache: 'no-cache' });
        if (res.ok) manifest = await res.json();
    } catch (e) {
        console.warn('sunrise list fetch failed', e);
    }
    const byFile = new Map();
    (Array.isArray(manifest) ? manifest : []).forEach((m) => {
        if (!m || typeof m.file !== 'string' || !IMAGE_RX.test(m.file)) return;
        byFile.set(m.file, {
            file: m.file,
            date: m.date || (m.file.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
            place: m.place || placeFromFileName(m.file),
            name: m.name || '',
            lat: m.lat,
            lon: m.lon,
        });
    });
    (await fetchSunsetList()).forEach((file) => {
        if (!byFile.has(file)) {
            byFile.set(file, {
                file,
                date: (file.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
                place: placeFromFileName(file),
                name: '',
            });
        }
    });
    return [...byFile.values()].sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') || b.file.localeCompare(a.file));
}

function sunriseThumb(item, width) {
    return thumbPhotoURL(item.file, width, SUNSET_PATH);
}

function sunriseLocal(item) {
    return localPhotoURL(item.file, SUNSET_PATH);
}

// ---------- Sunrise viewer (full-screen and "one at a time") ----------
function createSunriseViewer(root, items) {
    root.innerHTML = `
        <div class="sr-stage">
            <button type="button" class="sr-arrow sr-prev" aria-label="Previous photo">&#8249;</button>
            <img class="sr-img" alt="" />
            <button type="button" class="sr-arrow sr-next" aria-label="Next photo">&#8250;</button>
        </div>
        <div class="sr-caption" aria-live="polite">
            <span class="sr-place"></span>
            <span class="sr-meta"></span>
            <span class="sr-count"></span>
        </div>`;
    const img = root.querySelector('.sr-img');
    const placeEl = root.querySelector('.sr-place');
    const metaEl = root.querySelector('.sr-meta');
    const countEl = root.querySelector('.sr-count');
    const prevBtn = root.querySelector('.sr-prev');
    const nextBtn = root.querySelector('.sr-next');
    let index = 0;

    img.addEventListener('error', () => {
        const item = items[index];
        if (item && !img.dataset.fallback) {
            img.dataset.fallback = '1';
            img.src = sunriseLocal(item);
        }
    });

    function show(i) {
        if (!items.length) return;
        index = (i + items.length) % items.length;
        const item = items[index];
        img.dataset.fallback = '';
        img.src = sunriseThumb(item, 1600);
        img.alt = item.place ? `A moment shared from ${item.place}` : 'A moment shared for Wesley';
        placeEl.textContent = item.place || 'Wesley in the wild';
        metaEl.textContent = [item.name && `Shared by ${item.name}`, fmtShortDate(item.date)]
            .filter(Boolean).join(' · ');
        countEl.textContent = items.length > 1 ? `${index + 1} of ${items.length}` : '';
        const multi = items.length > 1;
        prevBtn.hidden = !multi;
        nextBtn.hidden = !multi;
        // Warm the neighbors so arrows feel instant.
        if (multi) {
            [index - 1, index + 1].forEach((j) => {
                const n = items[(j + items.length) % items.length];
                new Image().src = sunriseThumb(n, 1600);
            });
        }
    }

    prevBtn.addEventListener('click', () => show(index - 1));
    nextBtn.addEventListener('click', () => show(index + 1));

    // Swipe left/right on touch screens.
    const stage = root.querySelector('.sr-stage');
    let startX = null;
    let startY = null;
    stage.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
        startX = null;
    });

    return {
        show,
        next: () => show(index + 1),
        prev: () => show(index - 1),
    };
}

// ---------- Sunrises page ----------
async function loadSunsets() {
    const grid = document.getElementById('sunset-grid');
    const empty = document.getElementById('sunset-empty');
    const count = document.getElementById('sunset-count');
    if (!grid) return;

    const items = await loadSunriseItems();
    if (!items.length) return;

    // Collage
    grid.innerHTML = '';
    items.forEach((item, i) => {
        const figure = document.createElement('figure');
        figure.className = 'sunset';
        const img = document.createElement('img');
        img.alt = item.place ? `A moment shared from ${item.place}` : 'A moment shared for Wesley';
        img.loading = 'lazy';
        setImageWithFallback(img, item.file, 600, figure, SUNSET_PATH);
        const cap = document.createElement('figcaption');
        cap.className = 'sunset-cap';
        const place = document.createElement('span');
        place.className = 'cap-place';
        place.textContent = item.place || 'Wesley in the wild';
        const meta = document.createElement('span');
        meta.className = 'cap-meta';
        meta.textContent = [item.name, fmtShortDate(item.date)].filter(Boolean).join(' · ');
        cap.append(place, meta);
        figure.append(img, cap);
        figure.tabIndex = 0;
        figure.setAttribute('role', 'button');
        figure.setAttribute('aria-label', `Open ${img.alt}`);
        figure.addEventListener('click', () => openSunriseOverlay(i));
        figure.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSunriseOverlay(i); }
        });
        grid.appendChild(figure);
    });
    if (empty) empty.hidden = true;
    if (count) {
        count.textContent = `${items.length.toLocaleString()} ${items.length === 1 ? 'moment' : 'moments'} shared so far`;
        count.hidden = false;
    }

    // Full-screen viewer
    const overlay = document.getElementById('sr-overlay');
    const modalViewer = createSunriseViewer(document.getElementById('sr-modal'), items);
    function openSunriseOverlay(i) {
        modalViewer.show(i);
        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
        document.getElementById('sr-close').focus();
    }
    function closeSunriseOverlay() {
        overlay.hidden = true;
        document.body.style.overflow = '';
    }
    document.getElementById('sr-close').addEventListener('click', closeSunriseOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSunriseOverlay();
    });

    // One at a time
    const inlineViewer = createSunriseViewer(document.getElementById('sr-inline'), items);
    inlineViewer.show(0);

    // Blended sunrise
    const startMap = setupWildMap(items);

    // View tabs
    const views = document.getElementById('sr-views');
    views.hidden = false;
    let activeView = 'collage';
    views.querySelectorAll('.sr-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            activeView = tab.dataset.view;
            views.querySelectorAll('.sr-tab').forEach((t) => {
                const on = t === tab;
                t.classList.toggle('is-active', on);
                t.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            document.querySelectorAll('.sr-panel').forEach((panel) => {
                panel.hidden = panel.dataset.panel !== activeView;
            });
            if (activeView === 'map') startMap();
        });
    });

    // Arrow keys: the open full-screen viewer, or the one-at-a-time view.
    document.addEventListener('keydown', (e) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
        const target = !overlay.hidden ? modalViewer : (activeView === 'single' ? inlineViewer : null);
        if (!target) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); target.prev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); target.next(); }
        if (e.key === 'Escape' && !overlay.hidden) closeSunriseOverlay();
    });
}

// ---------- Add to Wesley's Gift ----------
// Stays in its "coming soon" state until CONFIG.walletAddress is set,
// then shows a scannable QR code, a copy button, and send steps.
function setupGift() {
    const addr = CONFIG.walletAddress;
    if (!addr) return;
    const uri = `bitcoin:${addr}`;

    const qr = document.getElementById('gift-qr');
    if (qr && typeof qrcode === 'function') {
        const code = qrcode(0, 'M');
        // Uppercase bech32 makes a smaller, easier-to-scan code.
        code.addData(uri.toUpperCase(), 'Alphanumeric');
        code.make();
        qr.innerHTML = code.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
        qr.href = uri; // On a phone, tapping opens the visitor's wallet app.
    }

    const addrEl = document.getElementById('gift-address');
    if (addrEl) {
        addrEl.textContent = addr;
        addrEl.classList.add('is-set');
    }

    const steps = document.getElementById('gift-steps');
    if (steps) steps.hidden = false;

    const copy = document.getElementById('gift-copy');
    if (copy) {
        copy.hidden = false;
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(addr);
                copy.textContent = 'Copied';
                setTimeout(() => { copy.textContent = 'Copy address'; }, 2000);
            } catch (e) {
                console.warn('copy failed', e);
            }
        });
    }
}

// Sunset uploads: the photo is shrunk in the visitor's browser (longest side
// 2000 px) before sending. Re-drawing it also drops the file's metadata, so
// GPS location never leaves their device. If the browser can't read the
// format (e.g. HEIC outside Safari), the original file is sent instead and
// the review bot cleans it.
async function shrinkPhoto(file) {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        return blob || file;
    } catch {
        return file;
    }
}

const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

// Shared by the sunset form and the photos-of-Wesley form. Images are
// shrunk in the browser (see shrinkPhoto); videos are sent as they are.
function setupUploadForm(formId, endpoint, successText, fields) {
    const form = document.getElementById(formId);
    if (!form) return;
    const input = form.elements.photo;
    const img = form.querySelector('.upload-preview-img');
    const video = form.querySelector('.upload-preview-video');
    const pickText = form.querySelector('.upload-pick-text');
    const note = form.querySelector('.form-note');
    const originalNote = note ? note.textContent : '';

    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');
        if (img) img.hidden = true;
        if (video) { video.hidden = true; video.pause(); }
        if (isVideo && video) {
            video.src = url;
            video.hidden = false;
            video.play().catch(() => {});
        } else if (img) {
            img.src = url;
            img.hidden = false;
            img.onerror = () => { img.hidden = true; };
        }
        if (pickText) pickText.textContent = isVideo ? 'Change video' : 'Change photo';
        if (note) { note.textContent = originalNote; note.classList.remove('form-error'); }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = input.files && input.files[0];
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        if (isVideo && file.size > MAX_VIDEO_BYTES) {
            if (note) {
                note.textContent = 'That video is too large. Please choose one under 24 MB (about 20 seconds).';
                note.classList.add('form-error');
            }
            return;
        }
        const data = new FormData();
        const upload = isVideo ? file : await shrinkPhoto(file);
        data.append('photo', upload, upload === file ? file.name : 'photo.jpg');
        for (const field of fields) data.append(field, form.elements[field].value);
        data.append('website', form.elements.website.value);
        await submitToSite(form, endpoint, { method: 'POST', body: data }, successText);
    });
}

// Decorative floating hearts, bitcoin symbols, and teddy faces behind the
// content. Built here so every page shares one definition.
const FLOAT_ITEMS = [
    ['heart', 6, 12, 0, 22, 22], ['sun', 22, 6, 3, 18, 26], ['lion', 38, 14, 6, 24, 24],
    ['heart', 56, 9, 1, 20, 18], ['sun', 72, 16, 4, 22, 22], ['lion', 88, 8, 7, 26, 26],
    ['heart', 14, 32, 2, 18, 20], ['sun', 32, 38, 5, 24, 18], ['lion', 50, 30, 8, 20, 24],
    ['heart', 68, 36, 0, 22, 22], ['sun', 84, 32, 3, 18, 28], ['lion', 8, 52, 6, 24, 22],
    ['heart', 28, 58, 9, 20, 26], ['sun', 46, 50, 2, 22, 20], ['lion', 64, 56, 5, 18, 22],
    ['heart', 82, 50, 8, 24, 18], ['sun', 16, 78, 1, 22, 24], ['lion', 36, 84, 4, 18, 22],
    ['heart', 54, 78, 7, 22, 20], ['sun', 76, 82, 0, 26, 26], ['lion', 92, 76, 3, 20, 22],
];

function buildFloatingBackground() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(svgNS, 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.position = 'absolute';
    defs.innerHTML = `<defs>
        <symbol id="ic-heart" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></symbol>
        <symbol id="ic-lion" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="21.00" cy="12.00" r="2.7"/><circle cx="19.79" cy="16.50" r="2.7"/><circle cx="16.50" cy="19.79" r="2.7"/><circle cx="12.00" cy="21.00" r="2.7"/><circle cx="7.50" cy="19.79" r="2.7"/><circle cx="4.21" cy="16.50" r="2.7"/><circle cx="3.00" cy="12.00" r="2.7"/><circle cx="4.21" cy="7.50" r="2.7"/><circle cx="7.50" cy="4.21" r="2.7"/><circle cx="12.00" cy="3.00" r="2.7"/><circle cx="16.50" cy="4.21" r="2.7"/><circle cx="19.79" cy="7.50" r="2.7"/><circle cx="12" cy="12.6" r="6.2" fill="#fff" fill-opacity="0.6"/><circle cx="7.9" cy="7.6" r="1.7" fill="#fff" fill-opacity="0.6"/><circle cx="16.1" cy="7.6" r="1.7" fill="#fff" fill-opacity="0.6"/><circle cx="9.8" cy="11.6" r="1"/><circle cx="14.2" cy="11.6" r="1"/><path d="M10.6 14h2.8l-1.4 1.6z"/><path d="M12 15.6v.9" stroke="currentColor" stroke-width=".7" fill="none"/></symbol>
        <symbol id="ic-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="19.20" y1="12.00" x2="22.40" y2="12.00"/><line x1="17.09" y1="17.09" x2="19.35" y2="19.35"/><line x1="12.00" y1="19.20" x2="12.00" y2="22.40"/><line x1="6.91" y1="17.09" x2="4.65" y2="19.35"/><line x1="4.80" y1="12.00" x2="1.60" y2="12.00"/><line x1="6.91" y1="6.91" x2="4.65" y2="4.65"/><line x1="12.00" y1="4.80" x2="12.00" y2="1.60"/><line x1="17.09" y1="6.91" x2="19.35" y2="4.65"/></g></symbol>
    </defs>`;

    const layer = document.createElement('div');
    layer.className = 'floating-bg';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = FLOAT_ITEMS.map(([kind, x, y, d, r, size]) => {
        const style = `--x:${x}%;--y:${y}%;--d:${d}s;--r:${r}s;--s:${size}px`;
        const inner = `<svg><use href="#ic-${kind}"/></svg>`;
        return `<span class="float-item float-${kind}" style="${style}">${inner}</span>`;
    }).join('');

    document.body.prepend(defs, layer);
}

(async function init() {
    buildFloatingBackground();
    setupWesleyDay();
    setupLightbox();
    setupReveals();
    setupCandle();
    setupShareButton();
    setupGift();
    loadGiftCount();
    loadSunsets();
    setupUploadForm('sunset-form', '/api/sunset',
        'Thank you. Your photo has been received and will join the others after a quick look.',
        ['place', 'name']);
    setupUploadForm('photo-form', '/api/photo',
        'Thank you. Your photo has been received and will join the gallery after a quick look.',
        ['name']);
    loadHeroPhoto();
    addCompanionPhoto();
    loadMemories();
    setupMemoryForm();
    loadGallery();
    loadActs();
    setupJSONForm('act-form', '/api/act', ['act', 'place', 'name'],
        'Thank you for being lion-hearted. Your act will appear here after a quick look.');
    loadEvents();
    setupKeepsake();
})();
