# Piaf

**Piaf** identifies birds by their song, right in the browser. It is a static, installable web app (PWA)
that works offline after the first load. The app interface is in French.

It grew out of a simple need: letting people whose phone cannot install Merlin Bird ID (for example an
iPhone 8 stuck on iOS 16) identify birds anyway. It also works on recent phones and on desktop.

- App: <https://yannickriou.github.io/birdnet-web/>
- Repository: <https://github.com/YannickRiou/birdnet-web>

Piaf is not affiliated with the Cornell Lab of Ornithology or with Merlin.

## Using Piaf

**iPhone (Safari)**
1. Open <https://yannickriou.github.io/birdnet-web/> in **Safari**, preferably on Wi-Fi
   (first load: about 26 MB for the model + 15 MB for the geographic filter).
2. Tap Share, then **Sur l'écran d'accueil** (Add to Home Screen). Without this, Safari may erase the site's
   data after 7 days without a visit.
3. Launch Piaf from its icon, allow the microphone, then tap the listen button.
4. Keep the screen on while listening (Piaf requests this automatically when the browser allows it):
   the microphone stops as soon as the app goes to the background.

**Android (Chrome)**: open the address, then menu, **Installer l'application** (Install app), or Add to Home Screen.

**Desktop**: open the address in a recent browser; installing is optional.

## Features

- **Live listening** with a scrolling spectrogram.
- **Audio file analysis** (voice memo, recording...).
- **Species cards**: French name, scientific name, confidence and iNaturalist photo (Creative Commons photos
  only, credited with the author and a link to the license).
- **Life list** ("Ma liste à vie"): tap « ＋ Ma liste » (add to my list) to confirm a species. The list is stored in the
  phone's `localStorage` (cookies are too small, 4 KB), with JSON backup export/import.
- **Geographic and seasonal filter** (BirdNET geographic model, threshold 0.03), enabled by default on
  **continental Europe** without asking for the location: grid of points every 2.5° (37–60° N, 10° W–30° E),
  a species is kept if it is likely this week at at least one point. Optionally, the device's precise
  location can be used instead.
- **Settings**: confidence threshold (50% by default), filter on/off, precise location on/off.

## Privacy

- Sound is analyzed **on the device**; it is never sent anywhere.
- Location is only requested if you enable the "précise" (precise location) option, and it never leaves the phone.
- Only a species' **scientific name** is sent to iNaturalist to fetch a photo.
- The life list stays in the device's local storage.

## Limitations

- **False positives** exist: an identification is a help, not a certainty. Check by ear and by eye,
  especially for rare or out-of-season species.
- **Non-commercial use only**: the BirdNET model license (CC BY-NC 4.0) requires it.
- The microphone **stops in the background** (locked screen or another app).
- On iOS, the storage of a non-installed site may be purged: install Piaf on the home screen and
  **export your life list regularly**.
- The model's 11 non-species classes (human voice, dog, engine...) are never displayed.

## Development

**New to the code? Start with the [developer handbook](https://yannickriou.github.io/birdnet-web/docs/handbook.html)**
(with diagrams; source in [`docs/handbook.html`](docs/handbook.html)): how Piaf works, how to test it without a
microphone, how to change it, deploy it, and troubleshoot it.

No build step: these are static files.

```bash
npm run serve          # python -m http.server 8080, then http://localhost:8080
npm install && npm run check   # checks the model (tools/check_model.mjs)
npm run vendor         # copies TensorFlow.js into vendor/
python tools/build_model.py    # regenerates model/ from Zenodo (checks the MD5)
python tools/make_icons.py     # renders the PNG icons from icons/icon.svg (headless Edge/Chrome + Pillow)
```

- The app icon is a bird drawn with spectrogram bars; `icons/icon.svg` is the single source, and
  `tools/make_icons.py` renders the PNG variants from it.
- `?backend=wasm|webgl|cpu` in the URL forces a compute backend (testing).
- After a change to the model or to `vendor/`, increment `VERSION` in `sw.js`.
- **Deployment**: GitHub Pages from the `main` branch, root folder (Settings, Pages).

## Architecture

| File | Role |
|---|---|
| `js/app.js` | Interface |
| `js/engine-worker.js` | Web Worker: TF.js, WebGL backend selection (fallback or WebAssembly SIMD benchmark if WebGL is missing, lacks float32, or is > 600 ms); 3 s windows at 48 kHz, new analysis every 1.5 s, automatic adaptation on slow phones (analyzes the most recent window) |
| `js/birdnet-core.js` | CPU mel spectrogram (radix-2 FFT) |
| `js/capture-worklet.js` | AudioWorklet: resamples the microphone to 48 kHz, sends 100 ms blocks directly to the worker (MessageChannel) |
| `js/audio.js` | Microphone (echoCancellation, noiseSuppression and autoGainControl disabled, because they erase birdsong); file decoding |
| `js/spectrogram.js` | Spectrogram, magma colormap |
| `js/species-info.js` | iNaturalist (≤ 1 request/s, 30-day cache) |
| `js/lifelist.js` | Life list |
| `sw.js` | Offline: cache first for `model/` and `vendor/`, network first for app files |
| `tools/` | `build_model.py`, `check_model.mjs`, `vendor.mjs`, `make_icons.py` |

Measured performance: about 84 ms per 3 s analysis with WebGL on desktop.

## Credits and licenses

Piaf's code is under the MIT license (see `LICENSE`). The model is under a different license.

| Component | Author | License | Link |
|---|---|---|---|
| Piaf code | Yannick Riou | MIT | [`LICENSE`](LICENSE) |
| BirdNET V2.4 model (`model/`, converted to float16) | K. Lisa Yang Center for Conservation Bioacoustics (Cornell Lab of Ornithology), Chemnitz University of Technology | CC BY-NC 4.0 (non-commercial) | [`model/LICENSE.md`](model/LICENSE.md), [Zenodo](https://zenodo.org/records/15050749) |
| TensorFlow.js 4.22.0 (`vendor/`) | Google / TensorFlow Authors | Apache-2.0 | [`vendor/LICENSE-tfjs.txt`](vendor/LICENSE-tfjs.txt) |
| Fraunces and Nunito Sans fonts (Google Fonts) | Respective authors | SIL OFL | [fonts.google.com](https://fonts.google.com/) |
| Species photos | iNaturalist photographers | Each photo under its own Creative Commons license, credited in the app | [iNaturalist](https://www.inaturalist.org/) |

**BirdNET citation**: Kahl, S., Wood, C. M., Eibl, M., & Klinck, H. (2021). BirdNET: A deep learning
solution for avian diversity monitoring. *Ecological Informatics*, 61, 101236.
<https://doi.org/10.1016/j.ecoinf.2021.101236>

Changes made to the model (float16 weights, mel layer reimplemented on CPU, merged names):
see [`model/LICENSE.md`](model/LICENSE.md).
