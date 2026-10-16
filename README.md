# Piaf

**Piaf** identifie les oiseaux à leur chant, directement dans le navigateur. C'est une application web
statique, installable (PWA) et utilisable hors ligne après le premier chargement.

Elle est née d'un besoin simple : permettre aux personnes dont le téléphone ne peut pas installer
Merlin Bird ID (par exemple un iPhone 8 bloqué sous iOS 16) d'identifier quand même les oiseaux.
Elle fonctionne aussi sur les téléphones récents et sur ordinateur.

- Application : <https://yannickriou.github.io/birdnet-web/>
- Dépôt : <https://github.com/YannickRiou/birdnet-web>

Piaf n'est affilié ni au Cornell Lab of Ornithology ni à Merlin.

## Utiliser Piaf

**iPhone (Safari)**
1. Ouvrir <https://yannickriou.github.io/birdnet-web/> dans **Safari**, de préférence en Wi-Fi
   (premier chargement : environ 26 Mo de modèle + 15 Mo pour le filtre géographique).
2. Bouton Partager, puis **Sur l'écran d'accueil**. Sans cela, Safari peut effacer les données du site après
   7 jours sans visite.
3. Lancer Piaf depuis l'icône, autoriser le micro, puis appuyer sur l'écoute.
4. Garder l'écran allumé pendant l'écoute (Piaf le demande automatiquement quand le navigateur le permet) :
   le micro s'arrête dès que l'application passe en arrière-plan.

**Android (Chrome)** : ouvrir l'adresse, puis menu, **Installer l'application** (ou Ajouter à l'écran d'accueil).

**Ordinateur** : ouvrir l'adresse dans un navigateur récent ; l'installation est optionnelle.

## Fonctionnalités

- **Écoute en direct** avec spectrogramme défilant.
- **Analyse d'un fichier audio** (mémo vocal, enregistrement...).
- **Fiches espèces** : nom français, nom scientifique, confiance et photo iNaturalist (uniquement des photos
  Creative Commons, créditées avec l'auteur et un lien vers la licence).
- **Ma liste à vie** : touchez « ＋ Ma liste » pour confirmer une espèce. La liste est stockée dans le
  `localStorage` du téléphone (les cookies sont trop petits, 4 Ko), avec export/import d'une sauvegarde JSON.
- **Filtre géographique et saisonnier** (modèle géographique de BirdNET, seuil 0,03), activé par défaut sur
  l'**Europe continentale** sans demander la position : grille de points tous les 2,5° (37–60° N, 10° O–30° E),
  une espèce est gardée si elle est probable cette semaine en au moins un point. En option, la position précise
  de l'appareil peut être utilisée à la place.
- **Réglages** : seuil de confiance (50 % par défaut), filtre on/off, position précise on/off.

## Vie privée

- Le son est analysé **sur l'appareil** ; il n'est jamais envoyé nulle part.
- La position n'est demandée que si vous activez l'option « position précise », et elle ne quitte jamais le téléphone.
- Seul le **nom scientifique** d'une espèce est envoyé à iNaturalist pour récupérer une photo.
- La liste à vie reste dans le stockage local de l'appareil.

## Limites

- Les **faux positifs** existent : une identification est une aide, pas une certitude. Vérifiez à l'oreille et
  à l'œil, surtout pour les espèces rares ou hors saison.
- **Usage non commercial uniquement** : la licence du modèle BirdNET (CC BY-NC 4.0) l'impose.
- Le micro **s'arrête en arrière-plan** (écran verrouillé ou autre application).
- Sur iOS, le stockage d'un site non installé peut être purgé : installez Piaf sur l'écran d'accueil et
  **exportez régulièrement** votre liste à vie.
- Les 11 classes non-espèces du modèle (voix humaine, chien, moteur...) ne sont jamais affichées.

## Développement

Aucune étape de build : ce sont des fichiers statiques.

```bash
npm run serve          # python -m http.server 8080, puis http://localhost:8080
npm install && npm run check   # vérifie le modèle (tools/check_model.mjs)
npm run vendor         # copie TensorFlow.js dans vendor/
python tools/build_model.py    # régénère model/ depuis Zenodo (vérifie le MD5)
python tools/make_icons.py     # régénère les icônes
```

- `?backend=wasm|webgl|cpu` dans l'URL force un moteur de calcul (tests).
- Après un changement du modèle ou de `vendor/`, incrémenter `VERSION` dans `sw.js`.
- **Déploiement** : GitHub Pages depuis la branche `main`, dossier racine (Settings, Pages).

## Architecture

| Fichier | Rôle |
|---|---|
| `js/app.js` | Interface |
| `js/engine-worker.js` | Web Worker : TF.js, choix du backend WebGL (repli ou benchmark WebAssembly SIMD si WebGL est absent, sans float32, ou > 600 ms) ; fenêtres de 3 s à 48 kHz, nouvelle analyse toutes les 1,5 s, adaptation automatique sur téléphone lent (analyse de la fenêtre la plus récente) |
| `js/birdnet-core.js` | Spectrogramme mel CPU (FFT radix-2) |
| `js/capture-worklet.js` | AudioWorklet : rééchantillonne le micro à 48 kHz, envoie des blocs de 100 ms directement au worker (MessageChannel) |
| `js/audio.js` | Micro (echoCancellation, noiseSuppression et autoGainControl désactivés, car ils effacent le chant) ; décodage de fichiers |
| `js/spectrogram.js` | Spectrogramme, colormap magma |
| `js/species-info.js` | iNaturalist (≤ 1 requête/s, cache 30 jours) |
| `js/lifelist.js` | Liste à vie |
| `sw.js` | Hors ligne : cache d'abord pour `model/` et `vendor/`, réseau d'abord pour les fichiers de l'app |
| `tools/` | `build_model.py`, `check_model.mjs`, `vendor.mjs`, `make_icons.py` |

Performance mesurée : environ 84 ms par analyse de 3 s avec WebGL sur ordinateur.

## Crédits et licences

Le code de Piaf est sous licence MIT (voir `LICENSE`). Le modèle est sous une licence différente.

| Composant | Auteur | Licence | Lien |
|---|---|---|---|
| Code de Piaf | Yannick Riou | MIT | [`LICENSE`](LICENSE) |
| Modèle BirdNET V2.4 (`model/`, converti en float16) | K. Lisa Yang Center for Conservation Bioacoustics (Cornell Lab of Ornithology), Chemnitz University of Technology | CC BY-NC 4.0 (non commercial) | [`model/LICENSE.md`](model/LICENSE.md), [Zenodo](https://zenodo.org/records/15050749) |
| TensorFlow.js 4.22.0 (`vendor/`) | Google / TensorFlow Authors | Apache-2.0 | [`vendor/LICENSE-tfjs.txt`](vendor/LICENSE-tfjs.txt) |
| Polices Fraunces et Nunito Sans (Google Fonts) | Auteurs respectifs | SIL OFL | [fonts.google.com](https://fonts.google.com/) |
| Photos d'espèces | Photographes iNaturalist | Chaque photo sous sa licence Creative Commons, créditée dans l'application | [iNaturalist](https://www.inaturalist.org/) |

**Citation de BirdNET** : Kahl, S., Wood, C. M., Eibl, M., & Klinck, H. (2021). BirdNET: A deep learning
solution for avian diversity monitoring. *Ecological Informatics*, 61, 101236.
<https://doi.org/10.1016/j.ecoinf.2021.101236>

Modifications apportées au modèle (poids en float16, couche mel réimplémentée sur CPU, fusion des noms) :
voir [`model/LICENSE.md`](model/LICENSE.md).
