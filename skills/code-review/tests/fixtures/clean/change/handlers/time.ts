export function time(): { status: number; body: string } {
  return { status: 200, body: new Date().toISOString() };
}
