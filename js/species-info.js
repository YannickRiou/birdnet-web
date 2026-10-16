// Photo d'une espèce via l'API publique d'iNaturalist.
// Seules les photos sous licence Creative Commons sont retenues, affichées avec leur crédit.
// Seul le nom scientifique de l'espèce est envoyé à iNaturalist, aucune donnée personnelle.

const KEY = 'piaf:taxa:v1';
const TTL = 30 * 24 * 3600 * 1000;
const API = 'https://api.inaturalist.org/v1/taxa';
const SPACING = 1000; // iNaturalist demande au plus ~1 requête par seconde

let cache = {};
try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* stockage indisponible */ }
const pending = new Map();
let chain = Promise.resolve();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* quota ou mode privé */ }
}

export function licenseUrl(code) {
  if (code === 'cc0') return 'https://creativecommons.org/publicdomain/zero/1.0/deed.fr';
  return `https://creativecommons.org/licenses/${code.replace(/^cc-/, '')}/4.0/deed.fr`;
}

async function search(sci, rank) {
  const url = `${API}?q=${encodeURIComponent(sci)}${rank ? '&rank=species' : ''}&per_page=5&locale=fr`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  return (await res.json()).results || [];
}

async function lookup(sci) {
  const low = sci.toLowerCase();
  const [genus, epithet] = low.split(' ');
  // Nom exact, ou synonyme reconnu par iNaturalist (taxonomies légèrement différentes).
  const pick = (results) => results.find((t) => t.name.toLowerCase() === low)
    || results.find((t) => (t.matched_term || '').toLowerCase() === low);
  let taxon = pick(await search(sci, true));
  if (!taxon) {
    // Espèce rangée en sous-espèce chez iNaturalist (ex. Acanthis cabaret → Acanthis flammea cabaret).
    const results = await search(sci, false);
    taxon = pick(results) || results.find((t) => {
      const parts = t.name.toLowerCase().split(' ');
      return parts[0] === genus && parts[parts.length - 1] === epithet;
    });
  }
  if (!taxon) return { photo: null };
  const p = taxon.default_photo;
  const info = { id: taxon.id, url: `https://www.inaturalist.org/taxa/${taxon.id}`, photo: null };
  if (p && p.license_code) {
    info.photo = (p.medium_url || p.square_url).replace(/\/(square|medium)\./, '/small.');
    info.attribution = p.attribution;
    info.license = p.license_code.toUpperCase().replace(/^CC-/, 'CC '); // cc-by-nc → CC BY-NC
    info.licenseUrl = licenseUrl(p.license_code);
  }
  return info;
}

/** Infos (photo + crédit + lien iNaturalist) d'une espèce, ou null en cas d'échec réseau. */
export function getSpeciesInfo(sci) {
  const hit = cache[sci];
  if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit);
  if (pending.has(sci)) return pending.get(sci);
  const job = chain.then(async () => {
    try {
      const info = { ...(await lookup(sci)), t: Date.now() };
      cache[sci] = info;
      save();
      return info;
    } catch (e) {
      return hit || null; // hors ligne : on garde l'ancienne valeur si elle existe
    } finally {
      pending.delete(sci);
    }
  });
  chain = job.then(() => new Promise((r) => setTimeout(r, SPACING)));
  pending.set(sci, job);
  return job;
}
