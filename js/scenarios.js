/**
 * Lifecycle registry for deterministic cockpit scenarios.
 * Travel keeps its existing engine; scripted scenarios share this small adapter.
 */
export function createScriptedScenarioRegistry(definitions, hooks = {}) {
  const states = new Map(
    Object.entries(definitions || {}).map(([id, definition]) => [
      id,
      { id, definition, instance: null, loading: null, playing: false },
    ])
  );

  function state(id) {
    return states.get(id) || null;
  }

  async function ensure(id) {
    const entry = state(id);
    if (!entry) throw new Error(`Unknown scripted scenario: ${id}`);
    if (entry.instance?.ready) return entry.instance;
    if (entry.loading) return entry.loading;
    entry.loading = (async () => {
      const instance = entry.definition.create();
      instance.onReplay = () => hooks.onReplay?.(id);
      instance.onConfigure = () => hooks.onConfigure?.(id);
      await instance.load(entry.definition.dataBase);
      entry.instance = instance;
      return instance;
    })();
    try {
      return await entry.loading;
    } finally {
      entry.loading = null;
    }
  }

  async function play(id, options) {
    const entry = state(id);
    if (!entry) throw new Error(`Unknown scripted scenario: ${id}`);
    if (entry.playing) return { ok: false, aborted: true };
    entry.playing = true;
    try {
      const instance = await ensure(id);
      return await instance.startReplay(options);
    } finally {
      entry.playing = false;
    }
  }

  function stop(id) {
    const entry = state(id);
    entry?.instance?.player?.stop?.();
    if (entry) entry.playing = false;
  }

  return {
    has: (id) => states.has(id),
    ids: () => Array.from(states.keys()),
    get: (id) => state(id)?.instance || null,
    ensure,
    play,
    isPlaying: (id) => Boolean(state(id)?.playing),
    hasProgress: (id) => {
      const instance = state(id)?.instance;
      return Boolean(instance?.deliverables?.length || instance?.player?.running);
    },
    show: (id) => state(id)?.instance?.show?.(),
    hide: (id) => state(id)?.instance?.hide?.(),
    reset: (id) => state(id)?.instance?.reset?.(),
    rerenderLocale: (id) => state(id)?.instance?.rerenderLocale?.(),
    stop,
    stopAll() {
      states.forEach((_, id) => stop(id));
    },
    hideAll() {
      states.forEach((entry) => entry.instance?.hide?.());
    },
  };
}
