"""Regénère le dossier model/ à partir des fichiers officiels BirdNET V2.4 (Zenodo).

Ce que fait le script (et donc les modifications apportées au modèle, cf. licence CC BY-NC 4.0) :
  1. télécharge BirdNET_v2.4_tfjs.zip et BirdNET_v2.4_tflite_int8.zip (pour les noms français)
     depuis https://zenodo.org/records/15050749 et vérifie leur somme MD5 ;
  2. convertit les poids float32 en float16 (taille divisée par 2, prédictions quasi identiques) ;
     les poids hors de la plage utile du float16 restent en float32 ;
  3. écrit model/species.json : [[nom scientifique, nom français, nom anglais], ...]
     dans l'ordre des sorties du modèle.

Usage : python tools/build_model.py   (Python >= 3.8 + numpy)
"""
import hashlib
import json
import pathlib
import shutil
import urllib.request
import zipfile

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "model"
ZENODO = "https://zenodo.org/records/15050749/files/"
SOURCES = {
    "tfjs": ("BirdNET_v2.4_tfjs.zip", "abefc17edeb93ad7abed36872e10324d"),
    "int8": ("BirdNET_v2.4_tflite_int8.zip", "69becc3e8eb1c72d1d9dae7f21062c74"),
}
SHARD_SIZE = 4 * 1024 * 1024


def fetch(key):
    name, md5 = SOURCES[key]
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(exist_ok=True)
        print(f"Téléchargement de {name}…")
        urllib.request.urlretrieve(ZENODO + name + "?download=1", path)
    digest = hashlib.md5(path.read_bytes()).hexdigest()
    if digest != md5:
        raise SystemExit(f"{name} : MD5 inattendu {digest} (attendu {md5})")
    return zipfile.ZipFile(path)


def to_float16(zf, src_dir, dst_dir):
    """Réécrit un modèle TF.js (layers ou graph) avec des poids float16."""
    model = json.loads(zf.read(f"{src_dir}/model.json"))
    dst_dir.mkdir(parents=True, exist_ok=True)
    out = bytearray()
    entries = []
    kept = 0
    for group in model["weightsManifest"]:
        blob = b"".join(zf.read(f"{src_dir}/{p}") for p in group["paths"])
        offset = 0
        for w in group["weights"]:
            assert "quantization" not in w, w["name"]
            n = int(np.prod(w["shape"])) if w["shape"] else 1
            if w["dtype"] != "float32":  # constantes entières du graphe : recopiées telles quelles
                out += blob[offset:offset + 4 * n]
                offset += 4 * n
                entries.append(w)
                continue
            values = np.frombuffer(blob, "<f4", n, offset)
            offset += 4 * n
            half = values.astype("<f2")
            # Garde le float32 si le float16 dégrade la valeur (dépassement ou valeurs minuscules).
            err = np.abs(half.astype("<f4") - values) / np.maximum(np.abs(values), 1e-3)
            entry = {"name": w["name"], "shape": w["shape"], "dtype": "float32"}
            if np.all(np.isfinite(half)) and err.max() < 1e-2:
                entry["quantization"] = {"dtype": "float16", "original_dtype": "float32"}
                out += half.tobytes()
            else:
                out += values.tobytes()
                kept += 1
            entries.append(entry)
    paths = []
    for i in range(0, len(out), SHARD_SIZE):
        paths.append(f"group1-shard{i // SHARD_SIZE + 1}of{-(-len(out) // SHARD_SIZE)}.bin")
        (dst_dir / paths[-1]).write_bytes(out[i:i + SHARD_SIZE])
    model["weightsManifest"] = [{"paths": paths, "weights": entries}]
    (dst_dir / "model.json").write_text(json.dumps(model, separators=(",", ":")), "utf8")
    print(f"{dst_dir.relative_to(ROOT).as_posix()} : {len(out) / 1e6:.1f} Mo, {kept} poids gardés en float32")


def main():
    tfjs, int8 = fetch("tfjs"), fetch("int8")
    if OUT.exists():
        shutil.rmtree(OUT)
    to_float16(tfjs, "model", OUT / "audio")
    to_float16(tfjs, "model/mdata", OUT / "geo")

    en = json.loads(tfjs.read("model/labels.json"))
    fr = int8.read("labels/fr.txt").decode("utf8").splitlines()
    assert len(en) == len(fr) == 6522
    species = []
    for e, f in zip(en, fr):
        sci, en_name = e.split("_", 1)
        sci_fr, fr_name = f.split("_", 1)
        assert sci == sci_fr, (sci, sci_fr)
        species.append([sci, fr_name, en_name])
    (OUT / "species.json").write_text(json.dumps(species, ensure_ascii=False, separators=(",", ":")), "utf8")
    print(f"model/species.json : {len(species)} espèces")


if __name__ == "__main__":
    main()
