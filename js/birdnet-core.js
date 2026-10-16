/*
 * Cœur BirdNET partagé entre le worker et les tests Node.
 *
 * Le modèle TF.js officiel calcule ses deux spectrogrammes mel dans une couche personnalisée
 * (MelSpecLayerSimple) via tf.signal.stft, très lente sur GPU mobile (DFT naïve en O(n²)).
 * On la remplace par un calcul CPU équivalent : FFT radix-2 (deux trames réelles par FFT
 * complexe) et banc de filtres mel creux. Le résultat est identique à la couche d'origine,
 * y compris sa particularité : la conversion complexe → réel garde la partie réelle.
 */
(function (root) {
  'use strict';

  const SAMPLE_RATE = 48000;
  const WINDOW = 3 * SAMPLE_RATE; // 144 000 échantillons = 3 s
  // Classes du modèle qui ne sont pas des espèces : jamais affichées.
  const NON_SPECIES = new Set(['Dog', 'Engine', 'Environmental', 'Fireworks', 'Gun', 'Human non-vocal',
    'Human vocal', 'Human whistle', 'Noise', 'Power tools', 'Siren']);

  class FFT {
    constructor(n) {
      this.n = n;
      this.rev = new Uint32Array(n);
      const bits = Math.log2(n);
      for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        this.rev[i] = r;
      }
      this.cos = new Float64Array(n / 2);
      this.sin = new Float64Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cos[i] = Math.cos((2 * Math.PI * i) / n);
        this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
      }
    }

    /** FFT complexe en place, re/im : Float64Array(n) déjà en ordre bit-reversed. */
    transform(re, im) {
      const n = this.n;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = start + j;
            const b = a + half;
            const tr = re[b] * this.cos[k] - im[b] * this.sin[k];
            const ti = re[b] * this.sin[k] + im[b] * this.cos[k];
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
    }
  }

  /** Spectrogramme mel d'une couche MelSpecLayerSimple, calculé sur CPU. */
  class MelSpec {
    constructor({ frameLength, frameStep, melFilterbank }) {
      this.L = frameLength;
      this.step = frameStep;
      this.bins = frameLength / 2 + 1;
      this.mels = melFilterbank[0].length;
      this.fft = new FFT(frameLength);
      this.window = new Float64Array(frameLength); // Hann périodique, comme tf.signal.hann_window
      for (let i = 0; i < frameLength; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameLength);
      // Banc de filtres creux : pour chaque bande mel, la plage [start, start + w.length) non nulle.
      this.filters = [];
      for (let m = 0; m < this.mels; m++) {
        let s = 0;
        let e = this.bins;
        while (s < e && melFilterbank[s][m] === 0) s++;
        while (e > s && melFilterbank[e - 1][m] === 0) e--;
        const w = new Float64Array(e - s);
        for (let k = s; k < e; k++) w[k - s] = melFilterbank[k][m];
        this.filters.push({ s, w });
      }
      this.re = new Float64Array(frameLength);
      this.im = new Float64Array(frameLength);
      this.specA = new Float64Array(this.bins);
      this.specB = new Float64Array(this.bins);
    }

    frames(n) {
      return 1 + Math.floor((n - this.L) / this.step);
    }

    /**
     * x : signal déjà normalisé dans [-1, 1]. Écrit dans out (Float32Array, taille mels × frames)
     * au format [bande mel inversée][trame], comme reverse + transpose de la couche d'origine.
     */
    compute(x, exponent, out) {
      const { L, step, bins, re, im, fft, window } = this;
      const F = this.frames(x.length);
      for (let f = 0; f < F; f += 2) {
        // Deux trames réelles dans une seule FFT complexe : z = a + i·b.
        const oa = f * step;
        const ob = (f + 1) * step;
        const hasB = f + 1 < F;
        for (let i = 0; i < L; i++) {
          const r = fft.rev[i];
          re[r] = x[oa + i] * window[i];
          im[r] = hasB ? x[ob + i] * window[i] : 0;
        }
        fft.transform(re, im);
        for (let k = 0; k < bins; k++) {
          const nk = (L - k) % L;
          this.specA[k] = 0.5 * (re[k] + re[nk]); // Re(A[k])
          this.specB[k] = 0.5 * (im[k] + im[nk]); // Re(B[k])
        }
        this.melFrame(this.specA, f, F, exponent, out);
        if (hasB) this.melFrame(this.specB, f + 1, F, exponent, out);
      }
    }

    melFrame(spec, f, F, exponent, out) {
      const last = this.mels - 1;
      for (let m = 0; m < this.mels; m++) {
        const { s, w } = this.filters[m];
        let acc = 0;
        for (let k = 0; k < w.length; k++) acc += spec[s + k] * w[k];
        out[(last - m) * F + f] = Math.pow(acc * acc, exponent);
      }
    }
  }

  /** Normalisation de la couche d'origine : min → -1, max → +1. */
  function normalize(src, dst) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const scale = 2 / (max - min + 1e-6);
    for (let i = 0; i < src.length; i++) dst[i] = (src[i] - min) * scale - 1;
    return dst;
  }

  /** Enregistre la couche personnalisée auprès de TF.js (à appeler une fois tf chargé). */
  function registerMelLayer(tf) {
    class MelSpecLayerSimple extends tf.layers.Layer {
      constructor(config) {
        super(config);
        this.specShape = config.specShape;
        this.mel = new MelSpec(config);
        this.norm = new Float32Array(0);
      }

      build(inputShape) {
        this.magScale = this.addWeight('magnitude_scaling', [], 'float32', tf.initializers.constant({ value: 1.23 }));
        super.build(inputShape);
      }

      computeOutputShape(inputShape) {
        return [inputShape[0], this.specShape[0], this.specShape[1], 1];
      }

      call(inputs) {
        const input = Array.isArray(inputs) ? inputs[0] : inputs;
        const [batch, n] = input.shape;
        const audio = input.dataSync(); // tenseur créé depuis le CPU : pas d'aller-retour GPU
        if (this.exponent === undefined) {
          this.exponent = 1 / (1 + Math.exp(this.magScale.read().dataSync()[0]));
        }
        if (this.norm.length !== n) this.norm = new Float32Array(n);
        const F = this.mel.frames(n);
        const size = this.mel.mels * F;
        const out = new Float32Array(batch * size);
        for (let b = 0; b < batch; b++) {
          normalize(audio.subarray(b * n, (b + 1) * n), this.norm);
          this.mel.compute(this.norm, this.exponent, out.subarray(b * size, (b + 1) * size));
        }
        return tf.tensor4d(out, [batch, this.mel.mels, F, 1]);
      }

      static get className() {
        return 'MelSpecLayerSimple';
      }
    }
    tf.serialization.registerClass(MelSpecLayerSimple);
    return MelSpecLayerSimple;
  }

  /** Semaine BirdNET (1 à 48, quatre « semaines » par mois). */
  function birdnetWeek(date) {
    return date.getMonth() * 4 + Math.min(4, Math.floor((date.getDate() - 1) / 7) + 1);
  }

  root.BirdNETCore = { SAMPLE_RATE, WINDOW, NON_SPECIES, FFT, MelSpec, normalize, registerMelLayer, birdnetWeek };
})(typeof self !== 'undefined' ? self : globalThis);
