// Wesley's Wallet: live data + chart
// All data is fetched from public, no-key APIs:
//   - CoinGecko: BTC price + history
//   - Blockstream:  wallet balance (when a real address is set)

const CONFIG = {
    // Replace with the real wallet address when ready.
    walletAddress: null, // e.g. 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    birth: new Date('2025-04-20T00:00:00'),
    passing: new Date('2026-04-25T00:00:00'),
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

async function loadChart(days) {
    const note = $('#chart-note');
    note.textContent = 'Loading price history…';
    try {
        const prices = await fetchPriceHistory(days);
        // Chart.js time scale needs date adapter; we draw with Date objects + linear fallback.
        renderChart(prices);
        note.textContent = '';
    } catch (e) {
        note.textContent = 'Could not load price history right now.';
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
            $('#wallet-address').textContent = CONFIG.walletAddress;
            const sats = await fetchWalletBalance(CONFIG.walletAddress);
            $('#btc-balance').textContent = fmtBTC(sats);
            $('#usd-value').textContent = fmtUSD((sats / 1e8) * price.usd);
        } else {
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
                b.removeAttribute('aria-selected');
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
const GALLERY_CACHE_KEY = 'wesley-photos-v2';
const GALLERY_CACHE_TTL = 10 * 60 * 1000;
const IMAGE_RX = /\.(jpe?g|png|webp|gif)$/i;
const MAIN_RX = /^main\./i;

async function loadGallery() {
    const grid = document.getElementById('photo-grid');
    const empty = document.getElementById('gallery-empty');
    if (!grid) return;

    let names = readPhotoCache();
    if (!names) {
        names = await fetchPhotoList();
        if (names.length) writePhotoCache(names);
    }

    const mainName = names.find((n) => MAIN_RX.test(n));
    if (mainName) {
        applyHeroPhoto(mainName);
        names = names.filter((n) => n !== mainName);
    }

    if (!names.length) {
        if (empty) empty.hidden = false;
        return;
    }

    grid.innerHTML = '';
    names.forEach((name) => {
        const figure = document.createElement('figure');
        figure.className = 'photo';
        const img = document.createElement('img');
        img.src = `assets/photos/${encodeURIComponent(name)}`;
        img.alt = 'Wesley';
        img.loading = 'lazy';
        img.addEventListener('error', () => figure.classList.add('is-missing'));
        figure.appendChild(img);
        grid.appendChild(figure);
    });
}

function applyHeroPhoto(name) {
    const container = document.getElementById('hero-photo');
    const img = document.getElementById('hero-photo-img');
    const logo = document.getElementById('hero-logo');
    if (!container || !img) return;
    img.addEventListener('load', () => {
        container.hidden = false;
        if (logo) logo.style.display = 'none';
    }, { once: true });
    img.addEventListener('error', () => {
        container.hidden = true;
    }, { once: true });
    img.src = `assets/photos/${encodeURIComponent(name)}`;
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
                .filter((f) => f.type === 'file' && IMAGE_RX.test(f.name))
                .map((f) => f.name);
            if (names.length) return names;
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
        const { t, names } = JSON.parse(raw);
        if (Date.now() - t > GALLERY_CACHE_TTL) return null;
        return Array.isArray(names) ? names : null;
    } catch {
        return null;
    }
}

function writePhotoCache(names) {
    try {
        localStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify({ t: Date.now(), names }));
    } catch {}
}

function setFooterTime() {
    $('#footer-time').textContent =
        'Last updated ' +
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

(async function init() {
    setAgeLine();
    setFooterTime();
    setupRangeButtons();
    loadGallery();
    try {
        await loadChartAdapter();
    } catch (e) {
        console.error('chart adapter failed', e);
    }
    loadWallet();
    loadChart(365);
})();
