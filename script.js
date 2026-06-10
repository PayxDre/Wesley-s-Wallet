// Wesley's Wallet: live data + chart
// All data is fetched from public, no-key APIs:
//   - CoinGecko: BTC price + history
//   - Blockstream:  wallet balance (when a real address is set)

const CONFIG = {
    walletAddress: 'bc1qlqkdygyxay5w0hzgts3yxp6wautrqxtyw4h293',
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

async function fetchWalletBalance(address) {
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!res.ok) throw new Error('balance fetch failed');
    const data = await res.json();
    const sats =
        (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) +
        (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum);
    return sats;
}

async function fetchAddressTxs(address) {
    const res = await fetch(`https://blockstream.info/api/address/${address}/txs`);
    if (!res.ok) throw new Error('tx fetch failed');
    return res.json();
}

function netForAddress(tx, address) {
    let received = 0;
    let sent = 0;
    (tx.vout || []).forEach((out) => {
        if (out.scriptpubkey_address === address) received += out.value || 0;
    });
    (tx.vin || []).forEach((input) => {
        const prev = input.prevout;
        if (prev && prev.scriptpubkey_address === address) sent += prev.value || 0;
    });
    return received - sent;
}

const CONTRIB_CACHE_KEY = 'wesley-contributions-v1';
const CONTRIB_CACHE_TTL = 5 * 60 * 1000;

async function loadContributions(currentPrice) {
    if (!CONFIG.walletAddress) return;
    const container = document.getElementById('contributions');
    const list = document.getElementById('contributions-list');
    if (!container || !list) return;

    let txs;
    try {
        const cached = JSON.parse(localStorage.getItem(CONTRIB_CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.t < CONTRIB_CACHE_TTL) {
            txs = cached.txs;
        }
    } catch {}
    if (!txs) {
        try {
            txs = await fetchAddressTxs(CONFIG.walletAddress);
            try {
                localStorage.setItem(CONTRIB_CACHE_KEY, JSON.stringify({ t: Date.now(), txs }));
            } catch {}
        } catch (e) {
            console.warn('contributions fetch failed', e);
            return;
        }
    }

    const incoming = txs
        .map((tx) => ({
            txid: tx.txid,
            net: netForAddress(tx, CONFIG.walletAddress),
            confirmed: tx.status && tx.status.confirmed,
            time: tx.status && tx.status.block_time ? tx.status.block_time * 1000 : null,
        }))
        .filter((c) => c.net > 0)
        .sort((a, b) => (b.time || Date.now()) - (a.time || Date.now()))
        .slice(0, 12);

    if (!incoming.length) return;

    list.innerHTML = '';
    incoming.forEach((c) => {
        const btc = c.net / 1e8;
        const btcStr = btc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
        const usdStr = currentPrice ? fmtUSD(btc * currentPrice) : '';
        const dateStr = c.time
            ? new Date(c.time).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
              })
            : null;

        const li = document.createElement('li');
        li.className = 'contribution';
        li.innerHTML = `
            <span class="contribution-amount">+${btcStr} BTC${usdStr ? `<span class="contribution-usd">(${usdStr})</span>` : ''}</span>
            <span class="contribution-meta">
                ${dateStr ? `<span>${dateStr}</span>` : '<span class="contribution-pending">Pending</span>'}
                <a class="contribution-link" href="https://mempool.space/tx/${c.txid}" target="_blank" rel="noopener">verify ↗</a>
            </span>
        `;
        list.appendChild(li);
    });

    container.hidden = false;
}

async function fetchCurrentBlockHeight() {
    const res = await fetch('https://blockstream.info/api/blocks/tip/height');
    if (!res.ok) throw new Error('block height fetch failed');
    return parseInt(await res.text(), 10);
}

async function fetchBTCPriceAtPassing() {
    const cacheKey = 'btc-price-at-passing-2026-04-25';
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        const v = parseFloat(cached);
        if (v > 0) return v;
    }
    const dateStr = '25-04-2026';
    const url = `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${dateStr}&localization=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('historical price fetch failed');
    const data = await res.json();
    const price = data?.market_data?.current_price?.usd;
    if (!price) throw new Error('no historical price');
    localStorage.setItem(cacheKey, String(price));
    return price;
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

    // BTC price change & wallet growth
    try {
        const passPrice = await fetchBTCPriceAtPassing();
        const priceDelta = currentPrice - passPrice;
        const pricePct = (priceDelta / passPrice) * 100;
        const sign = priceDelta >= 0 ? '+' : '';
        setVal('growth-price', `${sign}${pricePct.toFixed(1)}%`, priceDelta >= 0 ? 'positive' : 'negative');
        setVal('growth-price-sub', `${sign}${fmtUSD(priceDelta)} per BTC`);

        if (currentSats > 0) {
            const btc = currentSats / 1e8;
            const valueDelta = btc * priceDelta;
            const valueAtPass = btc * passPrice;
            const valuePct = (valueDelta / valueAtPass) * 100;
            const sign2 = valueDelta >= 0 ? '+' : '';
            setVal('growth-value', `${sign2}${fmtUSD(valueDelta)}`, valueDelta >= 0 ? 'positive' : 'negative');
            setVal('growth-value-sub', `${sign2}${valuePct.toFixed(1)}% on ${btc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`);
        } else {
            setVal('growth-value', '—', '');
            setVal('growth-value-sub', 'Awaiting first deposit');
        }
    } catch (e) {
        console.warn('growth price fetch failed:', e);
        setVal('growth-price', '—', '');
        setVal('growth-value', '—', '');
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
        balancePromise = fetchWalletBalance(CONFIG.walletAddress).catch((e) => {
            console.warn('balance fetch failed:', e);
            balancePromise = null;
            return 0;
        });
    }
    return balancePromise;
}

async function loadChart(days) {
    const note = $('#chart-note');
    note.textContent = 'Loading wallet history…';
    // 'Lifetime' spans Wesley's whole life rather than all of Bitcoin's
    // history; the wallet had no value before he was born.
    if (days === 'lifetime') {
        days = Math.ceil((Date.now() - CONFIG.birth.getTime()) / 86400000);
    }
    try {
        const [prices, sats] = await Promise.all([fetchPriceHistory(days), getBalanceSats()]);
        const btc = sats / 1e8;
        if (btc <= 0) {
            note.textContent = 'Wallet is empty. Chart will fill in once funded.';
            if (chart) { chart.destroy(); chart = null; }
            return;
        }
        const walletValues = prices.map(([t, p]) => [t, btc * p]);
        renderChart(walletValues);
        note.textContent = '';
    } catch (e) {
        note.textContent = 'Could not load wallet history right now.';
        console.error(e);
    }
}

async function loadWallet() {
    try {
        const price = await fetchBTCPrice();
        $('#btc-price').textContent = fmtUSD(price.usd);
        const change = price.change24h;
        const sign = change >= 0 ? '+' : '';
        $('#btc-change').textContent = `${sign}${change.toFixed(2)}% today`;
        $('#btc-change').style.color = change >= 0 ? '#5e7a52' : '#a85a4a';

        if (CONFIG.walletAddress) {
            const addrEl = $('#wallet-address');
            addrEl.innerHTML = '';
            const a = document.createElement('a');
            a.href = `https://mempool.space/address/${CONFIG.walletAddress}`;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = CONFIG.walletAddress;
            addrEl.appendChild(a);
            const sats = await getBalanceSats();
            $('#btc-balance').textContent = fmtBTC(sats);
            $('#usd-value').textContent = fmtUSD((sats / 1e8) * price.usd);
            loadGrowthMetrics(sats, price.usd);
            loadContributions(price.usd);
        } else {
            loadGrowthMetrics(0, price.usd);
            $('#btc-balance').textContent = '… BTC';
            $('#usd-value').textContent = 'Awaiting wallet';
        }
    } catch (e) {
        console.error(e);
    }
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
const GALLERY_BRANCHES = ['main', 'master', 'claude/memorial-bitcoin-wallet-8wg6q'];
let galleryBranch = GALLERY_BRANCHES[0];
const GALLERY_CACHE_KEY = 'wesley-photos-v7';
const GALLERY_CACHE_TTL = 10 * 60 * 1000;
const IMAGE_RX = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO_RX = /\.(mp4|webm|ogg)$/i;
const MEDIA_RX = /\.(jpe?g|png|webp|gif|mp4|webm|ogg)$/i;
const POSTER_RX = /-poster\.(jpe?g|png|webp)$/i;
const MAIN_RX = /^main\./i;
const FEATURED_RX = /^featured\./i;

async function loadGallery() {
    const grid = document.getElementById('photo-grid');
    const empty = document.getElementById('gallery-empty');
    if (!grid) return;

    let names = readPhotoCache();
    if (!names) {
        names = await fetchPhotoList();
        if (names.length) writePhotoCache(names);
    }

    // Posters live alongside videos; never display them as standalone tiles.
    const allNames = names.slice();
    const posters = new Set(allNames.filter((n) => POSTER_RX.test(n)));
    names = allNames.filter((n) => !POSTER_RX.test(n));

    const mainName = names.find((n) => MAIN_RX.test(n) && IMAGE_RX.test(n));
    if (mainName) {
        applyHeroPhoto(mainName);
        names = names.filter((n) => n !== mainName);
    }

    const featuredName = names.find((n) => FEATURED_RX.test(n) && IMAGE_RX.test(n));
    if (featuredName) {
        applyFeaturedPhoto(featuredName);
        names = names.filter((n) => n !== featuredName);
    }

    // Sort by a stable hash of the filename so consecutive shutter frames
    // (e.g. IMG_2560 and IMG_3580) don't end up next to each other.
    names.sort((a, b) => stableHash(a) - stableHash(b));

    if (!names.length) {
        if (empty) empty.hidden = false;
        return;
    }

    grid.innerHTML = '';
    names.forEach((name) => {
        const figure = document.createElement('figure');
        figure.className = 'photo';
        let element;
        if (VIDEO_RX.test(name)) {
            figure.classList.add('photo--video');
            element = document.createElement('video');
            element.src = `assets/photos/${encodeURIComponent(name)}`;
            element.autoplay = true;
            element.loop = true;
            element.muted = true;
            element.defaultMuted = true;
            element.playsInline = true;
            element.setAttribute('muted', '');
            element.setAttribute('playsinline', '');
            element.preload = 'auto';
            const posterName = findPosterFor(name, posters);
            if (posterName) element.poster = `assets/photos/${encodeURIComponent(posterName)}`;
            element.addEventListener('error', () => figure.classList.add('is-missing'));
        } else {
            element = document.createElement('img');
            element.alt = 'Wesley';
            element.loading = 'lazy';
            setImageWithFallback(element, name, 700, figure);
            element.addEventListener('click', () => openLightbox(localPhotoURL(name)));
        }
        figure.appendChild(element);
        grid.appendChild(figure);
    });
}

function localPhotoURL(name) {
    return `assets/photos/${encodeURIComponent(name)}`;
}

// Originals straight off the phone run 2-4 MB each; with a wall of them the
// page costs tens of megabytes. Serve gallery thumbnails through the free
// wsrv.nl resizing proxy (reading from raw.githubusercontent.com), and fall
// back to the local original if the proxy is ever unreachable.
function thumbPhotoURL(name, width) {
    const raw = `https://raw.githubusercontent.com/${GALLERY_REPO}/${galleryBranch}/${GALLERY_PATH}/${name}`;
    return `https://wsrv.nl/?url=${encodeURIComponent(raw)}&w=${width}&q=78&output=jpg`;
}

function setImageWithFallback(img, name, width, figure) {
    let triedLocal = false;
    img.addEventListener('error', () => {
        if (!triedLocal) {
            triedLocal = true;
            img.src = localPhotoURL(name);
        } else if (figure) {
            figure.classList.add('is-missing');
        }
    });
    img.src = thumbPhotoURL(name, width);
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

function cleanupIntroFly() {
    setTimeout(() => {
        const el = document.getElementById('intro-fly');
        if (el) el.remove();
    }, 9500);
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
    if (!container) return;

    let letters = [];
    try {
        const res = await fetch('assets/letters.json', { cache: 'no-cache' });
        if (res.ok) letters = await res.json();
    } catch (e) {
        console.warn('letters fetch failed', e);
    }

    if (!Array.isArray(letters) || letters.length === 0) {
        container.innerHTML =
            '<p class="letters-empty">No letters have been sealed yet. ' +
            'Family members can add letters to <code>assets/letters.json</code> with a ' +
            'recipient, sender, title, body, and an unlock date.</p>';
        return;
    }

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

function setupMemoryForm() {
    const form = document.getElementById('memory-form');
    if (!form) return;

    // If the Formspree action hasn't been set yet, swap the form for a
    // gentle 'coming soon' note instead of letting submissions fail silently.
    if (form.action.includes('YOUR_FORMSPREE_ID')) {
        const placeholder = document.createElement('p');
        placeholder.className = 'form-pending';
        placeholder.textContent = 'The sharing form is coming online soon.';
        form.replaceWith(placeholder);
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const note = form.querySelector('.form-note');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';

        try {
            const res = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json' },
            });
            if (res.ok) {
                const success = document.createElement('p');
                success.className = 'form-success';
                success.textContent = 'Thank you. Your memory has been received and will appear here after a brief review.';
                form.replaceWith(success);
            } else {
                throw new Error('submit failed');
            }
        } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            if (note) {
                note.textContent = 'Sorry, we could not send your message. Please try again in a moment.';
                note.style.color = '#a85a4a';
            }
        }
    });
}

function openLightbox(src) {
    const box = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    if (!box || !img) return;
    img.src = src;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const box = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    if (!box) return;
    box.hidden = true;
    if (img) img.src = '';
    document.body.style.overflow = '';
}

function setupLightbox() {
    const box = document.getElementById('lightbox');
    if (!box) return;
    box.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !box.hidden) closeLightbox();
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

(async function init() {
    cleanupIntroFly();
    setAgeLine();
    setFooterTime();
    setupRangeButtons();
    setupLightbox();
    setupReveals();
    setupCandle();
    loadLetters();
    loadMemories();
    setupMemoryForm();
    loadGallery();
    try {
        await loadChartAdapter();
    } catch (e) {
        console.error('chart adapter failed', e);
    }
    loadWallet();
    loadChart(365);
})();
