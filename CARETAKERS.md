# Caring for Wesley's Website

This guide is for whoever looks after the site: today that is Andrew, and one
day it may be Meg and Matt, or Vada, Riley, and Jimmy. It explains what the
site is made of, the few things only a person can do, and how to keep it safe
for the years ahead.

## What the site is made of

| Piece | Where it lives | What it does |
| --- | --- | --- |
| The pages and photos | GitHub repository `PayxDre/Wesley-s-Wallet`, branch `claude/memorial-bitcoin-wallet-8wg6q` | Everything you see. Every change is saved as a commit, so nothing is ever truly lost. |
| Hosting | Cloudflare Workers, project `wesleywallet` | Publishes the branch automatically after every commit. |
| Private storage | Cloudflare KV namespace `SUBMISSIONS` | Holds new submissions until they're reviewed, and holds sealed time capsule letters. |
| The review bot | Andrew's AI bot | Checks submissions every hour and publishes the approved ones. |

### Where each kind of content goes

| What people share | Page | Published to |
| --- | --- | --- |
| Memories | Memories | `assets/memories.json` |
| Photos and videos of Wesley | Photos | `assets/photos/` |
| Wesley in the Wild moments | In the Wild | `assets/sunsets/` + `assets/sunsets.json` (with `lat`/`lon` for the map) |
| Lion-hearted acts | Kindness | `assets/acts.json` |
| Time capsule letters | Letters | **Never the repository.** Sealed in Cloudflare KV, and only shown from their opening day. |
| Events (added by the family) | Home and Support | `assets/events.json` |

Events use this format; past events hide themselves:

```json
[
  {"date": "2027-04-20", "title": "Wesley's birthday walk", "time": "10:00 AM",
   "place": "West Chester, PA", "details": "Bring a friend.", "link": "https://..."}
]
```

## Things only a person can do

### 1. Give the site its own web address

The site lives at `wesleywallet.mcgreevyandrew.workers.dev` today. Its own
address (for example `wesleyswebsite.com`) is easier to share and won't break
if hosting ever changes.

1. Buy the name. Cloudflare sells domains at cost: Cloudflare dashboard,
   **Domain Registration**, **Register Domains**. Turn on auto-renew, and
   consider paying for several years at once.
2. In **Workers & Pages**, open `wesleywallet`, then **Settings**, **Domains &
   Routes**, **Add**, **Custom domain**, and enter the name.
3. Tell whoever maintains the code, so the share links and link previews can
   point to the new address.

### 2. Make sure the family owns it, not one person

- **GitHub:** add Meg and Matt as collaborators (repository **Settings**,
  **Collaborators**), or transfer the repository to an account they control.
- **Cloudflare:** invite Meg and/or Matt as members of the Cloudflare account
  (**Manage Account**, **Members**), with Administrator access.
- **Domain:** keep a family email on the domain registration and renewal notices.
- Write down where the logins and recovery codes are kept, in a place the family
  can find (a password manager's shared vault works well).

### 3. Keep some pages family-only (optional)

If some pages feel too personal for anyone with the link, Cloudflare Access can
put a free sign-in in front of them. Visitors get a one-time code by email.

1. Cloudflare dashboard, **Zero Trust**. Choose the Free plan.
2. **Access**, **Applications**, **Add an application**, **Self-hosted**.
3. Add the pages to protect, for example `/letters.html` and `/api/letters`
   (protect both together, or the letters still show through the API).
4. Add a policy that allows the family's email addresses.

Note: Access works best on a custom domain (step 1).

### 4. The gift address

The gift address is public, so anyone can look up its history and balance on a
bitcoin explorer, even though the site no longer shows amounts. For more privacy:

- Have Meg and Matt set up their own wallet, holding the recovery phrase
  themselves, and use a fresh receiving address from it.
- Put the new address in `script.js` (`CONFIG.walletAddress`), and move the
  existing gifts to their wallet.
- Keep the signed letter of intent (that the gift belongs to Vada, Riley, and
  Jimmy) with their important papers.

### 5. Back up the sealed letters

Sealed letters live only in Cloudflare KV. A few times a year, download a backup
and keep it somewhere private (never in the GitHub repository, which is public):

```
GET https://<site>/api/letters/backup
Authorization: Bearer <BOT_KEY>
```

The bot can do this and save the file to a private family drive.

### 6. Make a keepsake book each year

Open **Make a keepsake book** in the site's footer, choose the year, then
**Print or save as PDF**. Saving one every April keeps a copy that doesn't
depend on any website.

## Keys and secrets

- `BOT_KEY` is a Cloudflare **runtime** secret on the `wesleywallet` worker
  (Settings, Variables and Secrets, type Secret). The bot uses it to review
  submissions. If it ever leaks, set a new one there and give it to the bot.
- The bot's GitHub token should only have **Contents: read and write** and
  **Metadata: read** on this one repository. Give it an expiration and renew it.
- Never paste either one into a chat, an email, or the repository.

## His days

- April 20 is Wesley's birthday, and April 25 is his remembrance day. On those
  days the home page shows a message, and the candle counts how many were lit
  that day.
- `assets/wesleys-days.ics` adds both days to anyone's calendar, every year.
