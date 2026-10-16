# Piaf developer handbook

Everything you need to understand, run, test, change and deploy Piaf without outside help.
Code comments and the user interface are in French; this handbook is in English. Identifiers
(file names, functions, constants) are quoted exactly as they appear in the code.

## Table of contents

1. [What Piaf is](#1-what-piaf-is)
2. [Repository map](#2-repository-map)
3. [Quick start](#3-quick-start)
4. [Architecture and data flow](#4-architecture-and-data-flow)
5. [The Web Worker](#5-the-web-worker)
6. [The model](#6-the-model)
7. [Building `model/`, `vendor/` and icons](#7-building-model-vendor-and-icons)
8. [User interface](#8-user-interface)
9. [Offline support: the service worker](#9-offline-support-the-service-worker)
10. [Storage and privacy](#10-storage-and-privacy)
11. [iNaturalist photos](#11-inaturalist-photos)
12. [Testing](#12-testing)
13. [Deployment](#13-deployment)
14. [Licences](#14-licences)
15. [How do I... (recipes)](#15-how-do-i-recipes)
16. [Troubleshooting](#16-troubleshooting)
17. [Known limitations and ideas](#17-known-limitations-and-ideas)

---

## 1. What Piaf is

Piaf identifies birds by their song, entirely in the browser. It is a static, installable web app
(PWA) built on **BirdNET V2.4** (a TensorFlow.js export of the Cornell Lab / Chemnitz model). It
exists so that people whose phone cannot install Merlin Bird ID (for example an iPhone 8 stuck on
iOS 16) can still identify birds. It also runs on recent phones and desktops.

Design constraints that explain most decisions in the code:

- **No server, no build step.** Plain ES modules in the page, a classic script in the Web Worker.
  Hosting is GitHub Pages, which cannot set custom HTTP headers.
- **Everything on the device.** Audio never leaves the phone. Only a species' scientific name is
  sent to iNaturalist, to fetch a photo.
- **Must run on an iPhone 8** (iOS 16, Safari): little memory, a slow CPU/GPU, microphone stops in
  the background. One analysis of a 3 s window must stay under 1500 ms (the hop is 1.5 s).
- **Works offline** after the first visit (about 26 MB model + 15 MB geographic model).

Tech stack: TensorFlow.js 4.22.0 (WebGL / WebAssembly / CPU backends), Web Audio
(`AudioWorklet`), Web Workers, Service Worker, `localStorage`. Dev tooling: Node (checks, vendoring)
and Python (model conversion, icons).

---

## 2. Repository map

| Path | Role |
|---|---|
| [`../index.html`](../index.html) | The single page: three views, bottom tabs, species card `<template>`, credits |
| [`../css/app.css`](../css/app.css) | All styles; design tokens in `:root` |
| [`../js/app.js`](../js/app.js) | UI controller: wires microphone, worker, cards, life list, settings, geo filter, tabs |
| [`../js/audio.js`](../js/audio.js) | `Microphone` class (getUserMedia + AudioWorklet + AnalyserNode) and `decodeFile()` |
| [`../js/capture-worklet.js`](../js/capture-worklet.js) | `AudioWorkletProcessor` `capture`: resample to 48 kHz, 100 ms blocks |
| [`../js/engine-worker.js`](../js/engine-worker.js) | Web Worker: loads TF.js and the models, ring buffer, inference loop, geo filter |
| [`../js/birdnet-core.js`](../js/birdnet-core.js) | `BirdNETCore`: CPU mel-spectrogram layer, FFT, constants, `birdnetWeek()`. Shared by the page, the worker and Node tests |
| [`../js/spectrogram.js`](../js/spectrogram.js) | Scrolling spectrogram canvas (magma colormap, 0-12 kHz) |
| [`../js/species-info.js`](../js/species-info.js) | iNaturalist lookup, rate limiting, 30-day cache |
| [`../js/lifelist.js`](../js/lifelist.js) | Life list in `localStorage`, JSON export/import |
| [`../sw.js`](../sw.js) | Service worker (offline, three caches) |
| [`../manifest.webmanifest`](../manifest.webmanifest) | PWA manifest (name, icons, colours, `start_url: "./"`) |
| [`../icons/`](../icons) | `icon.svg` (single source) + rendered PNGs |
| `../model/audio/`, `../model/geo/` | Float16 TF.js models (generated, committed) |
| [`../model/species.json`](../model/species.json) | 6522 labels `[scientific, French, English]` (generated, committed) |
| [`../model/LICENSE.md`](../model/LICENSE.md) | Model licence, attribution and list of modifications (hand-written, kept by the build) |
| `../vendor/` | TF.js 4.22.0 files copied from `node_modules` (generated, committed) |
| [`../tools/build_model.py`](../tools/build_model.py) | Regenerates `model/` from Zenodo |
| [`../tools/check_model.mjs`](../tools/check_model.mjs) | Compares our model + CPU mel layer to the official one |
| [`../tools/vendor.mjs`](../tools/vendor.mjs) | Copies TF.js into `vendor/` |
| [`../tools/make_icons.py`](../tools/make_icons.py) | Renders PNG icons from `icon.svg` |
| [`../package.json`](../package.json) | Scripts `vendor`, `check`, `serve`; TF.js dev dependencies pinned to 4.22.0 |
| [`../.gitattributes`](../.gitattributes) | LF everywhere, binaries flagged (see [Deployment](#13-deployment)) |
| `../.cache/` (git-ignored) | Zenodo zips and the extracted official model + `sample.wav` |
| `../node_modules/` (git-ignored) | Only for `npm run vendor` and `npm run check` |

The site itself needs none of `node_modules`, `.cache`, `tools` or `docs` at runtime.

---

## 3. Quick start

Prerequisites:

- A recent Chrome/Edge/Firefox/Safari.
- Python >= 3.8 (for `npm run serve`, `build_model.py`, `make_icons.py`).
- Node.js + npm (only for `npm run check` and `npm run vendor`).
- `model/` and `vendor/` are already committed: you can run the site without installing anything.

```bash
git clone https://github.com/YannickRiou/birdnet-web.git
cd birdnet-web
npm run serve            # = python -m http.server 8080
```

Open <http://localhost:8080>. `localhost` counts as a secure context, so the microphone, the
service worker and `AudioWorklet` all work. Any other host needs HTTPS.

Optional, to run the model check and to get the official sample:

```bash
python tools/build_model.py   # downloads zips into .cache/, extracts .cache/orig/ (sample.wav, official model)
npm install
npm run check
```

Set your own git identity in the repo (it uses a local identity, not a global one):

```bash
git config user.name  "Your Name"
git config user.email "you@users.noreply.github.com"
```

Commit messages are in English.

Useful URL parameter: `?backend=webgl|wasm|cpu` forces a compute backend (see
[Backend choice](#backend-choice)).

---

## 4. Architecture and data flow

Three execution contexts cooperate: the **UI thread** (page), the **audio rendering thread**
(`AudioWorklet`) and the **worker thread** (`engine-worker.js`). The key rule: **audio samples never
touch the UI thread.** The worklet gets a `MessageChannel` port whose other end is transferred
straight to the worker.

```
 Microphone
    |  getUserMedia({echoCancellation:false, noiseSuppression:false,
    |                autoGainControl:false, channelCount:1})
    v
 MediaStreamSource --------------------------------+
    |  (AudioContext at the DEVICE sample rate)     |
    v                                               v
 AudioWorkletNode 'capture'                    AnalyserNode (fftSize 1024)
 js/capture-worklet.js                              |  getByteFrequencyData() each frame
 - linear resample -> 48 kHz mono                   v
 - 100 ms blocks (4800 samples)                js/spectrogram.js
    |                                          magma colormap, 0-12 kHz
    |  MessageChannel port (transferred         (UI thread, canvas)
    |  to the worker; blocks are transferred,
    |  not copied; UI thread never sees them)
    v
 Web Worker  js/engine-worker.js
 - ring buffer of 3 s (WINDOW = 144000 samples)
 - every HOP = 1.5 s, IF not busy: copy the latest 3 s,
   run BirdNET (TF.js) -> 6522 sigmoid scores
 - keep top 5 scores >= 0.1
    |  postMessage {type:'result', detections:[[index, score],...], ms}
    v
 UI thread  js/app.js  onDetections()
 - drop NON_SPECIES, drop score < user threshold
 - geo filter: drop species with geoScores[index] < 0.03
 - update `detected` map -> rerender() -> species cards
    |
    +--> js/species-info.js  (iNaturalist photo, async, 1 req/s)
    +--> js/lifelist.js      (user taps "+ Ma liste")
```

Points worth knowing:

- **Slow devices skip windows.** `schedule()` in the worker returns immediately if `busy`. When an
  inference finishes, it calls `schedule()` again, which analyses the *most recent* 3 s (not the
  next sequential window). A phone taking 3 s per inference simply produces a result every 3 s.
- **Overlap.** Windows are 3 s long and start every 1.5 s, so consecutive windows overlap by half.
- **AudioContext sample rate** is the device's (44.1 or 48 kHz typically). The worklet resamples
  linearly (`ratio = sampleRate / 48000`); at exactly 48 kHz it copies samples through.
- **The mic nodes are chained to `destination` through a gain of 0** (`this.mute`), because some
  browsers do not run a worklet whose output is not connected. No sound is played.
- **File analysis** (`decodeFile()` in `audio.js`) decodes with an `OfflineAudioContext` at 48 kHz
  (the browser resamples), mixes to mono, then sends the whole `Float32Array` to the worker
  (transferred). The worker analyses non-overlapping 3 s windows; the last window is zero-padded; a
  tail shorter than 1 s is ignored.
- **iOS rules.** `Microphone.start()` must run from a user gesture (it is called from the button's
  click handler). If the context leaves the `running` state (call, Siri, lock screen) or the track
  ends, `onInterrupted` fires and the UI stops listening. `app.js` requests a Screen Wake Lock
  while listening (when `navigator.wakeLock` exists) and re-requests it on `visibilitychange`.
  `stop()` suspends the context instead of closing it so restarting is instant.
- **Module systems.** `app.js` and friends are ES modules (`<script type="module">`). The worker is
  a *classic* worker (`new Worker(url)` without `type: 'module'`) using `importScripts`.
  `birdnet-core.js` is a plain IIFE attaching `BirdNETCore` to `self`/`globalThis`, so it works as a
  side-effect import in the page, via `importScripts` in the worker, and via `require` in Node.

### Worker message protocol

All messages are `{type, ...}` objects.

| Direction | `type` | Payload | Meaning |
|---|---|---|---|
| page → worker | `init` | `{backend?}` | Load TF.js backend + audio model, benchmark, reply `ready`. `backend` comes from `?backend=` |
| page → worker | `audioPort` | `{port}` (transferred `MessagePort`) | Direct audio channel from the worklet; each message is a `Float32Array` of 4800 samples |
| page → worker | `listen` | `{on}` | Start/stop live analysis; resets `written` and `lastRun` |
| page → worker | `location` | `{points, area}` | Compute species probable on `points` (`[[lat, lon, week], ...]`); `area` is `'europe'` or `'position'` and is echoed back |
| page → worker | `file` | `{samples}` (transferred `Float32Array`, 48 kHz mono) | Analyse a whole recording |
| worker → page | `progress` | `{value}` 0-1 | Model download progress |
| worker → page | `ready` | `{backend, ms}` | Model ready; `ms` is the benchmark time of one inference |
| worker → page | `result` | `{detections, ms}` | Live result: `detections = [[speciesIndex, score], ...]` (max 5, score >= 0.1, sorted); `ms` is this inference |
| worker → page | `geo` | `{scores, area}` | `scores`: `Float32Array(6522)`, max over the points, transferred |
| worker → page | `fileResult` | `{time, detections, progress}` | One 3 s window of a file; `time` in seconds, `progress` 0-1 |
| worker → page | `fileDone` | none | File analysis finished |
| worker → page | `error` | `{message, during?}` | `during` is the type of the message being handled (`init`, `location`, ...). Errors raised inside the live inference loop have no `during` |

`app.js` handles all of these in the single `worker.onmessage` switch.

### Backend choice

Implemented in `init()` / `useBackend()` in [`../js/engine-worker.js`](../js/engine-worker.js).

1. Candidates are `['webgl', 'wasm']`, or only the forced one when `?backend=` is given.
2. **webgl** is rejected if `tf.setBackend` fails (WebGL in a worker needs `OffscreenCanvas`) or
   if `tf.env().getBool('WEBGL_RENDER_FLOAT32_ENABLED')` is false: some mobile GPUs only compute in
   16 bits, which corrupts the results.
3. **wasm** is the SIMD build, **single-threaded**: multi-threading needs `SharedArrayBuffer`, i.e.
   COOP/COEP headers, which GitHub Pages cannot set.
4. If nothing works, **cpu** (pure JavaScript, very slow; the UI says "JavaScript (lent)").
5. The model is loaded, then **one warm-up inference + one timed inference** with random noise
   (`benchmark()`). If the backend is `webgl` and took more than **600 ms** (and no backend was
   forced), the worker also benchmarks `wasm` and keeps the faster one.

Measured on desktop, per 3 s window: WebGL ~70-120 ms, WASM ~185 ms. **iPhone 8 is not measured
yet**; the budget is < 1500 ms.

---

## 5. The Web Worker

[`../js/engine-worker.js`](../js/engine-worker.js) in more detail.

- **Constants:** `HOP = 1.5 * SAMPLE_RATE`, `MIN_SCORE = 0.1`, `MAX_RESULTS = 5`.
- **Ring buffer:** `ring` (`Float32Array(WINDOW)`) written at `written % WINDOW`; `windowBuf` is the
  linearised copy of the latest 3 s handed to the model. `written` counts samples since `listen`
  was switched on; nothing runs until `written >= WINDOW` (the first result comes after 3 s).
- **`infer(samples)`:** `tf.tensor2d(samples, [1, WINDOW])` → `model.predict` → `output.data()`.
  Tensors are disposed manually; the models are in a TF.js layers format.
- **`topScores`:** indices with score >= `MIN_SCORE`, sorted, top 5. The UI threshold (10-90 %) is
  applied later in `app.js`, so the worker floor of 0.1 must stay <= the slider minimum.
- **Geo model:** `geoFilter(points)` loads `model/geo/model.json` with `tf.loadGraphModel`,
  predicts on `[N, 3]`, takes `output.max(0)`, then **disposes the model**. It is loaded on demand
  and freed right away because memory is tight on an iPhone 8. It is re-run (not cached) every
  time the page asks, i.e. at startup (`computeArea()` on `ready`) and when settings change.
- **Errors** are caught in `self.onmessage` and posted as `{type:'error', message, during}`.

---

## 6. The model

### Audio model (`model/audio`)

BirdNET V2.4, TF.js **layers** model.

| | |
|---|---|
| Input | `float32 [batch, 144000]`: 3 s, mono, 48 kHz, nominally in [-1, 1] |
| Output | `[batch, 6522]` sigmoid scores (independent per class, not a softmax) |
| Output order | Same order as [`../model/species.json`](../model/species.json): `[scientific, French, English]` per entry |
| Weights | float16 on disk (TF.js decodes to float32 at load), 7 shards of up to 4 MB |

**11 classes are not species** and must never be shown: `Dog`, `Engine`, `Environmental`,
`Fireworks`, `Gun`, `Human non-vocal`, `Human vocal`, `Human whistle`, `Noise`, `Power tools`,
`Siren`. They live in `NON_SPECIES` (a `Set` of scientific-name field values) in
[`../js/birdnet-core.js`](../js/birdnet-core.js) and are filtered in `onDetections()` and when
counting probable species in `updateGeoStatus()`.

### Why `MelSpecLayerSimple` is reimplemented

The model begins with two custom layers, `MelSpecLayerSimple`, which turn audio into mel
spectrograms. The official layer uses `tf.signal.stft`, which is a naive O(n²) DFT on GPU and takes
about 67 s on the Node CPU backend. [`../js/birdnet-core.js`](../js/birdnet-core.js) replaces it with a CPU
implementation (`registerMelLayer(tf)` registers the class under the same name before the model is
loaded). On the official sample: ~1.4 s instead of ~65 s in Node, with a max absolute difference of
8.6e-4 on the scores.

The layer's `call()` does, per batch item:

1. **Normalise** (`normalize()`): min → -1, max → +1, per window (`scale = 2 / (max - min + 1e-6)`).
2. **Frame + window:** periodic Hann window (like `tf.signal.hannWindow`), frame step from config.
3. **FFT:** radix-2 `FFT` class; **two real frames are packed into one complex FFT**
   (`z = a + i·b`) and separated afterwards, halving the work.
4. **Keep only the REAL part of the spectrum** (`Re(A[k])`, `Re(B[k])`), not the magnitude. This is
   deliberate: it mimics the original Keras layer's complex → float cast. **Do not "fix" it to
   magnitude**: predictions would change and `npm run check` would fail.
5. **Mel filterbank:** a *sparse* filterbank (non-zero range per mel band) applied to the spectrum.
   The filterbank values come from the layer config inside `model.json`, not from the code.
6. **Square**, then raise to the power `1 / (1 + exp(magnitude_scaling))` (`magnitude_scaling` is a
   layer weight, initial value 1.23, overwritten by the loaded weights).
7. **Reverse the mel bins and transpose** to `[96 mel, 511 frames, 1]` (written directly as
   `out[(mels-1-m) * F + f]`).

The model has two such layers, configured in `model.json`:

| Layer | Frame length | Hop | Frequency range |
|---|---|---|---|
| 1 | 2048 | 278 | 0 - 3 kHz |
| 2 | 1024 | 280 | 500 Hz - 15 kHz |

`input.dataSync()` in `call()` is cheap because the input tensor was created from a CPU array in
`infer()` (no GPU read-back). The layer's output is a CPU-built tensor handed to the backend
(GPU for WebGL), so the heavy convolutions still run on the chosen backend.

Constants exported by `BirdNETCore`: `SAMPLE_RATE` (48000), `WINDOW` (144000), `NON_SPECIES`,
`FFT`, `MelSpec`, `normalize`, `registerMelLayer`, `birdnetWeek`.

### Geo model (`model/geo`)

TF.js **graph** model (BirdNET's "meta" model).

| | |
|---|---|
| Input | `[N, 3]` = `[latitude, longitude, week]` |
| Week | BirdNET week 1-48, four per month: `birdnetWeek(date)` = `month*4 + min(4, floor((day-1)/7)+1)` |
| Output | `[N, 6522]`: probability that each species occurs at that place and week |
| Combination | The worker takes the max over the N points |
| Threshold | `GEO_THRESHOLD = 0.03` in `app.js` (BirdNET's default) |

- **Default area:** continental Europe, `europePoints(week)` in `app.js`: a grid every 2.5° of
  latitude 37-60 °N and longitude 10 °W-30 °E. No permission prompt. About 490 species pass in
  mid-October.
- **"Precise" option:** `navigator.geolocation.getCurrentPosition` → a single point. On refusal or
  error it silently reverts to Europe and unticks the box. The position is never stored or sent.
- Filter state in `app.js`: `geoScores` (null until computed) and `geoArea`. While `geoScores` is
  null the filter lets everything through.

---

## 7. Building `model/`, `vendor/` and icons

You only need this when changing the model, TF.js, or the icon.

### `model/` : `python tools/build_model.py`

Requires Python >= 3.8 and `numpy`. The script:

1. Downloads `BirdNET_v2.4_tfjs.zip` and `BirdNET_v2.4_tflite_int8.zip` from Zenodo record
   **15050749** into `.cache/` and **checks their MD5** (the int8 zip is used only for
   `labels/fr.txt`).
2. Extracts the official model to `.cache/orig/` (needed by `npm run check`; also contains
   `sample.wav`).
3. Converts weights **float32 → float16** by writing the TF.js manifest entry
   `"quantization": {"dtype": "float16", "original_dtype": "float32"}`; TF.js decodes on load. A
   weight whose fp16 error exceeds 1 % (or overflows) would stay float32; currently none do.
4. **Keeps int32 graph constants as-is** (non-float32 entries in the geo graph).
5. Re-shards the output into 4 MB `group1-shardNofM.bin` files and rewrites `model.json`.
6. Writes `model/species.json` from `labels.json` (English) + `labels/fr.txt`, asserting that the
   scientific names agree line by line and that there are 6522.
7. Deletes and rewrites only `model/audio` and `model/geo`: **`model/LICENSE.md` is left untouched**.

The output is deterministic, so re-running without changes produces no git diff. Afterwards:
run `npm run check`, bump `VERSION` in `sw.js`, and update `model/LICENSE.md` if the list of
modifications changed.

### `npm run check` : [`../tools/check_model.mjs`](../tools/check_model.mjs)

Needs `npm install` and `.cache/orig/` from `build_model.py`. It loads, in Node (TF.js CPU backend):

- the **official** fp32 model with a reference `tf.signal.stft` layer (copy of the official example
  code), and
- **our** fp16 model with the CPU layer from `birdnet-core.js`,

runs both on `.cache/orig/sample.wav` (16-bit PCM with a 44-byte header, first 3 s), prints the top
5 of each and the max absolute difference over the 6522 scores. It **exits 1 if the difference is
greater than 0.02**. Run it after any change to `birdnet-core.js`, `build_model.py` or `model/`.

### `vendor/` : `npm install && npm run vendor`

[`../tools/vendor.mjs`](../tools/vendor.mjs) copies from `node_modules/@tensorflow/`:
`tf.min.js`, `tf-backend-wasm.min.js`, `tfjs-backend-wasm.wasm`, `tfjs-backend-wasm-simd.wasm`
into `vendor/`, strips the trailing `sourceMappingURL` comment from the `.js` files (the maps are
not shipped), and downloads the Apache-2.0 `LICENSE` from the tfjs repository at tag `tfjs-v4.22.0`
into `vendor/LICENSE-tfjs.txt` (the npm package does not include it). The worker loads them with
`importScripts('../vendor/tf.min.js', '../vendor/tf-backend-wasm.min.js', ...)` and
`tf.wasm.setWasmPaths('../vendor/')`. **There is no bundler.**

### Icons : `python tools/make_icons.py`

[`../icons/icon.svg`](../icons/icon.svg) (a bird drawn with spectrogram bars) is the single source.
The script renders it with headless Edge/Chrome and resizes with Pillow (`pip install pillow`):

| Output | Size | Notes |
|---|---|---|
| `apple-touch-icon.png` | 180 | Square: iOS rounds the corners itself |
| `icon-192.png`, `icon-512.png` | 192, 512 | Rounded |
| `icon-maskable-512.png` | 512 | Content scaled to 80 % (safe zone) for Android masks |

The SVG's first `<rect>` must be the background; the script relies on that.

---

## 8. User interface

[`../index.html`](../index.html) has three views toggled by the bottom tab bar (`.tabs button`
with `data-view`; handler at the end of `app.js`):

| Tab | View id | Content |
|---|---|---|
| Écouter | `view-listen` | Spectrogram canvas + loading overlay, listen button, "analyse a recording" file input, detection cards (`#detections`) |
| Ma liste | `view-list` | Life list cards, export/import buttons |
| Infos | `view-info` | Settings (threshold slider, geo checkboxes), engine info, install help, credits and licences |

Species cards are cloned from `<template id="card-tpl">` by `makeCard()`; the same template serves
detections and the life list.

**Detection state** (`app.js`): `detected` (Map: species index → `{index, best, last, first,
time}`) and `cards` (index → `<li>`). `rerender()` is the single place that reconciles state with the
DOM: it filters with `visible()` (threshold and geo), sorts (most recently heard first in live mode,
chronological in file mode), removes cards no longer visible, and moves nodes only when needed to
avoid scroll jumps. A card gets class `live` for 4 s (`LIVE_MS`) after its last detection; a
1 s `setInterval` refreshes "il y a ..." labels when the tab is visible.

**Settings** persist in `localStorage` (see [Storage](#10-storage-and-privacy)): `threshold`
(default 0.5, slider 10-90 step 5), `geo` (default true), `precise` (default false).

**Design tokens** are CSS variables in `:root` of [`../css/app.css`](../css/app.css). The palette is a
"field notebook":

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F7F2E7` | Page background |
| `--card` | `#FFFDF8` | Cards |
| `--ink` | `#1E2B22` | Main text (~13:1 on paper) |
| `--forest` | `#24503A` | Header, tabs, buttons |
| `--moss` | `#5E7F3A` | Decorative borders only (4.1:1, **below 4.5:1: never for text**) |
| `--leaf` | `#E1EBCF` | "Singing now" card, photo placeholder |
| `--robin` | `#E07A3F` | Primary action; **ink text** on it (4.9:1) |
| `--bark` | `#6A4E36` | Secondary text (6.8:1) |
| `--sand` | `#DCD2BE` | Neutral borders |

Fonts: **Fraunces** (titles, `--font-title`) and **Nunito Sans** (body, `--font-body`), loaded from
Google Fonts in `index.html` (cached by the service worker). Text contrast must stay >= 4.5:1:
re-check whenever you change a colour. The CSS also handles `env(safe-area-inset-*)` (notch, home
indicator), `prefers-reduced-motion`, and a 640 px max content width. There is no dark mode.

The status bar text (`#status`) shows "Chargement…", "Prêt", "Écoute…" and "Analyse en N ms".
`#engine` (Infos tab) shows the chosen backend and the benchmark time.

---

## 9. Offline support: the service worker

[`../sw.js`](../sw.js) is registered from `app.js` (`navigator.serviceWorker.register('sw.js')`).
It requires HTTPS or `localhost`; it is verified working on GitHub Pages. (The Claude in-app
browser could not register it on `http://127.0.0.1`; real Chrome/Safari on `localhost` is fine.)

| Cache | Strategy | Contents |
|---|---|---|
| `piaf-app-<VERSION>` | **network-first**, fallback to cache (`ignoreSearch`) | `SHELL` list: html, js, css, manifest, icon, `model/species.json`; anything else same-origin that is not heavy |
| `piaf-heavy-<VERSION>` | **cache-first** | Same-origin paths containing `/model/` or `/vendor/` (except `species.json`) |
| `piaf-external` | **cache-first** | iNaturalist images and Google Fonts (cross-origin requests with a non-empty `request.destination`; API JSON responses go straight to the network) |

On `install`, `SHELL` is pre-cached and `skipWaiting()` is called; on `activate`, caches not in
`[APP, HEAVY, EXTERNAL]` are deleted and clients are claimed.

**Rules for contributors:**

1. **Bump `VERSION` whenever `model/` or `vendor/` change.** Heavy files are cache-first, so
   without a new cache name users would be served stale model/TF.js files forever.
2. **Add every new app file to `SHELL`** (new JS module, new page, new asset) so it works offline
   from the first visit.
3. App files are network-first, so ordinary code edits reach users on the next online load without
   a bump (the first load after a deploy may still run the previous service worker's cached
   pages if the network is slow; a reload fixes it).
4. Changing `sw.js` itself makes browsers re-install it.

---

## 10. Storage and privacy

All data is in `localStorage`, per device and per origin:

| Key | Content | Written by |
|---|---|---|
| `piaf:settings:v1` | `{threshold, geo, precise}` | `app.js` |
| `piaf:lifelist:v1` | `{ "<scientific name>": {sci, fr, en, first, last, best} }`; dates are ISO strings, `best` is 0-1 rounded to 0.01 | `lifelist.js` |
| `piaf:taxa:v1` | iNaturalist cache `{ "<sci>": {id, url, photo, attribution, license, licenseUrl, t} }`, 30-day TTL | `species-info.js` |

All reads/writes are wrapped in `try/catch` (private mode, quota). **If you change a schema in an
incompatible way, bump the `:vN` suffix and write a migration** from the old key.

**Life list export** is a JSON file `{app: 'piaf', version: 1, exported, species: [...]}` named
`piaf-liste-YYYY-MM-DD.json`. **Import merges**: new species are added; for existing ones the
earliest `first`, latest `last` and max `best` win. Invalid files raise "Fichier non reconnu".
`add()` also calls `navigator.storage.persist()` to ask the browser not to evict the data.

**iOS caveat:** Safari may wipe storage of a site not visited for 7 days unless it is added to the
Home Screen. The UI tells users to install it and to export regularly.

Privacy summary: audio is processed locally and never sent; location only if "precise" is ticked,
and it stays on the device; iNaturalist receives only a scientific name; no analytics, no cookies.

---

## 11. iNaturalist photos

[`../js/species-info.js`](../js/species-info.js), `getSpeciesInfo(sci)` returns
`{id, url, photo, attribution, license, licenseUrl, t}` (or `{photo: null}` / `null` on failure).

- Request: `GET https://api.inaturalist.org/v1/taxa?q=<sci>&rank=species&per_page=5&locale=fr`.
  Results are matched on the exact `name` or on `matched_term` (iNaturalist synonyms).
- **Fallback:** if nothing matches, search again *without* `rank=species` for species iNaturalist
  files as a subspecies, and accept a name with the same genus and last epithet (for example
  *Acanthis cabaret* → *Acanthis flammea cabaret*).
- **Only photos with a `license_code` (Creative Commons) are shown**, with the attribution text and a
  link to the licence deed (`licenseUrl()`), rendered in the card's `.credit` line. This is a legal
  requirement: keep it. Species without a CC photo show an empty frame (the card still links to the
  taxon page).
- **Rate limit:** requests are chained through a promise queue with 1 s spacing (`SPACING`);
  iNaturalist asks for roughly 60 requests/min at most. Duplicate in-flight lookups share one promise.
- Cache: 30 days in `piaf:taxa:v1`; if the network fails, an expired cache entry is still used.
- Only the scientific name leaves the device.

---

## 12. Testing

There is no unit-test framework. Verification is: the model check (automated), a syntax check, and
manual scenarios.

### Automated

```bash
npm install                      # once
python tools/build_model.py      # once (creates .cache/orig/ with sample.wav)
npm run check                    # model + mel layer vs official; must print OK
node --check js/app.js           # syntax check, repeat for each file you touched
node --check js/engine-worker.js
node --check sw.js
```

`node --check` works on the ES-module files because it only parses them. Run `npm run check`
whenever `js/birdnet-core.js`, `tools/build_model.py` or `model/` change.

### Manual: desktop

1. `npm run serve`, open <http://localhost:8080>, open DevTools.
2. Wait for the loading overlay to disappear; the Infos tab should show "Moteur : ...".
3. Check the console for errors, and Application → Service Workers for `sw.js` (activated).
4. Go offline (DevTools Network → Offline), reload: the app must still load and work.

### Testing without a microphone

Both recipes use the official sample (`.cache/orig/sample.wav`, created by `build_model.py`; served
by the dev server because it lives under the repo root). Paste in the DevTools console of the Piaf page.

**Recipe 1: analyse a file** (exercises the worker and the file path):

```js
const buf = await (await fetch('.cache/orig/sample.wav')).arrayBuffer();
const dt = new DataTransfer();
dt.items.add(new File([buf], 'sample.wav', { type: 'audio/wav' }));
const input = document.querySelector('#file');
input.files = dt.files;
input.dispatchEvent(new Event('change'));
```

Expected: *Sizerin cabaret* around 95 % and *Sizerin flammé* around 80 %. If they are missing,
untick the geo filter and lower the threshold to see whether the filter or the model is responsible.

**Recipe 2: fake microphone** (exercises getUserMedia → worklet → worker → live loop):

```js
const ac = new AudioContext();
const buffer = await ac.decodeAudioData(await (await fetch('.cache/orig/sample.wav')).arrayBuffer());
const src = ac.createBufferSource();
src.buffer = buffer; src.loop = true;
const dest = ac.createMediaStreamDestination();
src.connect(dest); src.start();
await ac.resume();
navigator.mediaDevices.getUserMedia = async () => dest.stream;
// Now click « Écouter ».
```

Expected: the same two species highlighted within about 5 s (3 s to fill the buffer, then one analysis
every 1.5 s). If `ac` stays suspended, click once in the page first (autoplay policy).

To also exercise the **resampler**, run this *before* clicking « Écouter » (and reload the page first:
`Microphone` creates its context once):

```js
const Native = window.AudioContext;
window.AudioContext = function (opts) { return new Native({ ...opts, sampleRate: 44100 }); };
```

The app's context then runs at 44.1 kHz and the worklet resamples to 48 kHz; results must be the
same two species. Create the fake-mic context (`ac`) *before* installing this wrapper, or via
`new Native()`.

### Manual: mobile

- DevTools device mode at **375 × 667** approximates an iPhone 8 layout (not its performance).
- Real-device testing needs **HTTPS**: use the GitHub Pages URL, or an HTTPS tunnel to
  `localhost:8080`. On iPhone, also test Add to Home Screen, a phone call during listening
  (`onInterrupted`), and screen lock.
- Record the "Moteur : ..., N ms" line from the Infos tab. It must be < 1500 ms.

### Manual regression checklist

| Scenario | Expected |
|---|---|
| First load online | Progress bar to 100 %, then "Prêt", listen button enabled |
| Reload offline | Same, no network errors for app files |
| Listen, then stop | Cards appear, spectrogram scrolls, "Arrêter" ↔ "Écouter"; stop releases the mic indicator |
| Deny microphone | Hint "Micro refusé..." and listen button usable again |
| Move threshold slider | Cards appear/disappear immediately, value persists after reload |
| Toggle geo filter | Count text on the Infos tab changes; cards re-filter |
| "Precise" with permission denied | Box unticks itself, falls back to Europe |
| Add species to list, export, clear storage, import | Entry restored, dates preserved |
| Analyse a file | Progress %, cards sorted by time, "Analyse terminée." |
| Species with no CC photo | Empty photo frame, no credit line, no console error |

---

## 13. Deployment

Hosting is **GitHub Pages**, "Deploy from a branch", branch `main`, folder `/ (root)` (repo Settings →
Pages). Every push to `main` redeploys in about 1-2 minutes. Site:
<https://yannickriou.github.io/birdnet-web/>.

```bash
git push origin main
gh api repos/YannickRiou/birdnet-web/pages/builds/latest   # status: "built" when done
```

All URLs in the code are relative (`sw.js`, `manifest.webmanifest` with `start_url: "./"`,
`new URL(..., import.meta.url)`), so the app works from the `/birdnet-web/` sub-path. Keep it that
way: never introduce root-absolute paths such as `/js/app.js`.

**Line endings.** The repo has [`../.gitattributes`](../.gitattributes) (`* text=auto eol=lf`, plus
`*.bin`, `*.wasm`, `*.png` marked binary). On Windows, `core.autocrlf=true` would otherwise rewrite
files and could corrupt binaries or create whole-file diffs. Do not remove it.

**Repo identity.** Commits are in English; this repo uses a local identity (`user.name` plus a
GitHub noreply email). Set yours with `git config` inside the repo.

After deploying, open the live site in a private window and confirm that the new service worker
activates (Application → Service Workers) and that the Infos tab works.

---

## 14. Licences

| Part | Licence | What you must do |
|---|---|---|
| Piaf code | MIT ([`../LICENSE`](../LICENSE)) | Keep the notice |
| BirdNET V2.4 model (`model/`) | **CC BY-NC 4.0** | **Non-commercial use only**; keep the attribution; list your modifications in [`../model/LICENSE.md`](../model/LICENSE.md) |
| TensorFlow.js (`vendor/`) | Apache-2.0 | Keep `vendor/LICENSE-tfjs.txt` |
| Species photos | Each photo's own Creative Commons licence | Keep the per-photo credit and licence link on every card |
| Fraunces, Nunito Sans | SIL OFL | Credited in the app |

In-app credits live in `index.html`, section "Crédits et licences" (update it if you add a
component, change the model, or alter the modifications list). Piaf is not affiliated with the
Cornell Lab, Chemnitz University of Technology or Merlin; do not imply otherwise. The README has the
full attribution table and the BirdNET citation.

---

## 15. How do I... (recipes)

### Change the default confidence threshold

1. In [`../js/app.js`](../js/app.js): `const settings = { threshold: 0.5, ... }`.
2. If needed, change the slider bounds in `index.html` (`#threshold`, `min="10" max="90" step="5"`).
   The worker floor `MIN_SCORE = 0.1` in `engine-worker.js` must stay <= the slider minimum.
3. Existing users keep their saved value in `piaf:settings:v1`; the default only affects new users.
4. Re-test: slider position on first load, cards appear/disappear.

### Change the analysis rate (`HOP`)

1. In [`../js/engine-worker.js`](../js/engine-worker.js): `const HOP = 1.5 * SAMPLE_RATE`.
2. Smaller = more analyses (more CPU/battery, more overlap); larger = fewer. The window must stay
   `WINDOW` (3 s): it is the model's input size.
3. Re-test on a slow device: if inference takes longer than `HOP`, windows are skipped (by design).
   Update the "1,5 s" mention in comments and the README if you change it.

### Change the default region / grid

1. In `app.js`, edit `europePoints(week)`: latitude loop (37 → 60), longitude loop (-10 → 30), step
   2.5. More points = slower geo prediction (still one forward pass, `N` rows).
2. Update the French texts that say "Europe continentale": `updateGeoStatus()` in `app.js`, the
   checkbox label in `index.html`, and the README.
3. If you rename the area id (`'europe'`), update the `geoArea` comparisons (`'position'` is the other id).
4. Re-test: the species count in the Infos tab, and a few species that should (not) pass.

### Add another label language

BirdNET ships labels for many languages in the int8 zip as `labels/<lang>.txt`: `af ar cs da de en_uk
en_us es fi fr hu it ja ko nl no pl pt ro ru sk sl sv th tr uk zh`. Each line is
`<scientific>_<common name>`, in the same order as the model outputs.

1. In [`../tools/build_model.py`](../tools/build_model.py), read another file with
   `int8.read("labels/<lang>.txt")`, assert the scientific names match as the French/English loop does,
   and append the name as a **fourth column** of each `species.json` entry (appending keeps indexes
   1 and 2 stable).
2. Run the script, then `npm run check`.
3. In `app.js`, entries are destructured as `[sci, fr, en]` in `rerender()`, `onDetections()` and
   `makeCard(sci, fr, en)`. Add a language setting (new key in `settings`, a `<select>` in the Infos
   view) and pick the right column. The life list stores `fr` and `en`: add the new field to
   `lifelist.js` (`add()`, `importFile()`) without breaking older saves (do **not** bump `v1`
   unless you migrate).
4. Optionally change `locale=fr` in `species-info.js` so iNaturalist returns localised names.
5. Bump `VERSION` in `sw.js` (the model folder changed) and update `model/LICENSE.md`.

### Translate the UI

French strings are spread over: [`../index.html`](../index.html) (all labels, `lang="fr"`, meta
description), `app.js` (status/hint/error messages, `toLocaleDateString('fr-FR')`, `confirm`/`alert`),
`lifelist.js` (`alert`), `species-info.js` (`deed.fr` in `licenseUrl`, `locale=fr`),
[`../manifest.webmanifest`](../manifest.webmanifest) (`lang`, `name`, `description`), and the
`BACKENDS` labels in `app.js`. There is no i18n layer: either do a straight replacement or extract
strings into one module first. Keep the French licence/attribution wording unless you adapt it.

### Change colours or fonts

1. Edit the tokens in `:root` of [`../css/app.css`](../css/app.css). Keep text contrast >= 4.5:1
   (`--moss` is decorative only).
2. Also update `<meta name="theme-color">` in `index.html` and `theme_color` / `background_color` in
   the manifest, the hard-coded `#000004` spectrogram background in `.spectro`, and
   `icons/icon.svg` (then re-render the icons).
3. Fonts: change the Google Fonts `<link>` in `index.html` and `--font-title` / `--font-body`.
   Keep fallbacks (offline first visit has no fonts).

### Replace the icon

1. Edit [`../icons/icon.svg`](../icons/icon.svg) (first element must be the background `<rect>`).
2. `python tools/make_icons.py` (needs Pillow and Edge or Chrome).
3. Commit the SVG and the four PNGs. The SVG is also cached in `SHELL`, so bump `VERSION` if you want
   installed apps to refresh quickly (icons are network-first, so it is not mandatory).

### Upgrade TF.js

1. In `package.json`, change **both** pinned versions (`@tensorflow/tfjs`,
   `@tensorflow/tfjs-backend-wasm`) to the same release. In `tools/vendor.mjs`, update the licence URL tag
   (`tfjs-v4.22.0`).
2. `npm install && npm run vendor`.
3. `npm run check` (Node uses the npm package, so it validates the custom-layer API and the model).
4. Test in a browser with `?backend=webgl`, `?backend=wasm` and `?backend=cpu`: the custom layer
   (`registerMelLayer`) and the WASM paths are the fragile parts. Check the `.wasm` file names in
   `vendor.mjs` still exist in the new package.
5. **Bump `VERSION` in `sw.js`**, update the version in `index.html` credits/README if mentioned.

### Add a new JS module

1. Create `js/<name>.js` as an ES module; `import` it from `app.js` (or `importScripts` it in the
   worker with a path relative to the worker file).
2. Add `'js/<name>.js'` to `SHELL` in `sw.js` and bump `VERSION`.
3. Use only relative URLs. Run `node --check js/<name>.js`.
4. Add the file to the repository map in this handbook and the README architecture table.

### Update the BirdNET model

Change the Zenodo record id, file names and MD5 values at the top of `build_model.py`, run it,
`npm run check` (the output indexes/shape assumptions: 6522 classes, input 144000, mel layers),
bump `VERSION`, update `model/LICENSE.md` and the credits in `index.html`. See also the BirdNET+ note
in [limitations](#17-known-limitations-and-ideas).

### Release checklist

1. `npm run check` if anything under `model/`, `birdnet-core.js` or `build_model.py` changed.
2. `node --check` on every JS file you touched.
3. Manual test on a phone (real HTTPS origin): load, listen, stop, file analysis, offline reload.
4. Bump `VERSION` in `sw.js` if `model/` or `vendor/` changed; add new files to `SHELL`.
5. Check licences/credits (section 14) if you added a dependency or changed the model.
6. Commit (English message), `git push origin main`, then
   `gh api repos/YannickRiou/birdnet-web/pages/builds/latest` until built; smoke-test the live URL.

---

## 16. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Overlay stuck on "Chargement du modèle…" or "Préparation du modèle…" | Model files not reachable (wrong path, 404), blocked network, or `species.json` failed ("Impossible de charger la liste des espèces.") | Open DevTools → Network: check `model/species.json`, `model/audio/model.json` and the shards. Serve from the repo root. A stale service-worker cache can also hold broken files: Application → Clear storage, reload. On `error` with `during: 'init'` the overlay shows the message (e.g. no usable backend, unregistered layer) |
| Progress reaches 100 % then nothing | The warm-up inference/benchmark is compiling shaders or failing | Check the console and the worker. Try `?backend=wasm`. Keep the page in the foreground |
| "Moteur : JavaScript (lent)" | Neither WebGL (no OffscreenCanvas in workers, or float32 render unsupported) nor WASM could start; the cpu backend is a last resort | Test `?backend=wasm` and read the console error. Check that `vendor/*.wasm` are served (not 404, not served with an HTML fallback). Needs a recent browser; SIMD is required for the fast WASM build |
| "Moteur : WebAssembly" when you expected GPU | WebGL was rejected (no float32) or slower than 600 ms and WASM won | Expected on some phones. Force `?backend=webgl` to compare timings |
| No detections | Threshold too high, geo filter excluding the species, microphone processing, or only non-species classes | Lower the threshold; untick the geo filter (a species out of region/season is dropped); run Recipe 1 to validate the pipeline with known audio; confirm audio is really reaching the mic (spectrogram moves); check that echo cancellation/noise suppression/AGC are off for the track (`stream.getAudioTracks()[0].getSettings()`); remember `NON_SPECIES` (dog, engine, human voice...) are never shown |
| Detections look wrong or too many false positives | Threshold too low, geo filter off | Raise the threshold (50-70 %), keep the geo filter on. If *results are systematically garbage* after code changes, suspect `birdnet-core.js`: run `npm run check` |
| Stale files after a deploy | Heavy files are cache-first and `VERSION` was not bumped; or a service worker still serving the old shell | Bump `VERSION` in `sw.js` when `model/` or `vendor/` change. For a user stuck on old files: DevTools → Application → Service Workers → Unregister, Clear storage, reload |
| Photos missing | Species has no Creative Commons photo; offline and not cached; iNaturalist rate-limited/errored (HTTP 429/5xx); species name not matched | Expected for some species (empty frame). Online, check the `api.inaturalist.org` request in Network. A failed lookup is retried on next view (failures are not cached). To retest, delete `piaf:taxa:v1` from localStorage |
| "Micro refusé..." | Permission denied in the browser/OS | Allow the microphone for the site in browser/OS settings, reload. On iOS: Settings → Safari (or the installed app) → Microphone |
| "Aucun micro détecté" | `NotFoundError`: no input device | Plug/enable a microphone; check OS privacy settings |
| "Le micro est déjà utilisé..." | `NotReadableError`: another app holds the mic | Close the other app |
| Mic fails on a non-localhost HTTP address | `getUserMedia` and service workers need a secure context | Use `localhost` or HTTPS |
| iOS stops listening when the screen locks / app switches | Safari suspends audio capture in the background; `AudioContext` goes to `interrupted`, and the UI reports "Écoute interrompue..." | By design: keep the screen on (Wake Lock is requested when available), tap « Écouter » to resume. A phone call or Siri does the same |
| Life list disappeared on iPhone | Safari purged storage of a site not visited for 7 days and not installed | Add to Home Screen; export regularly; import the JSON backup |
| Spectrogram blank but model works | `AnalyserNode` not connected or context suspended | Check `mic.ctx.state`; AudioContext must be resumed from a user gesture |
| `?backend=` ignored | Value not one of `webgl`, `wasm`, `cpu`, or the forced backend failed (then it silently falls back to cpu) | Check the console and the "Moteur" line |
| `npm run check` fails: `.cache/orig/...` not found | Official model not extracted | Run `python tools/build_model.py` first |
| `npm run check` max diff > 0.02 | Change in `birdnet-core.js` (e.g. someone "fixed" the real-part quirk) or a bad conversion | Revert the change; compare the printed top-5 of both models |

---

## 17. Known limitations and ideas

- **Resampler is linear.** Fine for 44.1 → 48 kHz (typical mics) but it would alias if a
  microphone ran above 48 kHz. Add a low-pass filter before decimation if that ever matters.
- **No dark mode.**
- **Species without a CC photo** show an empty frame.
- **WASM is single-threaded** (no COOP/COEP on GitHub Pages). Moving to a host that can set those
  headers (or using a service-worker header shim) would allow multi-threaded WASM.
- **iPhone 8 timing is not measured yet.** Do it before promising anything; the target is < 1500 ms.
- **`error` messages from the live loop have no `during`**, so the UI cannot distinguish them from a
  generic error (it only writes the message in the hint).
- **BirdNET+ V3.0 preview** exists on Zenodo record **20703646** (ONNX, 11K species, CC BY-SA 4.0,
  FP16 pruned 72 MB, heavier compute). It would need `onnxruntime-web` and a new front-end (mel
  layer) check against the official pipeline. A possible future upgrade; note the licence differs
  (BY-SA vs BY-NC), so `model/LICENSE.md` and credits would change.
- Further ideas, not started: dark mode, per-session history, sharing a list, more label languages.
