# Free recipe-chat backend (Groq)

This Worker proxies chat requests from the static GitHub Pages dashboard to Groq. The Groq
credential stays in Cloudflare as a Worker secret; it is never put in the public website.
The Worker uses Groq's `openai/gpt-oss-20b` model and streams the answer back to the browser.

Groq free-tier availability and rate limits can change. This avoids the ~1 GB browser model
download; it does mean the chat text and the few matching recipe records are sent to Groq.

## One-time setup

1. Create/sign in to a Cloudflare account and install Wrangler (`npm install -g wrangler`).
2. From this folder, run `wrangler login`.
3. Set the Groq API key as a Cloudflare secret (obtain one from the Groq console):
   `wrangler secret put GROQ_API_KEY`
4. Deploy the Worker: `wrangler deploy`.
5. Test `https://personal-recipes-chat.<your-workers-subdomain>.workers.dev/health`.
6. Rebuild the dashboard with the Worker URL, then redeploy Pages:

   ```sh
   RECIPE_CHAT_API_URL=https://personal-recipes-chat.<your-workers-subdomain>.workers.dev/chat \
     python3 pipeline/build_site.py
   GITHUB_TOKEN=... bash pipeline/deploy_pages.sh
   ```

The Worker allows browser calls only from the recipe site's GitHub Pages origin, bounds
request sizes, and applies a per-IP best-effort rate limit. That in-memory limiter is not a
strong abuse-prevention system; for wider use, add Cloudflare Turnstile or a Durable Object.

## ChatGPT fallback

ChatGPT subscriptions cannot be used as API credentials. If Groq's free allowance is not
enough, the Worker can be changed to call the OpenAI API using a separate OpenAI API key stored
as a Cloudflare secret. OpenAI API usage is billed separately from ChatGPT plans.
