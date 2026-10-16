// Spectrogramme défilant (0–12 kHz), échelle de couleur « magma » perceptuellement uniforme.

const MAGMA = ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'];
const MAX_FREQ = 12000;

function buildLut() {
  const rgb = MAGMA.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const lut = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) {
    const t = (v / 255) * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(t));
    const f = t - i;
    for (let c = 0; c < 3; c++) lut[v * 4 + c] = rgb[i][c] + (rgb[i + 1][c] - rgb[i][c]) * f;
    lut[v * 4 + 3] = 255;
  }
  return lut;
}

export class Spectrogram {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.lut = buildLut();
    this.analyser = null;
    this.raf = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // au-delà de 2, aucun gain visible
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.step = Math.round(dpr); // largeur d'une colonne : ~60 px/s quelle que soit la densité
    this.column = this.ctx.createImageData(this.step, this.canvas.height);
    this.ctx.fillStyle = MAGMA[0];
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  start(analyser) {
    this.analyser = analyser;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -40;
    this.bins = new Uint8Array(analyser.frequencyBinCount);
    this.maxBin = Math.floor((MAX_FREQ / (analyser.context.sampleRate / 2)) * analyser.frequencyBinCount);
    cancelAnimationFrame(this.raf);
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      this.drawColumn();
    };
    draw();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.analyser = null;
  }

  drawColumn() {
    if (!this.analyser) return;
    const { canvas, ctx, column, step, lut, bins, maxBin } = this;
    const H = canvas.height;
    const W = canvas.width;
    this.analyser.getByteFrequencyData(bins);
    const px = column.data;
    for (let y = 0; y < H; y++) {
      const v = bins[Math.floor(((H - 1 - y) / H) * maxBin)];
      for (let x = 0; x < step; x++) {
        const o = (y * step + x) * 4;
        px[o] = lut[v * 4];
        px[o + 1] = lut[v * 4 + 1];
        px[o + 2] = lut[v * 4 + 2];
        px[o + 3] = 255;
      }
    }
    ctx.drawImage(canvas, -step, 0);
    ctx.putImageData(column, W - step, 0);
  }
}
