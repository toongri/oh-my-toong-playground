export function health(): { status: number; body: string } {
  return { status: 200, body: "ok" };
}
