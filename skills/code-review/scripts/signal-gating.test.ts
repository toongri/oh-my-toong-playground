import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

// ---------------------------------------------------------------------------
// completion-gate dispatch 계약: 디스패치 프롬프트가 "supplied artifact destination"을 싣는지로
// 비대화형 경로를 구분한다. 이 토큰을 SKILL.md(소비)와 code-reviewer agent(전달)가 함께 쓴다.
// 상태표와 게이트 문구는 시나리오 스위트가 지키므로 여기서는 토큰 존재만 확인한다.
// ---------------------------------------------------------------------------

describe("completion-gate dispatch discriminator 토큰", () => {
	it("SKILL.md와 code-reviewer agent 모두 `supplied artifact destination`을 쓴다", () => {
		for (const relative of [
			join("skills", "code-review", "SKILL.md"),
			join("agents", "code-reviewer.md"),
		]) {
			expect(readFileSync(join(REPO_ROOT, relative), "utf-8"), relative).toContain(
				"supplied artifact destination",
			);
		}
	});
});
