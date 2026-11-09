# Wesley's Wallet

A memorial site for Wesley.
*April 20, 2025 to April 25, 2026.*

A small, static website that holds a quiet record of bitcoin set aside in his memory, alongside photos and the story of his life.

## What's here

- `index.html`: page structure (hero, wallet, gallery, story, memories, footer)
- `styles.css`: warm cream + gold + sage palette, soft serif headings
- `script.js`: fetches live BTC price, wallet balance, and historical chart
- `assets/photos/`: drop photos here (jpg/png), then add them in `index.html`

## Things to fill in

In `script.js`, set:

```js
const CONFIG = {
    walletAddress: 'bc1q...', // <-- the real address
    ...
};
```

In `index.html`:

- Replace the placeholder photo tiles in `#photo-grid` with `<img src="assets/photos/your-photo.jpg" alt="..." />` wrapped in a `<div class="photo">`.
- Fill in **His Story** when ready.
- Fill in **A Memory Wall** (later: a real submission form, see below).

## How the data works

- **BTC price**: [CoinGecko](https://www.coingecko.com/en/api) public API, no key needed.
- **Wallet balance**: [Blockstream](https://blockstream.info/) public API, no key needed.
- **Price chart**: CoinGecko market chart endpoint, rendered with Chart.js.

All requests happen in the browser. No backend.

## Deploying (free)

Easiest options:

1. **GitHub Pages**: push to `main` and enable Pages in repo settings.
2. **Netlify / Vercel / Cloudflare Pages**: drag-and-drop the folder, or connect the repo.

For a custom domain (`wesleyswallet.com` or similar), buy from any registrar and point DNS to the host.

## Future ideas

- **Memory wall with submissions**: needs a tiny backend or a service like Formspree / Firebase.
- **Milestones on the chart**: birthdays, anniversaries, family events as markers.
- **Charity link**: direct visitors to a cause in Wesley's name.
- **QR code** for the wallet address so people can contribute easily.
- **"In his lifetime" counter**: days, hours since his birth.

## Local preview

Just open `index.html` in a browser, or run a tiny server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```
