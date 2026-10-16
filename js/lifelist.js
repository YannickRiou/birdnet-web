// « Liste à vie » : les espèces confirmées par l'utilisateur, stockées sur le téléphone
// (localStorage — les cookies sont limités à 4 Ko). Rien n'est envoyé sur Internet.

const KEY = 'piaf:lifelist:v1';
const listeners = new Set();
let entries = {};
try { entries = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* stockage indisponible */ }

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (e) {
    alert("Impossible d'enregistrer la liste sur ce téléphone (stockage plein ou navigation privée).");
  }
  listeners.forEach((fn) => fn());
}

export const onChange = (fn) => listeners.add(fn);
export const has = (sci) => Boolean(entries[sci]);
export const all = () => Object.values(entries).sort((a, b) => b.first.localeCompare(a.first));

export function add({ sci, fr, en, score }) {
  if (entries[sci]) return;
  const now = new Date().toISOString();
  entries[sci] = { sci, fr, en, first: now, last: now, best: Math.round(score * 100) / 100 };
  // Demande au navigateur de ne pas effacer ces données pour libérer de la place.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  save();
}

/** Espèce déjà dans la liste et entendue à nouveau : on met à jour la dernière date. */
export function seen(sci, score) {
  const e = entries[sci];
  if (!e) return;
  e.last = new Date().toISOString();
  e.best = Math.max(e.best, Math.round(score * 100) / 100);
  save();
}

export function remove(sci) {
  delete entries[sci];
  save();
}

export function exportFile() {
  const data = { app: 'piaf', version: 1, exported: new Date().toISOString(), species: all() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `piaf-liste-${data.exported.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Fusionne une sauvegarde : garde la première et la dernière date les plus étendues. */
export async function importFile(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'piaf' || !Array.isArray(data.species)) throw new Error('Fichier non reconnu');
  let added = 0;
  for (const s of data.species) {
    if (!s || typeof s.sci !== 'string' || typeof s.first !== 'string') continue;
    const cur = entries[s.sci];
    if (!cur) {
      entries[s.sci] = { sci: s.sci, fr: String(s.fr || ''), en: String(s.en || ''), first: s.first,
        last: String(s.last || s.first), best: Number(s.best) || 0 };
      added++;
    } else {
      if (s.first < cur.first) cur.first = s.first;
      if (s.last > cur.last) cur.last = s.last;
      cur.best = Math.max(cur.best, Number(s.best) || 0);
    }
  }
  save();
  return added;
}
