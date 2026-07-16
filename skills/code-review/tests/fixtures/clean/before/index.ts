import { registry } from "./registry";

export function dispatch(name: string, ...args: string[]) {
  const handler = registry[name];
  if (!handler) {
    return { status: 404, body: "not found" };
  }
  return handler(...args);
}
