import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface ReviewSubmissionReceipt {
	path: string;
	sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const assessmentKeys = ["unfixed_cost", "exposure", "remedy", "added_cost", "rationale"] as const;
const assessmentKeySet = new Set<string>(assessmentKeys);

function validatePriority(value: unknown): void {
	if (value !== "HIGH" && value !== "MEDIUM" && value !== "LOW") throw new Error("submit-review: finding priority must be HIGH, MEDIUM, or LOW");
}

function validateAssessment(value: unknown): void {
	if (!isRecord(value) || Object.keys(value).some((key) => !assessmentKeySet.has(key)) || Object.keys(value).length !== assessmentKeys.length) throw new Error("submit-review: finding assessment must contain exactly five known fields");
	for (const key of assessmentKeys) {
		if (typeof value[key] !== "string" || value[key].trim() === "") throw new Error(`submit-review: finding assessment.${key} must be a non-empty string`);
	}
}

function validateReviewJson(value: unknown): void {
	if (!isRecord(value) || (value.status !== "COMPLETE" && value.status !== "INCONCLUSIVE")) throw new Error("submit-review: status must be COMPLETE or INCONCLUSIVE");
	if (typeof value.reviewer !== "string" || value.reviewer.trim() === "") throw new Error("submit-review: reviewer must be a non-empty string");
	if (typeof value.at !== "string") throw new Error("submit-review: at must be a string");
	if (!Array.isArray(value.findings)) throw new Error("submit-review: findings must be an array");
	for (const finding of value.findings) {
		if (!isRecord(finding) || typeof finding.class !== "string" || finding.class.trim() === "" || (finding.verdict !== "CONFIRMED" && finding.verdict !== "PLAUSIBLE") || (finding.impact !== "HIGH" && finding.impact !== "MEDIUM" && finding.impact !== "LOW")) throw new Error("submit-review: finding requires class, verdict, and impact");
		if (finding.ref !== undefined && typeof finding.ref !== "string") throw new Error("submit-review: finding ref must be a string when present");
		if (value.status === "COMPLETE" || finding.priority !== undefined) validatePriority(finding.priority);
		if (value.status === "COMPLETE" || finding.assessment !== undefined) validateAssessment(finding.assessment);
	}
}

export function submitReviewArtifact(artifactPath: string, raw: string): ReviewSubmissionReceipt {
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { throw new Error("submit-review: invalid JSON"); }
	validateReviewJson(parsed);
	if (!existsSync(dirname(artifactPath))) throw new Error(`submit-review: destination directory does not exist: ${dirname(artifactPath)}`);
	const tempPath = `${artifactPath}.tmp-${randomUUID()}`;
	try {
		writeFileSync(tempPath, raw, { encoding: "utf8", mode: 0o600 });
		renameSync(tempPath, artifactPath);
	} catch (error) {
		try { unlinkSync(tempPath); } catch { /* best effort cleanup */ }
		throw error;
	}
	return { path: artifactPath, sha256: createHash("sha256").update(raw, "utf8").digest("hex") };
}

function main(): void {
	const args = process.argv.slice(2);
	const artifactIndex = args.indexOf("--artifact");
	const jsonIndex = args.indexOf("--json");
	if (artifactIndex < 0 || !args[artifactIndex + 1] || jsonIndex < 0 || args[jsonIndex + 1] !== "-") throw new Error("submit-review: --artifact <destination> --json - is required");
	const result = submitReviewArtifact(args[artifactIndex + 1], requireStdin());
	process.stdout.write(JSON.stringify(result) + "\n");
}

function requireStdin(): string {
	return readFileSync(0, "utf8");
}

if (import.meta.main) {
	try { main(); } catch (error) { process.stderr.write(`submit-review: ${String(error)}\n`); process.exit(1); }
}
