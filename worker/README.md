# Free recipe-chat backend (Cloudflare Workers AI)

This Worker sends chat requests from the static GitHub Pages dashboard to Cloudflare Workers
AI using the `@cf/openai/gpt-oss-20b` model. It needs no separate model-provider API key; the
Workers AI binding is configured in `wrangler.toml`.

Cloudflare currently includes **10,000 Neurons/day at no charge**. Based on the published
model rates (18,182 neurons per million input tokens and 27,273 per million output tokens),
that is roughly 100–200 short recipe-chat replies/day depending on prompt/history size. It is
not unlimited; once the daily allocation is used, requests fail until reset. This avoids the
~1 GB browser model download. Chat text and a few matching recipe records are sent to Cloudflare
for inference.

## One-time setup

1. Create/sign in to a Cloudflare account and install Wrangler (`npm install -g wrangler`).
2. From this folder, run `wrangler login`.
3. Deploy the Worker: `wrangler deploy`.
4. Test `https://personal-recipes-chat.<your-workers-subdomain>.workers.dev/health`.
5. Rebuild the dashboard with the Worker URL, then redeploy Pages:

   ```sh
   RECIPE_CHAT_API_URL=https://personal-recipes-chat.<your-workers-subdomain>.workers.dev/chat \
     python3 pipeline/build_site.py
   GITHUB_TOKEN=... bash pipeline/deploy_pages.sh
   ```

The Worker allows browser calls only from the recipe site's GitHub Pages origin, bounds
request sizes, and applies a per-IP best-effort rate limit. That in-memory limiter is not a
strong abuse-prevention system; for wider use, add Cloudflare Turnstile or a Durable Object.

## ChatGPT fallback

ChatGPT subscriptions cannot be used as API credentials. If Workers AI's daily free allocation
is not enough, the Worker can be changed to call the OpenAI API using a separate OpenAI API key
stored as a Cloudflare secret. OpenAI API usage is billed separately from ChatGPT plans.
