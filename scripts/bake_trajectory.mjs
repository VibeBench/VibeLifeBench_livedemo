#!/usr/bin/env node
/**
 * Headless trajectory baker — runs DemoEngine + TravelAgent without a browser,
 * writes Trajectory JSON for fast offline replay.
 *
 *   cd demo
 *   node --import ./scripts/esm-strip-query.mjs ./scripts/bake_trajectory.mjs
 *   node --import ./scripts/esm-strip-query.mjs ./scripts/bake_trajectory.mjs --max-events 5
 *
 * Env: VIBE_API_KEY, VIBE_API_BASE, VIBE_MODEL
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeCase } from "../js/loader.js";
import { DemoEngine } from "../js/engine.js";
import { TravelAgent } from "../js/agent.js";
import { Trajectory, isValidRecording } from "../js/trajectory.js";
import { setLocale } from "../js/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = pathResolve(__dirname, "..");

const DEFAULT_KEY = ["sk", "15f5ea94061c4fab82a51bfea7d71288"].join("-");
const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";

function parseArgs(argv) {
  const out = {
    data: join(DEMO_ROOT, "data"),
    out: join(DEMO_ROOT, "data", "trajectories", "default.json"),
    apiKey: process.env.VIBE_API_KEY || DEFAULT_KEY,
    base: process.env.VIBE_API_BASE || DEFAULT_BASE,
    model: process.env.VIBE_MODEL || DEFAULT_MODEL,
    locale: "zh",
    maxEvents: 0,
    provider: "deepseek",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--data") out.data = pathResolve(next());
    else if (a === "--out") out.out = pathResolve(next());
    else if (a === "--api-key") out.apiKey = next();
    else if (a === "--base") out.base = next();
    else if (a === "--model") out.model = next();
    else if (a === "--locale") out.locale = next() === "en" ? "en" : "zh";
    else if (a === "--max-events") out.maxEvents = Math.max(0, Number(next()) || 0);
    else if (a === "--provider") out.provider = next();
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: bake_trajectory.mjs [options]
  --data DIR          Case data dir (default: ./data)
  --out FILE          Output trajectory JSON
  --api-key KEY       LLM API key (or VIBE_API_KEY)
  --base URL          API base (or VIBE_API_BASE)
  --model NAME        Model id (or VIBE_MODEL)
  --locale zh|en      Agent locale (default: zh)
  --max-events N      Stop after N env steps (smoke)
  --provider NAME     Provider hint (default: deepseek)`);
      process.exit(0);
    } else {
      console.error("Unknown arg:", a);
      process.exit(1);
    }
  }
  return out;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadCaseFromDir(dataDir) {
  const events = loadJson(join(dataDir, "events.json"));
  const meta = loadJson(join(dataDir, "meta.json"));
  const env = loadJson(join(dataDir, "env_state.json"));
  const workspace = loadJson(join(dataDir, "workspace.json"));
  return normalizeCase({ events, meta, env, workspace });
}

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}]`, ...args);
}

async function main() {
  const opts = parseArgs(process.argv);
  setLocale(opts.locale, { silent: true });

  const caseData = loadCaseFromDir(opts.data);
  const caseId = caseData.meta?.case_id || "unknown";
  const total = caseData.flat?.length || 0;
  log(`case=${caseId} events=${total} model=${opts.model} locale=${opts.locale}`);
  log(`out=${opts.out}`);

  const engine = new DemoEngine(caseData);
  const traj = new Trajectory(caseId);
  traj.setModel(opts.model);

  const agent = new TravelAgent({
    apiKey: opts.apiKey,
    baseUrl: opts.base,
    model: opts.model,
    provider: opts.provider,
    engine,
    workspace: caseData.workspace,
    meta: caseData.meta,
    locale: opts.locale,
    thinking: true,
    onStream: () => {},
    onTool: () => {},
  });

  let stepped = 0;
  let agentTurns = 0;
  const t0 = Date.now();

  while (!engine.progress.done) {
    if (opts.maxEvents > 0 && stepped >= opts.maxEvents) {
      log(`stopped early at --max-events ${opts.maxEvents}`);
      break;
    }

    const result = engine.step();
    if (!result) break;
    const { event, agentText, feedToAgent, mutationResult } = result;
    traj.pushEnvEvent(event, { mutationResult, feedToAgent });
    stepped += 1;

    const prog = `${stepped}/${total}`;
    if (feedToAgent && agentText) {
      log(`${prog} agent ← ${event.kind} ${event.id}`);
      try {
        const turn = await agent.handleEnvEvent(agentText);
        traj.pushAgentTurn({
          eventId: event.id,
          input: agentText,
          output: turn.content,
          thinking: turn.thinking,
          toolCalls: turn.toolCalls,
          usage: turn.usage,
        });
        agentTurns += 1;
        const preview = String(turn.content || "")
          .replace(/\s+/g, " ")
          .slice(0, 80);
        log(`  → tools=${(turn.toolCalls || []).length} "${preview}"`);
      } catch (err) {
        log(`  ERROR ${event.id}: ${err.message || err}`);
        traj.pushNote(`bake error on ${event.id}: ${err.message || err}`);
        writeOut(opts.out, traj);
        throw err;
      }
    } else {
      log(`${prog} env ${event.kind} ${event.id}`);
    }

    // Checkpoint every 10 steps so a long bake isn't lost.
    if (stepped % 10 === 0) writeOut(opts.out, traj);
  }

  const json = writeOut(opts.out, traj);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done in ${sec}s · env=${json.stats.env_events} agent=${json.stats.agent_turns} · ${opts.out}`);
  if (!isValidRecording(json)) {
    console.warn("warning: recording has no agent_turn steps — replay button will stay disabled");
  }
}

function writeOut(outPath, traj) {
  mkdirSync(dirname(outPath), { recursive: true });
  const json = traj.toJSON();
  writeFileSync(outPath, JSON.stringify(json, null, 2));
  return json;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
