import { describe, it, expect } from "bun:test";
import { detectDeepInterviewDone, detectPrometheusDone } from "./transcript-detector.ts";

describe("transcript-detector", () => {
	describe("detectDeepInterviewDone (survivor)", () => {
		it("detects <deep-interview-done/> in a transcript", () => {
			const result = detectDeepInterviewDone("Interview complete. <deep-interview-done/>");

			expect(result).toBe(true);
		});

		it("returns false when <deep-interview-done/> is absent", () => {
			const result = detectDeepInterviewDone("Interview still in progress, no done token here");

			expect(result).toBe(false);
		});

		it("returns false for null message", () => {
			expect(detectDeepInterviewDone(null)).toBe(false);
		});
	});

	describe("detectPrometheusDone (survivor)", () => {
		it("detects <prometheus-done/> in a transcript", () => {
			const result = detectPrometheusDone("Planning complete.\n<prometheus-done/>");

			expect(result).toBe(true);
		});

		it("returns false when <prometheus-done/> is absent", () => {
			const result = detectPrometheusDone("Session still active, planning continues");

			expect(result).toBe(false);
		});

		it("returns false for null message", () => {
			expect(detectPrometheusDone(null)).toBe(false);
		});

		it("앞뒤 공백만 있는 단독 줄의 토큰은 감지함", () => {
			expect(detectPrometheusDone("끝났습니다.\n   <prometheus-done />  \n")).toBe(true);
			expect(detectPrometheusDone("<PROMETHEUS-DONE/>")).toBe(true);
			expect(detectPrometheusDone("끝\r\n<prometheus-done/>\r\n")).toBe(true);
		});

		it("문장 중간에 토큰을 언급만 한 메시지는 감지하지 않음", () => {
			expect(detectPrometheusDone("나중에 <prometheus-done/> 를 출력하겠습니다")).toBe(false);
			expect(detectPrometheusDone("Planning complete. <prometheus-done/>")).toBe(false);
			expect(detectPrometheusDone("<prometheus-done/> 이후 종료합니다")).toBe(false);
		});

		it("인라인 코드 안의 토큰은 감지하지 않음", () => {
			expect(detectPrometheusDone("`<prometheus-done/>`")).toBe(false);
			expect(detectPrometheusDone("토큰은\n`<prometheus-done/>`\n입니다")).toBe(false);
		});

		it("코드 펜스 안의 단독 줄 토큰은 감지하지 않음", () => {
			expect(detectPrometheusDone("예시:\n```\n<prometheus-done/>\n```\n")).toBe(false);
			expect(detectPrometheusDone("예시:\n~~~text\n<prometheus-done/>\n~~~")).toBe(false);
		});

		it("코드 펜스 밖의 단독 줄 토큰은 펜스 뒤에서도 감지함", () => {
			expect(detectPrometheusDone("```\ncode\n```\n<prometheus-done/>")).toBe(true);
		});
	});
});
