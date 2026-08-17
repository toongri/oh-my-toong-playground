import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = Buffer.concat(chunks);
const digest = createHash("sha256").update(input).digest("hex");
const control = process.env.CHILD_CONTROL;
if (control) appendFileSync(control, `started:${process.pid}\n`);
let descendant: ReturnType<typeof spawn> | undefined;
let stopLifecycle: (() => void) | undefined;
let lifecycleDone: Promise<void> | undefined;
if (process.env.CHILD_READY) {
	lifecycleDone = new Promise<void>((resolve) => { stopLifecycle = resolve; });
	descendant = spawn("sleep", ["30"], { stdio: "ignore" });
	const stop = (status: number) => { try { if (descendant?.pid) process.kill(descendant.pid, "SIGTERM"); } catch { /* descendant may already be gone */ } process.exitCode = status; stopLifecycle?.(); };
	process.on("SIGTERM", () => stop(143));
	process.on("SIGINT", () => stop(130));
	writeFileSync(process.env.CHILD_READY, JSON.stringify({ child: process.pid, descendant: descendant.pid }));
}
if (process.env.CHILD_WRITE_JSON) {
	writeFileSync(process.env.CHILD_WRITE_JSON, JSON.stringify({ digest, cwd: process.cwd(), env: process.env.CHILD_SENTINEL ?? "" }));
}
process.stdout.write(input);
process.stderr.write(Buffer.from(`child:${digest}\n`));
const exitCode = Number(process.env.CHILD_EXIT ?? "0");
if (Number.isInteger(exitCode)) process.exitCode = exitCode;
if (lifecycleDone) await lifecycleDone;
