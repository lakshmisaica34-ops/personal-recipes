# DesiKitchen — Night Build & Install Report (2026-10-31)

## UPDATE — Reference theme redesign (built, pending install)

A full theme pass was applied to match the user's Pinterest reference
("Recipe Cooking App — Clean & Delightful Mobile UI" by Nurina Laraswati), translated to
**sage green instead of the reference's orange**. All screens, all builds green.

**Reference → token translation**
| Reference | DesiKitchen |
|---|---|
| Orange accent surfaces, white bold text | Deep sage `SoftSageDeep #3F8F6C` + `OnSage` white (3.9:1 ≥ 3:1 large-text AA) |
| Warm cream page ground | `Paper #F7F6F1` (was sage-pale `#F3FAF6`) |
| White floating cards + soft shadows | Unchanged `Canvas` white, warm `Hairline #EAE8E3`, warm `Chip #F1F0EC` |
| Bold headings | `titleMedium` SemiBold → **Bold**; headlines stay Nunito ExtraBold |

**Cascade changes**
- `Theme.kt`: `primary = SoftSageDeep`, `onPrimary = White`, `background = Paper`, warm surface-container ladder.
- `Soft.kt`: `PillButton` = deep-sage fill / white bold text / 54dp / softly elevated; `SoftField` = white + soft shadow; `NumberBadge` gets a `current` flag (solid-sage + white number vs warm-gray); `SoftPageGround` → `Paper`.
- `Components.kt`: white heart-circle on photos; new `PhotoTimeBadge` (white time pill overlaid on photos).
- `DiscoverScreen.kt`: greeting + 👋, headline with "**cook**" in sage, full white search bar → rails, import demoted to a sage-tinted accent card (stays on top when the library is empty), sage-deep "View all" links, `RecentPhotoTile` → reference recipe card.
- `DesiKitchenRoot.kt`: lifted white bottom bar, sage icon on sage pill, Ink bold label.
- `RecipeDetailScreen.kt`: **full-bleed hero** (edge-to-edge below status bar, `photoHeight = maxWidth * 0.9f`, no rounding/shadow), white sheet pulled up `SheetOverlap = 28.dp` over the photo's bottom, sage 56dp **play FAB centered on the seam**, dot meta row (time · cuisine · servings), ingredient rows with 40dp sage initial chips + right-aligned bold quantities + hairlines.
- `CookingScreen.kt`: accent "n / N" counter, 3-tone progress segments (done SoftSage / current SoftSageDeep / upcoming SoftSageFill).

**Deliberate deviations from the reference** (product truth, not laziness): no star ratings
(no rating data — never fabricated), no categories strip, no ☰/bell dead icons, sage
letter-chips instead of ingredient emoji, 5 tabs kept, brand typeface Nunito kept.

**Status**: `assembleDebug` green (1m 44s). APK ready at
`app/build/outputs/apk/debug/app-debug.apk`. Install blocked on ADB reachability — see
"ADB status" below. A passive watcher (`watch3.sh`) installs on reconnect, then captures
verification screenshots.

---

## Scraper keys wired (root-cause fix)

The scraper was broken because the build had **empty** `BuildConfig` keys →
`CreatorsApiClient.create()` returned `null` → feature off. No scraper code was ever
faulty; it was purely missing build-time config.

`local.properties` (git-ignored) now carries all four values read by
`build.gradle.kts::secret()`:

| Key | Value / source |
|---|---|
| `CREATORS_API_URL` | `https://api.scrapecreators.com/v1` — documented in `CreatorsApiClient.kt`'s header comment |
| `CREATORS_API_KEY` | provided by user |
| `OPENROUTER_API_KEY` | provided by user |
| `OPENROUTER_MODEL` / `_TEXT_MODEL` / `_STILLS_MODEL` | left blank → code defaults (`gemini-2.5-flash` / `mistral-nemo` / `gemini-2.5-flash-lite`) |

**Both keys verified live before shipping** (a bad key silently disables the feature):
- OpenRouter `/api/v1/key` → HTTP 200, budget $50, ~$47.57 remaining.
- ScrapeCreators `/v1/instagram/post` with a deliberately invalid URL → HTTP 404
  `not_found`, `credits_remaining: 821`, 0 credits charged. The 404 is the *correct*
  response for a bad URL and proves the `x-api-key` auth was accepted.

The theme redesign + scraper keys are compiled into the **same APK**, so one
`install -r` ships both.

---

## ADB status (as of redesign pass)

The agent runs **on the phone itself** (Termux proot Debian container, model I2405, uptime
4 days). `su` inside the container is proot's uid mapping, **not** real Android root — real
UID is 10534 (Termux), so `pm install` / `screencap` / `dumpsys` are all denied. ADB is the
only install path.

The previously-working wireless-debugging port (`192.168.1.16:37207`) now returns
**Connection refused** — Android rotates the port, or wireless debugging toggled off. The
phone's IP also changed to `192.0.0.2` (CGNAT). `adb mdns services` is unavailable in the
Termux adb build. A localhost port scan (30000–65535) is used to find a rotated adbd port.
**Only the user can restore access**: Settings → Developer options → Wireless debugging.

---

# Original report (prior pass)

### Code changes (shipped in the APK)
1. **`ui/components/Components.kt` — `RecipeArt` monogram fallback**
   Bare initials floating in a photo-sized sage square are now a designed avatar chip:
   a `BoxWithConstraints`-scaled circle (`min(w,h) * 0.44`) in `SoftSageFill` with a
   `Hairline` border, monogram font clamped to the chip. Reads intentional at every tile
   size (grid tile, recent strip, detail hero).
2. **`ui/discover/DiscoverScreen.kt` — `RecentPhotoTile` title**
   `maxLines = 1` → `2` so recipe names ("Weeknight Chana Masala") don't ellipsize prematurely.

### Verified structurally, no change needed
- **Sticky "Start cooking" bar** (`RecipeDetailScreen.kt:214`): the LazyColumn already reserves
  `FloatBarHeight + FloatBarGap + SheetBottomAir + navInset` — content clears the bar.

### Test-only change (not in the APK)
- **`app/src/test/resources/robolectric.properties`** — `conscryptMode: OFF`
  (conscrypt 2.5.2 ships no linux-aarch64 native; tests do no TLS).

### Finding: Assistant "dark green pills"
The dark-green white-text suggestion pills seen in the previously installed APK have **no
matching component in this source** — the installed build predates these source edits
(`SoftChip` is pale sage `SoftSageFill`, `PillButton` is `SoftSage`+Ink). The new build
renders the current design; no code change made.

## Environment fixes (Termux, aarch64)
| Blocker | Fix |
|---|---|
| Gradle wrapper download timeout (services.gradle.org) | Gradle 8.9 direct from Tencent mirror, invoked outside the wrapper |
| Google AAPT2 is x86_64, host is aarch64 | `android.aapt2FromMavenOverride` → Termux native `aapt2` (kept in `~/.gradle/gradle.properties`, not the project) |
| Missing `~/.android/debug.keystore` | Generated standard debug keystore (`androiddebugkey`) |
| Room/KSP crash: sqlite-jdbc has no bionic aarch64 native | Patched cached jar: bionic `Linux-Android/aarch64/libsqlitejdbc.so` swapped into the `Linux/aarch64` slot (`.orig` backup kept) |
| Robolectric screenshot tour: conscrypt + native graphics have no linux-aarch64 | conscrypt bypassed (see above); **native graphics has no aarch64 build even in 2026 releases** → JVM screenshots not possible on this host; on-device capture watcher used instead |

## Data safety
- Full backup taken **before** the swap: `/tmp/opencode/desikitchen-backup/dk-backup-full.tar`
  (DB + WAL + `files/` incl. imported photos + `shared_prefs`), integrity `ok`,
  30 recipes / 3 cookbooks / 2 meal plan / 20 grocery items / `plus_unlocked=true`.
- Signature mismatch forced uninstall → install → restore via `run-as … tar -xf -` (stdin).
- After restore: app alive, **zero crashes**, Room opened the restored DB, settings intact.

## Install note (future updates)
The app is now signed with the generated debug keystore
(SHA-256 `95fdfb93e6866d287af87693241deebca99bd47a7a99f85ffe54bb21bfa6463a`).
Future `adb install -r` updates must use this machine's keystore
(`~/.android/debug.keystore`), or repeat the backup → uninstall → install → restore cycle.

## Verification status
- Compile-level: both edits compile; APK built, installed, running.
- Visual: blocked by the secure fingerprint lock overnight. A passive watcher
  (`/tmp/opencode/desikitchen-verify/watch.sh`) waits for a natural unlock, then captures
  Discover recent strip, Collections grid, Assistant chips, and the detail sticky bar into
  `/tmp/opencode/desikitchen-verify/`. It never wakes the phone and never touches the lock.
- Phone settings restored: `screen_off_timeout=600000` (your 10 min), `lock_after_timeout` untouched.
