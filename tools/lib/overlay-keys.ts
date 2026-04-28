type KeyExtractor = (entry: unknown) => string;

const EXACT_REGISTRY = new Map<string, KeyExtractor>([
  ["plugins.items", pluginsItemsKey],
  ["agents.items", syncItemsKey],
  ["commands.items", syncItemsKey],
  ["skills.items", syncItemsKey],
  ["scripts.items", syncItemsKey],
  ["rules.items", syncItemsKey],
  ["permissions.allow", selfKey],
  ["permissions.deny", selfKey],
  ["permissions.ask", selfKey],
]);

function pluginsItemsKey(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "name" in entry) {
    return String((entry as Record<string, unknown>).name);
  }
  return JSON.stringify(entry);
}

function syncItemsKey(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "component" in entry) {
    return String((entry as Record<string, unknown>).component);
  }
  return JSON.stringify(entry);
}

function selfKey(entry: unknown): string {
  return String(entry);
}

function hooksKey(entry: unknown): string {
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    const component = e.component !== undefined ? String(e.component) : undefined;
    const matcher = e.matcher !== undefined ? String(e.matcher) : undefined;
    if (component !== undefined && matcher !== undefined) {
      return JSON.stringify({ component, matcher });
    }
    if (component !== undefined) return component;
  }
  return JSON.stringify(entry);
}

export function hasRegistry(path: string): boolean {
  if (EXACT_REGISTRY.has(path)) return true;
  return path.startsWith("hooks.");
}

export function getIdentityKey(path: string, entry: unknown): string {
  const exact = EXACT_REGISTRY.get(path);
  if (exact) return exact(entry);
  if (path.startsWith("hooks.")) return hooksKey(entry);
  return JSON.stringify(entry);
}
