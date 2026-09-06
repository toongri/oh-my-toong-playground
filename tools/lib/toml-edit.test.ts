import { expect, test } from "bun:test";
import { parse } from "smol-toml";
import { applyTomlEdits } from "./toml-edit";

test("기존 값만 교체하고 CRLF와 주석을 보존한다", () => {
	const source = "# lead\r\nx  =  1   # keep\r\n[t]\r\ny = 2\r\n";
	expect(applyTomlEdits(source, [{ path: ["x"], kind: "set", value: 3 }])).toBe(
		source.replace("=  1", "=  3"),
	);
	expect(applyTomlEdits(source, [{ path: ["x"], kind: "set", value: 1 }])).toBe(source);
});

test("삭제한 키의 주석과 다른 설정을 보존한다", () => {
	expect(applyTomlEdits("x = 1 # keep\ny = 2\n", [{ path: ["x"], kind: "delete" }])).toBe(
		"# keep\ny = 2\n",
	);
});

test("루트와 중첩 삽입은 뒤따르는 테이블 범위를 침범하지 않는다", () => {
	const result = applyTomlEdits("[a]\nx=1\n[b]\ny=2", [
		{ path: ["root"], kind: "set", value: true },
		{ path: ["a", "added"], kind: "set", value: 3 },
		{ path: ["new", "deep", "key"], kind: "set", value: "ok" },
	]);
	expect(parse(result)).toEqual({
		root: true,
		a: { x: 1, added: 3 },
		b: { y: 2 },
		new: { deep: { key: "ok" } },
	});
});

test("따옴표 키와 다중행 문자열의 가짜 헤더를 구별한다", () => {
	const source = '"a.b" . "q\\"r" = """hello\n[fake]\nx = 8 # string\n""" # keep\n[t]\ny=1\n';
	const result = applyTomlEdits(source, [{ path: ["a.b", 'q"r'], kind: "set", value: "done" }]);
	expect(result).toBe('"a.b" . "q\\"r" = "done" # keep\n[t]\ny=1\n');
});

test("배열과 인라인 테이블 전체 값 교체를 지원한다", () => {
	const source = 'a = [\n  "# []", # c\n  "x",\n] # end\nb={x=1}\n';
	const result = applyTomlEdits(source, [
		{ path: ["a"], kind: "set", value: [1, 2] },
		{ path: ["b"], kind: "set", value: { y: true } },
	]);
	expect(parse(result)).toEqual({ a: [1, 2], b: { y: true } });
	expect(result).toContain("# end");
});

test("인라인과 배열 테이블 하위 편집은 거부한다", () => {
	expect(() => applyTomlEdits("a={x=1}", [{ path: ["a", "x"], kind: "set", value: 2 }])).toThrow();
	expect(() =>
		applyTomlEdits("[[a]]\nx=1", [{ path: ["a", "x"], kind: "set", value: 2 }]),
	).toThrow();
	expect(() => applyTomlEdits("[a]\nx=1", [{ path: ["a"], kind: "set", value: 2 }])).toThrow();
});

test("없는 키 삭제와 빈 변경은 바이트를 보존한다", () => {
	const source = "x = '''line\n# [hello]\n'''";
	expect(applyTomlEdits(source, [])).toBe(source);
	expect(applyTomlEdits(source, [{ path: ["absent"], kind: "delete" }])).toBe(source);
});

test("잘못된 입력과 표현할 수 없는 값은 비밀값 없이 거부한다", () => {
	expect(() => applyTomlEdits("bad = SECRET!", [])).toThrow("Invalid TOML");
	expect(() => applyTomlEdits("", [{ path: [], kind: "set", value: 1 }])).toThrow();
	expect(() => applyTomlEdits("", [{ path: ["x"], kind: "set", value: undefined }])).toThrow();
});

test("다중행 리터럴과 종료 따옴표가 많은 문자열 뒤의 값을 편집한다", () => {
	const source = `literal = '''first\n[fake]\nx=1 # text\n'''\nquote = """ends with quote""""\nx = 1 # real\n`;
	expect(applyTomlEdits(source, [{ path: ["x"], kind: "set", value: 2 }])).toBe(
		source.replace("x = 1 # real", "x = 2 # real"),
	);
});

test("파일 마지막 테이블과 중첩 헤더 삽입은 올바른 의미를 보존한다", () => {
	const source = "[a.child]\nx=1\n[z]\ny=2";
	const result = applyTomlEdits(source, [
		{ path: ["z", "last"], kind: "set", value: 7 },
		{ path: ["a", "extra"], kind: "set", value: 8 },
	]);
	expect(parse(result)).toEqual({ a: { child: { x: 1 }, extra: 8 }, z: { y: 2, last: 7 } });
});

test("내장 객체 이름과 점이 포함된 키도 별도 경로로 취급한다", () => {
	const result = applyTomlEdits("", [
		{ path: ["constructor", "prototype", "a.b"], kind: "set", value: 3 },
	]);
	expect(parse(result)).toEqual({ constructor: { prototype: { "a.b": 3 } } });
});

test("의미가 다른 날짜와 비정상 숫자를 문자열로 바꾸지 않는다", () => {
	const source = "date=1979-05-27T07:32:00Z\nx=nan\n";
	const result = applyTomlEdits(source, [{ path: ["x"], kind: "set", value: Infinity }]);
	expect(result).toBe(source.replace("x=nan", "x=inf"));
});

test("마지막 점 표기 키를 삭제해도 빈 부모 테이블 의미를 보존한다", () => {
	expect(
		applyTomlEdits("features.example = true\r\n", [
			{ path: ["features", "example"], kind: "delete" },
		]),
	).toBe('["features"]\r\n');
	const created = applyTomlEdits("", [{ path: ["features", "example"], kind: "set", value: true }]);
	expect(
		parse(applyTomlEdits(created, [{ path: ["features", "example"], kind: "delete" }])),
	).toEqual({ features: {} });
});

test("깊은 암시적 부모는 가장 깊은 빈 테이블 헤더로 복원한다", () => {
	const result = applyTomlEdits("a.b.c = 1\n[z]\nx=2", [{ path: ["a", "b", "c"], kind: "delete" }]);
	expect(result).toBe('[z]\nx=2\n["a"."b"]\n');
	expect(parse(result)).toEqual({ a: { b: {} }, z: { x: 2 } });
});

test("명시적 부모와 형제 키가 남으면 헤더를 중복 생성하지 않는다", () => {
	expect(applyTomlEdits("[a]\nb=1\n", [{ path: ["a", "b"], kind: "delete" }])).toBe("[a]\n");
	expect(applyTomlEdits("a.b=1\na.c=2\n", [{ path: ["a", "b"], kind: "delete" }])).toBe("a.c=2\n");
});

test("무관한 큰 정수를 그대로 보존하고 bigint 편집도 지원한다", () => {
	const source = "huge = 9223372036854775807\nx=1\n";
	expect(applyTomlEdits(source, [{ path: ["x"], kind: "set", value: 2 }])).toBe(
		source.replace("x=1", "x=2"),
	);
	expect(
		applyTomlEdits(source, [{ path: ["huge"], kind: "set", value: 9223372036854775807n }]),
	).toBe(source);
	expect(applyTomlEdits(source, [{ path: ["x"], kind: "set", value: 1n }])).toBe(source);
	expect(applyTomlEdits("", [{ path: ["big"], kind: "set", value: 9223372036854775807n }])).toBe(
		'"big" = 9223372036854775807\n',
	);
});
