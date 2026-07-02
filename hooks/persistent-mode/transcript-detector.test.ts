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
			const result = detectPrometheusDone("Planning complete. <prometheus-done/>");

			expect(result).toBe(true);
		});

		it("returns false when <prometheus-done/> is absent", () => {
			const result = detectPrometheusDone("Session still active, planning continues");

			expect(result).toBe(false);
		});

		it("returns false for null message", () => {
			expect(detectPrometheusDone(null)).toBe(false);
		});
	});
});
