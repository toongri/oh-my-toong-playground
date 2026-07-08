/**
 * Schema validator for sync.yaml and per-platform YAML files.
 *
 * Performs structural validation only — no file existence checks (P2-7).
 * Hook component file existence lives exclusively in components.ts.
 *
 * Validates:
 *   - YAML syntax
 *   - P2-3: Deprecated top-level sections (config, hooks, mcps, plugins) in sync.yaml → ERROR
 *   - Allowed sections in sync.yaml (agents, commands, skills, scripts, rules, provision)
 *   - Item format (string or object with component)
 *   - Platform values against valid targets
 *   - Per-platform YAML: allowed sections per platform, unknown section → WARN
 *
 * CLI usage: bun run tools/validators/schema.ts [path-to-sync.yaml]
 */

import { existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { getRootDir } from "../lib/config.ts";
import { resolveDocsTarget, assertDocsTargetContained } from "../lib/path-utils.ts";
import {
	type ValidationResult,
	makeResult,
	mergeResult,
	isObject,
	isArray,
	parseYaml as _parseYaml,
} from "../lib/validation.ts";

const parseYaml = (filePath: string) => _parseYaml(filePath, "YAML 문법 오류");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PLATFORMS = ["claude", "gemini", "codex", "opencode"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];
// Widened to `readonly string[]` so `.includes()` can be called with a plain
// `string` without an `as` cast at the call site.
const VALID_PLATFORM_VALUES: readonly string[] = VALID_PLATFORMS;
function isValidPlatform(value: string): value is Platform {
	return VALID_PLATFORM_VALUES.includes(value);
}

const VALID_SYNC_TOP_LEVEL = new Set([
	"name",
	"path",
	"platforms",
	"agents",
	"commands",
	"skills",
	"scripts",
	"rules",
	"docs",
	"provision",
]);

// P2-3: Deprecated sections that must not appear in sync.yaml
const DEPRECATED_SYNC_SECTIONS: Record<string, string> = {
	config:
		"sync.yaml: 'config' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
	hooks:
		"sync.yaml: 'hooks' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
	mcps: "sync.yaml: 'mcps' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
	plugins:
		"sync.yaml: 'plugins' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
};

const VALID_SECTION_FIELDS = new Set(["platforms", "items"]);

const VALID_AGENT_ITEM_FIELDS = new Set(["component", "add-skills", "add-hooks", "platforms"]);

const VALID_ADD_HOOK_ITEM_FIELDS = new Set([
	"event",
	"component",
	"command",
	"type",
	"matcher",
	"timeout",
	"prompt",
]);

const VALID_GENERIC_ITEM_FIELDS = new Set(["component", "platforms"]);

const VALID_PROVISION_ITEM_FIELDS = new Set(["check", "commands"]);

// docs is platform-agnostic (no per-section/per-item `platforms`) and has a
// shape distinct from the generic sections (`path` instead of `platforms`,
// item-level `path`/`as`/`delete` instead of `add-skills`/`add-hooks`).
const VALID_DOCS_SECTION_FIELDS = new Set(["path", "items"]);
const VALID_DOCS_ITEM_FIELDS = new Set(["component", "path", "as", "delete"]);

const VALID_EVENTS = new Set([
	"SessionStart",
	"UserPromptSubmit",
	"PreToolUse",
	"PostToolUse",
	"Stop",
	"SubagentStop",
	"PreCompact",
	"PostCompact", // Codex-only; shared Set is harmless — non-codex platform YAML never names it
]);

const VALID_HOOK_TYPES = new Set(["command", "prompt"]);

const PLATFORM_ALLOWED_SECTIONS: Record<string, Set<string>> = {
	claude: new Set(["config", "hooks", "mcps", "plugins", "statusLine"]),
	gemini: new Set(["config", "hooks", "mcps", "plugins"]),
	codex: new Set(["config", "mcps", "model-map", "hooks"]),
	opencode: new Set(["config", "mcps", "model-map"]),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validatePlatformValues(
	platforms: unknown,
	context: string,
	result: ValidationResult,
): void {
	if (!isArray(platforms)) return;
	for (const p of platforms) {
		if (typeof p === "string" && !isValidPlatform(p)) {
			result.errors.push(`${context}: 잘못된 플랫폼 '${p}' (지원: ${VALID_PLATFORMS.join(", ")})`);
		}
	}
}

function validateComponentRef(value: string, context: string, result: ValidationResult): void {
	if (!value.includes(":")) return;
	const parts = value.split(":");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		result.errors.push(`${context}: 잘못된 형식 '${value}' (올바른 형식: {project}:{name})`);
	}
}

// ---------------------------------------------------------------------------
// Section validators
// ---------------------------------------------------------------------------

function validateSection(
	sectionData: unknown,
	sectionName: string,
	result: ValidationResult,
	itemFieldsAllowed: Set<string>,
	extraItemValidation?: (
		item: Record<string, unknown>,
		idx: number,
		ctx: string,
		r: ValidationResult,
	) => void,
): void {
	if (sectionData === null || sectionData === undefined) return;

	// Reject old array format
	if (isArray(sectionData)) {
		result.errors.push(
			`${sectionName}: 기존 배열 형식은 더 이상 지원되지 않습니다. items 형식을 사용하세요.`,
		);
		return;
	}

	if (!isObject(sectionData)) {
		result.errors.push(`${sectionName}: object 형식이어야 합니다`);
		return;
	}

	// Check section-level fields
	for (const key of Object.keys(sectionData)) {
		if (!VALID_SECTION_FIELDS.has(key)) {
			result.errors.push(
				`${sectionName}: 알 수 없는 필드 '${key}' (지원: ${[...VALID_SECTION_FIELDS].join(", ")})`,
			);
		}
	}

	if (sectionData.platforms !== undefined && !isArray(sectionData.platforms)) {
		result.errors.push(`${sectionName}.platforms: 배열 형식이어야 합니다`);
	}
	validatePlatformValues(sectionData.platforms, `${sectionName}.platforms`, result);

	const items = sectionData.items;
	if (items !== undefined && !isArray(items)) {
		result.errors.push(`${sectionName}.items: 배열 형식이어야 합니다`);
		return;
	}
	if (!isArray(items)) return;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const itemCtx = `${sectionName}.items[${i}]`;

		if (typeof item === "string") {
			validateComponentRef(item, itemCtx, result);
			continue;
		}

		if (!isObject(item)) {
			result.errors.push(`${itemCtx}: string 또는 object 이어야 합니다`);
			continue;
		}

		// Check item-level fields
		for (const key of Object.keys(item)) {
			if (!itemFieldsAllowed.has(key)) {
				result.errors.push(
					`${itemCtx}: 알 수 없는 필드 '${key}' (지원: ${[...itemFieldsAllowed].join(", ")})`,
				);
			}
		}

		const component = item.component;
		if (!("component" in item)) {
			result.errors.push(`${sectionName}.items[${i}]: component 필드가 필요합니다`);
		} else if (typeof component !== "string") {
			result.errors.push(`${itemCtx}.component: string이어야 합니다 (got ${typeof component})`);
		} else if (!component.trim()) {
			result.errors.push(`${itemCtx}.component: 빈 문자열은 허용되지 않습니다`);
		} else {
			validateComponentRef(component, `${itemCtx}.component`, result);
		}

		validatePlatformValues(item.platforms, `${itemCtx}.platforms`, result);

		if (extraItemValidation) {
			extraItemValidation(item, i, itemCtx, result);
		}
	}
}

function validateAgentAddHooks(
	addHooks: unknown,
	agentCtx: string,
	result: ValidationResult,
): void {
	if (!isArray(addHooks)) return;

	for (let j = 0; j < addHooks.length; j++) {
		const hook = addHooks[j];
		const hookCtx = `${agentCtx}.add-hooks[${j}]`;

		if (!isObject(hook)) {
			result.errors.push(`${hookCtx}: object 이어야 합니다`);
			continue;
		}

		for (const key of Object.keys(hook)) {
			if (!VALID_ADD_HOOK_ITEM_FIELDS.has(key)) {
				result.errors.push(`${hookCtx}: 알 수 없는 필드 '${key}'`);
			}
		}

		const event = hook.event;
		if (typeof event === "string" && event && !VALID_EVENTS.has(event)) {
			result.errors.push(
				`${hookCtx}.event: 잘못된 값 '${event}' (지원: ${[...VALID_EVENTS].join(", ")})`,
			);
		}

		const type = hook.type;
		if (typeof type === "string" && type && !VALID_HOOK_TYPES.has(type)) {
			result.errors.push(
				`${hookCtx}.type: 잘못된 값 '${type}' (지원: ${[...VALID_HOOK_TYPES].join(", ")})`,
			);
		}

		const comp = hook.component;
		if (typeof comp === "string" && comp) {
			validateComponentRef(comp, `${hookCtx}.component`, result);
		}
	}
}

function validateAgentItems(
	item: Record<string, unknown>,
	_idx: number,
	ctx: string,
	result: ValidationResult,
): void {
	// add-skills format validation
	if (isArray(item["add-skills"])) {
		for (let k = 0; k < item["add-skills"].length; k++) {
			const skill = item["add-skills"][k];
			if (typeof skill === "string") {
				validateComponentRef(skill, `${ctx}.add-skills[${k}]`, result);
			}
		}
	}

	// add-hooks validation
	if (item["add-hooks"] !== undefined) {
		validateAgentAddHooks(item["add-hooks"], ctx, result);
	}
}

function validateProvision(provision: unknown, result: ValidationResult): void {
	if (provision === null || provision === undefined) return;

	if (!isArray(provision)) {
		result.errors.push(`provision: 배열 형식이어야 합니다`);
		return;
	}

	for (let i = 0; i < provision.length; i++) {
		const item = provision[i];
		const ctx = `provision[${i}]`;

		if (!isObject(item)) {
			result.errors.push(`${ctx}: object 형식이어야 합니다`);
			continue;
		}

		for (const key of Object.keys(item)) {
			if (!VALID_PROVISION_ITEM_FIELDS.has(key)) {
				result.errors.push(
					`${ctx}: 알 수 없는 필드 '${key}' (지원: ${[...VALID_PROVISION_ITEM_FIELDS].join(", ")})`,
				);
			}
		}

		if (item.check !== undefined && typeof item.check !== "string") {
			result.errors.push(`${ctx}.check: string이어야 합니다 (got ${typeof item.check})`);
		} else if (typeof item.check === "string" && item.check.trim() === "") {
			result.errors.push(
				`${ctx}.check: 빈/공백 문자열은 허용되지 않습니다 (생략하려면 키 자체를 제거)`,
			);
		}

		if (!("commands" in item)) {
			result.errors.push(`${ctx}: commands 필드가 필요합니다`);
			continue;
		}

		if (!isArray(item.commands)) {
			result.errors.push(`${ctx}.commands: 배열 형식이어야 합니다`);
			continue;
		}

		const commands = item.commands;

		if (commands.length === 0) {
			result.errors.push(`${ctx}.commands: 빈 배열은 허용되지 않습니다`);
			continue;
		}

		for (let j = 0; j < commands.length; j++) {
			const cmd = commands[j];
			if (typeof cmd !== "string") {
				result.errors.push(`${ctx}.commands[${j}]: string이어야 합니다 (got ${typeof cmd})`);
			} else if (cmd.trim() === "") {
				result.errors.push(`${ctx}.commands[${j}]: 빈 문자열은 허용되지 않습니다`);
			}
		}
	}
}

/**
 * Validate a `docs` item's `path`/`as`/section's `path` field: must be a
 * string when present, and must itself be a relative, contained path
 * (rejects absolute paths, empty, `.`, and any leading `..` escape) via the
 * shared `assertDocsTargetContained` — no re-implementation of containment.
 * Returns the string value (even if it failed containment) so the caller can
 * still feed it into `resolveDocsTarget` for the combined-target check, or
 * `undefined` when the field is absent or of the wrong type.
 */
function validateDocsPathField(
	value: unknown,
	fieldCtx: string,
	result: ValidationResult,
	assertContainment = false,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		result.errors.push(`${fieldCtx}: string이어야 합니다 (got ${typeof value})`);
		return undefined;
	}
	// `item.path`/`item.as` are FRAGMENTS joined onto the base — a leading `..`
	// that stays under deployRoot once combined is legitimate (matches the
	// runtime resolveDocsTarget + AC4.1: "leaving the docs base but under
	// deployRoot is allowed"). Containment is asserted on the COMBINED target
	// below, so per-field containment only applies to the section base `path`,
	// whose own `..` genuinely escapes deployRoot.
	if (assertContainment) {
		try {
			assertDocsTargetContained(value);
		} catch (e) {
			result.errors.push(`${fieldCtx}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return value;
}

function validateDocsSection(sectionData: unknown, result: ValidationResult): void {
	if (sectionData === null || sectionData === undefined) return;

	if (!isObject(sectionData)) {
		result.errors.push(`docs: object 형식이어야 합니다`);
		return;
	}

	// Section-level fields: docs is platform-agnostic — no `platforms` key.
	for (const key of Object.keys(sectionData)) {
		if (!VALID_DOCS_SECTION_FIELDS.has(key)) {
			result.errors.push(
				`docs: 알 수 없는 필드 '${key}' (지원: ${[...VALID_DOCS_SECTION_FIELDS].join(", ")})`,
			);
		}
	}

	const sectionPath = validateDocsPathField(sectionData.path, "docs.path", result, true);

	const items = sectionData.items;
	if (items !== undefined && !isArray(items)) {
		result.errors.push(`docs.items: 배열 형식이어야 합니다`);
		return;
	}
	if (!isArray(items)) return;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const itemCtx = `docs.items[${i}]`;

		if (typeof item === "string") {
			validateComponentRef(item, itemCtx, result);
			if (item.trim()) {
				try {
					resolveDocsTarget(item, sectionPath, undefined, undefined);
				} catch (e) {
					result.errors.push(`${itemCtx}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
			continue;
		}

		if (!isObject(item)) {
			result.errors.push(`${itemCtx}: string 또는 object 이어야 합니다`);
			continue;
		}

		// Item-level fields: no `platforms`, no `add-skills`/`add-hooks` — docs
		// items only ever carry component/path/as/delete.
		for (const key of Object.keys(item)) {
			if (!VALID_DOCS_ITEM_FIELDS.has(key)) {
				result.errors.push(
					`${itemCtx}: 알 수 없는 필드 '${key}' (지원: ${[...VALID_DOCS_ITEM_FIELDS].join(", ")})`,
				);
			}
		}

		const component = item.component;
		let validComponent: string | undefined;
		if (!("component" in item)) {
			result.errors.push(`${itemCtx}: component 필드가 필요합니다`);
		} else if (typeof component !== "string") {
			result.errors.push(`${itemCtx}.component: string이어야 합니다 (got ${typeof component})`);
		} else if (!component.trim()) {
			result.errors.push(`${itemCtx}.component: 빈 문자열은 허용되지 않습니다`);
		} else {
			validateComponentRef(component, `${itemCtx}.component`, result);
			validComponent = component;
		}

		const itemPath = validateDocsPathField(item.path, `${itemCtx}.path`, result);
		const itemAs = validateDocsPathField(item.as, `${itemCtx}.as`, result);

		if ("delete" in item && item.delete !== true) {
			result.errors.push(`${itemCtx}.delete: true만 허용됩니다 (got ${JSON.stringify(item.delete)})`);
		}

		// Combined containment: catches escapes that only manifest once
		// component/section.path/item.path/as are joined together (e.g. a
		// traversal hidden in the component name itself).
		if (validComponent !== undefined) {
			try {
				resolveDocsTarget(validComponent, sectionPath, itemPath, itemAs);
			} catch (e) {
				result.errors.push(`${itemCtx}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// sync.yaml validator
// ---------------------------------------------------------------------------

function validateSyncYamlData(
	data: Record<string, unknown>,
	filePath: string,
	result: ValidationResult,
): void {
	const label = basename(dirname(filePath)) + "/sync.yaml";

	for (const [section, message] of Object.entries(DEPRECATED_SYNC_SECTIONS)) {
		if (section in data) {
			result.errors.push(message);
		}
	}

	for (const key of Object.keys(data)) {
		if (!VALID_SYNC_TOP_LEVEL.has(key) && !(key in DEPRECATED_SYNC_SECTIONS)) {
			result.errors.push(`${label}: 알 수 없는 최상위 필드 '${key}'`);
		}
	}

	validatePlatformValues(data.platforms, "platforms", result);

	validateSection(data.agents, "agents", result, VALID_AGENT_ITEM_FIELDS, validateAgentItems);
	validateSection(data.commands, "commands", result, VALID_GENERIC_ITEM_FIELDS);
	validateSection(data.skills, "skills", result, VALID_GENERIC_ITEM_FIELDS);
	validateSection(data.scripts, "scripts", result, VALID_GENERIC_ITEM_FIELDS);
	validateSection(data.rules, "rules", result, VALID_GENERIC_ITEM_FIELDS);
	validateDocsSection(data.docs, result);
	validateProvision(data.provision, result);
}

export function validateSyncYaml(filePath: string): ValidationResult {
	const result = makeResult();

	const parsed = parseYaml(filePath);
	if (parsed.error) {
		result.errors.push(parsed.error);
		return result;
	}

	const data = parsed.data;
	if (!isObject(data)) {
		result.errors.push(`sync.yaml: 최상위 레벨은 map 이어야 합니다`);
		return result;
	}

	validateSyncYamlData(data, filePath, result);

	return result;
}

export function validateSyncYamlPartial(filePath: string): ValidationResult {
	const result = makeResult();

	const parsed = parseYaml(filePath);
	if (parsed.error) {
		result.errors.push(parsed.error);
		return result;
	}

	const data = parsed.data;
	if (data === null || data === undefined) return result;

	if (!isObject(data)) {
		result.errors.push(`sync.yaml: 최상위 레벨은 map 이어야 합니다`);
		return result;
	}

	validateSyncYamlData(data, filePath, result);

	return result;
}

// ---------------------------------------------------------------------------
// Per-platform YAML validator
// ---------------------------------------------------------------------------

function validatePlatformYamlData(
	data: Record<string, unknown>,
	platformYamlPath: string,
	platform: string,
	result: ValidationResult,
): void {
	const label = basename(platformYamlPath);
	const allowed = PLATFORM_ALLOWED_SECTIONS[platform];
	if (!allowed) return;

	for (const key of Object.keys(data)) {
		if (!allowed.has(key)) {
			result.warnings.push(`${label}: 알 수 없는 섹션 '${key}' (지원: ${[...allowed].join(", ")})`);
		}
	}

	// `hooks: null` is an overlay clear marker — a local YAML drops every inherited
	// hook (syncPlatformYaml already guards `if (yaml.hooks != null)`). Mirrors the
	// codex `mcps.<name>: null` deletion marker handled below.
	if (data.hooks !== undefined && data.hooks !== null && !isObject(data.hooks)) {
		result.errors.push(`${label}: hooks는 object 형식이어야 합니다`);
	} else if (isObject(data.hooks)) {
		for (const [event, value] of Object.entries(data.hooks)) {
			if (event === "preserve") {
				if (!isObject(value)) {
					result.errors.push(`${label}: hooks.preserve는 object 형식이어야 합니다`);
				} else {
					const cc = value["command-contains"];
					if (cc !== undefined && (!isArray(cc) || !cc.every((x) => typeof x === "string"))) {
						result.errors.push(
							`${label}: hooks.preserve.command-contains는 string 배열이어야 합니다`,
						);
					}
				}
				continue;
			}
			if (!VALID_EVENTS.has(event)) {
				result.errors.push(
					`${label}: hooks에 잘못된 이벤트 이름 '${event}' (지원: ${[...VALID_EVENTS].join(", ")})`,
				);
			}
			if (!isArray(value)) {
				result.errors.push(`${label}: hooks.${event}의 값은 배열이어야 합니다`);
				continue;
			}

			// A-3: validate individual hook items are objects
			for (let i = 0; i < value.length; i++) {
				const hookItem = value[i];
				if (!isObject(hookItem)) {
					result.errors.push(
						`${label}: hooks.${event}[${i}]은 object이어야 합니다 (got ${hookItem === null ? "null" : typeof hookItem})`,
					);
					continue;
				}

				// C10: validate field value types — non-string component/command or non-number timeout
				// causes a TypeError at resolver.ts (123).includes() outside the dry-run guard.
				const hookObj = hookItem;
				if (hookObj.component !== undefined && typeof hookObj.component !== "string") {
					result.errors.push(
						`${label}: hooks.${event}[${i}].component는 string이어야 합니다 (got ${typeof hookObj.component})`,
					);
				}
				if (hookObj.command !== undefined && typeof hookObj.command !== "string") {
					result.errors.push(
						`${label}: hooks.${event}[${i}].command는 string이어야 합니다 (got ${typeof hookObj.command})`,
					);
				}
				if (hookObj.timeout !== undefined && typeof hookObj.timeout !== "number") {
					result.errors.push(
						`${label}: hooks.${event}[${i}].timeout은 number여야 합니다 (got ${typeof hookObj.timeout})`,
					);
				}

				// A-2: codex does not support type: prompt
				if (platform === "codex") {
					const hookType = hookObj.type;
					if (hookType === "prompt") {
						result.errors.push(
							`${label}: hooks.${event}[${i}].type 'prompt'는 codex가 지원하지 않습니다 (지원: command)`,
						);
					}
				}
			}
		}
	}

	if (data.mcps !== undefined && !isObject(data.mcps)) {
		result.errors.push(`${label}: mcps는 object 형식이어야 합니다`);
	} else if (isObject(data.mcps)) {
		for (const [name, value] of Object.entries(data.mcps)) {
			// codex treats `<name>: null` as an overlay deletion marker that drops an
			// inherited server; other platforms require a concrete server object.
			if (value === null && platform === "codex") continue;
			if (!isObject(value)) {
				result.errors.push(`${label}: mcps.${name}의 값은 object이어야 합니다`);
			}
		}
	}
}

export function validatePlatformYaml(platformYamlPath: string, platform: string): ValidationResult {
	const result = makeResult();

	const parsed = parseYaml(platformYamlPath);
	if (parsed.error) {
		result.errors.push(parsed.error);
		return result;
	}

	const data = parsed.data;
	if (!isObject(data)) {
		result.errors.push(`${basename(platformYamlPath)}: object 형식이어야 합니다`);
		return result;
	}

	validatePlatformYamlData(data, platformYamlPath, platform, result);

	return result;
}

export function validatePlatformYamlPartial(
	platformYamlPath: string,
	platform: string,
): ValidationResult {
	const result = makeResult();

	const parsed = parseYaml(platformYamlPath);
	if (parsed.error) {
		result.errors.push(parsed.error);
		return result;
	}

	const data = parsed.data;
	if (data === null || data === undefined) return result;

	if (!isObject(data)) {
		result.errors.push(`${basename(platformYamlPath)}: object 형식이어야 합니다`);
		return result;
	}

	validatePlatformYamlData(data, platformYamlPath, platform, result);

	return result;
}

// ---------------------------------------------------------------------------
// config.yaml validator
// ---------------------------------------------------------------------------

function validateConfigYamlData(
	data: Record<string, unknown>,
	label: string,
	result: ValidationResult,
): void {
	const ep = data["enabled-projects"];
	if (ep !== undefined && !isArray(ep)) {
		result.errors.push(`${label}: enabled-projects는 배열 형식이어야 합니다 (got ${typeof ep})`);
	}
}

export function validateConfigYaml(filePath: string): ValidationResult {
	const result = makeResult();

	const parsed = parseYaml(filePath);
	if (parsed.error) {
		result.errors.push(parsed.error);
		return result;
	}

	const data = parsed.data;
	if (!isObject(data)) {
		result.errors.push(`${basename(filePath)}: object 형식이어야 합니다`);
		return result;
	}

	validateConfigYamlData(data, basename(filePath), result);
	return result;
}

export function validateConfigYamlPartial(filePath: string): ValidationResult {
	const result = makeResult();

	const parsed = parseYaml(filePath);
	if (parsed.error) {
		result.errors.push(parsed.error);
		return result;
	}

	const data = parsed.data;
	if (data === null || data === undefined) return result;

	if (!isObject(data)) {
		result.errors.push(`${basename(filePath)}: object 형식이어야 합니다`);
		return result;
	}

	validateConfigYamlData(data, basename(filePath), result);
	return result;
}

// ---------------------------------------------------------------------------
// Discovery and orchestration
// ---------------------------------------------------------------------------

function discoverSyncYamls(rootDir: string): string[] {
	const results: string[] = [];

	// projects/* first
	const projectsDir = join(rootDir, "projects");
	if (existsSync(projectsDir)) {
		for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				const candidate = join(projectsDir, entry.name, "sync.yaml");
				if (existsSync(candidate)) {
					results.push(candidate);
				}
			}
		}
	}

	// root sync.yaml
	const rootSync = join(rootDir, "sync.yaml");
	if (existsSync(rootSync)) {
		results.push(rootSync);
	}

	return results;
}

export function validateAll(rootDir: string): ValidationResult {
	const result = makeResult();

	const configYaml = join(rootDir, "config.yaml");
	if (existsSync(configYaml)) {
		mergeResult(result, validateConfigYaml(configYaml));
	}

	const configLocalYaml = join(rootDir, "config.local.yaml");
	if (existsSync(configLocalYaml)) {
		mergeResult(result, validateConfigYamlPartial(configLocalYaml));
	}

	for (const syncYamlPath of discoverSyncYamls(rootDir)) {
		const syncResult = validateSyncYaml(syncYamlPath);
		mergeResult(result, syncResult);

		const yamlDir = dirname(syncYamlPath);

		const localSync = join(yamlDir, "sync.local.yaml");
		if (existsSync(localSync)) {
			mergeResult(result, validateSyncYamlPartial(localSync));
		}

		for (const platform of VALID_PLATFORMS) {
			const platformYaml = join(yamlDir, `${platform}.yaml`);
			if (existsSync(platformYaml)) {
				mergeResult(result, validatePlatformYaml(platformYaml, platform));
			}

			const platformLocalYaml = join(yamlDir, `${platform}.local.yaml`);
			if (existsSync(platformLocalYaml)) {
				mergeResult(result, validatePlatformYamlPartial(platformLocalYaml, platform));
			}
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
	const targetArg = process.argv[2];
	const rootDir = getRootDir();

	if (!rootDir) {
		process.stderr.write("[SCHEMA] config.yaml를 찾을 수 없습니다\n");
		process.exit(1);
	}

	let result: ValidationResult;

	if (targetArg && existsSync(targetArg)) {
		result = validateSyncYaml(targetArg);
		const yamlDir = dirname(targetArg);
		for (const platform of VALID_PLATFORMS) {
			const platformYaml = join(yamlDir, `${platform}.yaml`);
			if (existsSync(platformYaml)) {
				mergeResult(result, validatePlatformYaml(platformYaml, platform));
			}
		}
	} else {
		result = validateAll(rootDir);
	}

	for (const warning of result.warnings) {
		process.stderr.write(`\x1b[1;33m[SCHEMA]\x1b[0m ${warning}\n`);
	}

	if (result.errors.length > 0) {
		for (const error of result.errors) {
			process.stderr.write(`\x1b[0;31m[SCHEMA]\x1b[0m ${error}\n`);
		}
		process.stderr.write(
			`\x1b[0;31m[SCHEMA]\x1b[0m 스키마 검증 실패: ${result.errors.length} 개 오류\n`,
		);
		process.exit(1);
	}

	process.stderr.write(`\x1b[0;32m[SCHEMA]\x1b[0m 스키마 검증 통과\n`);
	process.exit(0);
}

if (import.meta.main) {
	main();
}
