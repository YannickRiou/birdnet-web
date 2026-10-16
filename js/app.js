// Interface de Piaf : relie micro, worker d'inférence, cartes d'espèces, liste à vie et réglages.
import './birdnet-core.js';
import { Microphone, decodeFile } from './audio.js';
import { Spectrogram } from './spectrogram.js';
import { getSpeciesInfo } from './species-info.js';
import * as life from './lifelist.js';

const { NON_SPECIES, birdnetWeek } = self.BirdNETCore;
const GEO_THRESHOLD = 0.03; // seuil par défaut de BirdNET pour la liste d'espèces locale
const LIVE_MS = 4000; // une espèce reste « en train de chanter » 4 s après sa dernière détection
const SETTINGS_KEY = 'piaf:settings:v1';

const $ = (sel) => document.querySelector(sel);
const ui = {
  status: $('#status'), loading: $('#loading'), loadingText: $('#loading-text'), loadingBar: $('#loading-bar'),
  listen: $('#listen'), listenLabel: $('#listen-label'), file: $('#file'), fileLabel: $('#file-label'), hint: $('#hint'),
  detections: $('#detections'), detCount: $('#det-count'), detEmpty: $('#det-empty'),
  lifelist: $('#lifelist'), lifeCount: $('#life-count'), lifeEmpty: $('#life-empty'),
  threshold: $('#threshold'), thresholdValue: $('#threshold-value'), geo: $('#geo'), precise: $('#precise'),
  geoStatus: $('#geo-status'),
  engine: $('#engine'), tpl: $('#card-tpl'),
};

// ---------- Réglages ----------
const settings = { threshold: 0.5, geo: true, precise: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY))); } catch (e) { /* défauts */ }
const saveSettings = () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* stockage indisponible */ }
};

// ---------- État ----------
let species = []; // [nom scientifique, nom français, nom anglais] dans l'ordre des sorties du modèle
let geoScores = null; // probabilité de présence par espèce sur la zone choisie (modèle géographique)
let geoArea = null; // zone du dernier calcul : 'europe' ou 'position'
let mode = 'live'; // 'live' (micro) ou 'file' (enregistrement)
let listening = false;
let wakeLock = null;
const detected = new Map(); // index → { index, best, last, first, time }
const cards = new Map(); // index → élément <li> des détections

// ---------- Worker et micro ----------
const worker = new Worker(new URL('./engine-worker.js', import.meta.url));
const mic = new Microphone(worker);
const spectro = new Spectrogram($('#spectro'));
mic.onInterrupted = () => stopListening('Écoute interrompue. Touchez « Écouter » pour reprendre.');

const BACKENDS = { webgl: 'processeur graphique (WebGL)', wasm: 'WebAssembly', cpu: 'JavaScript (lent)' };

worker.onmessage = ({ data }) => {
  switch (data.type) {
    case 'progress':
      ui.loadingBar.style.width = `${Math.round(data.value * 100)}%`;
      ui.loadingText.textContent = `Chargement du modèle… ${Math.round(data.value * 100)} %`;
      break;
    case 'ready':
      ui.loading.hidden = true;
      ui.listen.disabled = false;
      ui.status.textContent = 'Prêt';
      ui.engine.textContent = `Moteur : ${BACKENDS[data.backend]}, ${data.ms} ms par analyse de 3 s.`;
      computeArea();
      break;
    case 'result':
      ui.status.textContent = `Analyse en ${data.ms} ms`;
      onDetections(data.detections, null, data.clip);
      break;
    case 'geo':
      geoScores = data.scores;
      geoArea = data.area;
      updateGeoStatus();
      rerender();
      break;
    case 'fileResult':
      ui.hint.textContent = `Analyse de l'enregistrement… ${Math.round(data.progress * 100)} %`;
      onDetections(data.detections, data.time, data.clip);
      break;
    case 'fileDone':
      ui.hint.textContent = detected.size ? 'Analyse terminée.' : 'Analyse terminée : aucune espèce reconnue au seuil choisi.';
      ui.fileLabel.hidden = false;
      break;
    case 'error':
      console.error(data);
      ui.hint.textContent = `Erreur : ${data.message}`;
      if (data.during === 'init') ui.loadingText.textContent = `Impossible de charger le modèle : ${data.message}`;
      if (data.during === 'location') updateGeoStatus('Filtre indisponible : toutes les espèces sont possibles.');
      break;
  }
};

// ---------- Détections ----------
function visible(d) {
  if (d.best < settings.threshold) return false;
  if (settings.geo && geoScores && geoScores[d.index] < GEO_THRESHOLD) return false;
  return true;
}

function onDetections(list, fileTime, clip) {
  const now = Date.now();
  for (const [index, score] of list) {
    if (NON_SPECIES.has(species[index][0]) || score < settings.threshold) continue;
    const d = detected.get(index) || { index, best: 0, first: now, time: fileTime, clip: null };
    if (clip && score > d.best) d.clip = clip; // on garde l'extrait au meilleur score
    d.best = Math.max(d.best, score);
    d.last = now;
    if (fileTime !== null && d.time === null) d.time = fileTime;
    detected.set(index, d);
    if (visible(d) && life.has(species[index][0])) life.seen(species[index][0], score);
  }
  rerender();
}

function percent(v) {
  return `${Math.round(v * 100)} %`;
}

function ago(ms) {
  const s = Math.round(ms / 1000);
  if (s < 5) return 'à l\'instant';
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
}

function clock(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fillPhoto(card, sci) {
  getSpeciesInfo(sci).then((info) => {
    if (!info || !card.isConnected) return;
    const link = card.querySelector('.name');
    if (info.url) link.href = info.url;
    if (!info.photo) return;
    const img = card.querySelector('img');
    img.src = info.photo;
    img.alt = card.querySelector('.name').textContent;
    const credit = card.querySelector('.credit');
    credit.textContent = `${info.attribution} · `;
    const a = document.createElement('a');
    a.href = info.licenseUrl;
    a.target = '_blank';
    a.rel = 'noopener license';
    a.textContent = info.license;
    credit.append(a);
  });
}

function makeCard(sci, fr, en) {
  const card = ui.tpl.content.firstElementChild.cloneNode(true);
  card.querySelector('.name').textContent = fr || en || sci;
  card.querySelector('.sci').textContent = sci;
  fillPhoto(card, sci);
  return card;
}

function setAddButton(btn, sci) {
  const inList = life.has(sci);
  btn.textContent = inList ? '✓ Ma liste' : '＋ Ma liste';
  btn.className = inList ? 'add in' : 'add';
  btn.setAttribute('aria-pressed', String(inList));
}

function rerender() {
  const now = Date.now();
  const shown = [...detected.values()].filter(visible)
    .sort((a, b) => (mode === 'file' ? a.time - b.time : b.last - a.last));
  const keep = new Set(shown.map((d) => d.index));
  for (const [index, card] of cards) {
    if (!keep.has(index)) { card.remove(); cards.delete(index); }
  }
  shown.forEach((d, i) => {
    const [sci, fr, en] = species[d.index];
    let card = cards.get(d.index);
    if (!card) {
      card = makeCard(sci, fr, en);
      const btn = card.querySelector('.add');
      btn.onclick = () => {
        if (!life.has(sci)) life.add({ sci, fr, en, score: d.best });
      };
      const play = card.querySelector('.play');
      play.onclick = () => {
        const cur = detected.get(d.index);
        if (cur && cur.clip) playClip(cur.clip, play);
      };
      cards.set(d.index, card);
    }
    card.classList.toggle('live', mode === 'live' && listening && now - d.last < LIVE_MS);
    card.querySelector('.meta').textContent = mode === 'file'
      ? `${percent(d.best)} · à ${clock(d.time)}`
      : `${percent(d.best)} · ${ago(now - d.last)}`;
    setAddButton(card.querySelector('.add'), sci);
    card.querySelector('.play').hidden = !d.clip;
    // Ne déplace le nœud que s'il n'est pas déjà à sa place (évite les sauts de défilement).
    if (ui.detections.children[i] !== card) ui.detections.insertBefore(card, ui.detections.children[i] || null);
  });
  ui.detCount.textContent = shown.length ? `${shown.length} espèce${shown.length > 1 ? 's' : ''}` : '';
  ui.detEmpty.hidden = shown.length > 0;
}

// ---------- Réécoute des extraits ----------
let playCtx = null;
let player = null; // { source, button } de l'extrait en cours de lecture

function stopClip() {
  if (!player) return;
  const { source, button } = player;
  player = null;
  source.onended = null;
  source.stop();
  button.classList.remove('on');
  button.textContent = '▶';
  button.setAttribute('aria-label', "Réécouter l'extrait");
  if (listening) worker.postMessage({ type: 'listen', on: true });
}

function playClip(clip, button) {
  const same = player && player.button === button;
  stopClip();
  if (same) return; // second appui = arrêt
  playCtx = playCtx || new (window.AudioContext || window.webkitAudioContext)();
  playCtx.resume();
  // Passe-haut (2 × 1er ordre, ~600 Hz) : vent et grondements, hors bande des oiseaux, dominaient le pic
  // et laissaient le chant trop faible. Puis normalisation (gain plafonné à ×50 pour un chant lointain).
  const alpha = 1 / (1 + 2 * Math.PI * 600 / 48000);
  const filtered = Float32Array.from(clip);
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < filtered.length; i++) {
      const x = filtered[i];
      y1 = alpha * (y1 + x - x1);
      x1 = x;
      filtered[i] = y1;
    }
  }
  let peak = 0;
  for (let i = 0; i < filtered.length; i++) peak = Math.max(peak, Math.abs(filtered[i]));
  const gain = Math.min(0.9 / (peak || 1), 50);
  const buffer = playCtx.createBuffer(1, filtered.length, 48000);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < filtered.length; i++) data[i] = filtered[i] * gain;
  const source = playCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(playCtx.destination);
  // Pendant la lecture, l'analyse est suspendue : sinon le micro réentendrait l'extrait.
  if (listening) worker.postMessage({ type: 'listen', on: false });
  source.onended = stopClip;
  source.start();
  button.classList.add('on');
  button.textContent = '■';
  button.setAttribute('aria-label', 'Arrêter la lecture');
  player = { source, button };
}

// Rafraîchit « il y a … » et la surbrillance, sans travail inutile quand l'onglet est caché.
setInterval(() => { if (!document.hidden && mode === 'live' && detected.size) rerender(); }, 1000);

// ---------- Écoute ----------
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* refusé */ }
}

async function startListening() {
  ui.listen.disabled = true;
  try {
    if (mode === 'file') { mode = 'live'; detected.clear(); rerender(); }
    await mic.start();
    listening = true;
    spectro.start(mic.analyser);
    ui.listen.classList.add('on');
    ui.listenLabel.textContent = 'Arrêter';
    ui.hint.textContent = 'Écoute en cours : gardez l\'écran allumé.';
    ui.status.textContent = 'Écoute…';
    requestWakeLock();
  } catch (e) {
    console.error(e);
    const messages = {
      NotAllowedError: 'Micro refusé. Autorisez-le dans les réglages du navigateur, puis réessayez.',
      NotFoundError: 'Aucun micro détecté sur cet appareil.',
      NotReadableError: 'Le micro est déjà utilisé par une autre application.',
    };
    ui.hint.textContent = messages[e && e.name] || `Micro indisponible : ${e.message || e}`;
    mic.stop();
  }
  ui.listen.disabled = false;
}

function stopListening(message) {
  if (!listening) return;
  listening = false;
  mic.stop();
  spectro.stop();
  ui.listen.classList.remove('on');
  ui.listenLabel.textContent = 'Écouter';
  ui.hint.textContent = message || '';
  ui.status.textContent = 'Prêt';
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  rerender();
}

ui.listen.onclick = () => (listening ? stopListening() : startListening());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && listening) requestWakeLock();
});

ui.file.onchange = async () => {
  const file = ui.file.files[0];
  ui.file.value = '';
  if (!file) return;
  stopListening();
  stopClip();
  mode = 'file';
  detected.clear();
  rerender();
  ui.fileLabel.hidden = true;
  ui.hint.textContent = 'Décodage de l\'enregistrement…';
  try {
    const { samples, duration } = await decodeFile(file);
    ui.hint.textContent = `Analyse de ${clock(duration)} d'enregistrement…`;
    worker.postMessage({ type: 'file', samples }, [samples.buffer]);
  } catch (e) {
    ui.hint.textContent = 'Format audio non reconnu par ce navigateur.';
    ui.fileLabel.hidden = false;
  }
};

// ---------- Filtre géographique ----------
// Par défaut : Europe continentale, sans demander la position. Grille de points (pas de 2,5°)
// de la Sicile et du sud de l'Espagne (37° N) au sud de la Scandinavie (60° N), du Portugal (10° O)
// à l'est de la Pologne (30° E) ; une espèce est retenue si elle est probable en au moins un point.
function europePoints(week) {
  const points = [];
  for (let lat = 37; lat <= 60; lat += 2.5) {
    for (let lon = -10; lon <= 30; lon += 2.5) points.push([lat, lon, week]);
  }
  return points;
}

function updateGeoStatus(text) {
  if (text) { ui.geoStatus.textContent = text; return; }
  if (!settings.geo) {
    ui.geoStatus.textContent = 'Désactivé : toutes les espèces du monde sont possibles (plus d\'erreurs).';
  } else if (geoScores) {
    let n = 0;
    geoScores.forEach((v, i) => { if (v >= GEO_THRESHOLD && !NON_SPECIES.has(species[i][0])) n++; });
    ui.geoStatus.textContent = geoArea === 'position'
      ? `${n} espèces probables autour de vous cette semaine (calcul fait sur le téléphone).`
      : `${n} espèces probables en Europe continentale cette semaine.`;
  } else {
    ui.geoStatus.textContent = 'Calcul des espèces probables…';
  }
}

function computeArea() {
  if (!settings.geo) return;
  const week = birdnetWeek(new Date());
  const useEurope = () => worker.postMessage({ type: 'location', area: 'europe', points: europePoints(week) });
  if (!settings.precise) return useEurope();
  if (!('geolocation' in navigator)) { useEurope(); return; }
  updateGeoStatus('Recherche de votre position…');
  navigator.geolocation.getCurrentPosition(
    (pos) => worker.postMessage({ type: 'location', area: 'position',
      points: [[pos.coords.latitude, pos.coords.longitude, week]] }),
    () => {
      settings.precise = false;
      ui.precise.checked = false;
      saveSettings();
      useEurope();
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600 * 1000 },
  );
}

ui.geo.checked = settings.geo;
ui.precise.checked = settings.precise;
ui.precise.disabled = !settings.geo;
ui.geo.onchange = () => {
  settings.geo = ui.geo.checked;
  ui.precise.disabled = !settings.geo;
  saveSettings();
  updateGeoStatus();
  if (settings.geo && !geoScores) computeArea();
  rerender();
};
ui.precise.onchange = () => {
  settings.precise = ui.precise.checked;
  saveSettings();
  geoScores = null;
  computeArea();
  rerender();
};

ui.threshold.value = Math.round(settings.threshold * 100);
ui.thresholdValue.textContent = percent(settings.threshold);
ui.threshold.oninput = () => {
  settings.threshold = ui.threshold.value / 100;
  ui.thresholdValue.textContent = percent(settings.threshold);
  saveSettings();
  rerender();
};

// ---------- Liste à vie ----------
function renderLifeList() {
  const entries = life.all();
  ui.lifelist.replaceChildren(...entries.map((e) => {
    const card = makeCard(e.sci, e.fr, e.en);
    const first = new Date(e.first).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    card.querySelector('.meta').textContent = `Depuis le ${first}`;
    const btn = card.querySelector('.add');
    btn.textContent = 'Retirer';
    btn.className = 'add remove';
    btn.onclick = () => {
      if (confirm(`Retirer « ${e.fr || e.en || e.sci} » de votre liste ?`)) life.remove(e.sci);
    };
    return card;
  }));
  ui.lifeCount.textContent = entries.length ? `${entries.length} espèce${entries.length > 1 ? 's' : ''}` : '';
  ui.lifeEmpty.hidden = entries.length > 0;
}

life.onChange(() => {
  for (const [index, card] of cards) setAddButton(card.querySelector('.add'), species[index][0]);
  if (!$('#view-list').hidden) renderLifeList();
});

$('#export').onclick = () => life.exportFile();
$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = await life.importFile(file);
    alert(`${added} espèce${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} à votre liste.`);
  } catch (err) {
    alert(`Import impossible : ${err.message}`);
  }
};

// ---------- Onglets ----------
document.querySelectorAll('.tabs button').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((t) => t.removeAttribute('aria-current'));
    tab.setAttribute('aria-current', 'page');
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== tab.dataset.view; });
    if (tab.dataset.view === 'view-list') renderLifeList();
    window.scrollTo(0, 0);
  };
});

// ---------- Démarrage ----------
updateGeoStatus();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
fetch('model/species.json').then((r) => r.json()).then((list) => {
  species = list;
  worker.postMessage({ type: 'init', backend: new URLSearchParams(location.search).get('backend') });
}).catch(() => { ui.loadingText.textContent = 'Impossible de charger la liste des espèces.'; });
