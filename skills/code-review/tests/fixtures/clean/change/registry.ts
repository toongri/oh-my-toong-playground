import { ping } from "./handlers/ping";
import { echo } from "./handlers/echo";
import { time } from "./handlers/time";
import { health } from "./handlers/health";

type Handler = (...args: string[]) => { status: number; body: string };

export const registry: Record<string, Handler> = {
  ping,
  echo,
  time,
  health,
};
