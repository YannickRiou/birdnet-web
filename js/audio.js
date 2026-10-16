// Micro → AudioWorklet → worker, plus un AnalyserNode pour le spectrogramme affiché.

const TARGET_RATE = 48000;

export class Microphone {
  constructor(worker) {
    this.worker = worker;
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.onInterrupted = () => {};
  }

  /** Doit être appelé depuis un geste de l'utilisateur (exigence iOS pour l'audio). */
  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      await this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      this.ctx.onstatechange = () => {
        // iOS : appel entrant, Siri, verrouillage… le contexte passe en « interrupted ».
        if (this.ctx && this.ctx.state !== 'running' && this.stream) this.onInterrupted();
      };
    }
    await this.ctx.resume();
    // Traitements « voix » désactivés : ils effacent justement les chants d'oiseaux.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream.getAudioTracks()[0].onended = () => this.onInterrupted();

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    const channel = new MessageChannel();
    this.node.port.postMessage({ port: channel.port1 }, [channel.port1]);
    this.worker.postMessage({ type: 'audioPort', port: channel.port2 }, [channel.port2]);

    // Le nœud doit être relié à la sortie pour être exécuté partout ; gain nul = aucun son.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.node).connect(this.mute).connect(this.ctx.destination);
    this.source.connect(this.analyser);
    this.worker.postMessage({ type: 'listen', on: true });
  }

  stop() {
    this.worker.postMessage({ type: 'listen', on: false });
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    for (const n of [this.source, this.node, this.mute, this.analyser]) if (n) n.disconnect();
    this.stream = this.source = this.node = this.mute = this.analyser = null;
    // On suspend sans fermer : relancer reste instantané.
    if (this.ctx) this.ctx.suspend();
  }
}

/** Décode un fichier audio (wav, mp3, m4a…) en mono 48 kHz. */
export async function decodeFile(file) {
  const data = await file.arrayBuffer();
  // Le contexte « hors ligne » à 48 kHz rééchantillonne au décodage.
  const probe = new OfflineAudioContext(1, 1, TARGET_RATE);
  const buffer = await new Promise((resolve, reject) => probe.decodeAudioData(data, resolve, reject));
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
  }
  return { samples: mono, duration: buffer.duration };
}
