export function echo(input: string): { status: number; body: string } {
  return { status: 200, body: input };
}
