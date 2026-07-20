# VibeLifeBench Live Demo

Interactive AI Travel Agent demo (NZ campervan case) for [VibeLifeBench](https://github.com/VibeBench).

## Live site

`https://vibebench.github.io/VibeLifeBench_livedemo/`

## Local

```bash
./start.sh
# http://127.0.0.1:8080
# Demo console API Base → http://127.0.0.1:8787
```

## Rebuild data

```bash
python3 scripts/build_data.py --case /path/to/newzealand_drive_30d_fix --out data
python3 scripts/fetch_routes.py --out data
```

Case data is prebuilt under `data/` for static hosting.
