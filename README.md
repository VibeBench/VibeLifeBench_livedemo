# VibeLifeBench Live Demo

Interactive AI Travel Agent demo (NZ campervan case) for [VibeLifeBench](https://github.com/VibeBench).

## Live site

`https://vibebench.github.io/VibeLifeBench_livedemo/`

Enable Pages once (repo admin):

1. **Settings → Pages → Build and deployment**
2. Source: **GitHub Actions** (preferred; workflow already in `.github/workflows/pages.yml`)
   - or Source: **Deploy from a branch** → `gh-pages` / `/ (root)`
3. If the org repo is private, Pages may require a paid plan — set the repo **Public** for free project Pages.

## Local

```bash
./start.sh
# http://127.0.0.1:8080
```

Demo console supports **OpenAI-compatible** providers (DeepSeek / OpenAI / OpenRouter / SiliconFlow / Ollama / custom).  
Browser CORS: pick provider **本地 CORS 代理**, Base `http://127.0.0.1:8787`, set upstream (e.g. DeepSeek).

## Rebuild data

```bash
python3 scripts/build_data.py --case /path/to/newzealand_drive_30d_fix --out data
python3 scripts/fetch_routes.py --out data
```

Case data is prebuilt under `data/` for static hosting (80 events, 15 trip days, road-following routes).
