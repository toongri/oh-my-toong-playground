import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import {
	REQUIRED_HEADINGS,
	validatePlan,
	validatePlanGraph,
	validateBoundaryMap,
	validateFences,
} from "./validate-plan.ts";

// ---------------------------------------------------------------------------
// Self-test: canonical heading list
// ---------------------------------------------------------------------------

test("validator required headings are the 7 canonical literals", () => {
	expect(REQUIRED_HEADINGS).toEqual([
		"TL;DR",
		"Context",
		"Work Objectives",
		"TODOs",
		"Execution Strategy",
		"Verification Strategy",
		"Success Criteria",
	]);
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function buildPlan(overrides: Partial<Record<string, string>> = {}): string {
	const defaults: Record<string, string> = {
		"TL;DR": "Short summary of the work.",
		Context: "Background and motivation for the work.",
		"Work Objectives": "The concrete goals we want to achieve.",
		TODOs: "- [ ] Step 1\n- [ ] Step 2",
		"Execution Strategy": "How we will execute the plan.",
		"Verification Strategy": "How we verify correctness.",
		"Success Criteria": "Definition of done.",
	};
	const sections = { ...defaults, ...overrides };
	return REQUIRED_HEADINGS.map((h) => {
		const body = sections[h] ?? `Body for ${h}.`;
		return `## ${h}\n\n${body}\n`;
	}).join("\n");
}

// ---------------------------------------------------------------------------
// Happy-path
// ---------------------------------------------------------------------------

describe("real-plan fixture passes", () => {
	test("real-plan fixture passes", () => {
		const plan = buildPlan();
		const missing = validatePlan(plan);
		expect(missing).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Empty section tests — one per required heading
// ---------------------------------------------------------------------------

describe("empty sections", () => {
	test("empty section: TL;DR", () => {
		const plan = buildPlan({ "TL;DR": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("TL;DR");
	});

	test("empty section: Context", () => {
		const plan = buildPlan({ Context: "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Context");
	});

	test("empty section: Work Objectives", () => {
		const plan = buildPlan({ "Work Objectives": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Work Objectives");
	});

	test("empty section: TODOs", () => {
		const plan = buildPlan({ TODOs: "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("TODOs");
	});

	test("empty section: Execution Strategy", () => {
		const plan = buildPlan({ "Execution Strategy": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Execution Strategy");
	});

	test("empty section: Verification Strategy", () => {
		const plan = buildPlan({ "Verification Strategy": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Verification Strategy");
	});

	test("empty section: Success Criteria", () => {
		const plan = buildPlan({ "Success Criteria": "" });
		const missing = validatePlan(plan);
		expect(missing).toContain("Success Criteria");
	});
});

// ---------------------------------------------------------------------------
// Policy tests
// ---------------------------------------------------------------------------

describe("validator policy", () => {
	test("validator policy: fenced heading not counted", () => {
		// ## Success Criteria appears ONLY inside a code fence — must NOT count
		const plan = buildPlan({ "Success Criteria": "" }).replace(
			"## Success Criteria\n\n\n",
			// Remove the real (empty) heading and replace entire section with
			// a fenced block that contains the heading literal
			"```\n## Success Criteria\nThis is inside a fence.\n```\n",
		);
		const missing = validatePlan(plan);
		expect(missing).toContain("Success Criteria");
	});

	test("validator policy: whitespace-only body empty", () => {
		// Body is only spaces/newlines — counts as empty
		const plan = buildPlan({ TODOs: "   \n   \n   " });
		const missing = validatePlan(plan);
		expect(missing).toContain("TODOs");
	});

	test("validator policy: duplicate heading first occurrence", () => {
		// First occurrence of TODOs has content; second is empty.
		// Validator must use FIRST occurrence → result should NOT list TODOs as missing.
		const plan = buildPlan() + "\n## TODOs\n\n\n";
		const missing = validatePlan(plan);
		expect(missing).not.toContain("TODOs");
	});
});

// ---------------------------------------------------------------------------
// Graph semantics — TODO id uniqueness, Blocked By resolution, cycles, Wave rule
// ---------------------------------------------------------------------------

/** Build a plan whose ## TODOs section contains the given TODO blocks. */
function buildGraphPlan(todoBlocks: string[]): string {
	return buildPlan({ TODOs: todoBlocks.join("\n") });
}

/** One TODO block in the plan-template checkbox shape. */
function todoBlock(
	id: string,
	opts: { blockedBy?: string; blocks?: string; wave?: string } = {},
): string {
	const lines = [`- [ ] ${id}. Task ${id}`];
	lines.push(`  - What to do: work for task ${id}`);
	if (opts.blockedBy !== undefined) lines.push(`  - Blocked By: ${opts.blockedBy}`);
	if (opts.blocks !== undefined) lines.push(`  - Blocks: ${opts.blocks}`);
	if (opts.wave !== undefined) lines.push(`  - Wave: ${opts.wave}`);
	return lines.join("\n");
}

describe("graph semantics", () => {
	test("valid dependency graph passes", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { wave: "1" }),
			todoBlock("3", { blockedBy: "TODO 1, TODO 2", wave: "2" }),
			todoBlock("F1", { blockedBy: "TODO 3", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("duplicate TODO id detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("1", { wave: "1" }),
		]);
		expect(validatePlanGraph(plan)).toContain("duplicate TODO id: 1");
	});

	test("Blocked By reference to undefined TODO detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 9", wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 2: Blocked By references undefined TODO 9",
		);
	});

	test("self-dependency detected", () => {
		const plan = buildGraphPlan([todoBlock("1", { blockedBy: "TODO 1", wave: "1" })]);
		expect(validatePlanGraph(plan)).toContain("TODO 1: blocked by itself");
	});

	test("dependency cycle detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blockedBy: "TODO 2", wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 1", wave: "2" }),
		]);
		const violations = validatePlanGraph(plan);
		expect(violations.some((v: string) => v.startsWith("dependency cycle:"))).toBe(true);
	});

	test("Wave lower than max(blocker)+1 detected", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 1", wave: "1" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 2: Wave 1 but must be at least 2 (= max(blocker waves) + 1)",
		);
	});

	test("Wave later than max(blocker)+1 is allowed", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 1", wave: "3" }),
			todoBlock("3", { wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("empty Blocked By allows any Wave of 1 or more", () => {
		expect(validatePlanGraph(buildGraphPlan([todoBlock("1", { wave: "2" })]))).toEqual([]);
		expect(validatePlanGraph(buildGraphPlan([todoBlock("1", { wave: "0" })]))).toContain(
			"TODO 1: Wave 0 but must be at least 1 (= max(blocker waves) + 1)",
		);
	});

	test("unparseable Blocked By entry suppresses the Wave formula check for that TODO", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "TODO 1, bogus", wave: "1" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([
			'TODO 2: unparseable Blocked By entry "bogus"',
		]);
	});

	test("Blocked By: None treated as no blockers", () => {
		const plan = buildGraphPlan([todoBlock("1", { blockedBy: "None", wave: "1" })]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("Wave FINAL task exempt from numeric formula", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("F1", { blockedBy: "TODO 1", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("numeric TODO cannot use Wave FINAL", () => {
		const plan = buildGraphPlan([todoBlock("1", { wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 1: Wave FINAL is reserved for F1-F4",
		);
	});

	test("noncanonical FINAL TODO id is rejected", () => {
		const plan = buildGraphPlan([todoBlock("F5", { wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO F5: Wave FINAL is reserved for F1-F4",
		);
	});

	test("F1-F4 TODO must use Wave FINAL", () => {
		const plan = buildGraphPlan([todoBlock("F1", { wave: "1" })]);
		expect(validatePlanGraph(plan)).toContain("TODO F1: F1-F4 TODO must use Wave FINAL");
	});

	test("numeric-wave task blocked by FINAL task detected", () => {
		const plan = buildGraphPlan([
			todoBlock("F1", { wave: "FINAL" }),
			todoBlock("2", { blockedBy: "TODO F1", wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 2: numeric-wave task blocked by FINAL task F1",
		);
	});

	test("missing Wave field detected", () => {
		const plan = buildGraphPlan([todoBlock("1")]);
		expect(validatePlanGraph(plan)).toContain("TODO 1: missing Wave");
	});

	test("checkbox lines inside fences ignored", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			"```\n- [ ] 1. duplicate inside fence\n- [ ] 9. phantom\n```",
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("noncanonical checkbox TODO-only section is rejected", () => {
		const plan = buildGraphPlan(["- [ ] A. Task"]);
		expect(validatePlanGraph(plan)).toContain(
			"TODOs section contains no canonical checkbox TODOs",
		);
	});

	test("prose-only TODO section is rejected", () => {
		const plan = buildGraphPlan(["Describe the work here."]);
		expect(validatePlanGraph(plan)).toContain(
			"TODOs section contains no canonical checkbox TODOs",
		);
	});

	test("no TODOs section yields no graph violations", () => {
		// Section presence is validatePlan's job — graph validator must not duplicate it
		expect(validatePlanGraph("# not a plan\n\nprose only\n")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Drift-lock: canonical headings in SKILL.md must match REQUIRED_HEADINGS
// ---------------------------------------------------------------------------

test("validator headings match SKILL contract", () => {
	// Resolve SKILL.md relative to this test file's directory
	const skillPath = join(import.meta.dir, "..", "SKILL.md");
	const skillContent = readFileSync(skillPath, "utf8");

	// Find the anchor line, then extract the immediately following fenced block
	const anchorLine = "Canonical required section headings (validator single source):";
	const anchorIdx = skillContent.indexOf(anchorLine);
	if (anchorIdx === -1) throw new Error(`Anchor not found in SKILL.md: "${anchorLine}"`);

	const afterAnchor = skillContent.slice(anchorIdx + anchorLine.length);

	// Find the opening fence (```)
	const fenceOpenMatch = afterAnchor.match(/^[ \t]*```[^\n]*\n/m);
	if (!fenceOpenMatch) throw new Error("Opening fence not found after anchor in SKILL.md");
	const fenceOpenEnd = fenceOpenMatch.index! + fenceOpenMatch[0].length;

	// Find the closing fence
	const afterFenceOpen = afterAnchor.slice(fenceOpenEnd);
	const fenceCloseMatch = afterFenceOpen.match(/^[ \t]*```[ \t]*$/m);
	if (!fenceCloseMatch) throw new Error("Closing fence not found after anchor in SKILL.md");

	const fenceBody = afterFenceOpen.slice(0, fenceCloseMatch.index!);

	// Extract lines that start with "## " — these are the canonical headings
	const extracted = fenceBody
		.split("\n")
		.filter((line) => line.startsWith("## "))
		.map((line) => line.slice("## ".length).trim());

	expect(extracted).toEqual(REQUIRED_HEADINGS);
});

// ---------------------------------------------------------------------------
// Boundary Map — consolidated two-axis boundary picture (structural plans only)
// ---------------------------------------------------------------------------

// A complete Boundary Map block: definition table (layer + Collaborators +
// affected/modified) + Dependency direction verdict. Structural enumeration is
// signalled by the "Must NOT own" ownership marker.
const BOUNDARY_MAP_OK = `## ADR

### D-2 — RenewSubscriptionUseCase (new, structural)

Owns the renewal sequence.
Must NOT own: the charge mechanics.
Edges: (RenewalScheduler → RenewSubscriptionUseCase, trigger)

### Boundary Map

| Part | Layer (vertical domain / horizontal use-case) | Responsibility | Collaborators | affected / modified |
|------|------------------------------------------------|----------------|---------------|---------------------|
| RenewSubscriptionUseCase | horizontal use-case | orchestrates renewal | Subscription, Billing, Notification | modified (new) |
| Subscription | vertical domain | period + lifecycle | (called by use-case) | modified |
| Billing | vertical domain | charge | (called by use-case) | affected, unchanged |

**Dependency direction:** use-case → domains, one way. No domain→domain back-reference; unidirectional on both axes.
`;

describe("Boundary Map — structural plans", () => {
	test("not required when no structural enumeration (no Must NOT own)", () => {
		const plan = buildPlan();
		expect(validateBoundaryMap(plan)).toEqual([]);
	});

	test("complete Boundary Map block passes", () => {
		expect(validateBoundaryMap(BOUNDARY_MAP_OK)).toEqual([]);
	});

	test("structural enumeration with NO Boundary Map block fails", () => {
		const plan = `## ADR\n\n### D-2 — X (structural)\n\nOwns the thing.\nMust NOT own: the other.\nEdges: none\n`;
		const out = validateBoundaryMap(plan);
		expect(out.length).toBe(1);
		expect(out[0]).toContain("block is missing");
	});

	test("Boundary Map block missing the Collaborators slot fails", () => {
		const plan = BOUNDARY_MAP_OK.replace(/Collaborators/g, "Uses");
		const out = validateBoundaryMap(plan);
		expect(out.some((v) => v.includes("Collaborators"))).toBe(true);
	});

	test("Boundary Map block missing the Dependency direction verdict fails", () => {
		const plan = BOUNDARY_MAP_OK.replace("Dependency direction", "Wiring");
		const out = validateBoundaryMap(plan);
		expect(out.some((v) => v.includes("Dependency direction"))).toBe(true);
	});

	test("markers only inside a fenced example do not count (fence-masking)", () => {
		const plan = `## ADR

### D-2 — X (structural)

Owns the thing.
Must NOT own: the other.

### Boundary Map

\`\`\`
| Part | Layer | Collaborators | affected / modified |
Dependency direction: use-case → domains
\`\`\`
`;
		const out = validateBoundaryMap(plan);
		expect(out.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Parsing robustness — CRLF, indented fences, fence-only sections
// ---------------------------------------------------------------------------

describe("파싱 견고성", () => {
	const passingTodos = [
		todoBlock("1", { wave: "1" }),
		todoBlock("2", { blockedBy: "1", wave: "2" }),
		todoBlock("F1", { blockedBy: "2", wave: "FINAL" }),
	];

	test("CRLF 줄바꿈 계획도 LF 계획과 같은 결과로 통과한다", () => {
		const lf = buildGraphPlan(passingTodos);
		expect(validatePlanGraph(lf)).toEqual([]);
		for (const crlf of [lf.replace(/\n/g, "\r\n"), lf.replace(/\n/g, "\r")]) {
			expect(validatePlanGraph(crlf)).toEqual(validatePlanGraph(lf));
			expect(validatePlan(crlf)).toEqual(validatePlan(lf));
			expect(validateBoundaryMap(crlf)).toEqual(validateBoundaryMap(lf));
		}
	});

	test("들여쓴 펜스 안의 예시 TODO는 유령 TODO를 만들지 않는다", () => {
		const real = [
			"- [ ] 1. Real task",
			"  - Run:",
			"    ```bash",
			"    - [ ] 9. Example task",
			"    Blocked By: 77",
			"    Wave: 5",
			"    ```",
			"  - Wave: 1",
		].join("\n");
		const plan = buildGraphPlan([real, todoBlock("F1", { blockedBy: "1", wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("들여쓴 ~~~ 펜스도 제거한다", () => {
		const real = [
			"- [ ] 1. Real task",
			"  ~~~",
			"  Blocked By: 77",
			"  ~~~",
			"  - Wave: 1",
		].join("\n");
		const plan = buildGraphPlan([real, todoBlock("F1", { blockedBy: "1", wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("~~~ 펜스 안의 ## Success Criteria는 제목으로 세지 않는다", () => {
		const plan = buildPlan({ "Success Criteria": "" }).replace(
			"## Success Criteria\n\n\n",
			"~~~\n## Success Criteria\nInside a fence.\n~~~\n",
		);
		expect(validatePlan(plan)).toContain("Success Criteria");
	});

	test("펜스 밖 텍스트는 제거하지 않는다", () => {
		const plan = buildPlan({
			Context: "before\n```\ncode\n```\nafter ~~~ not a fence",
		});
		expect(validatePlan(plan)).toEqual([]);
	});

	test("펜스 블록만 있는 섹션은 비어 있지 않다", () => {
		const plan = buildPlan({
			"Execution Strategy": "```\nWave 1: 1\nWave 2: 2\n```",
			"Verification Strategy": "  ```bash\n  bun test\n  ```",
		});
		expect(validatePlan(plan)).toEqual([]);
	});

	test("펜스 안의 제목은 섹션 경계가 되지 않는다", () => {
		const plan = buildPlan({
			"Execution Strategy": "```\n## Verification Strategy\n```",
			"Verification Strategy": "",
		});
		expect(validatePlan(plan)).toContain("Verification Strategy");
	});
});

// ---------------------------------------------------------------------------
// HTML 주석 — 펜스와 같은 방식으로 모든 검사에서 제거
// ---------------------------------------------------------------------------

describe("HTML 주석", () => {
	test("한 줄 주석 안의 ## Success Criteria는 제목으로 세지 않는다", () => {
		const plan = buildPlan({ "Success Criteria": "" }).replace(
			"## Success Criteria\n\n\n",
			"<!-- ## Success Criteria x -->\n",
		);
		expect(validatePlan(plan)).toContain("Success Criteria");
	});

	test("여러 줄 주석 안의 제목은 제목으로 세지 않는다", () => {
		const plan = `${buildPlan({ "Success Criteria": "" }).replace(
			"## Success Criteria\n\n\n",
			"",
		)}\n<!--\n## Success Criteria\nhidden body\n-->\n`;
		expect(validatePlan(plan)).toContain("Success Criteria");
	});

	test("주석만 있는 섹션은 비어 있다", () => {
		const plan = buildPlan({ Context: "<!-- todo: write context -->" });
		expect(validatePlan(plan)).toContain("Context");
	});

	test("주석 안의 TODO와 Blocked By는 그래프에 반영되지 않는다", () => {
		const real = [
			"- [ ] 1. Real task",
			"  <!--",
			"  Blocked By: 77",
			"  - [ ] 9. Ghost task",
			"  -->",
			"  - Wave: 1",
		].join("\n");
		const plan = buildGraphPlan([real, todoBlock("F1", { blockedBy: "1", wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("주석 안의 Must NOT own은 Boundary Map을 요구하지 않는다", () => {
		expect(validateBoundaryMap("## ADR\n\n<!-- Must NOT own: x -->\n")).toEqual([]);
	});

	test("닫히지 않은 주석과 주석 밖 텍스트는 그대로 둔다", () => {
		const plan = buildPlan({ Context: "before <!-- note --> after\n<!-- never closed" });
		expect(validatePlan(plan)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Blocks: 파싱과 Blocked By 대칭 검사
// ---------------------------------------------------------------------------

describe("Blocks 필드", () => {
	test("Blocked By와 대칭인 Blocks는 통과한다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "TODO 2", wave: "1" }),
			todoBlock("2", { blockedBy: "1", blocks: "F1", wave: "2" }),
			todoBlock("F1", { blockedBy: "2", blocks: "none", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("Blocks 줄이 없는 TODO는 불일치가 아니다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { blockedBy: "1", wave: "2" }),
			todoBlock("F1", { blockedBy: "2", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("쓸 수 없는 Blocks 항목은 거부한다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "2, soon", wave: "1" }),
			todoBlock("2", { blockedBy: "1", wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toContain('TODO 1: unparseable Blocks entry "soon"');
	});

	test("정의되지 않은 TODO를 가리키는 Blocks를 보고한다", () => {
		const plan = buildGraphPlan([todoBlock("1", { blocks: "9", wave: "1" })]);
		expect(validatePlanGraph(plan)).toContain("TODO 1: Blocks references undefined TODO 9");
	});

	test("자기 자신을 막는 Blocks를 보고한다", () => {
		const plan = buildGraphPlan([todoBlock("1", { blocks: "1", wave: "1" })]);
		expect(validatePlanGraph(plan)).toContain("TODO 1: blocks itself");
	});

	test("A가 Blocks: B인데 B에서 A로 가는 Blocked By 경로가 없으면 보고한다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "2", wave: "1" }),
			todoBlock("2", { wave: "1" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 1: Blocks 2 but TODO 2 has no Blocked By path to 1",
		);
	});

	test("Blocks 줄이 F1을 빼도 F1이 Blocked By로 나열하면 통과한다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "none", wave: "1" }),
			todoBlock("2", { blockedBy: "1", blocks: "none", wave: "2" }),
			todoBlock("F1", { blockedBy: "1, 2", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("Blocks의 빈 값 표기는 Blocked By와 같다(none만, 대소문자 무시)", () => {
		for (const empty of ["none", "None", ""]) {
			const plan = buildGraphPlan([
				todoBlock("1", { blocks: empty, blockedBy: empty, wave: "1" }),
			]);
			expect(validatePlanGraph(plan)).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Boundary Map 트리거 — 필드 형태만
// ---------------------------------------------------------------------------

describe("Boundary Map 트리거", () => {
	test("산문 속 Must NOT own 언급은 트리거하지 않는다", () => {
		const plan = buildPlan({ "TL;DR": "Each D-item states what it Must NOT own, see ADR." });
		expect(validateBoundaryMap(plan)).toEqual([]);
	});

	test("문장 중간·문장 앞머리의 Must NOT own 언급은 트리거하지 않는다", () => {
		for (const line of [
			"The D-items say Must NOT own is required",
			"Each item declares what it Must NOT own.",
			"Must NOT owner list is below",
			"Must NOT own is discussed here",
			"- Must NOT own lists are optional",
		]) {
			expect(validateBoundaryMap(`## ADR\n\n${line}\n`)).toEqual([]);
		}
	});

	test("줄 중간의 라벨 형태도 트리거한다", () => {
		for (const line of [
			"- **Owns**: flag read for the domain. **Must NOT own**: flag persistence.",
			"Owns: the counter. Must NOT own: progress judgment.",
			"- **Owns**: x. **Must NOT own.** y",
			"Owns: x. **Must NOT own:** y",
			"Owns: x. must not own : y",
		]) {
			const out = validateBoundaryMap(`## ADR\n\n${line}\n`);
			expect(out.length).toBe(1);
			expect(out[0]).toContain("block is missing");
		}
	});

	test("소문자 필드 Must not own:도 트리거한다", () => {
		const out = validateBoundaryMap("## ADR\n\nMust not own: the other.\n");
		expect(out.length).toBe(1);
		expect(out[0]).toContain("block is missing");
	});

	test("목록 표시와 굵게 표시가 붙은 필드도 트리거한다", () => {
		for (const line of [
			"- Must NOT own: x",
			"* **Must NOT own:** x",
			"1. **Must NOT own**: x",
			"**Must NOT own.** x",
			"- **Must NOT own** x",
			"- **Must NOT own**",
			"Must NOT own",
			"  Must not own: x",
		]) {
			expect(validateBoundaryMap(`## ADR\n\n${line}\n`).length).toBe(1);
		}
	});
});

// ---------------------------------------------------------------------------
// CLI 종료 코드와 fixture 정합성
// ---------------------------------------------------------------------------

describe("코드 펜스", () => {
	const F = "```";

	test("닫히지 않은 펜스는 연 줄을 알리고, 그 뒤는 코드로 보아 섹션을 세지 않는다", () => {
		const plan = `# P\n\n${F}md\n\n${buildPlan()}`;
		const out = validateFences(plan);
		expect(out.length).toBe(1);
		expect(out[0]).toContain("line 3");
		expect(validatePlan(plan)).toEqual(REQUIRED_HEADINGS);
	});

	test("닫힌 펜스만 있으면 펜스 위반이 없다", () => {
		expect(validateFences(`${buildPlan()}\n${F}ts\nx\n${F}\n~~~\ny\n~~~\n`)).toEqual([]);
	});

	test("최상위에서 4칸 들여쓴 펜스 줄은 들여쓴 코드라 펜스를 열지 않는다", () => {
		const plan = buildPlan({ Context: `예시:\n\n    ${F}\n` });
		expect(validateFences(plan)).toEqual([]);
		expect(validatePlan(plan)).toEqual([]);
	});

	test("목록 항목 내용 열 기준으로 들여쓴 펜스 안의 예시 TODO는 세지 않는다", () => {
		const real = [
			"- [ ] 1. Real task",
			"  10. 예시",
			"",
			"      " + F,
			"      - [ ] 9. Example task",
			"      Blocked By: 77",
			"      " + F,
			"  - Wave: 1",
		].join("\n");
		const plan = buildGraphPlan([real, todoBlock("F1", { blockedBy: "1", wave: "FINAL" })]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});
});

describe("CLI", () => {
	const script = join(import.meta.dir, "validate-plan.ts");
	const run = (...args: string[]) =>
		spawnSync("bun", [script, ...args], { encoding: "utf8" });

	test("읽을 수 없는 파일은 stderr 메시지와 종료 코드 2를 낸다", () => {
		const r = run("/nonexistent/dir/plan.md");
		expect(r.status).toBe(2);
		expect(r.stdout).toBe("");
		expect(r.stderr).toContain("validate-plan: cannot read /nonexistent/dir/plan.md:");
	});

	test("인자가 없으면 종료 코드 2를 낸다", () => {
		expect(run().status).toBe(2);
	});

	const fixtureDir = join(import.meta.dir, "..", "__fixtures__", "stage-a");
	for (const name of readdirSync(fixtureDir).filter((f) => f.endsWith(".md"))) {
		test(`stage-a fixture ${name}는 종료 코드 0으로 통과한다`, () => {
			const r = run(join(fixtureDir, name));
			expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 0, stdout: "" });
		});
	}
});

// ---------------------------------------------------------------------------
// 공유 id 목록 파서 / Blocks 추이 검사 / Wave 하한
// ---------------------------------------------------------------------------

/** One-task graph with the given Blocked By value; returns the graph violations. */
function blockedByViolations(value: string): string[] {
	return validatePlanGraph(
		buildGraphPlan([
			todoBlock("1", { wave: "1" }),
			todoBlock("2", { wave: "1" }),
			todoBlock("3", { wave: "1" }),
			todoBlock("4", { blockedBy: value, wave: "9" }),
		]),
	);
}

describe("id 목록 파서", () => {
	test("대괄호 한 쌍을 벗긴다", () => {
		expect(blockedByViolations("[1, 3]")).toEqual([]);
		expect(blockedByViolations("[1, 9]")).toContain(
			"TODO 4: Blocked By references undefined TODO 9",
		);
	});

	test("없음 표기는 빈 목록이다", () => {
		for (const none of ["", "none", "NONE", "—", "–", "-", "n/a", "N/A", "없음", "(none)", "(none — first task)", "[none]"]) {
			const plan = buildGraphPlan([
				todoBlock("1", { blockedBy: none, blocks: none, wave: "1" }),
			]);
			expect(validatePlanGraph(plan)).toEqual([]);
		}
	});

	test("T와 TODO 접두를 받는다", () => {
		expect(blockedByViolations("T1, TODO 2, T3")).toEqual([]);
		expect(blockedByViolations("T7")).toContain("TODO 4: Blocked By references undefined TODO 7");
	});

	test("같은 접두의 숫자 범위를 펼친다", () => {
		expect(blockedByViolations("1-3")).toEqual([]);
		expect(blockedByViolations("1–3")).toEqual([]);
		expect(blockedByViolations("T1-T3")).toEqual([]);
		expect(blockedByViolations("1-5")).toContain("TODO 4: Blocked By references undefined TODO 5");
	});

	test("F 범위는 F 접두 id로 펼친다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "F1-F4", wave: "1" }),
			todoBlock("F1", { blockedBy: "1", wave: "FINAL" }),
			todoBlock("F2", { blockedBy: "1", wave: "FINAL" }),
			todoBlock("F3", { blockedBy: "1", wave: "FINAL" }),
			todoBlock("F4", { blockedBy: "1", wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("1000개를 넘는 id를 펼치는 범위는 펼치지 않고 해석 불가로 둔다", () => {
		expect(blockedByViolations("1-1001")).toEqual(['TODO 4: unparseable Blocked By entry "1-1001"']);
		expect(blockedByViolations("1-99999999999999999999")).toEqual([
			'TODO 4: unparseable Blocked By entry "1-99999999999999999999"',
		]);
		expect(blockedByViolations("1-1000")).not.toContainEqual(expect.stringContaining("unparseable"));
	});

	test("뒤집힌 범위와 접두가 섞인 범위는 해석 불가다", () => {
		expect(blockedByViolations("3-1")).toContain('TODO 4: unparseable Blocked By entry "3-1"');
		expect(blockedByViolations("F1-4")).toContain('TODO 4: unparseable Blocked By entry "F1-4"');
		expect(blockedByViolations("T1-F2")).toContain('TODO 4: unparseable Blocked By entry "T1-F2"');
	});

	test("그 밖의 항목은 해석 불가로 남는다", () => {
		expect(blockedByViolations("see above")).toContain(
			'TODO 4: unparseable Blocked By entry "see above"',
		);
	});
});

describe("Blocks 추이 검사", () => {
	test("Blocked By 그래프로 도달 가능하면 통과한다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "3", wave: "1" }),
			todoBlock("2", { blockedBy: "1", wave: "2" }),
			todoBlock("3", { blockedBy: "2", wave: "3" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("경로가 없으면 보고한다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "3", wave: "1" }),
			todoBlock("2", { wave: "1" }),
			todoBlock("3", { blockedBy: "2", wave: "2" }),
		]);
		expect(validatePlanGraph(plan)).toContain(
			"TODO 1: Blocks 3 but TODO 3 has no Blocked By path to 1",
		);
	});

	test("FINAL 대상은 대칭 검사에서 면제된다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "F1-F4", wave: "1" }),
			todoBlock("F1", { wave: "FINAL" }),
			todoBlock("F2", { wave: "FINAL" }),
			todoBlock("F3", { wave: "FINAL" }),
			todoBlock("F4", { wave: "FINAL" }),
		]);
		expect(validatePlanGraph(plan)).toEqual([]);
	});

	test("정의되지 않은 대상과 자기 참조는 FINAL 면제와 무관하게 보고된다", () => {
		const plan = buildGraphPlan([
			todoBlock("1", { blocks: "F2", wave: "1" }),
			todoBlock("F1", { blocks: "F1", wave: "FINAL" }),
		]);
		const v = validatePlanGraph(plan);
		expect(v).toContain("TODO 1: Blocks references undefined TODO F2");
		expect(v).toContain("TODO F1: blocks itself");
	});
});
