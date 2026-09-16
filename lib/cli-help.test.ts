/**
 * Tests for lib/cli-help.ts
 */

import { describe, test, expect } from "bun:test";
import { renderHelp, type CliCommand } from "./cli-help.ts";

const ROSTER: CliCommand[] = [
	{ name: "get", authority: "ai", effect: "reads state" },
	{ name: "set", authority: "ai", effect: "writes state" },
	{ name: "adopt", authority: "ai", effect: "re-keys a session" },
	{ name: "force-complete", authority: "user", effect: "forces completion" },
	{ name: "resume-pursuit", authority: "user", effect: "resumes a paused pursuit" },
	{ name: "set-blocked", authority: "system", effect: "records a blocker" },
	{ name: "claim-review-dispatch", authority: "hook", effect: "reserves a review dispatch" },
];

describe("renderHelp", () => {
	test("groups commands under the correct section header", () => {
		const out = renderHelp("my-cli", ROSTER);
		expect(out).toContain("AI-USABLE");
		expect(out).toContain(
			"USER-ONLY (AI must NOT run these — present the command and ask the user to run it)",
		);
		expect(out).toContain("SYSTEM-ONLY (internal; not for manual use)");
		expect(out).toContain("HOOK-ONLY (invoked by hooks, not manually)");
	});

	test("sorts commands alphabetically within a group", () => {
		const out = renderHelp("my-cli", ROSTER);
		const aiSection = out.split("AI-USABLE")[1].split(/\n\n|$/)[0];
		const idxAdopt = aiSection.indexOf("adopt");
		const idxGet = aiSection.indexOf("get");
		const idxSet = aiSection.indexOf("set —");
		expect(idxAdopt).toBeGreaterThanOrEqual(0);
		expect(idxAdopt).toBeLessThan(idxGet);
		expect(idxGet).toBeLessThan(idxSet);
	});

	test("a user-authority command lands under USER-ONLY with the ask-the-user framing", () => {
		const out = renderHelp("my-cli", ROSTER);
		const userSectionStart = out.indexOf("USER-ONLY");
		const nextSectionStart = out.indexOf("SYSTEM-ONLY");
		const userSection = out.slice(userSectionStart, nextSectionStart);
		expect(userSection).toContain("present the command and ask the user to run it");
		expect(userSection).toContain("force-complete — forces completion");
		expect(userSection).toContain("resume-pursuit — resumes a paused pursuit");
	});

	test("omits a group's header entirely when it has no commands", () => {
		const out = renderHelp("my-cli", [{ name: "get", authority: "ai", effect: "reads state" }]);
		expect(out).toContain("AI-USABLE");
		expect(out).not.toContain("USER-ONLY");
		expect(out).not.toContain("SYSTEM-ONLY");
		expect(out).not.toContain("HOOK-ONLY");
	});

	test("includes the CLI name in the output", () => {
		const out = renderHelp("ultragoal-state", ROSTER);
		expect(out).toContain("ultragoal-state commands:");
	});
});
