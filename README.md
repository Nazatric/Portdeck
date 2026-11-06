# PortDeck

A calm, full-screen workspace for opening and previewing local React, Next.js-style, and static HTML projects — native Android. Everything the app needs ships with it: interface, icons, React runtimes, and the offline preview engine, so previews work without a network. PortDeck is Android-only; there is no web build.

## Features

- **Any size.** Import a folder, ZIP, or loose files. There is no size or file-count limit; the only bound is free space on the device. Files are streamed into app storage and served to the preview straight from disk. `node_modules` and `.git` are skipped; build output (`dist`, `build`, `out`, …) is kept, so ready-built sites, SPAs, PWAs — and Wasm sites — open as they are.
- **Online and offline.** React 18/19, Tailwind CSS, the compiler, and the interface are bundled. npm packages, CDN scripts, stylesheets, and web fonts a project uses are downloaded the first time it runs online and kept, so the same project then runs offline. Anything still needing the network is listed in the Info panel.
- **Runs real web apps.** Runtime `fetch()`/XHR, images and media set from JavaScript or `innerHTML`, CSS `url()`, workers, `import.meta.glob`, computed dynamic imports, `new URL(…, import.meta.url)`, project import maps, inline module scripts, circular imports, tsconfig path aliases, Next.js layouts and `_app`, and BrowserRouter apps work in the preview. Links between HTML pages navigate inside the preview. `localStorage`, `sessionStorage`, cookies, and IndexedDB work inside the sandbox; service worker registration is accepted and skipped.
- **Devices and full screen.** Fill, Phone, and Tablet preview modes, with a Portrait/Landscape toggle for Phone and Tablet. Fill uses the whole preview area edge to edge; the fullscreen control hides the system bars, and a small floating switcher changes the preview mode without leaving full screen.
- **A real library.** Imported projects are kept on the device and listed in the Projects tab. Hold a project to open a context menu with Open and Delete — deleting removes the project and its files. Projects survive restarts; only the built-in demos are read-only.
- The preview runs in a sandboxed frame with no real URL, so apps that read `location.pathname` directly start at their default route, and server-only code and native Node.js modules do not run.

## Android app (Kotlin Multiplatform / Compose Multiplatform)

`multiplatform/` holds the app: shared Compose UI (`commonMain`) and the Android target. JDK 17, SDK platform 35, and build tools 35.0.0 are required.

```sh
cd multiplatform
gradle :composeApp:assembleDebug --no-daemon   # Gradle 8.11.1; CI installs it for you
```

The Android app draws edge to edge, requests the display's highest refresh rate, keeps its state across rotation, returns to the library on system back, hides the system bars in full screen, and has an adaptive launcher icon and dark splash. Imported apps run in a sandboxed WebView; the interface itself is native Compose.

Projects open with a shared-element morph from the card to the workspace. The live preview mounts once the morph settles.

### Preview engine (`multiplatform/engine/`)

The preview engine (compiler, sandboxed runtime, Android host) is TypeScript source committed under `multiplatform/engine/`, bundled into the committed `engine.js` asset the app serves. Edit it there; never hand-edit the bundle.

```sh
cd multiplatform/engine
npm ci
npm test             # headless end-to-end check of the preview pipeline (all demos + synthetic projects)
npm run format       # prettier --write
npm run format:check # what CI enforces
npm run build        # rewrites ../composeApp/src/androidMain/assets/engine/engine.js
```

`tools/prepare-native.sh` wraps the install, test, and build steps.

### Regenerating bundled assets

`tools/generate-assets.mjs` downloads pinned sources once and writes committed modules:

- `composeApp/.../IconData.kt`: Lucide 1.67.0 icons (ISC) and Simple Icons 16.36.0 brand marks (CC0), normalised to single path strings.
- `multiplatform/engine/src/lib/vendor/react.generated.ts`: production React 18 and 19 builds (MIT).
- `multiplatform/engine/src/lib/vendor/tailwind.generated.ts`: Tailwind CSS browser build (MIT).
- `multiplatform/engine/src/lib/vendor/indexeddb.generated.ts`: fake-indexeddb (Apache-2.0), used where the sandbox blocks IndexedDB.

```sh
node tools/generate-assets.mjs
```

Formatting and code style: [prettier](https://prettier.io) for the engine (`npm run format`), [Spotless](https://github.com/diffplug/spotless) with ktlint for the Kotlin sources (`gradle :composeApp:spotlessApply`). CI enforces both.

## Build in CI

Push to GitHub and open **Actions > PortDeck Builds**. Two jobs run in parallel:

- **Verify preview engine** — prettier check, the headless pipeline test, and a rebuild that fails if the committed `engine.js` does not match the source.
- **Build Android APK** — spotless check, then `assembleDebug`; the APK is uploaded as the `portdeck-android` artifact (versionCode 3 / 1.2.0).

Gradle is cached between runs via `gradle/actions/setup-gradle`, and runs on the same ref cancel superseded runs.

## Goose

`tools/goose/asset_guard.goose`, written in [aardappel/goose](https://github.com/aardappel/goose), verifies the generated native assets during CI. The application runtime is Kotlin, Compose, and JavaScript.
