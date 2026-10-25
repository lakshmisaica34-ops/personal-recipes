# From personal scraper to app backend

How the extraction pipeline in this repo turns into the ingestion layer of a public app,
and why "connect your Instagram" cannot be the main flow.

## 1. The constraint that shapes everything

**Instagram has no API for a user's saved posts.** Not for personal accounts, not for
professional ones. The "saved" collection exists only in the mobile/web client. That means:

- Even with every permission granted and app review passed, you cannot read a user's saved
  reels on their behalf.
- The reason the pipeline in this repo works is that it reuses a *browser session cookie* and
  calls the same private web endpoints the Instagram web app calls. It is impersonating the
  user's browser, not using an API.
- Asking users to hand over cookies is a non-starter for a consumer app: it is a credential,
  it breaks constantly, and one flagged account takes the whole feature down (we already hit a
  spam-flag on this account while probing `media-info`).

Consequence: **the unit of ingestion is a public post URL, not a user's saved list.**
Someone has to point at a reel — by sharing it, by pasting it, or by having a creator publish
it to us directly.

## 2. What the official APIs actually give you

| Route | Reads | Gives video bytes? | Verdict |
|---|---|---|---|
| Instagram API with Instagram Login | only the connecting user's own media, professional accounts only | yes, own media | useless for other people's reels |
| Business Discovery (Facebook Login) | public **professional** accounts' media metadata | **no** — `media_url` is omitted for video with licensed audio, and for reels whose owner disabled downloads | good for captions/creator tracking, not for frames |
| oEmbed | embed HTML for a public post | no | not an ingestion path |
| Saved posts | — | — | does not exist |

Business Discovery is still useful: for the 493 creators already in this dataset you can poll
their public media, get `caption`, `permalink`, `media_type`, `timestamp` and `thumbnail_url`
at ~200 calls/hour per connected professional account. Captions alone already produced 647 of
the 1,044 dishes here (62%), so a "follow these creators" feature can run entirely on the
official API with zero scraping risk. The reels that need frames need another route.

Platform policy also matters: media fetched through the API may not be stored, must be
attributed, and must be deleted on request. So store the *extracted recipe* plus the permalink,
not the video.

## 3. Ingestion options, cheapest risk first

### A. Share sheet → URL → resolve server-side  *(MVP)*
The user taps Share in Instagram and picks your app. You receive a URL like
`instagram.com/reel/DdIurvitW1A/`. You already know everything you need from the shortcode
(`DdIurvitW1A`), so:

1. normalise to a shortcode,
2. look it up in the global cache,
3. if missing, enqueue an extraction job,
4. stream the reel, sample keyframes + audio, call Gemini, validate, store.

No password, no cookie, no download by the user. This is the flow to build first; it also
works from a paste box, a WhatsApp forward, or a web form.

### A2. Share the reel to a business account's DMs  *(the version you proposed)*

A user taps Share → Send to → `@yourapp`. A professional Instagram account receives the DM and
Meta posts it to your webhook. No password, no extension, no app install.

The payload for a shared post (since Feb 2026, attachment type `ig_post`) looks like:

```json
{ "type": "ig_post",
  "payload": {
    "ig_post_media_id": "18139494541428835",
    "title": "the post caption, verbatim",
    "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=..." } }
```

Three useful things fall out of that:

1. **The caption arrives for free.** `title` is the post caption. In this corpus captions alone
   already give complete ingredients for 62% of dishes, so a large share of DMs need no media
   fetch at all.
2. **The permalink is derivable.** `ig_post_media_id` → shortcode is a base64 variant of the
   numeric id; verified 432/432 against the media ids in `work/video_results.jsonl`. So you can
   rebuild `instagram.com/reel/<shortcode>/` deterministically, and key the cache by shortcode.
3. **The sender id identifies the user**, so the recipe lands in the right account.

What it does **not** give is the video bytes: `url` is a lookaside CDN asset (preview image),
not the MP4. So the DM route replaces *URL discovery*, not the fetch step — you still need a
resolver (B) for the ~38% of reels whose caption is not enough.

Requirements and limits:

- Professional account (Business or Creator), connected to a Meta app.
- Permissions `instagram_business_basic` + `instagram_business_manage_messages`; production use
  means app review (screencast, privacy policy, business verification), typically weeks.
- HTTPS webhook: echo `hub.challenge` on verification, validate `X-Hub-Signature-256`,
  acknowledge in <5 s and process asynchronously.
- 24-hour reply window (longer with message tags), so send the "recipe saved" link promptly.
- The author of the shared reel may be private — then only the caption is usable.
- Discoverability is the real UX problem: `https://ig.me/m/<handle>` deep-links straight into
  the DM thread, which is what an "Add a recipe" button should open.

### B. Managed scraper for the fetch step
Your own server fetching Instagram from a datacenter IP gets login-walled within requests.
Apify / Bright Data / ScrapeCreators solve exactly that one problem: give them a URL or
username, get back post JSON including a playable video URL.

- ~$1.50–2.70 per 1,000 posts (Apify `instagram-scraper`, 2026 pricing), i.e. **$0.0015–0.0027
  per reel**.
- Add your extraction cost: **$0.0009 per reel** (frames + audio, measured in this repo).
- **All-in ≈ $0.0025–0.0036 per recipe** — about the price of one whole-video Gemini pass,
  but with no cookies and no burned accounts.

Put this behind an interface (`resolvePost(url) -> {videoUrl, caption, author, ...}`) so it can
be swapped for your own fetch pool later.

### C. Browser extension for bulk import  *(the honest answer to "users won't upload their data")*
A Chrome extension with a content script on `instagram.com` can, while the user browses their
own saved collection, read the post URLs off the page and send only those URLs to your backend.
The user never exports a file and never shares a password, and your server never holds their
session — the browser does the authenticated reading. It is still user-initiated scraping of
their own account, so keep it explicit, rate-limited, and off until the user clicks Import.
Best paired with A: extension for the backlog, share sheet for new finds.

### D. Creator self-publish  *(long-term, zero scraping)*
Creators claim their handle, we attribute the existing cards to them, and they publish
structured recipes (or approve the auto-extracted one). This is the only path that gives you
rights, corrections, and a reason for creators to send traffic your way. It also removes the
takedown problem: the creator is the source.

## 4. Backend shape

```
POST /ingest {url}            -> {shortcode, status: cached|queued, recipe?}
GET  /r/:shortcode            -> recipe JSON (public permalink for sharing)
queue: ingest -> resolve -> frames+audio -> Gemini -> validate -> merge -> index
```

Rules that matter:

- **One extraction per shortcode, ever.** The cache is global and shared across users; the
  1,044 dishes here are already a cache for the reels your first users will paste.
- **Idempotent + resumable.** Current scripts are already append-only with a done-set, which is
  exactly what a queue needs (`work/*.jsonl` → Postgres/Redis later).
- **Version the extractor.** Store `extraction_version` with each recipe; re-extraction is
  $0.0009/reel, so a prompt or model upgrade can be replayed over the whole corpus for pennies
  per thousand.
- **Per-job cost ledger.** Already built (`video_log.csv`); it is the thing that tells you
  whether a new method is worth it.
- **Never store the video.** Download to tmp, extract, delete. Store permalink, creator,
  thumbnail URL, structured ingredients/steps in both languages, and the source method
  (`caption | frames | video`) so quality is auditable.
- **Dedupe across users.** Two users sharing the same dish from different reels should merge
  into one card with two source links — the merge logic in `pipeline/build_site.py` already
  does this by normalised dish name.
- **Attribution + deletion.** Every card links to the reel and the creator; a creator deletion
  request must remove the card and blacklist the shortcode.

### Tooling that plugs in

| Job | Options | Notes |
|---|---|---|
| Receive the share | Instagram Messaging API (official, free) | the only programmatic way into a DM inbox; Meta Business Suite has no public inbox API |
| Same, without owning the review | ManyChat, Respond.io, Unipile | they hold the Meta app; check they forward the `ig_post` attachment, otherwise ask users to paste the link as text |
| Resolve a URL to media | Apify `instagram-scraper`, ScrapeCreators, Bright Data, HikerAPI | $0.0015–0.0027/post; interface it so it is swappable |
| Caption/metadata for professional authors | Business Discovery (Graph API) | free, 200 calls/hr per connected account, no video bytes |
| Queue + cache | Postgres/Supabase + BullMQ/Redis or pg-boss | the current append-only JSONL done-set is the same idea |
| Extraction | this repo (`video_extract_stills.mjs`) | frames + audio, $0.0009/reel, ~25 s |
| Reply to the user | Send API | web link to the recipe card, must land inside the 24 h window |

## 5. What I would do, in order

1. **Now:** business account + DM ingestion (A2) as the front door, Apify (or similar) as the
   resolver, this pipeline as the extractor, shortcode cache. ~$0.0015–0.002/recipe blended,
   because the caption arrives in the webhook and only ~38% of reels need a media fetch.
2. **Next:** follow-the-creator via Business Discovery for the 493 creators already indexed —
   free captions, auto-refresh, no scraping.
3. **Then:** extension import for a user's existing saved collection (URLs only).
4. **Later:** creator claim + self-publish, which is what makes the data durable and legal.

## 6. What does *not* work, so nobody re-tries it

- "Log in with Instagram and we'll import your saves" — no such API.
- Reading another user's reel video through the official API — `media_url` is withheld for
  licensed-audio video, which is nearly every recipe reel.
- Server-side logged-out scraping at any volume — login wall on datacenter IPs, and the account
  gets flagged when it does get through.
- Asking users for their session cookie — works technically (this repo proves it), fails as a
  product.
