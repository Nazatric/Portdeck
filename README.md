# PortDeck

A calm, full-screen workspace for opening and previewing local React, Next.js-style, and static HTML projects. Everything the app needs ships with it: interface, icons, React runtimes, and the Tailwind CSS engine are bundled, so previews work offline.

## Web app (Next.js)

```sh
npm ci
npm run dev
```

- **Any size.** Import a folder, ZIP, or loose files, or drop them anywhere on the library. There is no size or file-count limit; the only bound is free space on the device. Each file is stored as its own Blob in IndexedDB (copied by the browser, never held in memory), ZIPs are read as a stream, and the import shows live progress and can be cancelled. `node_modules` and `.git` are skipped; build output (`dist`, `build`, `out`, …) is kept, so ready-built sites, SPAs, and PWAs open as they are, including Vue, Svelte, and Angular builds.
- **Online and offline.** React 18/19, Tailwind CSS, the compiler, and the interface are bundled. npm packages, CDN scripts, stylesheets, and web fonts a project uses are downloaded with their whole module graph the first time it runs online and kept in Cache Storage, so the same project then runs offline. The Info panel lists anything still needing the network.
- **Runs real web apps.** Runtime `fetch()`/XHR, images and media set from JavaScript or `innerHTML`, CSS `url()`, workers, `import.meta.glob`, computed dynamic imports, `new URL(…, import.meta.url)`, project import maps, inline module scripts, circular imports, tsconfig path aliases, Next.js layouts and `_app`, and BrowserRouter apps work in the preview. Links between HTML pages navigate inside the preview, with a chip to return to the start page; any HTML file can be previewed from Files. `localStorage`, `sessionStorage`, cookies, and IndexedDB work inside the sandbox; service worker registration is accepted and skipped.
- **Devices and orientation.** Fit, Phone, Tablet, and Desktop. Phone and Tablet show a Portrait/Landscape toggle; turning animates the frame rotating, and the app keeps its state. In full screen a small rotate/exit control fades when idle.
- Console, Files (virtualized for very large projects, with a source viewer), and Info open in a resizable bottom sheet.
- Keyboard: `R` reload, `F` full screen, `1`–`4` device size, `O` portrait/landscape, `Esc` close or exit.

The preview runs in a sandboxed frame with no real URL path, so apps that read `location.pathname` directly start at their default route, and server routes and native Node.js modules do not run.

### Regenerating bundled assets

`tools/generate-assets.mjs` downloads pinned sources once and writes committed modules:

- `src/components/icon-data.ts` and `composeApp/.../IconData.kt`: Lucide 1.67.0 icons (ISC) and Simple Icons 16.36.0 brand marks (CC0), normalised so web and Compose share the exact same paths.
- `src/lib/vendor/react.generated.ts`: production React 18 and 19 builds (MIT).
- `src/lib/vendor/tailwind.generated.ts`: Tailwind CSS browser build (MIT).
- `src/lib/vendor/indexeddb.generated.ts`: fake-indexeddb (Apache-2.0), used where the sandbox blocks IndexedDB.

```sh
node tools/generate-assets.mjs
```

## Native targets (Kotlin + Compose Multiplatform)

`multiplatform/` holds shared Compose UI for an Android app and a Kotlin/Wasm web target. Both use the same palette, icon set, and offline preview engine. The engine source lives in `multiplatform/engine/` and bundles into the committed `engine.js` / `host.js` assets the apps serve.

```sh
npm ci
./tools/prepare-native.sh
cd multiplatform
./gradlew :composeApp:assembleDebug --no-daemon
./gradlew :composeApp:wasmJsBrowserDistribution --no-daemon '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8'
```

Android requires JDK 17, SDK platform 35, and build tools 35.0.0. Imports have no size limit: files are streamed into app storage and served to the preview straight from disk. Phone and tablet previews have the same portrait/landscape toggle and turning animation, and pages lay out at true device width. The Android app draws edge to edge, requests the display's highest refresh rate, keeps its state across rotation, returns to the library on system back, hides the system bars in full screen, and has an adaptive launcher icon and dark splash. Imported apps run in a sandboxed WebView; the interface itself is native Compose.

Projects open with a shared-element morph from the card to the workspace. The live preview mounts once the morph settles.

Known limitation: in headless testing of the Kotlin/Wasm build, the toolbar directly above the live preview was not repainted while the preview overlay was visible. Layout and input remain correct, and the issue disappears when the overlay is hidden. It has not yet been checked on a GPU-accelerated browser. The Next.js web app and Android app do not use this overlay.

### Preview engine (`multiplatform/engine/`)

The preview engine (compiler, sandboxed runtime, Android and Wasm hosts) is TypeScript source committed under `multiplatform/engine/`. Edit it there; never hand-edit the bundles.

```sh
cd multiplatform/engine
npm ci
npm test        # headless end-to-end check of the preview pipeline (all demos)
npm run build   # rewrites ../composeApp/src/androidMain/assets/engine/engine.js and
                # ../composeApp/src/wasmJsMain/resources/host.js
```

Commit both the source and the rebuilt bundles. CI fails the "Verify preview engine" job when the committed bundles do not match the source.

## Build in CI

Push to GitHub and open **Actions > PortDeck Builds**. The jobs verify the preview engine bundles, build the Android app, and build the Wasm distribution, uploading their artifacts.

## Goose

`tools/goose/asset_guard.goose`, written in [aardappel/goose](https://github.com/aardappel/goose), verifies the generated native assets during CI. The application runtime is Kotlin, Compose, and JavaScript.
