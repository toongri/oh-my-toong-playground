import { describe, it, expect } from "bun:test";
import { deepMergeOverlay } from "./deep-merge-overlay.ts";

describe("deepMergeOverlay", () => {
  describe("scalar 병합", () => {
    it("scalar는 local이 base를 덮어쓴다", () => {
      const result = deepMergeOverlay({ a: 1 }, { a: 2 });
      expect(result).toEqual({ a: 2 });
    });

    it("local에 없는 key는 base 값 유지", () => {
      const result = deepMergeOverlay({ a: 1, b: "keep" }, { a: 2 });
      expect(result).toEqual({ a: 2, b: "keep" });
    });

    it("base에 없는 key는 local에서 추가됨", () => {
      const result = deepMergeOverlay({ a: 1 }, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe("plain object 재귀 병합", () => {
    it("중첩 객체는 재귀적으로 병합된다", () => {
      const result = deepMergeOverlay(
        { env: { A: 1, B: 2 } },
        { env: { B: 3, C: 4 } }
      );
      expect(result).toEqual({ env: { A: 1, B: 3, C: 4 } });
    });

    it("깊이 중첩된 객체도 병합된다", () => {
      const base = { a: { b: { c: { d: 1, e: 2 } } } };
      const local = { a: { b: { c: { e: 99, f: 3 } } } };
      expect(deepMergeOverlay(base, local)).toEqual({ a: { b: { c: { d: 1, e: 99, f: 3 } } } });
    });
  });

  describe("string array: concat + dedup (by self)", () => {
    it("string array는 concat 후 중복 제거", () => {
      const result = deepMergeOverlay(
        { deny: ["X", "Y"] },
        { deny: ["Y", "Z"] },
        "root"
      );
      expect(result).toEqual({ deny: ["X", "Y", "Z"] });
    });

    it("permissions.deny는 자기 자신이 dedup 키", () => {
      const result = deepMergeOverlay(
        { permissions: { deny: ["Bash(rm -rf *)", "Bash(git push --force*)"] } },
        { permissions: { deny: ["Bash(rm -rf *)", "Bash(git push -f*)"] } }
      );
      expect(result.permissions).toEqual({
        deny: ["Bash(rm -rf *)", "Bash(git push --force*)", "Bash(git push -f*)"],
      });
    });

    it("base에만 있는 항목은 보존됨", () => {
      const result = deepMergeOverlay(
        { deny: ["A", "B", "C"] },
        { deny: ["B"] },
        "root"
      );
      expect(result).toEqual({ deny: ["A", "B", "C"] });
    });

    it("local에만 있는 항목은 끝에 추가됨", () => {
      const result = deepMergeOverlay(
        { deny: ["A"] },
        { deny: ["B"] },
        "root"
      );
      expect(result).toEqual({ deny: ["A", "B"] });
    });
  });

  describe("object array: identity-key dedup + in-place replace", () => {
    it("plugins.items: local 항목이 base 항목을 in-place로 교체", () => {
      const result = deepMergeOverlay(
        { plugins: { items: [{ name: "p", value: 1 }] } },
        { plugins: { items: [{ name: "p", value: 2 }] } }
      );
      expect(result.plugins).toEqual({ items: [{ name: "p", value: 2 }] });
    });

    it("plugins.items: 교체 시 entry 내부 병합 안 함 (whole replacement)", () => {
      const result = deepMergeOverlay(
        { plugins: { items: [{ name: "p", value: 1, extra: "keep?" }] } },
        { plugins: { items: [{ name: "p", value: 2 }] } }
      );
      expect((result.plugins as any).items[0]).toEqual({ name: "p", value: 2 });
      expect((result.plugins as any).items[0].extra).toBeUndefined();
    });

    it("base에만 있는 항목은 보존됨", () => {
      const result = deepMergeOverlay(
        { plugins: { items: [{ name: "a" }, { name: "b" }] } },
        { plugins: { items: [{ name: "b" }] } }
      );
      expect((result.plugins as any).items).toEqual([{ name: "a" }, { name: "b" }]);
    });

    it("충돌 시 순서 보존: local 항목은 base의 위치에 남는다", () => {
      const result = deepMergeOverlay(
        { plugins: { items: [{ name: "a" }, { name: "b" }, { name: "c" }] } },
        { plugins: { items: [{ name: "b", extra: true }] } }
      );
      const items = (result.plugins as any).items;
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ name: "a" });
      expect(items[1]).toEqual({ name: "b", extra: true });
      expect(items[2]).toEqual({ name: "c" });
    });

    it("local에만 있는 항목은 끝에 추가됨", () => {
      const result = deepMergeOverlay(
        { plugins: { items: [{ name: "a" }] } },
        { plugins: { items: [{ name: "b" }] } }
      );
      expect((result.plugins as any).items).toEqual([{ name: "a" }, { name: "b" }]);
    });
  });

  describe("hooks: component+matcher 복합 키 dedup", () => {
    it("matcher-A 항목만 교체되고 matcher-B는 생존", () => {
      const base = {
        hooks: {
          PreToolUse: [
            { component: "x", matcher: "A" },
            { component: "x", matcher: "B" },
          ],
        },
      };
      const local = {
        hooks: {
          PreToolUse: [{ component: "x", matcher: "A", env: { Y: 1 } }],
        },
      };
      const result = deepMergeOverlay(base, local);
      const entries = (result.hooks as any).PreToolUse;
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ component: "x", matcher: "A", env: { Y: 1 } });
      expect(entries[1]).toEqual({ component: "x", matcher: "B" });
    });

    it("matcher 없는 항목과 matcher 있는 항목은 별개", () => {
      const base = {
        hooks: {
          PreToolUse: [
            { component: "pre-tool-enforcer.sh" },
            { component: "pre-tool-enforcer.sh", matcher: "Bash" },
          ],
        },
      };
      const local = {
        hooks: {
          PreToolUse: [{ component: "pre-tool-enforcer.sh", matcher: "Bash", timeout: 99 }],
        },
      };
      const result = deepMergeOverlay(base, local);
      const entries = (result.hooks as any).PreToolUse;
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ component: "pre-tool-enforcer.sh" });
      expect(entries[1]).toEqual({ component: "pre-tool-enforcer.sh", matcher: "Bash", timeout: 99 });
    });
  });

  describe("empty local은 no-op", () => {
    it("local이 null이면 base의 deep clone 반환", () => {
      const base = { a: 1, b: { c: 2 } };
      const result = deepMergeOverlay(base, null as any);
      expect(result).toEqual(base);
    });

    it("local이 undefined이면 base의 deep clone 반환", () => {
      const base = { a: 1 };
      const result = deepMergeOverlay(base, undefined as any);
      expect(result).toEqual(base);
    });

    it("local이 빈 객체면 base의 deep clone 반환", () => {
      const base = { a: 1, b: { c: 2 } };
      const result = deepMergeOverlay(base, {});
      expect(result).toEqual(base);
    });

    it("empty local 결과는 base와 참조가 다름 (deep clone)", () => {
      const base = { a: { nested: 1 } };
      const result = deepMergeOverlay(base, {});
      expect(result).not.toBe(base);
      expect(result.a).not.toBe(base.a);
    });
  });

  describe("base가 없고 local이 있는 경우", () => {
    it("base가 undefined이면 local의 deep clone 반환", () => {
      const local = { a: 1 };
      const result = deepMergeOverlay(undefined as any, local);
      expect(result).toEqual({ a: 1 });
    });

    it("결과는 local과 참조가 다름 (deep clone)", () => {
      const local = { a: { nested: 1 } };
      const result = deepMergeOverlay(undefined as any, local);
      expect(result).not.toBe(local);
      expect(result.a).not.toBe(local.a);
    });
  });

  describe("불변성: 원본 객체 변경 안 함", () => {
    it("base 객체를 변경하지 않음", () => {
      const base = { a: 1, b: { c: 2 } };
      deepMergeOverlay(base, { a: 99, b: { c: 100 } });
      expect(base).toEqual({ a: 1, b: { c: 2 } });
    });
  });
});
