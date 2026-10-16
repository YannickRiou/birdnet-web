# Licence des fichiers du modèle BirdNET

Les fichiers de ce dossier sont des **œuvres dérivées de BirdNET V2.4** et sont distribués sous licence
**[Creative Commons Attribution - Pas d'Utilisation Commerciale 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/deed.fr)**.

Ils ne sont **pas** couverts par la licence MIT du reste du dépôt (voir `../LICENSE`).

**Utilisation commerciale interdite.** Vous pouvez copier, redistribuer et adapter ces fichiers à condition
de citer les auteurs, d'indiquer les modifications effectuées et de ne pas les utiliser à des fins commerciales.

## Attribution

BirdNET V2.4 est développé par le **K. Lisa Yang Center for Conservation Bioacoustics**
(Cornell Lab of Ornithology) et la **Chemnitz University of Technology**.

- Source : <https://zenodo.org/records/15050749>
- Dépôt du projet : <https://github.com/birdnet-team/BirdNET-Analyzer>
- Licence : <https://creativecommons.org/licenses/by-nc/4.0/>

Citation :

> Kahl, S., Wood, C. M., Eibl, M., & Klinck, H. (2021). BirdNET: A deep learning solution for avian diversity
> monitoring. *Ecological Informatics*, 61, 101236. <https://doi.org/10.1016/j.ecoinf.2021.101236>

Piaf n'est affilié ni au Cornell Lab of Ornithology, ni à Chemnitz University of Technology, ni à Merlin Bird ID,
et n'est pas approuvé par eux.

## Modifications apportées

Les fichiers d'origine (`BirdNET_v2.4_tfjs.zip` et, pour les étiquettes uniquement, `BirdNET_v2.4_tflite_int8.zip`)
ont été modifiés comme suit :

- **Poids convertis de float32 en float16** : modèle audio 55 → 25,7 Mo, modèle géographique 29 → 14,8 Mo.
- **Couche personnalisée `MelSpecLayerSimple`** réimplémentée sur CPU dans `js/birdnet-core.js`
  (FFT radix-2, deux trames réelles par FFT complexe, banc de filtres mel creux) à la place de `tf.signal.stft`.
  Prédictions vérifiées identiques (écart absolu max. 8,6e-4 sur les 6522 scores de l'échantillon officiel ;
  Sizerin cabaret : 0,944 contre 0,945), cette couche étant environ 50 fois plus rapide.
- **`species.json`** : fusion des noms scientifiques, français (`labels/fr.txt`) et anglais en un seul fichier.

Ces modifications sont reproductibles avec `python tools/build_model.py` (téléchargement depuis Zenodo et
vérification MD5) et vérifiables avec `npm install && npm run check` (`tools/check_model.mjs`).
