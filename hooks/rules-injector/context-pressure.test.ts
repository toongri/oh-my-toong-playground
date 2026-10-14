import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { transcriptHasContextPressureMarker } from "./context-pressure.js";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function transcript(text: string): string {
	const dir = mkdtempSync(join(tmpdir(), "context-pressure-"));
	dirs.push(dir);
	const path = join(dir, "rollout.jsonl");
	writeFileSync(path, text);
	return path;
}

test("마지막 비어 있지 않은 줄의 표시는 현재 압박이다", () => {
	expect(transcriptHasContextPressureMarker(transcript("turn\n[Context Compacted]"))).toBe(true);
});

test("표시 줄 뒤의 빈 줄과 공백 줄은 새 활동이 아니다", () => {
	expect(transcriptHasContextPressureMarker(transcript("turn\ncontext_length_exceeded\n\n  \r\n\t\n"))).toBe(true);
});

test("표시 뒤에 활동이 이어지면 지난 압박이다", () => {
	expect(transcriptHasContextPressureMarker(transcript("context compacted\nnext turn\n"))).toBe(false);
});

test("표시가 없거나 파일이 비었거나 없으면 압박이 아니다", () => {
	expect(transcriptHasContextPressureMarker(transcript("a\nb\n"))).toBe(false);
	expect(transcriptHasContextPressureMarker(transcript(""))).toBe(false);
	expect(transcriptHasContextPressureMarker(transcript("\n\n"))).toBe(false);
	expect(transcriptHasContextPressureMarker(join(tmpdir(), "missing-context-pressure.jsonl"))).toBe(false);
	expect(transcriptHasContextPressureMarker(undefined)).toBe(false);
});

test("읽기 조각보다 긴 마지막 줄도 줄 전체를 본다", () => {
	const head = `{"text":"context compacted ${"x".repeat(300_000)}`;
	expect(transcriptHasContextPressureMarker(transcript(`older\n${head}"}\n`))).toBe(true);
	expect(transcriptHasContextPressureMarker(transcript(`context compacted\n${"y".repeat(300_000)}\n`))).toBe(false);
});

test("조각 경계에 걸린 여러 바이트 문자를 깨뜨리지 않는다", () => {
	for (let pad = 0; pad < 3; pad++) {
		const line = `${"x".repeat(pad)}${"가".repeat(70_000)} context compacted`;
		expect(transcriptHasContextPressureMarker(transcript(`turn\n${line}\n`))).toBe(true);
	}
});

test("소문자 변환으로 길이가 바뀌는 문자가 표시 뒤 활동을 가리지 않는다", () => {
	expect(transcriptHasContextPressureMarker(transcript(`${"İ".repeat(20)} context compacted\nok`))).toBe(false);
});

test("조각 수백 개에 걸친 마지막 줄도 읽는 시간이 줄 길이에 비례한다", () => {
	const line = `${"가".repeat(5_600_000)} context compacted`;
	const path = transcript(`context compacted\n${line}\n`);
	const start = performance.now();
	expect(transcriptHasContextPressureMarker(path)).toBe(true);
	expect(performance.now() - start).toBeLessThan(300);
	const activity = transcript(`${line}\nnext turn\n`);
	expect(transcriptHasContextPressureMarker(activity)).toBe(false);
});
