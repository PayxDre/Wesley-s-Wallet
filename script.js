// Wesley's Wallet: live data + chart
// All data is fetched from public, no-key APIs:
//   - CoinGecko: BTC price + history
//   - Blockstream:  wallet balance (when a real address is set)

const CONFIG = {
    // The family gift wallet. Set to null to show a "being set up" state
    // instead of live numbers.
    walletAddress: 'bc1qhrvv3xjwlluq7fzkp6evhg00j5e9mqhunlshuf',
    // Optional caption shown under the framed Featured photo.
    featuredCaption: '',
    birth: new Date('2025-04-20T00:00:00'),
    passing: new Date('2026-04-25T00:00:00'),
    // Approximate Bitcoin block height at passing (April 25, 2026).
    // Anchored to the inscription in block 947,318 on April 30, 2026
    // minus ~5 days × 144 blocks/day.
    blockAtPassing: 946600,
};

const $ = (sel) => document.querySelector(sel);

const fmtUSD = (n) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: n >= 1000 ? 0 : 2,
    }).format(n);

const fmtBTC = (sats) => {
    const btc = sats / 1e8;
    return `${btc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`;
};

async function fetchBTCPrice() {
    const url =
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
    const res = await fetch(url);
    if (!res.ok) throw new Error('price fetch failed');
    const data = await res.json();
    return {
        usd: data.bitcoin.usd,
        change24h: data.bitcoin.usd_24h_change,
    };
}

// Balance plus the number of gifts (incoming payments, including ones
// still waiting to confirm), from one Blockstream lookup.
async function fetchWalletBalance(address) {
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!res.ok) throw new Error('balance fetch failed');
    const data = await res.json();
    const sats =
        (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) +
        (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum);
    walletGiftCount = data.chain_stats.funded_txo_count + data.mempool_stats.funded_txo_count;
    return sats;
}

let walletGiftCount = null;

async function fetchCurrentBlockHeight() {
    const res = await fetch('https://blockstream.info/api/blocks/tip/height');
    if (!res.ok) throw new Error('block height fetch failed');
    return parseInt(await res.text(), 10);
}

// The BTC price on the day Wesley passed never changes, so it's looked up
// once and remembered. mempool.space serves historical prices with no
// age limit; CoinGecko's free tier only reaches back 365 days, so it is
// only a fallback.
async function fetchBTCPriceAtPassing() {
    const cacheKey = 'btc-price-at-passing-2026-04-25';
    try {
        const v = parseFloat(localStorage.getItem(cacheKey));
        if (v > 0) return v;
    } catch {}

    const ts = Math.floor(CONFIG.passing.getTime() / 1000);
    const sources = [
        async () => {
            const res = await fetch(`https://mempool.space/api/v1/historical-price?currency=USD&timestamp=${ts}`);
            if (!res.ok) throw new Error('mempool historical price failed');
            const data = await res.json();
            return data?.prices?.[0]?.USD;
        },
        async () => {
            const res = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin/history?date=25-04-2026&localization=false');
            if (!res.ok) throw new Error('coingecko historical price failed');
            const data = await res.json();
            return data?.market_data?.current_price?.usd;
        },
    ];

    for (const source of sources) {
        try {
            const price = await source();
            if (price > 0) {
                try { localStorage.setItem(cacheKey, String(price)); } catch {}
                return price;
            }
        } catch (e) {
            console.warn(e.message);
        }
    }
    throw new Error('no historical price available');
}

async function loadGrowthMetrics(currentSats, currentPrice) {
    const $val = (id) => document.getElementById(id);
    const setVal = (id, txt, cls) => {
        const el = $val(id);
        if (!el) return;
        el.textContent = txt;
        if (cls !== undefined) {
            el.classList.remove('positive', 'negative');
            if (cls) el.classList.add(cls);
        }
    };

    // Days since passing
    const days = Math.max(0, Math.floor((Date.now() - CONFIG.passing.getTime()) / 86400000));
    setVal('growth-days', days.toLocaleString());

    // Bitcoin blocks since passing
    try {
        const height = await fetchCurrentBlockHeight();
        const blocks = Math.max(0, height - CONFIG.blockAtPassing);
        setVal('growth-blocks', blocks.toLocaleString());
    } catch (e) {
        setVal('growth-blocks', `~${Math.floor(days * 144).toLocaleString()}`);
    }

    // BTC price change since he passed
    try {
        if (currentPrice == null) throw new Error('current price unavailable');
        const passPrice = await fetchBTCPriceAtPassing();
        const priceDelta = currentPrice - passPrice;
        const pricePct = (priceDelta / passPrice) * 100;
        const sign = priceDelta >= 0 ? '+' : '';
        setVal('growth-price', `${sign}${pricePct.toFixed(1)}%`, priceDelta >= 0 ? 'positive' : 'negative');
        setVal('growth-price-sub', `${sign}${fmtUSD(priceDelta)} per BTC`);
    } catch (e) {
        console.warn('growth price fetch failed:', e);
        setVal('growth-price', '—', '');
    }

    // Gifts received: a count, independent of price
    if (currentSats === null || (CONFIG.walletAddress && walletGiftCount === null)) {
        setVal('growth-value', '—', '');
        setVal('growth-value-sub', 'Unavailable right now');
    } else if (!CONFIG.walletAddress) {
        setVal('growth-value', '—', '');
        setVal('growth-value-sub', 'Wallet being set up');
    } else {
        setVal('growth-value', walletGiftCount.toLocaleString(), '');
        setVal('growth-value-sub', walletGiftCount === 0 ? 'Be the first to add to it'
            : walletGiftCount === 1 ? 'gift so far' : 'gifts so far');
    }
}

async function fetchPriceHistory(days) {
    const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('history fetch failed');
    const data = await res.json();
    return data.prices; // [[timestamp, price], ...]
}

let chart;

function renderChart(prices) {
    const ctx = document.getElementById('price-chart').getContext('2d');
    const labels = prices.map(([t]) => new Date(t));
    const values = prices.map(([, p]) => p);

    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(184, 146, 74, 0.28)');
    gradient.addColorStop(1, 'rgba(184, 146, 74, 0)');

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    data: values,
                    borderColor: '#b8924a',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.25,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#2d2a26',
                    padding: 10,
                    titleFont: { family: 'Inter', size: 12, weight: '500' },
                    bodyFont: { family: 'Inter', size: 13 },
                    callbacks: {
                        title: (items) =>
                            new Date(items[0].parsed.x).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                            }),
                        label: (item) => fmtUSD(item.parsed.y),
                    },
                },
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'month' },
                    grid: { display: false },
                    ticks: { color: '#6b6359', font: { family: 'Inter', size: 11 } },
                },
                y: {
                    grid: { color: '#e7dfd2' },
                    ticks: {
                        color: '#6b6359',
                        font: { family: 'Inter', size: 11 },
                        callback: (v) => fmtUSD(v),
                    },
                },
            },
        },
    });
}

let balancePromise = null;
function getBalanceSats() {
    if (!CONFIG.walletAddress) return Promise.resolve(0);
    if (!balancePromise) {
        // A failed lookup returns null (not 0) so the page says "unavailable"
        // instead of showing an empty wallet.
        balancePromise = fetchWalletBalance(CONFIG.walletAddress).catch((e) => {
            console.warn('balance fetch failed:', e);
            balancePromise = null;
            return null;
        });
    }
    return balancePromise;
}

async function loadChart(days) {
    const note = $('#chart-note');
    note.textContent = 'Loading wallet history…';
    try {
        // Check the balance first: an unfunded wallet needs no price history.
        const sats = await getBalanceSats();
        if (sats === null) throw new Error('balance unavailable');
        const btc = sats / 1e8;
        if (btc <= 0) {
            note.textContent = CONFIG.walletAddress
                ? 'The chart will appear here once the wallet is funded.'
                : 'The wallet chart will appear here once the wallet is set up and funded.';
            if (chart) { chart.destroy(); chart = null; }
            return;
        }
        const prices = await fetchPriceHistory(days);
        const walletValues = prices.map(([t, p]) => [t, btc * p]);
        renderChart(walletValues);
        note.textContent = '';
    } catch (e) {
        note.textContent = 'Could not load wallet history right now.';
        console.error(e);
    }
}

async function loadWallet() {
    const addr = CONFIG.walletAddress;
    if (addr) {
        // Show the address right away; it doesn't depend on any live data.
        const addrEl = $('#wallet-address');
        addrEl.innerHTML = '';
        const a = document.createElement('a');
        a.href = `https://mempool.space/address/${addr}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = addr;
        addrEl.appendChild(a);
    } else {
        $('#btc-balance').textContent = 'Being set up';
        $('#usd-value').textContent = 'Balance will appear once funded';
        $('#wallet-address').textContent = 'Coming soon';
    }

    // Price and balance come from different services; one failing must
    // not hide the other.
    const [priceRes, satsRes] = await Promise.allSettled([
        fetchBTCPrice(),
        addr ? getBalanceSats() : Promise.resolve(0),
    ]);
    const price = priceRes.status === 'fulfilled' ? priceRes.value : null;
    const sats = satsRes.status === 'fulfilled' ? satsRes.value : null;

    if (price) {
        $('#btc-price').textContent = fmtUSD(price.usd);
        const change = price.change24h;
        const sign = change >= 0 ? '+' : '';
        $('#btc-change').textContent = `${sign}${change.toFixed(2)}% today`;
        $('#btc-change').style.color = change >= 0 ? '#5e7a52' : '#a85a4a';
    } else {
        $('#btc-price').textContent = 'Unavailable';
        $('#btc-change').textContent = 'Live price could not be loaded';
    }

    if (addr) {
        if (sats === null) {
            $('#btc-balance').textContent = 'Unavailable';
            $('#usd-value').textContent = 'Balance could not be loaded right now';
        } else {
            $('#btc-balance').textContent = fmtBTC(sats);
            $('#usd-value').textContent = price ? fmtUSD((sats / 1e8) * price.usd) : 'USD value unavailable';
        }
    }

    loadGrowthMetrics(addr ? sats : 0, price ? price.usd : null);
}

function setupRangeButtons() {
    document.querySelectorAll('.range-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.range-btn').forEach((b) => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            loadChart(btn.dataset.days);
        });
    });
}

function setAgeLine() {
    const ageEl = $('#age-line');
    if (!ageEl) return;
    const ms = CONFIG.passing - CONFIG.birth;
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    const years = Math.floor(days / 365);
    const remaining = days - years * 365;
    if (years === 1 && remaining > 0) {
        ageEl.textContent = `One year and ${remaining} days of light.`;
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

function setFooterTime() {
    $('#footer-time').textContent =
        'Live prices as of ' +
        new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
}

// Chart.js needs a time scale adapter. We load date-fns adapter dynamically
// only when needed so the chart can render time-series labels.
function loadChartAdapter() {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// The balloon lion stays tucked below the viewport until the reader
// reaches the wallet section, then floats up the screen once.
function setupIntroFly() {
    const el = document.getElementById('intro-fly');
    const wallet = document.getElementById('wallet');
    if (!el || !wallet || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                observer.disconnect();
                el.classList.add('fly');
                setTimeout(() => el.remove(), 9500);
            });
        },
        { threshold: 0.25 }
    );
    observer.observe(wallet);
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

async function fetchCandleCount() {
    try {
        const res = await fetch(
            `${CANDLE_COUNTER_BASE}/get/${CANDLE_COUNTER_NS}/${CANDLE_COUNTER_KEY}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
    } catch (e) {
        console.warn('candle count fetch failed', e);
        return null;
    }
}

async function incrementCandleCount() {
    try {
        const res = await fetch(
            `${CANDLE_COUNTER_BASE}/hit/${CANDLE_COUNTER_NS}/${CANDLE_COUNTER_KEY}`
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

function setupCandle() {
    const btn = document.getElementById('candle-btn');
    const status = document.getElementById('candle-status');
    if (!btn || !status) return;

    // Load global count without incrementing.
    fetchCandleCount().then(displayCandleCount);

    if (localStorage.getItem(CANDLE_KEY)) {
        btn.classList.add('lit');
        status.classList.add('is-lit');
        status.textContent = 'Your candle is lit for Wesley.';
    }

    btn.addEventListener('click', async () => {
        if (btn.classList.contains('lit')) return;
        btn.classList.add('lit');
        status.classList.add('is-lit');
        status.textContent = 'Your candle is lit for Wesley.';
        try { localStorage.setItem(CANDLE_KEY, new Date().toISOString()); } catch {}
        const newCount = await incrementCandleCount();
        if (newCount != null) displayCandleCount(newCount);
    });
}

async function loadLetters() {
    const container = document.getElementById('letters-list');
    const navLink = document.querySelector('[data-nav="letters"]');
    if (!container && !navLink) return;

    let letters = [];
    try {
        const res = await fetch('assets/letters.json', { cache: 'no-cache' });
        if (res.ok) letters = await res.json();
    } catch (e) {
        console.warn('letters fetch failed', e);
    }

    // Section stays hidden until at least one letter exists, so visitors
    // never see an empty or technical placeholder.
    if (!Array.isArray(letters) || letters.length === 0) return;
    if (navLink) navLink.hidden = false;
    if (!container) return;
    const section = document.getElementById('letters');
    if (section) section.hidden = false;

    const now = Date.now();
    letters.sort((a, b) => new Date(a.unlocksOn) - new Date(b.unlocksOn));

    container.innerHTML = '';
    letters.forEach((letter) => {
        const unlocksAt = new Date(letter.unlocksOn).getTime();
        const isUnlocked = !isNaN(unlocksAt) && now >= unlocksAt;
        const card = document.createElement('article');
        card.className = 'letter-card ' + (isUnlocked ? 'open' : 'locked');

        const to = escapeHTML(letter.to || '');
        const from = escapeHTML(letter.from || '');
        const title = escapeHTML(letter.title || '');

        if (isUnlocked) {
            const body = escapeHTML(letter.body || '').replace(/\n/g, '<br />');
            card.innerHTML = `
                <p class="letter-meta">To ${to} · From ${from}</p>
                <h3 class="letter-title">${title}</h3>
                <p class="letter-body">${body}</p>
                <p class="letter-signature">— ${from}</p>
            `;
        } else {
            const daysToGo = Math.ceil((unlocksAt - now) / 86400000);
            const dateStr = new Date(unlocksAt).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
            });
            card.innerHTML = `
                <div class="letter-seal" aria-hidden="true">✉</div>
                <p class="letter-meta">To ${to} · From ${from}</p>
                <h3 class="letter-title">${title}</h3>
                <p class="letter-countdown">Opens ${dateStr}</p>
                <p class="letter-countdown-small">${daysToGo.toLocaleString()} days from now</p>
            `;
        }

        container.appendChild(card);
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
            <button type="button" class="sr-arrow sr-prev" aria-label="Previous sunrise">&#8249;</button>
            <img class="sr-img" alt="" />
            <button type="button" class="sr-arrow sr-next" aria-label="Next sunrise">&#8250;</button>
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
        img.alt = item.place ? `Sunrise at ${item.place}` : 'A sunrise shared for Wesley';
        placeEl.textContent = item.place || 'A sunrise for Wesley';
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

// ---------- Blended sunrise ----------
// Every shared sunrise becomes one panorama. Each photo is studied first
// (where its horizon sits, where its sun is, its overall color), then:
//   1. scaled and shifted so every horizon lands on the same line and each
//      sun sits in the middle of its own stretch of sky,
//   2. color-matched part of the way toward the group, so a pink dawn and a
//      gold one meet halfway instead of clashing,
//   3. merged with multi-band blending: broad sky colors mix over a wide
//      area while fine detail (clouds, palms, waves) changes over a short
//      one, which hides the seams between photos.
const BLEND_H = 800;
const BLEND_LEVELS = 8; // pyramid depth; window edges align to 2^levels

const BLEND_MAX = 24; // beyond this, an even sample across time

function loadImageElement(src, cors) {
    return new Promise((resolve) => {
        const im = new Image();
        if (cors) im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
    });
}

// A resized copy keeps downloads small; the proxy allows canvas use. If it
// can't be reached, fall back to the original on this site.
async function loadBlendImage(item) {
    return (await loadImageElement(thumbPhotoURL(item.file, 1400, SUNSET_PATH), true))
        || loadImageElement(sunriseLocal(item));
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

// Study a photo on a small copy: horizon height, sun position, color stats.
function analyzeSunrise(img) {
    const w = 240;
    const h = Math.max(60, Math.round((img.height / img.width) * w));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    const mean = [0, 0, 0];
    const sq = [0, 0, 0];
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        lum[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        for (let k = 0; k < 3; k++) {
            mean[k] += d[p + k];
            sq[k] += d[p + k] * d[p + k];
        }
    }
    const n = w * h;
    const std = [0, 1, 2].map((k) => Math.sqrt(Math.max(1, sq[k] / n - (mean[k] / n) ** 2)));
    for (let k = 0; k < 3; k++) mean[k] /= n;

    // Horizon: the row with the strongest edge running across most of the
    // photo. Using a low percentile across columns means a palm tree or a
    // person in one spot can't win; a long straight sea or land line does.
    let best = 0;
    let horizon = 0.6;
    const g = new Float32Array(w);
    for (let y = Math.max(1, Math.round(h * 0.2)); y < Math.round(h * 0.88); y++) {
        for (let x = 0; x < w; x++) g[x] = Math.abs(lum[(y - 1) * w + x] - lum[Math.min(h - 1, y + 1) * w + x]);
        g.sort();
        const score = g[Math.floor(w * 0.4)];
        if (score > best) { best = score; horizon = y / h; }
    }
    if (best < 3) horizon = 0.6; // no clear horizon (all sky, or fog)

    // Sun: the brightest column in the band of sky just above the horizon.
    const top = Math.max(0, Math.round((horizon - 0.4) * h));
    const bottom = Math.max(top + 1, Math.round(horizon * h));
    const cols = new Float32Array(w);
    for (let x = 0; x < w; x++) {
        let s = 0;
        for (let y = top; y < bottom; y++) s += (lum[y * w + x] / 255) ** 4;
        cols[x] = s;
    }
    let sunX = 0.5;
    let peak = 0;
    let avg = 0;
    for (let x = 0; x < w; x++) {
        let s = 0;
        for (let j = -4; j <= 4; j++) s += cols[Math.min(w - 1, Math.max(0, x + j))];
        avg += s / w;
        if (s > peak) { peak = s; sunX = x / w; }
    }
    if (peak < avg * 1.4) sunX = 0.5; // no distinct sun: keep it centered

    return { horizon, sunX, mean, std };
}

// Draw a photo into a window canvas, stretching its edge pixels outward
// wherever it doesn't reach (those areas carry almost no weight in the blend).
function drawCovering(ctx, img, dx, dy, dw, dh, ww, wh) {
    ctx.drawImage(img, dx, dy, dw, dh);
    const cv = ctx.canvas;
    const l = Math.max(0, Math.ceil(dx));
    const r = Math.min(ww, Math.floor(dx + dw));
    if (l > 0) ctx.drawImage(cv, l, 0, 1, wh, 0, 0, l, wh);
    if (r < ww) ctx.drawImage(cv, r - 1, 0, 1, wh, r, 0, ww - r, wh);
    const t = Math.max(0, Math.ceil(dy));
    const b = Math.min(wh, Math.floor(dy + dh));
    if (t > 0) ctx.drawImage(cv, 0, t, ww, 1, 0, 0, ww, t);
    if (b < wh) ctx.drawImage(cv, 0, b - 1, ww, 1, 0, b, ww, wh - b);
}

// Pyramid helpers on interleaved Float32Arrays with `ch` channels.
function pyrReduce(src, w, h, ch) {
    const w2 = Math.ceil(w / 2);
    const h2 = Math.ceil(h / 2);
    const kx = [1, 4, 6, 4, 1];
    const tmp = new Float32Array(w2 * h * ch);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x2 = 0; x2 < w2; x2++) {
            const o = (y * w2 + x2) * ch;
            for (let j = -2; j <= 2; j++) {
                const p = (row + Math.min(w - 1, Math.max(0, x2 * 2 + j))) * ch;
                const f = kx[j + 2] / 16;
                for (let k = 0; k < ch; k++) tmp[o + k] += src[p + k] * f;
            }
        }
    }
    const out = new Float32Array(w2 * h2 * ch);
    for (let y2 = 0; y2 < h2; y2++) {
        for (let j = -2; j <= 2; j++) {
            const yy = Math.min(h - 1, Math.max(0, y2 * 2 + j));
            const f = kx[j + 2] / 16;
            const si = yy * w2 * ch;
            const oi = y2 * w2 * ch;
            for (let q = 0; q < w2 * ch; q++) out[oi + q] += tmp[si + q] * f;
        }
    }
    return out;
}

// Bilinear upsample of an RGB (w2 x h2) level to (w x h), added into or
// subtracted from `dst` (sign = +1 or -1).
function pyrExpandInto(src, w2, h2, dst, w, h, sign) {
    for (let y = 0; y < h; y++) {
        const sy = Math.min(h2 - 1, y / 2);
        const y0 = Math.floor(sy);
        const y1 = Math.min(h2 - 1, y0 + 1);
        const fy = sy - y0;
        for (let x = 0; x < w; x++) {
            const sx = Math.min(w2 - 1, x / 2);
            const x0 = Math.floor(sx);
            const x1 = Math.min(w2 - 1, x0 + 1);
            const fx = sx - x0;
            const a = (y0 * w2 + x0) * 3, b = (y0 * w2 + x1) * 3;
            const c = (y1 * w2 + x0) * 3, e = (y1 * w2 + x1) * 3;
            const o = (y * w + x) * 3;
            for (let k = 0; k < 3; k++) {
                const top = src[a + k] + (src[b + k] - src[a + k]) * fx;
                const bot = src[c + k] + (src[e + k] - src[c + k]) * fx;
                dst[o + k] += sign * (top + (bot - top) * fy);
            }
        }
    }
}

// Find where two neighboring photos should meet: a top-to-bottom path
// through their overlap that runs where they already look alike and
// avoids crossing edges (trees, roofs, people). Returns an x per row.
function findSeam(A, B, center, half, H) {
    const zx0 = Math.max(A.x0, B.x0, Math.round(center - half));
    const zx1 = Math.min(A.x0 + A.ww, B.x0 + B.ww, Math.round(center + half));
    const zw = zx1 - zx0;
    const seam = new Int32Array(H);
    if (zw < 3) { seam.fill(Math.round(center)); return seam; }
    const px = (I, gx, y) => (y * I.ww + (gx - I.x0)) * 3;
    const edge = (I, gx, y) => {
        const l = px(I, Math.max(I.x0, gx - 1), y);
        const r = px(I, Math.min(I.x0 + I.ww - 1, gx + 1), y);
        const u = px(I, gx, Math.max(0, y - 1));
        const d = px(I, gx, Math.min(H - 1, y + 1));
        let s = 0;
        for (let k = 0; k < 3; k++) s += Math.abs(I.data[r + k] - I.data[l + k]) + Math.abs(I.data[d + k] - I.data[u + k]);
        return s;
    };
    const cost = new Float32Array(zw * H);
    let total = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < zw; x++) {
            const gx = zx0 + x;
            const a = px(A, gx, y);
            const b = px(B, gx, y);
            let d = 0;
            for (let k = 0; k < 3; k++) d += Math.abs(A.data[a + k] - B.data[b + k]);
            const c = d + 1.5 * (edge(A, gx, y) + edge(B, gx, y));
            cost[y * zw + x] = c;
            total += c;
        }
    }
    // Gentle pull toward the middle so seams don't all bunch at one side.
    const pull = (total / (zw * H)) * 0.6;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < zw; x++) {
            const t = (zx0 + x - center) / half;
            cost[y * zw + x] += pull * t * t;
        }
    }
    const acc = new Float32Array(zw * H);
    const from = new Int8Array(zw * H);
    for (let x = 0; x < zw; x++) acc[x] = cost[x];
    for (let y = 1; y < H; y++) {
        for (let x = 0; x < zw; x++) {
            let best = acc[(y - 1) * zw + x];
            let dir = 0;
            if (x > 0 && acc[(y - 1) * zw + x - 1] < best) { best = acc[(y - 1) * zw + x - 1]; dir = -1; }
            if (x < zw - 1 && acc[(y - 1) * zw + x + 1] < best) { best = acc[(y - 1) * zw + x + 1]; dir = 1; }
            acc[y * zw + x] = best + cost[y * zw + x];
            from[y * zw + x] = dir;
        }
    }
    let x = 0;
    for (let i = 1; i < zw; i++) if (acc[(H - 1) * zw + i] < acc[(H - 1) * zw + x]) x = i;
    for (let y = H - 1; y >= 0; y--) {
        seam[y] = zx0 + x;
        x += from[y * zw + x];
    }
    return seam;
}

async function drawBlendedSunrise(canvas, items, onProgress) {
    // Oldest on the left, newest on the right.
    const all = items.slice().sort((a, b) =>
        (a.date || '').localeCompare(b.date || '') || a.file.localeCompare(b.file));
    const list = all.length <= BLEND_MAX ? all
        : Array.from({ length: BLEND_MAX }, (_, i) => all[Math.round((i * (all.length - 1)) / (BLEND_MAX - 1))]);

    onProgress('Gathering sunrises…');
    const loaded = await Promise.all(list.map(loadBlendImage));
    const photos = loaded.filter(Boolean).map((img) => ({ img, ...analyzeSunrise(img) }));
    const n = photos.length;
    const ctx = canvas.getContext('2d');
    if (!n) return false;

    const align = 2 ** BLEND_LEVELS;
    const H = BLEND_H;
    const W = Math.ceil(Math.min(2880, Math.max(1440, n * 300)) / align) * align;
    const slot = W / n;

    // Shared horizon line: the typical one, so photos move as little as possible.
    const hs = photos.map((p) => p.horizon).sort((a, b) => a - b);
    const targetY = Math.min(0.7, Math.max(0.45, hs[Math.floor(n / 2)])) * H;

    // Group color the photos are nudged toward.
    const strength = n > 1 ? 0.5 : 0;
    const gMean = [0, 1, 2].map((k) => photos.reduce((s, p) => s + p.mean[k], 0) / n);
    const gStd = [0, 1, 2].map((k) => photos.reduce((s, p) => s + p.std[k], 0) / n);

    // Place one photo in its stretch of the panorama, color-matched.
    const reach = Math.ceil(slot / 2 + align);
    function prepare(i) {
        const p = photos[i];
        const c = (i + 0.5) * slot;
        const x0 = Math.max(0, Math.floor((c - reach) / align) * align);
        const x1 = Math.min(W, Math.ceil((c + reach) / align) * align);
        const ww = x1 - x0;

        // Scale so the horizon lands on the shared line and the photo fills
        // the height, and is wide enough to cover its stretch and the seams.
        const iw = p.img.width;
        const ih = p.img.height;
        const core = Math.min(ww, slot * 2);
        let s = Math.max(H / ih, targetY / (p.horizon * ih), (H - targetY) / ((1 - p.horizon) * ih), core / iw);
        s = Math.min(s, (H / ih) * 2.6); // never zoom in more than this
        const dw = iw * s;
        const dh = ih * s;
        const dy = targetY - p.horizon * dh;
        const cl = c - x0;
        let dx = cl - p.sunX * dw; // put the sun in the middle of its stretch
        if (dw >= core) dx = Math.min(cl - core / 2, Math.max(cl + core / 2 - dw, dx));
        else dx = cl - dw / 2;

        const wc = document.createElement('canvas');
        wc.width = ww;
        wc.height = H;
        const wctx = wc.getContext('2d', { willReadFrequently: true });
        wctx.imageSmoothingQuality = 'high';
        drawCovering(wctx, p.img, dx, dy, dw, dh, ww, H);
        const px = wctx.getImageData(0, 0, ww, H).data;

        const gain = [0, 1, 2].map((k) => {
            const ratio = Math.min(1.4, Math.max(0.7, gStd[k] / p.std[k]));
            return 1 + (ratio - 1) * strength;
        });
        const shift = [0, 1, 2].map((k) => p.mean[k] + (gMean[k] - p.mean[k]) * strength);
        const data = new Float32Array(ww * H * 3);
        for (let q = 0, o = 0; q < px.length; q += 4, o += 3) {
            for (let k = 0; k < 3; k++) data[o + k] = (px[q + k] - p.mean[k]) * gain[k] + shift[k];
        }
        return { x0, ww, data };
    }

    // Result pyramid plus the total weight at each pixel of each level.
    const dims = [];
    for (let l = 0, w = W, h = H; l <= BLEND_LEVELS; l++, w = Math.ceil(w / 2), h = Math.ceil(h / 2)) dims.push([w, h]);
    const result = dims.map(([w, h]) => new Float32Array(w * h * 3));
    const weight = dims.map(([w, h]) => new Float32Array(w * h));

    // Add one photo's detail bands, each masked by its own softened region.
    function addPhoto(I, seamL, seamR) {
        const r = 3; // a few pixels of cross-fade right at the seam
        let m = new Float32Array(I.ww * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < I.ww; x++) {
                const gx = I.x0 + x + 0.5;
                const a = seamL ? Math.min(1, Math.max(0, (gx - seamL[y] + r) / (2 * r))) : 1;
                const b = seamR ? Math.min(1, Math.max(0, (seamR[y] - gx + r) / (2 * r))) : 1;
                m[y * I.ww + x] = a * b;
            }
        }
        let g = I.data;
        let w = I.ww;
        let h = H;
        let lx0 = I.x0;
        for (let l = 0; l <= BLEND_LEVELS; l++) {
            let next = null;
            let w2 = 0;
            let h2 = 0;
            if (l < BLEND_LEVELS) {
                next = pyrReduce(g, w, h, 3);
                w2 = Math.ceil(w / 2);
                h2 = Math.ceil(h / 2);
                pyrExpandInto(next, w2, h2, g, w, h, -1); // g is now this level's detail
            }
            const [RW] = dims[l];
            const R = result[l];
            const Wt = weight[l];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const mv = m[y * w + x];
                    if (mv < 1e-6) continue;
                    const o = (y * w + x) * 3;
                    const ri = y * RW + lx0 + x;
                    R[ri * 3] += g[o] * mv; R[ri * 3 + 1] += g[o + 1] * mv; R[ri * 3 + 2] += g[o + 2] * mv;
                    Wt[ri] += mv;
                }
            }
            if (l < BLEND_LEVELS) {
                m = pyrReduce(m, w, h, 1);
                g = next;
                w = w2;
                h = h2;
                lx0 /= 2;
            }
        }
    }

    let cur = prepare(0);
    let seamL = null;
    for (let i = 0; i < n; i++) {
        onProgress(`Blending sunrise ${i + 1} of ${n}…`);
        await nextFrame();
        const next = i + 1 < n ? prepare(i + 1) : null;
        const seamR = next ? findSeam(cur, next, (i + 1) * slot, Math.min(slot * 0.45, 360), H) : null;
        addPhoto(cur, seamL, seamR);
        seamL = seamR;
        cur = next;
    }

    // Collapse the pyramid back into one picture.
    onProgress('Finishing…');
    await nextFrame();
    result.forEach((R, l) => {
        const Wt = weight[l];
        for (let i = 0; i < Wt.length; i++) {
            const f = Wt[i] > 1e-6 ? 1 / Wt[i] : 0;
            R[i * 3] *= f; R[i * 3 + 1] *= f; R[i * 3 + 2] *= f;
        }
    });
    for (let l = BLEND_LEVELS - 1; l >= 0; l--) {
        const [w, h] = dims[l];
        const [w2, h2] = dims[l + 1];
        pyrExpandInto(result[l + 1], w2, h2, result[l], w, h, 1);
    }
    const out = result[0];
    canvas.width = W;
    canvas.height = H;
    const image = ctx.createImageData(W, H);
    const od = image.data;
    for (let q = 0, o = 0; q < od.length; q += 4, o += 3) {
        od[q] = out[o]; od[q + 1] = out[o + 1]; od[q + 2] = out[o + 2]; od[q + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    // A soft vignette and a quiet caption.
    const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(20,16,12,0)');
    v.addColorStop(1, 'rgba(20,16,12,0.32)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    const band = ctx.createLinearGradient(0, H * 0.7, 0, H);
    band.addColorStop(0, 'rgba(20,16,12,0)');
    band.addColorStop(1, 'rgba(20,16,12,0.55)');
    ctx.fillStyle = band;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#fffaf2';
    ctx.font = 'italic 60px "Cormorant Garamond", Georgia, serif';
    ctx.fillText('Sunrises for Wesley', W / 2, H - 84);
    ctx.font = '500 22px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,250,242,0.88)';
    const total = Math.max(all.length, n);
    const line = n === 1 ? 'The first sunrise, with more to come'
        : `${n < total ? `${n} of ${total}` : n} sunrises, blended into one`;
    ctx.fillText(line, W / 2, H - 44);
    ctx.shadowBlur = 0;
    return true;
}

// The family's bot can publish a finished blend (assets/sunrise-blend.json
// pointing at an image in assets/). When one exists it's shown instead of
// building the blend in the browser.
const SUNRISE_BLEND_MANIFEST = 'assets/sunrise-blend.json';

async function drawPublishedBlend(canvas) {
    let info;
    try {
        const res = await fetch(SUNRISE_BLEND_MANIFEST, { cache: 'no-store' });
        if (!res.ok) return null;
        info = await res.json();
    } catch {
        return null;
    }
    if (!info || typeof info.file !== 'string' || !/^[\w.-]+\.(jpe?g|png|webp)$/i.test(info.file)) return null;
    const img = await loadImageElement(`assets/${info.file}?v=${encodeURIComponent(info.updated || '')}`);
    if (!img) return null;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return info;
}

function setupSunriseBlend(items) {
    const canvas = document.getElementById('sr-mesh-canvas');
    const status = document.getElementById('sr-blend-status');
    const dl = document.getElementById('sr-mesh-download');
    const note = document.getElementById('sr-blend-note');
    if (!canvas) return () => {};

    dl.addEventListener('click', () => {
        canvas.toBlob((blob) => {
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'sunrises-for-wesley.jpg';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }, 'image/jpeg', 0.9);
    });

    let started = false;
    // Built only when the tab is first opened: it loads every photo in full.
    return async () => {
        if (started) return;
        started = true;
        dl.disabled = true;
        canvas.hidden = true;
        status.hidden = false;
        let ok = false;
        try {
            const published = await drawPublishedBlend(canvas);
            if (published) {
                ok = true;
                if (note) {
                    const n = Number(published.count);
                    const parts = [n > 0 ? `${n} ${n === 1 ? 'sunrise' : 'sunrises'} blended into one sky` : 'The sunrises shared so far, blended into one sky'];
                    if (published.updated) parts.push(`updated ${fmtShortDate(published.updated)}`);
                    note.textContent = `${parts.join(', ')}.`;
                }
            } else {
                ok = await drawBlendedSunrise(canvas, items, (msg) => { status.textContent = msg; });
            }
        } catch (err) {
            console.error(err);
        }
        canvas.hidden = !ok;
        status.hidden = ok;
        if (!ok) status.textContent = 'The blended sunrise could not be made right now.';
        dl.disabled = !ok;
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
        img.alt = item.place ? `Sunrise at ${item.place}` : 'A sunrise shared for Wesley';
        img.loading = 'lazy';
        setImageWithFallback(img, item.file, 600, figure, SUNSET_PATH);
        const cap = document.createElement('figcaption');
        cap.className = 'sunset-cap';
        const place = document.createElement('span');
        place.className = 'cap-place';
        place.textContent = item.place || 'A sunrise for Wesley';
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
        count.textContent = `${items.length.toLocaleString()} ${items.length === 1 ? 'sunrise' : 'sunrises'} shared so far`;
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
    const startMesh = setupSunriseBlend(items);

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
            if (activeView === 'mesh') startMesh();
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
    ['heart', 6, 12, 0, 22, 22], ['btc', 22, 6, 3, 18, 26], ['bear', 38, 14, 6, 24, 24],
    ['heart', 56, 9, 1, 20, 18], ['btc', 72, 16, 4, 22, 22], ['bear', 88, 8, 7, 26, 26],
    ['heart', 14, 32, 2, 18, 20], ['btc', 32, 38, 5, 24, 18], ['bear', 50, 30, 8, 20, 24],
    ['heart', 68, 36, 0, 22, 22], ['btc', 84, 32, 3, 18, 28], ['bear', 8, 52, 6, 24, 22],
    ['heart', 28, 58, 9, 20, 26], ['btc', 46, 50, 2, 22, 20], ['bear', 64, 56, 5, 18, 22],
    ['heart', 82, 50, 8, 24, 18], ['btc', 16, 78, 1, 22, 24], ['bear', 36, 84, 4, 18, 22],
    ['heart', 54, 78, 7, 22, 20], ['btc', 76, 82, 0, 26, 26], ['bear', 92, 76, 3, 20, 22],
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
        <symbol id="ic-bear" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><circle cx="5.5" cy="6" r="3"/><circle cx="18.5" cy="6" r="3"/><circle cx="9" cy="12" r="1" fill="#fff"/><circle cx="15" cy="12" r="1" fill="#fff"/></symbol>
    </defs>`;

    const layer = document.createElement('div');
    layer.className = 'floating-bg';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = FLOAT_ITEMS.map(([kind, x, y, d, r, size]) => {
        const style = `--x:${x}%;--y:${y}%;--d:${d}s;--r:${r}s;--s:${size}px`;
        const inner = kind === 'btc' ? '₿' : `<svg><use href="#ic-${kind}"/></svg>`;
        return `<span class="float-item float-${kind}" style="${style}">${inner}</span>`;
    }).join('');

    document.body.prepend(defs, layer);
}

(async function init() {
    buildFloatingBackground();
    setupIntroFly();
    setAgeLine();
    setFooterTime();
    setupRangeButtons();
    setupLightbox();
    setupReveals();
    setupCandle();
    setupShareButton();
    setupGift();
    loadSunsets();
    setupUploadForm('sunset-form', '/api/sunset',
        'Thank you. Your sunrise has been received and will join the collage after a quick look.',
        ['place', 'name']);
    setupUploadForm('photo-form', '/api/photo',
        'Thank you. Your photo has been received and will join the gallery after a quick look.',
        ['name']);
    loadHeroPhoto();
    loadLetters();
    loadMemories();
    setupMemoryForm();
    loadGallery();
    if (document.getElementById('wallet')) {
        try {
            await loadChartAdapter();
        } catch (e) {
            console.error('chart adapter failed', e);
        }
        loadWallet();
        loadChart(365);
    }
})();
