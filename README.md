# Gravity Shift

A one-touch gravity-flip runner that runs in any browser, offline, with no game engine and no dependencies.

You never stop moving. Tap, click or press space to flip gravity and run the ceiling or the floor. Spikes sit on both surfaces, the shaft keeps speeding up, and every shard you snag raises the combo multiplier. One mistake ends the run.

**Play:** https://saharrison2100.github.io/gravity-shift/

## Controls

| Action | Keyboard | Touch / mouse |
| --- | --- | --- |
| Flip gravity | `Space`, `↑`, `W`, `↓`, `S` | Tap anywhere |
| Pause | `P` or `Esc` | Pause on screen |
| Restart | `R` | Run again |
| Mute | `M` | Sound button |

## What is in here

- `docs/` — the whole game. `index.html`, `game.js`, a PWA manifest, a service worker and icons.
- `capacitor.config.json` — Android wrapper config (web assets served from `docs/`).
- `.github/workflows/android-apk.yml` — builds a debug APK on every push and attaches it to the `v1.0.0` release.

## Tech notes

- Pure Canvas 2D. Delta-timed single `requestAnimationFrame` loop, fixed 960×540 design space scaled to any viewport, device-pixel-ratio aware.
- Procedural level sections: gap floors, gap ceilings, spike runs, staggered corridors and gauntlets, with difficulty ramping over the first 78 seconds.
- Web Audio API generated sound effects (no audio files), `localStorage` best score, particles, screen shake, hit flash.
- Installable as a PWA (Add to Home Screen) and shippable as an Android app through Capacitor.

## Run locally

```bash
npx http-server docs -p 8080 -c-1
# open http://localhost:8080
```

## Build the Android APK

```bash
npm install
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

Or let GitHub Actions do it: every push to `main` builds the APK and publishes it to the releases page.

## Built for

The Base44 $65K Web Game Contest (deadline 3 December 2026). The Base44 build of the same game is the contest entry; this repository is the standalone source.
