# DesiKitchen UI review (initial pass)

**App:** DesiKitchen 1.2.0 (`com.desikitchen.app`), native Jetpack Compose  
**Evidence:** Vivo I2405, 1260×2800 capture, Android  
**Method:** Impeccable native design review; visual screenshots only. The native detector is not applicable. Source/build project was not found, so no code-level checks or implementation were possible.

Screens captured: Discover, Collections, a collection recipe grid, Dal Tadka recipe detail, Assistant, Saved, and Profile. No import was submitted and no saved recipes, settings, or account data were intentionally changed. A clipboard URL briefly appeared in the Discover import field during navigation; it was cleared without submitting.

## Overall impression

The app has a distinctive food-oriented identity: the wordmark, forest-green primary action, warm food photography, and quiet pale-sage surfaces feel like one product. The main opportunity is refinement, not a wholesale rebrand: make the dense Discover screen easier to scan, eliminate truncated labels and image fallbacks, and tighten oversized layouts while preserving the existing palette and voice.

## Provisional heuristic scores

Scores are based only on the screens listed above; workflows and error states were not exercised, so these are directional, not a release certification.

| # | Heuristic | Score | Evidence / gap |
|---|---|---:|---|
| 1 | Visibility of system status | 2/4 | Current tab is clear; asynchronous import/chat states not evaluated. |
| 2 | Match with real world | 3/4 | Recipe, meal-plan, and grocery concepts are familiar; “What’s the plan, yo?” is a tonal choice that may not suit every audience. |
| 3 | User control and freedom | 3/4 | Back controls are visible on detail; destructive/edit flows not tested. |
| 4 | Consistency and standards | 3/4 | Green/sage system is consistent; card sizing, image fallbacks, and title truncation vary. |
| 5 | Error prevention | 2/4 | Import action is prominent, but validation/recovery were not exercised. |
| 6 | Recognition rather than recall | 3/4 | Labeled bottom navigation, recent recipes, and collections support recognition. |
| 7 | Flexibility and efficiency | 3/4 | Search and saved shortcuts exist; bulk/quick paths not tested. |
| 8 | Aesthetic and minimalist design | 2/4 | Coherent identity, but Discover stacks many competing sections and oversized controls. |
| 9 | Error recognition and recovery | 2/4 | Error states were not reached; score is provisional. |
| 10 | Help and documentation | 2/4 | Inline descriptions exist; contextual help was not evident in reviewed screens. |
| **Total** | | **25/40** | Provisional, partial-surface review. |

## What is working

- **Ownable visual identity:** forest green, sage, food imagery, and the DesiKitchen wordmark are memorable and cohesive. Keep them; beige/cream is not automatically a defect when it serves this established palette.
- **Clear bottom navigation:** five labeled destinations make the app’s structure understandable without relying on icons alone.
- **Recipe detail has useful content:** strong dish photography, named ingredients, quantities, and a clear cooking action support the core task.

## Priority issues

### [P1] Discover is crowded and front-loads too much

The opening view stacks branding/greeting, a large headline, a complete import form, “Recently saved,” and “Collections.” The first saved-recipe row is horizontally clipped at the viewport edge and long titles truncate. The prominent import CTA competes with the more frequent browse/save task.

**Fix:** simplify the top area to a compact app bar/search and a concise task-oriented heading. Keep import available but visually secondary (e.g. a compact row/action). Use a consistent horizontal-card width with end padding and either two-line titles or enough width to read names. Reduce simultaneous section competition.

**Impeccable:** `/impeccable layout`, then `/impeccable typeset`.

### [P1] Missing recipe imagery appears as initials on large cards

The collection grid shows “PP” and “RC” in oversized pale blank image blocks, while nearby recipes have photography. This reads as broken content and makes the grid feel unfinished.

**Fix:** use a deliberate fallback illustration or compact initials treatment; avoid reserving a full photo-height area for a missing image. Check the image URL/cache/load-error states and use a neutral, consistent placeholder.

**Impeccable:** `/impeccable harden`, then `/impeccable polish`.

### [P2] Collection and recipe grids spend too much vertical space

Collection cards devote a large square area to imagery and then repeat a tall title/count block; two-column recipe cards also leave substantial empty areas when photos are unavailable. At phone size this reduces visible choices and increases scrolling.

**Fix:** define image aspect ratios by card role, use a compact collection cover, and keep title + metadata within a predictable two/three-line card. For recipe grids, retain a stable aspect ratio and compact fallback state. Preserve sensible touch targets (48dp minimum) while reducing decorative padding.

**Impeccable:** `/impeccable layout`.

### [P2] Recipe-detail bottom action may cover content

“Start cooking” is pinned over the ingredient list at the bottom of the captured detail. The last visible ingredient content approaches the action container, so verify that scroll content receives bottom inset/padding and can be read above the CTA.

**Fix:** account for the sticky action’s measured height plus navigation-bar inset in the scroll content; verify the final ingredient and instructions are fully reachable at large font scale and with the keyboard/IME where applicable.

**Impeccable:** `/impeccable adapt` and `/impeccable audit`.

### [P2] Assistant suggestions dominate the conversation

The assistant reply is followed by several full-width/high-emphasis green suggestion pills, which visually compete with the actual answer and input. One suggestion is a long sentence, making the chip surface especially broad.

**Fix:** present suggestions as lower-emphasis, horizontally scrollable or compact outlined chips; show fewer at once and let the response remain primary. Keep the composer clear and comfortably thumb-reachable.

**Impeccable:** `/impeccable distill`, then `/impeccable layout`.

## Native Android notes

## Applied Impeccable playbooks to the reviewed screens

These are evidence-based review passes on the existing captures. No playbook was used to claim source edits or test states that weren’t reached.

### `/impeccable critique`

- **Specificity:** the wordmark, food imagery, and green/sage palette give DesiKitchen its own identity. The layout is strongest on the recipe detail and weakest on the Discover landing screen, where several unrelated tasks compete in the first viewport.
- **Cognitive load:** moderate-to-high on Discover: import, recent recipes, collections, and a large greeting all ask for attention. Assistant suggestions also present five large prompts after an already long answer.
- **Emotional journey:** appetizing imagery creates a good entry; blank “PP”/“RC” image tiles undermine confidence; recipe detail returns to a clear, useful cooking action.
- **No P0 blockers observed** in the screens reviewed. P1/P2 findings are listed above. Import, paywall, cooking, and error paths remain unreviewed.

### `/impeccable layout`

- **Discover reading order:** identity/greeting → import → saved recipes → collections. The greeting and import consume substantial space before the user reaches saved food; compress the header and demote import.
- **Grouping/rhythm:** horizontal rails and collection cards are understandable, but multiple large sections and oversized gaps make the screen feel longer and less scannable than its content requires.
- **Structure/density:** two-column recipe grids are appropriate, but image fallbacks need the same compact geometry as real photos. Add equal leading/trailing content padding to horizontal rails.
- **Fixed elements:** the recipe-detail cooking action and bottom navigation require explicit scroll insets so the last row/action is never occluded. This needs a source/device check.

### `/impeccable typeset`

- Preserve the product’s existing face and casual voice; do not replace the brand type based on screenshots alone.
- The display headline and section headings dominate Discover. Reduce their role contrast/vertical footprint before shrinking essential body text.
- Keep recipe names and cuisine/time metadata readable instead of truncating key words. Use at most two lines for titles and reflow secondary metadata rather than cutting it mid-label.
- Actual Compose `sp` roles, line heights, font scale behavior, and localization cannot be verified without source and font-scale captures.

### `/impeccable harden`

- **Missing data:** compact, consistent photo fallback for Palak Paneer and Rajma Chawal; do not render initials as giant image content.
- **Long content:** test long recipe/collection names and assistant suggestions; wrapping should not expand chips across nearly the whole screen or hide key metadata.
- **Network/error/empty states:** image loading, offline browsing, import validation, assistant failures, and search-empty states were not triggered. They remain explicit follow-up tests, not assumed defects.

### `/impeccable adapt`

- Evidence covers one portrait phone only. The visible horizontal rails and two-column grid need checks at narrow width and larger font scale; verify they wrap/scroll without cropping controls or essential titles.
- Check recipe-detail bottom padding against gesture/navigation bars and test the keyboard on search/chat.
- Tablet, landscape, foldable, and multi-window behavior are unverified; use Android window size classes and restructure navigation for expanded width rather than stretching the phone layout.

### `/impeccable audit` (native)

- **Observed:** bottom navigation has five text labels; search has a content description in the first hierarchy dump. Profile shows a “Keep screen on” setting (off in the captured state) and says Cook mode stays awake.
- **Not verified:** TalkBack traversal and announcements, 48dp targets, contrast ratios, dark theme, dynamic colors, font scaling, predictive Back, recomposition/list performance, and multi-window behavior. APK screenshots cannot establish these implementation properties.
- Do not run the web detector on the APK or treat a regex scan as a native audit. Obtain the Compose project for source-level checks and a build for verification.

### `/impeccable polish`

Recommended fix order for when source is available: (1) image fallbacks and any confirmed content occlusion; (2) Discover density, carousel bounds, and title wrapping; (3) Assistant suggestion hierarchy; (4) verify Material roles, accessibility, font scaling, dark appearance, and all relevant states; then capture the same screens again for a final visual pass. Preserve existing identity and behavior outside those scopes.

- Keep the current branded palette but express it through Material color roles, including a tested dark scheme and accessible contrast; do not replace the palette merely to satisfy a generic “beige slop” rule.
- Verify every custom control against Material 3 behavior, 48dp minimum touch targets, system/predictive Back, and status/navigation/IME insets.
- The project’s Compose source is needed to assess hard-coded colors, text scale, semantics, lazy-list usage, and detector regex findings. Per Impeccable’s native guidance, `detect` is not a substitute for source-aware native review and should not be run as though it validates the Android UI.
- Follow-up checks should include TalkBack traversal, 1.3× system font scale, dark mode, and the key recipe flow on-device.

## Review limits / next step

This is a visual first pass, not a complete feature-flow audit. The installed APK was pulled locally to `/tmp/opencode/desikitchen-audit/desikitchen-1.2.0.apk`; it is not source code and cannot safely be edited into a maintainable build. Provide the Kotlin/Compose project or its Git URL to implement and verify the improvements. Captures under `/tmp/opencode/desikitchen-audit/screens/` include signed-in personal app content; keep them private and do not publish or commit them without redaction.
