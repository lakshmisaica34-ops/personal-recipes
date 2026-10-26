# OpenRouter free-model chat (via Cloudflare Worker)

The dashboard chat calls this Worker, which proxies to OpenRouter's NVIDIA Nemotron 3 Ultra
550B free endpoint (`nvidia/nemotron-3-ultra-550b-a55b:free`).
The OpenRouter API key stays in a Cloudflare Worker secret, never in the public website. The
explicit `:free` model ID prevents routing to paid models; this Worker does not configure paid
fallbacks. OpenRouter currently limits free-model requests to 50/day and 20/minute for accounts
that have purchased under $10 in credits. Actual model availability and provider-side limits
vary. Chat text and matching recipe records are sent to OpenRouter and its selected provider.

## Setup (Cloudflare dashboard, no terminal)

1. Sign in to Cloudflare and open **Workers & Pages → Create application → Create Worker**.
2. Name it `personal-recipes-chat`, then choose **Edit code**.
3. Replace the editor contents with `src/index.js` from this folder and deploy.
4. In **Settings → Variables and Secrets**, add `OPENROUTER_API_KEY` as a secret and
   `ALLOWED_ORIGIN` as a text variable with value `https://lakshmisaica34-ops.github.io`.
   Redeploy after saving.
5. Copy the Worker URL (ends in `.workers.dev`).

The Worker restricts browser origins, request size and messages, and includes a best-effort
per-IP rate limit. This does not authenticate visitors or guarantee protection from abuse;
this should remain a personal site.
