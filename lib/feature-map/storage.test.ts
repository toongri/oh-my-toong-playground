import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureFeatureMap } from "@lib/feature-map/manifest";
import { getFeature, getFeatureMapStatus, queryFeatureMap, saveFeature, validateFeatureMap, withFeatureMapReadLock } from "@lib/feature-map/storage";

const roots: string[] = [];
function temp(): string { const p = mkdtempSync(join(tmpdir(), "feature-map-storage-")); roots.push(p); return p; }
function repo(): string { const p = temp(); execFileSync("git", ["init", "-q", p]); return p; }
function doc(id = "alpha") { return { metadata: { schema_version: 1 as const, id, title: "Alpha" }, body: "# Alpha\n" }; }
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe("feature-map storage", () => {
  test("미설정 상태를 bootstrap하고 저장 없이 반환한다", () => {
    const cwd = repo(); const home = temp();
    expect(getFeatureMapStatus({ cwd, home })).toEqual(expect.objectContaining({ status: "not_found", reason: "storage_not_configured", next_action: "ask_user_for_storage" }));
  });

  test("미설정 상태에서도 잘못된 feature ID를 먼저 거부한다", () => {
    const cwd = repo(); const home = temp();
    expect(() => getFeature("INVALID ID", { cwd, home })).toThrow("feature-map: id must be a safe lower ASCII identifier");
  });

  function assertSynchronousCallbackType(): void {
    // @ts-expect-error Async callbacks can resume after the lock is released.
    withFeatureMapReadLock({}, async () => undefined);
  }
  void assertSynchronousCallbackType;

  test("새 문서를 저장하고 revision으로 읽는다", () => {
    const cwd = repo(); const home = temp();
    const configured = configureFeatureMap("features", { cwd, home });
    const saved = saveFeature({ ...doc(), expectedRevision: null }, { cwd, home });
    expect(saved.status).toBe("ok");
    if (saved.status !== "ok") throw new Error("save failed");
    expect(saved.feature.path).toBe(join(configured.manifest.storage!.location, "alpha.md"));
    expect(readFileSync(saved.feature.path, "utf8")).toContain("id: alpha");
    expect(getFeature("alpha", { cwd, home })).toMatchObject({ status: "ok", feature: { revision: saved.feature.revision } });
    expect(queryFeatureMap({ text: "ALPHA" }, { cwd, home })).toMatchObject({ status: "ok", features: [{ id: "alpha" }] });
  });

  test("오래된 revision 충돌은 파일 바이트를 보존한다", () => {
    const cwd = repo(); const home = temp(); configureFeatureMap("features", { cwd, home });
    const first = saveFeature({ ...doc(), expectedRevision: null }, { cwd, home });
    if (first.status !== "ok") throw new Error("save failed");
    const before = readFileSync(first.feature.path, "utf8");
    const conflict = saveFeature({ ...doc(), body: "changed\n", expectedRevision: "0".repeat(64) }, { cwd, home });
    expect(conflict).toMatchObject({ status: "conflict", reason: "revision_mismatch" });
    expect(readFileSync(first.feature.path, "utf8")).toBe(before);
  });

  test("파일명 불일치와 symlink를 조용히 건너뛰지 않는다", () => {
    const cwd = repo(); const home = temp(); const configured = configureFeatureMap("features", { cwd, home });
    writeFileSync(join(configured.manifest.storage!.location, "wrong.md"), "---\nschema_version: 1\nid: right\ntitle: Right\n---\nbody\n");
    expect(() => queryFeatureMap({}, { cwd, home })).toThrow(/filename\/id mismatch/);
    const external = join(temp(), "external.md"); writeFileSync(external, "outside\n");
    symlinkSync(external, join(configured.manifest.storage!.location, "link.md"));
    expect(() => validateFeatureMap({ cwd, home })).not.toThrow();
    expect(validateFeatureMap({ cwd, home })).toMatchObject({ status: "invalid" });
    expect(lstatSync(join(configured.manifest.storage!.location, "link.md")).isSymbolicLink()).toBe(true);
  });

  test("빈 configured query와 없는 get은 feature_not_found를 반환한다", () => {
    const cwd = repo(); const home = temp(); configureFeatureMap("features", { cwd, home });
    expect(queryFeatureMap({}, { cwd, home })).toEqual({ status: "not_found", reason: "feature_not_found" });
    expect(getFeature("missing", { cwd, home })).toEqual({ status: "not_found", reason: "feature_not_found" });
  });

  test("configured root가 사라지면 오류를 내고 다시 만들지 않는다", () => {
    const cwd = repo(); const home = temp();
    const configured = configureFeatureMap("features", { cwd, home });
    rmSync(configured.manifest.storage!.location, { recursive: true, force: true });
    expect(() => getFeatureMapStatus({ cwd, home })).toThrow(/unavailable/);
    expect(existsSync(configured.manifest.storage!.location)).toBe(false);
  });

  test("정확한 expectedRevision으로 update하고 변경 revision을 반환한다", () => {
    const cwd = repo(); const home = temp(); configureFeatureMap("features", { cwd, home });
    const first = saveFeature({ ...doc(), expectedRevision: null }, { cwd, home });
    if (first.status !== "ok") throw new Error("initial save failed");
    const updated = saveFeature({ ...doc(), body: "updated\r\n\r\n", expectedRevision: first.feature.revision }, { cwd, home });
    expect(updated.status).toBe("ok");
    if (updated.status !== "ok") throw new Error("update failed");
    expect(updated.feature.revision).not.toBe(first.feature.revision);
    const fetched = getFeature("alpha", { cwd, home });
    expect(fetched).toMatchObject({ status: "ok", feature: { body: "updated\n" } });
    if (fetched.status !== "ok") throw new Error("get failed");
    expect(updated.feature).toEqual(fetched.feature);
    expect(Object.hasOwn(updated.feature, "expectedRevision")).toBe(false);
  });

  test("외부 직접 편집은 old revision을 무효화하고 충돌 시 바이트를 보존한다", () => {
    const cwd = repo(); const home = temp(); configureFeatureMap("features", { cwd, home });
    const first = saveFeature({ ...doc(), expectedRevision: null }, { cwd, home });
    if (first.status !== "ok") throw new Error("initial save failed");
    writeFileSync(first.feature.path, "external bytes\n");
    const conflict = saveFeature({ ...doc(), body: "api bytes\n", expectedRevision: first.feature.revision }, { cwd, home });
    expect(conflict).toMatchObject({ status: "conflict", reason: "revision_mismatch" });
    expect(readFileSync(first.feature.path, "utf8")).toBe("external bytes\n");
  });

  test("changedBy filter와 id 정렬을 적용한다", () => {
    const cwd = repo(); const home = temp(); configureFeatureMap("features", { cwd, home });
    saveFeature({ metadata: { schema_version: 1, id: "zeta", title: "Z", state_changed_by: ["team-a"] }, body: "z\n", expectedRevision: null }, { cwd, home });
    saveFeature({ metadata: { schema_version: 1, id: "alpha", title: "A", state_changed_by: ["team-b"] }, body: "a\n", expectedRevision: null }, { cwd, home });
    expect(queryFeatureMap({ changedBy: "team-a" }, { cwd, home })).toMatchObject({ status: "ok", features: [{ id: "zeta" }] });
    expect(queryFeatureMap({}, { cwd, home })).toMatchObject({ status: "ok", features: [{ id: "alpha" }, { id: "zeta" }] });
  });

  test("validate가 dangling state_changed_by와 duplicate ID를 보고한다", () => {
    const cwd = repo(); const home = temp(); const configured = configureFeatureMap("features", { cwd, home });
    writeFileSync(join(configured.manifest.storage!.location, "alpha.md"), "---\nschema_version: 1\nid: alpha\ntitle: A\nstate_changed_by: [missing]\n---\na\n");
    writeFileSync(join(configured.manifest.storage!.location, "beta.md"), "---\nschema_version: 1\nid: alpha\ntitle: A2\n---\nb\n");
    const result = validateFeatureMap({ cwd, home });
    expect(result).toMatchObject({ status: "invalid" });
    if (result.status === "invalid") {
      expect(result.issues.some((issue) => issue.message.includes("dangling state_changed_by"))).toBe(true);
      expect(result.issues.some((issue) => issue.message.includes("duplicate feature id"))).toBe(true);
    }
  });

  test("trailing slash가 있는 절대 configured location도 사용할 수 있다", () => {
    const cwd = repo(); const home = temp(); const root = temp();
    const configured = configureFeatureMap(`${root}/`, { cwd, home });
    const saved = saveFeature({ ...doc(), expectedRevision: null }, { cwd, home });
    expect(saved.status).toBe("ok");
    expect(queryFeatureMap({}, { cwd, home })).toMatchObject({ status: "ok", features: [{ id: "alpha" }] });
    expect(configured.manifest.storage!.location).toContain(root);
  });

  test("읽기 전용 storage에서도 query/get/validate를 수행한다", () => {
    if (process.platform === "win32") return;
    const cwd = repo(); const home = temp(); const configured = configureFeatureMap("features", { cwd, home });
    const saved = saveFeature({ ...doc(), expectedRevision: null }, { cwd, home });
    if (saved.status !== "ok") throw new Error("initial save failed");
    const location = configured.manifest.storage!.location;
    try {
      chmodSync(location, 0o555);
      expect(queryFeatureMap({}, { cwd, home })).toMatchObject({ status: "ok", features: [{ id: "alpha" }] });
      expect(getFeature("alpha", { cwd, home })).toMatchObject({ status: "ok", feature: { metadata: { id: "alpha" } } });
      expect(validateFeatureMap({ cwd, home })).toMatchObject({ status: "valid", feature_count: 1 });
    } finally {
      chmodSync(location, 0o755);
    }
  });
});
