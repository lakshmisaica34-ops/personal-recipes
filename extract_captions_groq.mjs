// Extract structured recipe data from captions using Groq (text only)
// Only use Gemini for video extraction, never for these captions
import fs from 'node:fs';

const KEY = process.env.Groq_api || '';
if (!KEY) throw new Error('Groq_api secret not found in env');

const RESULTS = 'exports/recipe_scrape_results_final.json';
const OUT = 'exports/groq_caption_extractions.json';
const MODEL = 'llama-3.1-8b-instant'; // fast and cheap, still supported on Groq

const all = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
const recipes = all.filter((r) => r.is_recipe === true);
console.log(`Extracting from ${recipes.length} recipe captions with Groq (${MODEL})`);

// Resume if interrupted
let done = [];
if (fs.existsSync(OUT)) {
  try {
    const content = fs.readFileSync(OUT, 'utf8').trim();
    if (content) done = JSON.parse(content);
  } catch (e) {
    console.log('Could not parse existing extraction file, starting fresh');
    done = [];
  }
}
const doneIds = new Set(done.map((d) => d.id));
console.log(`${done.length} already extracted`);

const PROMPT = `You are an expert at extracting clean, usable recipes from Instagram captions.

Given a caption, extract a structured recipe. 
- Only extract ingredients and steps if they are actually present in the caption. Do not guess or make up recipes.
- If the recipe says "full recipe in comments" or "recipe in bio" but doesn't list ingredients/steps in the caption itself, set ingredients and steps to empty arrays.
- Clean up ingredient names (remove extra hashtags, mentions, etc)
- Format steps as clear, actionable instructions
- recipe_name should be concise and human readable

Return ONLY valid JSON with these exact fields:
{
  "recipe_name": string|null,
  "ingredients": string[],
  "steps": string[],
  "servings": string|null,
  "prep_time": string|null,
  "cook_time": string|null,
  "total_time": string|null,
  "notes": string|null
}

Do not add any explanation or markdown fences.`;

async function extract(caption) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: caption || '(no caption)' },
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });
  
  if (res.status !== 200) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err.slice(0, 200)}`);
  }
  
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(text);
  } catch (e) {
    // try to extract json from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw e;
  }
}

let count = 0;
for (const rec of recipes) {
  if (doneIds.has(rec.id)) continue;
  count++;
  
  try {
    const result = await extract(rec.caption_full || '');
    done.push({
      id: rec.id,
      code: rec.code,
      ...result,
    });
    fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
    
    if (count % 25 === 0) {
      console.log(`  ${done.length}/${recipes.length} extracted (${result.ingredients?.length || 0} ingredients, ${result.steps?.length || 0} steps)`);
    }
  } catch (e) {
    console.log(`  ERROR ${rec.id}: ${e.message}`);
    done.push({
      id: rec.id,
      code: rec.code,
      recipe_name: null,
      ingredients: [],
      steps: [],
      servings: null,
      prep_time: null,
      cook_time: null,
      total_time: null,
      notes: 'EXTRACTION_ERROR: ' + e.message,
    });
    fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
  }
  
  // small delay to be nice to the API
  await new Promise(r => setTimeout(r, 200));
}

console.log(`\nDone! Extracted ${done.length} records`);
console.log(`With ingredients: ${done.filter(d => (d.ingredients||[]).length > 0).length}`);
console.log(`With steps: ${done.filter(d => (d.steps||[]).length > 0).length}`);
console.log(`Saved to ${OUT}`);
