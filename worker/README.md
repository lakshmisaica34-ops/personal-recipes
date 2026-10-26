# Cloudflare Workers AI chat

The dashboard chat calls this Worker, which uses Cloudflare's `@cf/openai/gpt-oss-20b`
through the built-in Workers AI binding. No model-provider key is embedded in the site.
Cloudflare's currently published free daily allocation is limited; it can change. Chat text
and matching recipe records are sent to Cloudflare for inference.

## One-time setup (Cloudflare dashboard, no terminal)

1. Sign in to Cloudflare and open **Workers & Pages → Create application → Create Worker**.
2. Name it `personal-recipes-chat`, then choose **Edit code**.
3. Replace the editor contents with `src/index.js` from this folder and deploy.
4. Open the Worker **Settings → Bindings → Add → Workers AI**. Set the variable name to `AI`,
   save, and deploy again. In **Settings → Variables**, add `ALLOWED_ORIGIN` with value
   `https://lakshmisaica34-ops.github.io`, then deploy.
5. Copy the Worker URL (ends in `.workers.dev`). Send that URL here; it is public, not a secret.

Once you provide that URL, it can be connected to the dashboard. The Worker restricts browser
origins, request size and messages, and includes a best-effort per-IP rate limit. This does not
authenticate visitors or guarantee protection from abuse; this should remain a personal site.
