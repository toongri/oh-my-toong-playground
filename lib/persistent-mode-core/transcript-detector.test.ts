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

		it("여는 펜스와 문자·길이가 맞지 않거나 정보 문자열이 붙은 줄은 펜스를 닫지 않음", () => {
			expect(detectPrometheusDone("````md\n```\n<prometheus-done/>\n````")).toBe(false);
			expect(detectPrometheusDone("~~~\n```\n<prometheus-done/>\n~~~")).toBe(false);
			expect(detectPrometheusDone("```\n```ts\n<prometheus-done/>\n```")).toBe(false);
		});

		it("목록 항목 내용 열 기준으로 들여쓴 펜스 안의 토큰은 감지하지 않음", () => {
			expect(detectPrometheusDone("10. 예시\n\n    ```\n    <prometheus-done/>\n    ```")).toBe(false);
			expect(detectPrometheusDone("- 상위\n  - 하위\n\n    ```\n    <prometheus-done/>\n    ```")).toBe(false);
			expect(detectPrometheusDone("10. 예시\n\n    ```\n    x\n    ```\n\n<prometheus-done/>")).toBe(true);
		});

		it("내용 없는 목록 항목 바로 아래 들여쓴 펜스 안의 토큰은 감지하지 않음", () => {
			expect(detectPrometheusDone("-\n    ```\n    <prometheus-done/>\n    ```")).toBe(false);
			expect(detectPrometheusDone("1.\n    ```\n    <prometheus-done/>\n    ```")).toBe(false);
		});

		it("빈 줄로 끝난 빈 목록 항목은 뒤의 4칸 들여쓴 줄을 담지 않음", () => {
			expect(detectPrometheusDone("-\n\n    ```\n\n<prometheus-done/>")).toBe(true);
		});

		it("목록 항목 안 펜스를 내어쓴 펜스 줄은 닫지 않고 새 펜스를 연다", () => {
			expect(detectPrometheusDone("- 항목\n  ```\n  x\n```\n<prometheus-done/>")).toBe(false);
		});

		it("목록 마커와 같은 줄에서 연 펜스 안의 토큰은 감지하지 않음", () => {
			expect(detectPrometheusDone("- ```\n  <prometheus-done/>\n  ```")).toBe(false);
		});

		it("최상위에서 4칸 들여쓴 토큰은 들여쓴 코드라 감지하지 않음", () => {
			expect(detectPrometheusDone("완료:\n\n    <prometheus-done/>")).toBe(false);
		});

		it("최상위에서 4칸 들여쓴 펜스 줄은 들여쓴 코드라 펜스를 열지 않음", () => {
			expect(detectPrometheusDone("예시:\n\n    ```\n\n<prometheus-done/>")).toBe(true);
		});

		it("닫히지 않은 펜스 뒤의 토큰은 감지하지 않음", () => {
			expect(detectPrometheusDone("```\ncode\n<prometheus-done/>")).toBe(false);
		});

		it("더 긴 닫는 펜스 뒤의 토큰은 감지함", () => {
			expect(detectPrometheusDone("```\ncode\n`````\n<prometheus-done/>")).toBe(true);
		});

		it("코드 펜스 밖의 단독 줄 토큰은 펜스 뒤에서도 감지함", () => {
			expect(detectPrometheusDone("```\ncode\n```\n<prometheus-done/>")).toBe(true);
		});
	});
});
