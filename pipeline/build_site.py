#!/usr/bin/env python3
"""Build the published recipe collection from caption + video extraction results.

Inputs
  work/caption_merged.jsonl   every classified post (caption pass)
  work/video_results.jsonl    per-video Gemini extractions
  work/video_cost.json        cost/time summary (optional)

Outputs
  docs/index.html   self-contained searchable collection (works offline)
  docs/recipes.json full structured data
  docs/recipes.csv  flat export
  docs/costs.json   per-video cost + timing log
"""
import collections
import csv
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTIONS = os.path.join(ROOT, "work/caption_merged.jsonl")
VIDEOS = os.path.join(ROOT, "work/video_results.jsonl")
ING_PATCHES = [
    os.path.join(ROOT, "work/batches/out_noing_01.jsonl"),
    os.path.join(ROOT, "work/batches/out_gap_ing_1.jsonl"),
    os.path.join(ROOT, "work/batches/out_gap_ing_2.jsonl"),
    os.path.join(ROOT, "work/batches/out_gap_ing_3.jsonl"),
]
TITLE_PATCH = os.path.join(ROOT, "work/batches/out_gap_title.jsonl")
LOG = os.path.join(ROOT, "work/video_log.jsonl")
CHAT_API_URL = os.environ.get("RECIPE_CHAT_API_URL", "")
SITE = os.path.join(ROOT, "docs")
os.makedirs(SITE, exist_ok=True)

STOPWORDS = {
    "recipe", "recipes", "easy", "quick", "instant", "homemade", "simple", "best",
    "healthy", "high", "protein", "proteins", "fibre", "fiber", "veg", "vegetarian",
    "indian", "style", "the", "a", "an", "my", "our", "of", "and", "with", "for",
    "authentic", "traditional", "perfect", "ultimate", "super", "tasty", "yummy",
    "delicious", "special", "new", "style", "version", "at", "home", "make", "how",
}


def norm_key(text):
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r"['’]s\b", "", t)          # possessives: amma's -> amma
    t = re.sub(r"[^a-z0-9\u0900-\u0DFF]+", " ", t)
    words = []
    for w in t.split():
        if w in STOPWORDS:
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        words.append(w)
    return " ".join(words) or t.strip()


def load_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def merge_ingredients(a, b):
    """Union by English item name, preferring entries that carry a quantity."""
    out = {}
    for ing in list(a) + list(b):
        item = (ing.get("item") or "").strip()
        en = (ing.get("item_en") or item).strip()
        if not en:
            continue
        k = norm_key(en) or en.lower()
        cur = out.get(k)
        if cur is None:
            out[k] = {"item": item, "quantity": (ing.get("quantity") or "").strip(), "item_en": en}
        else:
            if not cur["quantity"] and (ing.get("quantity") or "").strip():
                cur["quantity"] = ing["quantity"].strip()
            if not cur["item"] and item:
                cur["item"] = item
    return list(out.values())


def build():
    captions = {r["code"]: r for r in load_jsonl(CAPTIONS)}
    videos = {r["code"]: r for r in load_jsonl(VIDEOS) if not r.get("error")}
    ing_patch = {}
    for path in ING_PATCHES:
        for r in load_jsonl(path):
            ings = r.get("ingredients") or []
            if ings:
                ing_patch[r["code"]] = ings
    title_patch = {r["code"]: r for r in load_jsonl(TITLE_PATCH)}

    records = []
    for code, cap in captions.items():
        if not cap.get("food_post"):
            continue
        vid = videos.get(code)
        if vid is not None and not vid.get("is_recipe"):
            continue  # model confirmed there is no recipe on camera

        ingredients = cap.get("ingredients") or []
        if not ingredients:
            ingredients = ing_patch.get(code) or []
        steps = cap.get("steps") or []
        steps_en = cap.get("steps_en") or []
        source = "caption"
        cost = seconds = None
        if vid is not None:
            source = vid.get("source") or "video"
            ingredients = merge_ingredients(ingredients, vid.get("ingredients") or [])
            if vid.get("steps"):
                steps = vid["steps"]
                steps_en = vid.get("steps_en") or []
            cost = (vid.get("usage") or {}).get("cost_usd")
            seconds = (vid.get("timings") or {}).get("total_s")
        elif cap.get("source") == "video":
            source = "video"

        tp = title_patch.get(code) or {}
        dish = cap.get("dish") or tp.get("dish") or ""
        dish_en = cap.get("dish_en") or tp.get("dish_en") or ""
        if vid is not None:
            dish = vid.get("dish") or dish
            dish_en = vid.get("dish_en") or dish_en

        # the collection is title-first: a named dish is enough to include the post
        if not (dish or dish_en) and not ingredients and not steps:
            continue  # nothing usable extracted

        records.append({
            "code": code,
            "dish": dish,
            "dish_en": dish_en,
            "language": (vid or {}).get("language") or (cap.get("language") if cap.get("language") not in (None, "", "unknown") else "") or tp.get("language") or "",
            "creator": cap.get("username") or "",
            "creator_name": cap.get("full_name") or "",
            "permalink": cap.get("permalink") or f"https://www.instagram.com/p/{code}/",
            "thumbnail": ("thumbs/" + code + ".jpg") if os.path.exists(os.path.join(SITE, "thumbs", code + ".jpg")) else (cap.get("thumbnail_url") or ""),
            "taken_at": cap.get("taken_at"),
            "duration_s": cap.get("duration_s"),
            "ingredients": ingredients,
            "steps": steps,
            "steps_en": steps_en,
            "source": source,
            "confidence": (vid or {}).get("confidence"),
            "cost_usd": cost,
            "seconds": round(seconds, 1) if seconds else None,
            "frames": (vid or {}).get("frames"),
        })

    # ---- conservative duplicate merge: same normalised English dish name ----
    groups = collections.defaultdict(list)
    for r in records:
        groups[norm_key(r["dish_en"] or r["dish"])].append(r)

    merged = []
    for key, rows in groups.items():
        rows.sort(key=lambda r: (len(r["steps"]), len(r["ingredients"]), len(r["steps_en"])), reverse=True)
        primary = dict(rows[0])
        variants = []
        for other in rows:
            variants.append({
                "creator": other["creator"],
                "permalink": other["permalink"],
                "dish": other["dish"],
                "dish_en": other["dish_en"],
                "language": other["language"],
                "ingredients": other["ingredients"],
                "steps": other["steps"],
                "steps_en": other["steps_en"],
                "source": other["source"],
            })
        if len(rows) > 1:
            primary["variants"] = variants
        primary["dupe_key"] = key
        merged.append(primary)

    # merged records with no dish name at all are noise
    merged = [m for m in merged if (m["dish"] or m["dish_en"])]
    merged.sort(key=lambda r: norm_key(r["dish_en"] or r["dish"]))

    cost_log = []
    cum_cost = cum_time = 0.0
    for v in sorted(videos.values(), key=lambda r: r.get("at") or ""):
        t = v.get("timings") or {}
        u = v.get("usage") or {}
        cum_cost += u.get("cost_usd") or 0
        cum_time += t.get("total_s") or 0
        cost_log.append({
            "n": len(cost_log) + 1,
            "code": v["code"],
            "username": v.get("username"),
            "dish": v.get("dish") or v.get("dish_hint") or "",
            "at": v.get("at"),
            "frames": v.get("frames"),
            "duration_s": round(v.get("duration_s") or 0, 1),
            "video_mb": round((v.get("video_bytes") or 0) / 1e6, 2),
            "download_s": round(t.get("download_s") or 0, 1),
            "encode_s": round(t.get("encode_s") or 0, 1),
            "api_s": round(t.get("api_s") or 0, 1),
            "total_s": round(t.get("total_s") or 0, 1),
            "video_tokens": u.get("video_tokens"),
            "audio_tokens": u.get("audio_tokens"),
            "cost_usd": u.get("cost_usd"),
            "cost_total_usd": round(cum_cost, 6),
            "time_total_s": round(cum_time, 1),
            "is_recipe": v.get("is_recipe"),
        })

    summary = {
        "recipes": len(merged),
        "source_posts": len(records),
        "with_ingredients": sum(1 for m in merged if m["ingredients"]),
        "with_steps": sum(1 for m in merged if m["steps"] or m["steps_en"]),
        "title_only": sum(1 for m in merged if not m["ingredients"]),
        "duplicate_groups": sum(1 for m in merged if m.get("variants")),
        "from_caption": sum(1 for m in merged if m["source"] == "caption"),
        "from_video": sum(1 for m in merged if m["source"] == "video"),
        "from_stills": sum(1 for m in merged if m["source"] == "stills"),
        "creators": len({m["creator"] for m in merged}),
        "languages": dict(collections.Counter(m["language"] or "unknown" for m in merged).most_common()),
        "videos_processed": len(cost_log),
        "video_cost_usd": round(sum(c["cost_usd"] or 0 for c in cost_log), 4),
        # actual spend includes videos that were re-read; cost_log keeps one row per post
        "extractions": max(len(cost_log), len(load_jsonl(LOG))),
        "total_spend_usd": round(sum((r.get("cost_usd") or 0) for r in load_jsonl(LOG)) or
                                 sum(c["cost_usd"] or 0 for c in cost_log), 4),
        "video_time_s": round(sum(c["total_s"] for c in cost_log), 1),
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    json.dump(merged, open(os.path.join(SITE, "recipes.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(cost_log, open(os.path.join(SITE, "costs.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(summary, open(os.path.join(SITE, "summary.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    cost_cols = ["n", "at", "code", "username", "dish", "duration_s", "frames", "video_mb",
                 "download_s", "encode_s", "api_s", "total_s", "video_tokens",
                 "audio_tokens", "cost_usd", "cost_total_usd", "time_total_s", "is_recipe"]
    with open(os.path.join(SITE, "costs.csv"), "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cost_cols)
        for r in cost_log:
            w.writerow([r.get(c) for c in cost_cols])

    with open(os.path.join(SITE, "recipes.csv"), "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["code", "dish", "dish_en", "language", "creator", "permalink",
                    "ingredients", "steps", "steps_en", "source", "cost_usd", "seconds"])
        for r in merged:
            w.writerow([
                r["code"], r["dish"], r["dish_en"], r["language"], r["creator"], r["permalink"],
                "; ".join(f'{i["quantity"]} {i["item"]}'.strip() for i in r["ingredients"]),
                " | ".join(r["steps"]), " | ".join(r["steps_en"]),
                r["source"], r["cost_usd"], r["seconds"],
            ])

    html = render_html(merged, summary, cost_log)
    open(os.path.join(SITE, "index.html"), "w", encoding="utf-8").write(html)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


def render_html(recipes, summary, costs):
    data = json.dumps(recipes, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    cdata = json.dumps(costs, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    sdata = json.dumps(summary, ensure_ascii=False)
    return (TEMPLATE.replace("__DATA__", data).replace("__COSTS__", cdata)
            .replace("__SUMMARY__", sdata).replace("__CHAT_API_URL__", json.dumps(CHAT_API_URL)))


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>My Recipe Collection</title>
<meta name="theme-color" content="#12100e">
<style>
  :root{
    --bg:#12100e; --card:#1c1917; --card2:#242019; --line:#332d26;
    --text:#f2ece4; --muted:#a89c8d; --accent:#e8a33d; --accent2:#8fbf6a;
    --radius:14px;
  }
  @media (prefers-color-scheme: light){
    :root{--bg:#faf7f2;--card:#fff;--card2:#f3ede3;--line:#e5dccd;--text:#231f1a;--muted:#7a6f60;--accent:#b26b12;--accent2:#4b7a2b;}
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Telugu","Noto Sans Devanagari",sans-serif;
    -webkit-text-size-adjust:100%}
  header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);
    backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:10px 14px calc(10px)}
  h1{font-size:17px;margin:0 0 8px;letter-spacing:.2px;font-weight:650}
  h1 span{color:var(--muted);font-weight:400;font-size:13px}
  .nav{display:flex;gap:6px;margin:0 0 9px}
  .nav button{flex:1;background:var(--card);border:1px solid var(--line);color:var(--muted);border-radius:9px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer}
  .nav button.active{background:var(--accent);border-color:var(--accent);color:#1b1408}
  .view{display:none}.view.active{display:block}
  .searchrow{display:flex;gap:8px}
  input[type=search]{flex:1;min-width:0;background:var(--card);border:1px solid var(--line);color:var(--text);
    border-radius:10px;padding:11px 12px;font-size:16px;outline:none}
  input[type=search]:focus{border-color:var(--accent)}
  select{background:var(--card);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:11px 8px;font-size:14px}
  .chips{display:flex;gap:6px;overflow-x:auto;padding:9px 0 2px;scrollbar-width:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{white-space:nowrap;border:1px solid var(--line);background:var(--card);color:var(--muted);
    padding:6px 11px;border-radius:999px;font-size:12.5px;cursor:pointer;user-select:none}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#1b1408;font-weight:600}
  main{padding:12px 14px 80px;max-width:1280px;margin:0 auto}
  .count{color:var(--muted);font-size:12.5px;margin:2px 0 10px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;min-width:0}
  .head{cursor:pointer;display:flex;flex-direction:column;gap:0;align-items:stretch;height:100%}
  .thumb{width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--card2);display:block}
  .no-thumb{width:100%;aspect-ratio:1/1;display:grid;place-items:center;background:var(--card2);color:var(--muted);font-size:42px}
  .names{padding:9px 10px 11px;min-width:0;position:relative}
  .dish{font-size:14px;font-weight:650;line-height:1.3;word-break:break-word}
  .dish-sub{font-size:12px;color:var(--muted);margin-top:2px;word-break:break-word}
  .meta{font-size:11px;color:var(--muted);margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .meta a{color:var(--accent);text-decoration:none}
  .badge{background:var(--card2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:10.5px}
  .badge.vid{border-color:var(--accent2);color:var(--accent2)}
  .arrow{display:none}
  .body{display:none;padding:0 12px 14px;border-top:1px solid var(--line)}
  .card.open .body{display:block}
  .sect{font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);margin:14px 0 7px;font-weight:600}
  ul.ing{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr;gap:1px}
  ul.ing li{display:flex;gap:10px;padding:5px 0;border-bottom:1px dashed var(--line);font-size:14px}
  ul.ing .q{color:var(--accent);min-width:64px;font-variant-numeric:tabular-nums;flex-shrink:0}
  ul.ing .en{color:var(--muted);font-size:12px;margin-left:auto;text-align:right;max-width:45%}
  ol.steps{margin:0;padding-left:20px}
  ol.steps li{margin:0 0 8px;font-size:14.5px;line-height:1.5}
  ol.steps li .tr{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
  .toggle{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:10px}
  .toggle button{background:transparent;border:0;color:var(--muted);padding:6px 12px;font-size:12.5px;cursor:pointer}
  .toggle button.on{background:var(--card2);color:var(--text)}
  .variants{margin-top:6px}
  .variant{border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:7px;background:var(--card2)}
  .variant .vhead{font-size:12.5px;color:var(--muted);margin-bottom:5px}
  .variant .vhead a{color:var(--accent);text-decoration:none}
  .proc{font-size:11.5px;color:var(--muted);margin-top:12px;border-top:1px dashed var(--line);padding-top:8px;line-height:1.6}
  .empty{text-align:center;color:var(--muted);padding:50px 20px;font-size:14px}
  .stats{font-size:12px;color:var(--muted);line-height:1.7;margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
  .stats b{color:var(--text)}
  .chat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin:0 0 14px}
  .chat-title{font-size:14px;font-weight:650;margin-bottom:5px}
  .chat-hint{font-size:12px;color:var(--muted);margin-bottom:9px}
  .chat-tools{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  .chat-tools button{background:var(--card2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer}
  #chat-status{font-size:12px;color:var(--muted)}
  .chatrow{display:flex;gap:8px}.chatrow input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:10px 11px;font-size:15px}
  .chatrow button{background:var(--accent);color:#1b1408;border:0;border-radius:9px;padding:0 14px;font-weight:650;cursor:pointer}
  .chatrow button:disabled,.chatrow input:disabled{opacity:.5;cursor:not-allowed}
  #chat-log{display:flex;flex-direction:column;gap:8px;margin:8px 0;max-height:420px;overflow:auto}
  .bubble{max-width:88%;padding:9px 11px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
  .bubble.user{align-self:flex-end;background:var(--card2)}.bubble.assistant{align-self:flex-start;background:var(--bg);border:1px solid var(--line)}
  .chat-picks{display:flex;flex-wrap:wrap;gap:6px;max-width:92%}.chat-picks button{border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:999px;padding:6px 9px;font-size:11px;cursor:pointer}
  @media(max-width:380px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}
  @media(min-width:700px){.grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}}
  button.link{background:none;border:0;color:var(--accent);font-size:12.5px;cursor:pointer;padding:0;text-decoration:underline}
  #costs{display:none;margin-top:8px;max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:10px}
  table{border-collapse:collapse;width:100%;font-size:11.5px}
  th,td{text-align:left;padding:5px 7px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--card)}
  @media (min-width:640px){ ul.ing{grid-template-columns:1fr 1fr} }
</style>
</head>
<body>
<header>
  <h1>My Recipe Collection <span id="hdr"></span></h1>
  <nav class="nav" aria-label="Main navigation">
    <button type="button" class="active" data-tab="recipes" aria-selected="true">Recipes</button>
    <button type="button" data-tab="chat" aria-selected="false">Chat</button>
  </nav>
  <div id="recipes-controls">
    <div class="searchrow">
      <input id="q" type="search" placeholder="Search dish, ingredient, creator…" autocomplete="off" spellcheck="false">
      <select id="sort">
        <option value="az">A–Z</option>
        <option value="new">Newest</option>
        <option value="ing">Most ingredients</option>
      </select>
    </div>
    <div class="chips" id="chips"></div>
  </div>
</header>
<main>
  <section id="recipes-view" class="view active">
    <div class="count" id="count"></div>
    <div id="list"></div>
    <div class="stats" id="stats"></div>
  </section>
  <section id="chat-view" class="view">
    <div class="chat">
      <div class="chat-title">Chat with your recipes</div>
      <div class="chat-hint">Chat naturally and refine recipe ideas. The free hosted model receives your messages and a few matching recipe records.</div>
      <div class="chat-tools"><button id="clear-chat" type="button">New chat</button><span id="chat-status" aria-live="polite">Checking chat service…</span></div>
      <div id="chat-log" aria-live="polite"></div>
      <form class="chatrow" id="chat-form"><input id="chat-q" type="text" placeholder="Ask for a recipe… e.g. dinner with paneer, no onion" autocomplete="off" disabled><button id="chat-send" type="submit" disabled>Send</button></form>
    </div>
  </section>
</main>
<script>
const DATA = __DATA__;
const COSTS = __COSTS__;
const SUMMARY = __SUMMARY__;
window.RECIPE_DATA = DATA;
const $ = (s) => document.querySelector(s);
const list = $('#list'), qEl = $('#q'), sortEl = $('#sort'), chipsEl = $('#chips');
window.setTab = (tab) => {
  document.querySelectorAll('.nav [data-tab]').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  $('#recipes-view').classList.toggle('active', tab === 'recipes');
  $('#chat-view').classList.toggle('active', tab === 'chat');
  $('#recipes-controls').style.display = tab === 'recipes' ? '' : 'none';
  window.scrollTo({top:0,behavior:'smooth'});
};
document.querySelectorAll('.nav [data-tab]').forEach(b => b.addEventListener('click', () => window.setTab(b.dataset.tab)));

const field = (r) => [
  r.dish, r.dish_en, r.creator, r.creator_name,
  ...(r.ingredients||[]).map(i => (i.item||'')+' '+(i.item_en||'')),
  ...(r.steps||[]), ...(r.steps_en||[])
].join(' ').toLowerCase();

DATA.forEach(r => { r._f = field(r); });

const langs = [...new Set(DATA.map(r => r.language).filter(Boolean))];
let state = { q:'', lang:'', sort:'az' };

function chips(){
  const all = document.createElement('div');
  all.className = 'chip' + (state.lang === '' ? ' on' : '');
  all.textContent = 'All (' + DATA.length + ')';
  all.onclick = () => { state.lang=''; render(); };
  chipsEl.appendChild(all);
  langs.forEach(l => {
    const c = document.createElement('div');
    c.className = 'chip' + (state.lang === l ? ' on' : '');
    c.textContent = langName(l);
    c.onclick = () => { state.lang = (state.lang === l ? '' : l); render(); };
    chipsEl.appendChild(c);
  });
}
function langName(l){
  const m = {en:'English',te:'Telugu',hi:'Hindi',mr:'Marathi',ta:'Tamil',kn:'Kannada',ml:'Malayalam',bn:'Bengali',gu:'Gujarati',pa:'Punjabi',ur:'Urdu',fr:'French'};
  return m[l] || l.toUpperCase();
}

function esc(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function attr(s){ return esc(s).replace(/'/g,'&#39;'); }

function ingHTML(r, variant){
  const rows = (variant ? variant.ingredients : r.ingredients) || [];
  if (!rows.length) return '<div class="sect">Ingredients</div><div style="color:var(--muted);font-size:13px">Not listed</div>';
  return '<div class="sect">Ingredients</div><ul class="ing">' + rows.map(i =>
    '<li><span class="q">' + esc(i.quantity || '—') + '</span><span>' + esc(i.item) + '</span>' +
    (i.item_en && i.item_en.toLowerCase() !== (i.item||'').toLowerCase() ? '<span class="en">' + esc(i.item_en) + '</span>' : '') +
    '</li>').join('') + '</ul>';
}

function stepsHTML(r, variant, mode){
  const orig = (variant ? variant.steps : r.steps) || [];
  const en = (variant ? variant.steps_en : r.steps_en) || [];
  if (!orig.length && !en.length) return '<div class="sect">Method</div><div style="color:var(--muted);font-size:13px">Not captured in the caption or video.</div>';
  const list = mode === 'en' && en.length ? en : (orig.length ? orig : en);
  const alt = mode === 'en' ? null : en;
  return '<div class="sect">Method</div><ol class="steps">' + list.map((s, i) => {
    const tr = (alt && alt[i] && alt[i].trim() && alt[i].trim().toLowerCase() !== s.trim().toLowerCase()) ? '<span class="tr">' + esc(alt[i]) + '</span>' : '';
    return '<li>' + esc(s) + tr + '</li>';
  }).join('') + '</ol>';
}

function card(r, idx){
  const title = r.dish || r.dish_en || 'Untitled';
  const sub = r.dish_en && r.dish_en.toLowerCase() !== title.toLowerCase() ? r.dish_en : '';
  const nv = r.variants ? r.variants.length : 1;
  return '<div class="card" data-i="' + idx + '">' +
    '<div class="head" onclick="toggle(this)">' +
      (r.thumbnail ? '<img class="thumb" loading="lazy" src="' + attr(r.thumbnail) + '" alt="' + attr(title) + '" onerror="this.outerHTML=\'<div class=no-thumb>🍲</div>\'">' : '<div class="no-thumb">🍲</div>') +
      '<div class="names">' +
        '<div class="dish">' + esc(title) + '</div>' +
        (sub ? '<div class="dish-sub">' + esc(sub) + '</div>' : '') +
        '<div class="meta">' +
          '<span>@' + esc(r.creator) + '</span>' +
          '<a href="' + attr(r.permalink) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">video ↗</a>' +
          '<span class="badge">' + esc(langName(r.language)) + '</span>' +
          '<span class="badge ' + (r.source === 'caption' ? '' : 'vid') + '">' +
            ({'video': 'on camera', 'stills': 'frames + audio'}[r.source] || 'caption') + '</span>' +
          (nv > 1 ? '<span class="badge">' + nv + ' versions</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="body">' + ingHTML(r) +
      '<div class="toggle"><button class="on" onclick="setMode(this,\'orig\')">Original</button><button onclick="setMode(this,\'en\')">English</button></div>' +
      stepsHTML(r, null, 'orig') +
      (r.seconds ? '<div class="proc">Read in ' + r.seconds + ' s' +
          (r.frames ? ' from ' + r.frames + ' frames + audio' : ' from the full video') +
          ' · $' + (r.cost_usd || 0).toFixed(4) + ' of API usage.</div>' : '') +
      (r.variants ? '<div class="sect">Other versions</div><div class="variants">' + r.variants.slice(1).map(v =>
          '<div class="variant"><div class="vhead">@' + esc(v.creator) + ' · <a href="' + attr(v.permalink) + '" target="_blank" rel="noopener">video ↗</a> · ' + esc(langName(v.language)) + '</div>' +
          ingHTML(r, v) + stepsHTML(r, v, 'orig') + '</div>').join('') + '</div>' : '') +
    '</div></div>';
}

window.toggle = (el) => { el.parentElement.classList.toggle('open'); };
window.setMode = (btn, mode) => {
  const body = btn.closest('.body');
  const card = body.parentElement;
  body.querySelectorAll('.toggle button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const r = DATA[+card.dataset.i];
  const sect = body.querySelectorAll('.sect');
  const old = body.querySelector('ol.steps');
  if (old) old.outerHTML = stepsHTML(r, null, mode);
};

function filtered(){
  let out = DATA.filter(r =>
    (!state.lang || r.language === state.lang) &&
    (!state.q || state.q.split(/\s+/).every(t => r._f.includes(t)))
  );
  if (state.sort === 'az') out.sort((a,b) => (a.dish_en||a.dish).localeCompare(b.dish_en||b.dish));
  else if (state.sort === 'new') out.sort((a,b) => (b.taken_at||0) - (a.taken_at||0));
  else out.sort((a,b) => (b.ingredients||[]).length - (a.ingredients||[]).length);
  return out;
}

function render(){
  chipsEl.innerHTML = '';
  chips();
  const rows = filtered();
  $('#count').textContent = rows.length + ' of ' + DATA.length + ' dishes';
  list.className = 'grid';
  list.innerHTML = rows.length ? rows.map(r => card(r, DATA.indexOf(r))).join('') :
    '<div class="empty">No dishes match “' + esc(state.q) + '”.</div>';
}

qEl.addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); render(); });
sortEl.addEventListener('change', e => { state.sort = e.target.value; render(); });

window.showRecipe=(code)=>{
  const r=DATA.find(x=>x.code===code); if(!r)return;
  window.setTab('recipes');
  list.className='grid'; list.innerHTML=card(r,DATA.indexOf(r));
  $('#count').textContent='1 recipe';
  window.scrollTo({top:0,behavior:'smooth'});
  const el=list.querySelector('.card'); if(el)el.querySelector('.head').click();
};

$('#hdr').textContent = '· ' + SUMMARY.recipes + ' dishes · ' + SUMMARY.creators + ' creators';
$('#stats').innerHTML =
  'Collected from ' + SUMMARY.source_posts + ' recipe videos by ' + SUMMARY.creators + ' creators.<br>' +
  SUMMARY.from_caption + ' recipes complete in the caption, ' + SUMMARY.from_video + ' read from the full video, ' +
  (SUMMARY.from_stills || 0) + ' from sampled frames + audio.<br>' +
  SUMMARY.with_ingredients + ' dishes list their ingredients' +
  (SUMMARY.title_only ? ', ' + SUMMARY.title_only + ' are a dish name only' : '') + '.<br>' +
  (SUMMARY.duplicate_groups ? SUMMARY.duplicate_groups + ' dishes merged from multiple videos.<br>' : '') +
  'Video analysis: ' + SUMMARY.videos_processed + ' videos, $' + SUMMARY.video_cost_usd.toFixed(2) +
  ', ' + (SUMMARY.video_time_s/60).toFixed(0) + ' min compute (' +
  (SUMMARY.video_time_s / Math.max(SUMMARY.videos_processed, 1)).toFixed(0) + ' s per video on average). ' +
  (SUMMARY.extractions > SUMMARY.videos_processed ?
    SUMMARY.extractions + ' extractions incl. ' + (SUMMARY.extractions - SUMMARY.videos_processed) +
    ' re-reads, $' + SUMMARY.total_spend_usd.toFixed(2) + ' in total. ' : '') +
  '<button class="link" onclick="var c=document.getElementById(\'costs\');c.style.display=c.style.display===\'block\'?\'none\':\'block\'">per-video cost log</button>' +
  ' <a class="link" href="costs.csv" download>costs.csv</a>' +
  '<div id="costs"><table><thead><tr><th>#</th><th>video</th><th>dish</th><th>len s</th><th>dl s</th><th>enc s</th><th>api s</th><th>total s</th><th>cost</th><th>running $</th><th>running min</th></tr></thead><tbody>' +
  COSTS.map(c => '<tr><td>' + c.n + '</td><td>@' + esc(c.username||'') + ' ' + esc(c.code) + '</td><td>' + esc((c.dish||'').slice(0,34)) + '</td><td>' + c.duration_s + '</td><td>' + c.download_s +
    '</td><td>' + c.encode_s + '</td><td>' + c.api_s + '</td><td>' + c.total_s + '</td><td>$' + (c.cost_usd||0).toFixed(4) +
    '</td><td>$' + (c.cost_total_usd||0).toFixed(4) + '</td><td>' + ((c.time_total_s||0)/60).toFixed(1) + '</td></tr>').join('') +
  '</tbody><tfoot><tr><th colspan="8">' + COSTS.length + ' videos</th><th>$' + SUMMARY.video_cost_usd.toFixed(4) +
  '</th><th></th><th>' + (SUMMARY.video_time_s/60).toFixed(1) + '</th></tr></tfoot></table>' +
  (SUMMARY.extractions > SUMMARY.videos_processed ?
    '<div style="padding:8px 4px;color:var(--mute);font-size:12px">This table keeps one row per post: ' +
    SUMMARY.extractions + ' extractions in total (incl. re-reads), $' + SUMMARY.total_spend_usd.toFixed(2) + ' spent.</div>' : '') +
  '</div>';

render();
</script>
<script type="module">
const CHAT_API = __CHAT_API_URL__;
const statusEl = document.querySelector('#chat-status');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#chat-q');
const send = document.querySelector('#chat-send');
const log = document.querySelector('#chat-log');
let busy = false;
let history = [];
const setStatus = (s) => { statusEl.textContent = s; };
if (CHAT_API) {
  input.disabled = false; send.disabled = false;
  setStatus('Free hosted AI · chat is sent to the recipe assistant service.');
} else {
  setStatus('Cloudflare chat backend is not deployed yet. Deploy the free Worker once to enable chat.');
}

function bubble(role, text='') {
  const el = document.createElement('div');
  el.className = 'bubble ' + role;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
function pickRecipes(query) {
  const data = window.RECIPE_DATA || [];
  const previous = history.filter(m => m.role === 'user').slice(-5).map(m => m.content).join(' ');
  const q = (previous + ' ' + query).toLowerCase();
  const banned = new Set();
  const groups = {
    onion:['onion'], garlic:['garlic'], dairy:['milk','cream','cheese','butter','paneer','yogurt','curd','ghee'],
    nuts:['almond','cashew','peanut','pistachio','walnut'], gluten:['wheat','flour','maida','bread','pasta'],
    egg:['egg'], meat:['chicken','mutton','lamb','beef','pork','fish','prawn','shrimp']
  };
  for (const [key, items] of Object.entries(groups)) {
    if (new RegExp('\\b(no|without|avoid|exclude|skip)\\s+(\\w+\\s+){0,2}' + key + 's?\\b').test(q)) items.forEach(x => banned.add(x));
  }
  if (/\b(vegetarian|vegan|no meat)\b/.test(q)) groups.meat.forEach(x => banned.add(x));
  if (/\bvegan\b/.test(q)) [...groups.dairy, ...groups.egg].forEach(x => banned.add(x));
  const stop = new Set('what which with from into have has make cook cooking recipe recipes something anything please suggest recommend give find show me i want need can you dinner lunch breakfast idea ideas dish dishes this that for the a an and or but no without avoid exclude skip vegetarian vegan healthy quick easy simple spicy mild meal meals'.split(' '));
  const terms = q.normalize('NFKD').toLowerCase().split(/[^a-z0-9\u0900-\u0dff]+/).filter(w => w.length > 2 && !stop.has(w));
  const candidates = data.map(r => {
    const ing = (r.ingredients || []).map(i => ((i.item_en || '') + ' ' + (i.item || '')).toLowerCase());
    const text = [r.dish, r.dish_en, ...ing].join(' ').toLowerCase();
    if ([...banned].some(x => text.includes(x))) return null;
    let score = 0;
    for (const t of terms) if (text.includes(t)) score += t.length > 4 ? 3 : 1;
    return { r, score };
  }).filter(Boolean).sort((a,b) => b.score - a.score);
  let matched = candidates.filter(x => x.score > 0);
  if (!matched.length) matched = candidates.sort(() => Math.random() - .5);
  return matched.slice(0, 10).map(x => x.r);
}
function showPicks(parent, recipes, answer) {
  const row = document.createElement('div'); row.className = 'chat-picks';
  const mentioned = recipes.filter(r => {
    const a = answer.toLowerCase();
    return [r.dish, r.dish_en].filter(Boolean).some(n => n.length > 3 && a.includes(n.toLowerCase()));
  });
  for (const r of (mentioned.length ? mentioned : recipes.slice(0,3)).slice(0,5)) {
    const b = document.createElement('button');
    b.textContent = r.dish_en || r.dish || 'Recipe';
    b.title = 'Show this recipe in the collection';
    b.addEventListener('click', () => window.showRecipe(r.code));
    row.appendChild(b);
  }
  parent.after(row);
}

document.querySelector('#clear-chat').addEventListener('click', () => {
  history = []; log.replaceChildren();
  if (CHAT_API) setStatus('New conversation. Free hosted AI is ready.');
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !CHAT_API || busy) return;
  input.value = ''; busy = true; send.disabled = true;
  bubble('user', text);
  const picks = pickRecipes(text);
  const compact = picks.map(r => ({
    code: r.code, name: r.dish_en || r.dish, original_name: r.dish,
    ingredients: (r.ingredients || []).slice(0, 24).map(i => [i.quantity, i.item_en || i.item].filter(Boolean).join(' ')),
    method: (r.steps_en || r.steps || []).slice(0, 5), url: r.permalink
  }));
  const system = `You are my friendly personal recipe-finding assistant. Have a natural, useful back-and-forth: ask one short clarifying question when needed, remember my preferences from this conversation, and recommend dishes only from the supplied collection. When suggesting a dish, use its exact card title so I can open it below. Never invent a dish or claim an ingredient/method is present if the supplied record does not show it. Be concise, explain why a suggestion fits, and mention when ingredient data is incomplete. If the user gives an allergy, say this extracted list is not a safety guarantee and they must check the original video. The recipe cards below are the only source of truth for recommendations.\n\nAvailable recipe cards (JSON):\n${JSON.stringify(compact)}`;
  if (!history.length) history.push({role:'system', content:system});
  else history[0] = {role:'system', content:system};
  history.push({role:'user', content:text});
  const assistant = bubble('assistant', '');
  setStatus('Thinking…');
  try {
    const response = await fetch(CHAT_API, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:[{role:'system',content:system},...history.slice(1).slice(-8)]})
    });
    if (!response.ok) throw new Error((await response.text()).slice(0,240) || `HTTP ${response.status}`);
    if (!response.body) throw new Error('The chat service returned no response stream');
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let buffer='';
    let answer = '';
    while(true){
      const {value,done}=await reader.read(); if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split('\n'); buffer=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        const raw=line.slice(5).trim(); if(!raw||raw==='[DONE]')continue;
        try{const chunk=JSON.parse(raw);answer+=chunk.choices?.[0]?.delta?.content||chunk.response||'';}catch{}
        assistant.textContent=answer;log.scrollTop=log.scrollHeight;
      }
    }
    if (!answer.trim()) answer = 'I could not form a reply. Try asking in another way.';
    assistant.textContent = answer;
    history.push({role:'assistant', content:answer});
    showPicks(assistant, picks, answer);
    setStatus('Free-tier hosted AI · provider quotas may change.');
  } catch (err) {
    assistant.textContent = 'The local model hit an error: ' + (err?.message || err);
    setStatus('Chat request failed. Try again in a moment.');
  } finally {
    busy = false; send.disabled = !CHAT_API; input.focus();
  }
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
