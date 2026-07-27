# Pre-baked trajectories

- `default.json` — full offline bake of `newzealand_drive_30d` for one-click fast replay.

Regenerate:

```bash
cd demo
node --import ./scripts/esm-strip-query.mjs ./scripts/bake_trajectory.mjs
```
