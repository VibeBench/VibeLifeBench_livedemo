# VibeLifeBench Live Demo

Interactive demos for [VibeLifeBench](https://github.com/VibeBench):

1. **旅行 NZ** — AI Travel Agent (campervan case, map + phone)
2. **挂耳电商** — full-chain commerce cockpit (20 stages / ~146-step bake: QC fail, pack reject, quality spike, note takedown, factory delay, price war, livestream, P&L+SOP)

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

Use the top-bar **ZH / EN** toggle to switch the full UI and task copy between Chinese and English (Agent replies follow the selected language going forward).

### Fast replay (no LLM)

If `data/trajectories/default.json` is present, the demo loads it on boot and enables **加速回放 / Fast replay** without running the model. You can also import a trajectory JSON from the demo console.

```bash
# Offline bake (headless DemoEngine + TravelAgent → JSON)
cd demo
node --import ./scripts/esm-strip-query.mjs ./scripts/bake_trajectory.mjs
# smoke: --max-events 5
# env: VIBE_API_KEY / VIBE_API_BASE / VIBE_MODEL
```

Output defaults to `data/trajectories/default.json`. Replay uses cached agent turns + re-executes tools for map/ledger animations.

## Rebuild data

```bash
python3 scripts/build_data.py --case /path/to/newzealand_drive_30d_v3 --out data
python3 scripts/fetch_routes.py --out data
```

Case data is prebuilt under `data/` for static hosting (96 events, 15 trip days, road-following routes). Includes car_rental / visa / ecommerce seeds and sql_file mutation stubs.
