#!/usr/bin/env python3
"""Merge caption results, normalise them, and build the video queue.

Sources
  work/caption_results.jsonl   Groq pipeline output (append-only, resumable)
  work/batches/out_*.jsonl     assistant batch output
  /tmp/opencode/caption_audit2.json  heuristic category per code

Outputs
  work/caption_merged.jsonl    one validated row per code
  work/video_queue.jsonl       posts whose recipe is not complete in the caption
  work/caption_stats.json      coverage + classification summary
"""
import collections
import glob
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIN = os.path.join(ROOT, "exports/recipe_scrape_results_final.json")
AUDIT = "/tmp/opencode/caption_audit2.json"
GROQ = os.path.join(ROOT, "work/caption_results.jsonl")
BATCHES = os.path.join(ROOT, "work/batches/out_*.jsonl")
MERGED = os.path.join(ROOT, "work/caption_merged.jsonl")
QUEUE = os.path.join(ROOT, "work/video_queue.jsonl")
STATS = os.path.join(ROOT, "work/caption_stats.json")

VALID_COMPLETENESS = {"full", "partial", "none"}


def load_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def score(row):
    """Prefer rows that actually carry extracted content."""
    return len(row.get("ingredients") or []) + 2 * len(row.get("steps") or [])


def normalize(raw, src):
    ingredients = []
    for i in raw.get("ingredients") or []:
        if not isinstance(i, dict):
            continue
        item = (i.get("item") or "").strip()
        if not item:
            continue
        ingredients.append(
            {
                "item": item,
                "quantity": (i.get("quantity") or "").strip(),
                "item_en": (i.get("item_en") or item).strip(),
            }
        )
    steps = [s.strip() for s in (raw.get("steps") or []) if isinstance(s, str) and s.strip()]
    steps_en = [s.strip() for s in (raw.get("steps_en") or []) if isinstance(s, str) and s.strip()]
    if steps and not steps_en:
        steps_en = ["", ] * len(steps)
    if steps_en and not steps:
        steps = [""] * len(steps_en)
    # keep the pairs aligned even if a model dropped one
    n = min(len(steps), len(steps_en)) if steps_en else len(steps)
    steps, steps_en = steps[:n], steps_en[:n]

    food = bool(raw.get("food_post"))
    completeness = raw.get("completeness") if raw.get("completeness") in VALID_COMPLETENESS else "none"
    if not food:
        completeness = "none"
    # a "full" claim only stands if both halves were actually extracted
    if completeness == "full" and not (ingredients and steps):
        completeness = "partial"

    return {
        "code": raw["code"],
        "food_post": food,
        "completeness": completeness,
        "dish": (raw.get("dish") or "").strip(),
        "dish_en": (raw.get("dish_en") or "").strip(),
        "language": (raw.get("language") or "").strip(),
        "ingredients": ingredients,
        "steps": steps,
        "steps_en": steps_en,
        "reason": (raw.get("reason") or "").strip(),
        "_engine": raw.get("engine") or src,
    }


def main():
    meta = {r["code"]: r for r in json.load(open(FIN, encoding="utf-8"))}
    audit = {a["code"]: a.get("cat") for a in json.load(open(AUDIT, encoding="utf-8"))}

    best = {}
    for src, path in [("groq", GROQ)] + [("assistant", p) for p in sorted(glob.glob(BATCHES))]:
        for raw in load_jsonl(path):
            if raw.get("error") or not raw.get("code") or raw["code"] not in meta:
                continue
            row = normalize(raw, src)
            prev = best.get(row["code"])
            if prev is None or score(row) > score(prev):
                best[row["code"]] = row
            best[row["code"]]["_sources"] = sorted(set((prev or {}).get("_sources", []) + [row["_engine"]]))

    missing = [c for c in meta if c not in best]
    rows = []
    for code, row in best.items():
        m = meta[code]
        row = dict(row)
        engine = row.pop("_engine")
        row.pop("_sources", None)
        rows.append(
            {
                "code": code,
                "id": m["id"],
                "username": m["username"],
                "full_name": m.get("full_name"),
                "permalink": m["video_url"],
                "thumbnail_url": m.get("thumbnail_url"),
                "taken_at": m.get("taken_at"),
                "duration_s": m.get("video_duration_s"),
                "heuristic": audit.get(code),
                "engine": engine,
                **row,
            }
        )
    rows.sort(key=lambda r: (r["taken_at"] or 0), reverse=True)

    with open(MERGED, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    queue = [
        {
            "code": r["code"],
            "id": r["id"],
            "username": r["username"],
            "caption_full": (meta[r["code"]].get("caption_full") or ""),
            "why": r["completeness"],
            "dish_hint": r["dish"] or r["dish_en"],
        }
        for r in rows
        if r["food_post"] and r["completeness"] != "full"
    ]
    with open(QUEUE, "w", encoding="utf-8") as fh:
        for r in queue:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    stats = {
        "total_records": len(meta),
        "classified": len(rows),
        "missing": len(missing),
        "missing_codes": missing[:50],
        "food_posts": sum(1 for r in rows if r["food_post"]),
        "not_food": sum(1 for r in rows if not r["food_post"]),
        "completeness": dict(collections.Counter(r["completeness"] for r in rows if r["food_post"])),
        "with_recipe_from_caption": sum(
            1 for r in rows if r["food_post"] and r["completeness"] == "full"
        ),
        "video_queue": len(queue),
        "engine": dict(collections.Counter(r["engine"] for r in rows)),
        "language": dict(collections.Counter(r["language"] or "unknown" for r in rows).most_common(12)),
    }
    json.dump(stats, open(STATS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(json.dumps(stats, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
