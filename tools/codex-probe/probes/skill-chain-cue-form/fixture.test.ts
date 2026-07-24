/**
 * Hermetic tests for the synthetic alpha/beta/decoy fixture builders — no
 * codex spawn. Pins down the exact isolation property the probe design
 * depends on: the string "beta" (the dispatch target's name) appears in
 * alpha's body ONLY at the one dispatch spot for the sigil/prose arms, and
 * nowhere at all for the removed arm — see index.ts's header comment for why
 * that isolation is what makes this probe (unlike skill-chain-load) able to
 * attribute an observed open to the cue form rather than to some other
 * "beta" mention leaking in from elsewhere.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { alphaBody, betaBody, BETA_SENTINEL, decoyBody, DECOY_NAMES, writeSyntheticFixture } from "./fixture.ts";

describe("alphaBody", () => {
	it("sigil and prose arms share the identical pre-rewrite source (arm difference is applied later, by whether the rewrite pass runs)", () => {
		expect(alphaBody("sigil")).toBe(alphaBody("prose"));
	});

	it("sigil/prose source contains the literal Skill(skill: \"beta\") dispatch call exactly once", () => {
		const body = alphaBody("sigil");
		const matches = body.match(/Skill\(skill: "beta"\)/g) ?? [];
		expect(matches.length).toBe(1);
	});

	it("removed arm contains no mention of beta anywhere", () => {
		expect(alphaBody("removed")).not.toContain("beta");
	});

	it("oldprose arm's dispatch line is the pre-ba36eb7b rule-6a output form: 'the beta skill'", () => {
		expect(alphaBody("oldprose")).toContain("the beta skill");
	});

	it("oldprose source contains 'beta' exactly once — same isolation invariant as every other arm", () => {
		const body = alphaBody("oldprose");
		const matches = body.match(/beta/g) ?? [];
		expect(matches.length).toBe(1);
	});

	it("every arm's frontmatter names the skill alpha", () => {
		for (const arm of ["sigil", "prose", "removed", "oldprose"] as const) {
			expect(alphaBody(arm)).toContain("name: alpha");
		}
	});
});

describe("betaBody", () => {
	it("contains the sentinel exactly once and names itself beta in frontmatter", () => {
		const body = betaBody();
		const matches = body.match(new RegExp(BETA_SENTINEL, "g")) ?? [];
		expect(matches.length).toBe(1);
		expect(body).toContain("name: beta");
	});
});

describe("decoyBody", () => {
	it("never mentions alpha or beta by name — a decoy that leaked a reference would confound the decoy signal", () => {
		const body = decoyBody("gamma");
		expect(body).not.toContain("alpha");
		expect(body).not.toContain("beta");
	});

	it("names itself with the given decoy name in frontmatter", () => {
		expect(decoyBody("delta")).toContain("name: delta");
	});
});

describe("DECOY_NAMES", () => {
	it("is gamma and delta", () => {
		expect(DECOY_NAMES).toEqual(["gamma", "delta"]);
	});
});

describe("writeSyntheticFixture", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-form-fixture-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("writes skills/{alpha,beta,gamma,delta}/SKILL.md under the given fixture root", async () => {
		await writeSyntheticFixture(tmpDir, "sigil");
		for (const name of ["alpha", "beta", "gamma", "delta"]) {
			const content = await fs.readFile(path.join(tmpDir, "skills", name, "SKILL.md"), "utf8");
			expect(content.length).toBeGreaterThan(0);
		}
	});

	it("writes the arm-specific alpha body", async () => {
		await writeSyntheticFixture(tmpDir, "removed");
		const content = await fs.readFile(path.join(tmpDir, "skills", "alpha", "SKILL.md"), "utf8");
		expect(content).not.toContain("beta");
	});

	it("writes the oldprose arm's legacy-prose dispatch form", async () => {
		await writeSyntheticFixture(tmpDir, "oldprose");
		const content = await fs.readFile(path.join(tmpDir, "skills", "alpha", "SKILL.md"), "utf8");
		expect(content).toContain("the beta skill");
	});
});
