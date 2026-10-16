/*
 * AudioWorklet de capture : convertit le micro en 48 kHz mono et envoie des blocs de 100 ms
 * directement au worker d'inférence (sans passer par le thread de l'interface).
 * Rééchantillonnage linéaire : suffisant pour 44,1 → 48 kHz, cas courant des micros.
 */
/* global sampleRate */
const TARGET_RATE = 48000;
const BLOCK = TARGET_RATE / 10;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.pos = 0; // position (en échantillons d'entrée) du prochain échantillon de sortie ; -1 = dernier du bloc précédent
    this.prev = 0;
    this.out = new Float32Array(BLOCK);
    this.filled = 0;
    this.target = null;
    this.port.onmessage = (e) => { this.target = e.data.port; };
  }

  push(v) {
    this.out[this.filled++] = v;
    if (this.filled === BLOCK) {
      if (this.target) this.target.postMessage(this.out, [this.out.buffer]);
      this.out = new Float32Array(BLOCK);
      this.filled = 0;
    }
  }

  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    if (this.ratio === 1) {
      for (let i = 0; i < x.length; i++) this.push(x[i]);
      return true;
    }
    const last = x.length - 1;
    while (this.pos < last) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i < 0 ? this.prev : x[i];
      this.push(a + (x[i + 1] - a) * f);
      this.pos += this.ratio;
    }
    this.pos -= x.length;
    this.prev = x[last];
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
