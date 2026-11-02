# DesiKitchen — Emil design-engineering review

**Skill suite:** [emilkowalski/skills](https://github.com/emilkowalski/skills), installed under `.opencode/skills/`  
**App:** DesiKitchen 1.2.0, native Android / Jetpack Compose  
**Method:** visual review of locally available screenshots only. The app’s Kotlin/Compose project is not in this workspace. This is not a source, accessibility, usability-task, or animation audit.

## Screens evidenced

Discover (top and lower positions), Collections, a collection’s recipe grid, Dal Tadka recipe detail, Assistant, Saved, and Profile. The screenshot folder also contains import-field/keyboard states, but no submitted import result or error state. No reliable capture of Plus/paywall, cooking mode, full search results, or edited meal-plan/grocery flows was identified. Screenshots contain personal app content and should remain private.

## Read

DesiKitchen already has a clear, ownable base: recognizable wordmark, deep green actions, restrained sage/cream surfaces, and real food imagery. It feels like a product about cooking, not a generic dashboard. The best opportunity is to make each screen feel more deliberate through reliable content boundaries, less competition, and small fit-and-finish details—not to replace the brand.

### Findings and intended direction

| Before (screenshot evidence) | After (recommended direction) | Why |
| --- | --- | --- |
| Discover shows a large greeting/headline and prominent import form before recipe browsing; the recent-recipe rail visibly crops the third card and cuts titles with ellipses. | Give browsing a compact, useful first viewport; keep import available but secondary. Give rails deliberate end padding and titles a predictable two-line treatment. | Browsing and finding a saved meal are core repeat tasks. The user should see where the rail ends and be able to identify a recipe without guessing. |
| Collection grid shows photo-sized blank tiles with “PP” and “RC” initials for missing images. | Use a designed fallback that reads as intentional, sized for the information it contains; keep image ratios consistent. | A fallback is part of the product’s visual identity, not merely an empty image container. |
| Assistant’s long answer is followed by several visually strong green suggestion pills. | Let the answer lead; show fewer suggestions at once in a quieter treatment. | The main content should have a clear visual winner, and long prompts should not turn into oversized CTA slabs. |
| Recipe-detail “Start cooking” surface is pinned at the bottom near ingredient content. | Confirm the scroll container reserves space for the action surface and Android navigation inset; ensure the final item can scroll fully above it. | A persistent action should remain available without obscuring the task content. Screenshot alone cannot establish actual occlusion. |
| Discover mixes friendly greeting copy with a broad headline (“What’s the plan, yo?”); some recipe/collection labels truncate. | Keep the friendly voice if it is intentional; make the heading task-specific and handle long names without cutting off useful words. | Product personality should aid orientation, while content remains legible and trustworthy. |
| Very rounded shapes recur across import, assistant suggestions/composer, and selected navigation. | Keep pill geometry for genuinely chip-like controls; use a small, consistent shape vocabulary for other surfaces. | Shape contrast helps users distinguish actions, fields, and selection states. Verify against the app’s Material 3 system in source. |
| Orange clipboard icon stands apart from the dominant green actions; Assistant uses a familiar sparkle icon. | Confirm orange has a semantic role and sparkle is an intentional brand choice; otherwise align with the established icon/accent language. | Small repeated cues build product coherence. These are questions to verify, not proof of implementation defects. |

## Craft notes

- **Hierarchy:** On Discover, reduce competition rather than merely shrinking every element. Preserve clear section names and strong food imagery; reduce the preamble and the visual weight of secondary import content.
- **Content fit:** Avoid mid-word truncation when the title is a recipe’s primary identifier. Confirm card widths, line limits, and accessibility font scaling in Compose.
- **Surface and color:** Keep the distinctive forest green and sage. No obvious neon, purple gradient, glow, or decorative blob appears in these captures. Do not rebrand to satisfy generic anti-slop rules.
- **Imagery:** The user’s recipe photos are product-specific and more persuasive than decorative filler. Prioritize robust image loading/fallbacks over adding artwork.
- **Navigation:** Five labeled destinations aid recognition. Check selected/unselected contrast and touch targets on-device; pixels alone cannot confirm semantics or target dimensions.
- **Motion:** No motion judgment is possible from still screenshots. Do not infer that transitions are good or bad. Review Compose transitions and interactions on a running build, including reduced-motion/system animator settings, before proposing animation changes.

## Priority order

1. Make missing-image states intentional and confirm bottom content is not hidden by the cooking action.
2. Fix Discover rail bounds and title truncation; improve the first-screen balance between import and browsing.
3. Reduce Assistant suggestion competition and verify a consistent component shape hierarchy.
4. On a build/device, inspect font scaling, TalkBack semantics/order, contrast, 48dp touch targets, Android system Back/insets, and dark theme.
5. Only then review motion in actual interactions; prefer no motion over decorative motion, and keep feedback quick and interruptible.

## Limits and follow-up

This review is limited to screenshot evidence and the screen types listed above. It does not validate navigation paths, screen-reader behavior, loading/error/empty states, large text, dark mode, performance, animations, or the screens not captured. The screen called `27-search.png` visually shows Discover/import with the keyboard rather than search results, so it is not counted as search-flow coverage. Source-level recommendations need the Kotlin/Compose project and a runnable build.

No app code or user content was changed for this review.
