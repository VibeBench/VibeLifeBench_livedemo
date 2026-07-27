/**
 * Node ESM resolve hook: strip ?v= cache-bust query strings from relative imports
 * so demo modules (written for the browser) can load under Node.
 *
 * Usage:
 *   node --import ./scripts/esm-strip-query.mjs ./scripts/bake_trajectory.mjs
 */
export async function resolve(specifier, context, nextResolve) {
  const q = specifier.indexOf("?");
  if (q !== -1 && (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:"))) {
    return nextResolve(specifier.slice(0, q), context);
  }
  return nextResolve(specifier, context);
}
