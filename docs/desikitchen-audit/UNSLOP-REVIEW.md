# DesiKitchen — Unslop screen review

> Review only. No app code, account data, preferences, or recipes were changed.

**Skill:** `unslop` by Damir Sokolovsky (@heydamir), CC BY 4.0  
**App:** DesiKitchen 1.2.0, native Android / Jetpack Compose  
**Evidence:** phone screenshots at 1260×2800 from the installed app. This is a visual review of available captures, not a full app audit. The Compose source/build project is not present, so source values, actual theme tokens, and implementation behavior could not be verified.

## Screens reviewed

- Discover: opening screen and one scrolled position
- Collections: collection index
- Collection detail: “Weeknight Dinners” recipe grid
- Recipe detail: “Dal Tadka”
- Assistant: existing conversation and suggested prompts
- Saved: meal plan, grocery list, collections, recipe index
- Profile: kitchen shortcuts and settings

Screenshots remain in `/tmp/opencode/desikitchen-audit/screens/`. They contain personal app content; keep them private.

## Direction

- **Product:** DesiKitchen helps home cooks save recipes, organize meals, plan groceries, and cook.
- **Character:** generous, grounded, practical.
- **World:** a real South Asian home kitchen: ingredients, spice, daylight, and familiar food.
- **Moments:** let authentic dish photography and useful cooking detail carry the richness.
- **Signature:** the food itself is the signature; don’t add decorative “AI” sparkle motifs.

Preserve the existing DesiKitchen wordmark and forest-green brand. Treat the current cream/sage as supporting tones, not a reason to replace the identity. Keep large surfaces quieter so food photography can lead.

## Audit — signs observed

### Clear issues

1. **Discover: clipped carousel content and truncated recipe titles.** The “Recently saved” rail runs past the screen edge; visible dish names are cut short. Some collection titles/descriptions are ellipsized too. Give the rail symmetrical end padding and make card widths/title wrapping intentional; retain useful metadata instead of clipping it mid-label.
2. **Collection detail: missing images rendered as oversized initials.** Palak Paneer (“PP”) and Rajma Chawal (“RC”) occupy full photo-sized blanks. This reads as failed content, not a designed fallback. Use a deliberate, compact fallback and preserve a consistent card ratio.
3. **Assistant: repeated high-emphasis pill suggestions.** Five large, solid-green prompts follow a long answer; the longest prompt spans most of the screen. Lower their emphasis, show fewer at once, and keep the answer visually primary.
4. **Recipe detail: pinned cooking surface is close to ingredient content.** The bottom “Start cooking” panel sits over the scroll area. Confirm bottom content padding includes the panel and system-navigation inset so the final ingredient/instructions remain reachable.
5. **Discover copy stacks a greeting and a generic headline.** “Good afternoon” plus “What’s the plan, yo?” uses two lines of introduction before the main task. If the casual voice is deliberate, keep its warmth, but make the title earn its space with a useful cooking context.

### Possible system drift to verify in source

- **Capsule overuse:** the import field/button, Assistant suggestions/composer, and selected navigation state all use very rounded shapes. Keep pills for actual chips; use the existing Material 3 shape scale for fields, cards, and buttons so everything does not read as one capsule system.
- **Surface tint:** Discover uses a warm-tinted fade and Collections/Saved use broad pale-sage surfaces. These are low-key and brand-consistent, not the stereotypical purple-glow slop. Still, the app’s chrome could be quieter: neutral warm surfaces, green for key actions/selection, and richer color in food imagery.
- **Accent consistency:** the clipboard action on Discover is orange while most interface actions are green. Confirm orange has a semantic/product role; if not, bring it into the established accent system.
- **Type weight/scale:** headings appear visually heavy and large relative to metadata, especially on Discover and Collections. The APK includes a Plus Jakarta Sans license asset, but screenshots cannot confirm which face/styles are used. Keep the brand face if intentional; establish a smaller, consistent Material type-role scale rather than reducing body readability.
- **Assistant sparkle mark:** the Assistant destination uses a sparkle motif. The app has an assistant feature, but sparkle is a familiar generic AI cue. Prefer the existing mark or a clear conversation symbol unless sparkle is an intentional brand asset.
- **Naming:** collection detail says “Search this cookbook” while the app’s main surface calls these “Collections.” Use one term unless “cookbook” has a separate product meaning.

### Signs not found in the available captures

- No obvious purple-to-blue gradients, glowing blobs, neon borders, gradient text, emoji navigation, or bouncing/pulsing decoration.
- Real dish photography gives the app a strong, product-specific visual moment. Text baked into imported social thumbnails appears to be source media, not UI decoration.
- Motion, image-loading behavior, errors, empty states, and dark theme were not captured; no conclusions about those states.

## Nine-pass review

1. **Spacing:** Discover has many sections and generous vertical blocks before users reach recipe content; carousel edges clip. Collections cards reserve a great deal of space for images. Tighten within groups, separate sections clearly, and keep consistent rail/card padding.
2. **Color:** keep the recognizable green and sage identity. Quiet large chrome surfaces and let food photos carry color. Check the isolated orange clipboard icon and verify text contrast, especially secondary gray on pale tinted backgrounds.
3. **Icons:** the bottom navigation icons appear to share a consistent line style. Avoid using generic sparkle as the default AI signal; confirm icon family, size, and semantics in source.
4. **Copy:** retain the product’s friendly voice if intentional, but replace the two-part greeting/headline with a more useful context. Fix truncated recipe and cuisine labels. Keep the clear collection description and cooking terminology.
5. **Type:** tune hierarchy by role, not by making every title large/bold. Ensure titles wrap and metadata remains legible. Verify actual font roles and Android `sp` scaling from Compose source.
6. **Layout:** simplify the Discover first viewport; use fixed, predictable card proportions; make rails scroll with clear start/end margins; keep the cooking CTA from covering recipe content.
7. **Details:** reserve capsule geometry for chips; use a size-appropriate Material 3 shape system elsewhere. Make image fallbacks look intentional. Keep primary green action styling for the one main action per surface.
8. **Visuals:** preserve real food photos as the main visual asset. Fix missing photo states rather than adding generated decorative art; ordinary recipe, settings, and list screens do not need extra illustrations.
9. **Motion:** not assessable from static captures. When source is available, keep motion purposeful, short, interruptible, and consistent with Android system settings.

## Highest-priority changes when source is available

1. Fix the broken-looking recipe image fallbacks and confirm the sticky cooking action never hides content.
2. Fix Discover carousel bounds/title truncation and reduce first-screen competition between import and browse.
3. Reduce Assistant prompt-chip dominance and standardize shapes/type roles across screens.
4. Verify contrast, TalkBack labels/order, 48dp targets, system Back, dark theme, and larger font scale on-device.

## Limits

This review only covers the seven screen types listed above. Search, import results, Plus/paywall, cooking mode, meal-plan editing, grocery interactions, error/loading/empty states, dark mode, and other navigation destinations remain pending. No Impeccable web detector was run: this is a native Compose app and that detector does not validate native UI. Implementation and build verification require the Kotlin/Compose project.

---

Unslop skill by Damir Sokolovsky (@heydamir), licensed CC BY 4.0: https://github.com/heydamir/unslop
