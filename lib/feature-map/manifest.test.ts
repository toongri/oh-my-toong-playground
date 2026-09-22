import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  configureFeatureMap,
  ensureFeatureMapManifest,
  resolveFeatureMapContext,
} from "@lib/feature-map/manifest";

const temporaryRoots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "feature-map-manifest-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gitRepo(name = "repo"): string {
  const root = join(tempDir(), name);
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  return root;
}

describe("feature-map manifest", () => {
  test("처음 호출하면 null storage 매니페스트를 만들고 다시 호출해도 보존한다", () => {
    const cwd = gitRepo("my repo");
    const home = tempDir();
    const first = ensureFeatureMapManifest({ cwd, home });
    const before = readFileSync(first.context.manifestPath, "utf8");
    const second = ensureFeatureMapManifest({ cwd, home });

    expect(first.manifest).toEqual({ version: 1, project: first.context.projectKey, storage: null });
    expect(second).toEqual(first);
    expect(readFileSync(first.context.manifestPath, "utf8")).toBe(before);
  });

  test("상대 location을 매니페스트 디렉터리에 해석하고 하위 디렉터리를 만든다", () => {
    const cwd = gitRepo();
    const home = tempDir();
    const result = configureFeatureMap("data/features", { cwd, home });
    expect(result.manifest.storage).toEqual({
      format: "markdown-frontmatter-v1",
      location: join(dirname(result.context.manifestPath), "data/features"),
    });
    expect(statSync(result.manifest.storage!.location).isDirectory()).toBe(true);
  });

  test("빈 location과 파일 location을 거부한다", () => {
    const cwd = gitRepo();
    const home = tempDir();
    expect(() => configureFeatureMap("   ", { cwd, home })).toThrow();
    const file = join(tempDir(), "file");
    writeFileSync(file, "x");
    expect(() => configureFeatureMap(file, { cwd, home })).toThrow();
  });

  test("설정 변경 시 기존 매니페스트의 확장 필드를 보존한다", () => {
    const cwd = gitRepo();
    const home = tempDir();
    const context = resolveFeatureMapContext({ cwd, home });
    mkdirSync(dirname(context.manifestPath), { recursive: true });
    writeFileSync(context.manifestPath, `version: 1\nproject: ${context.projectKey}\nstorage: null\nextra:\n  keep: true\n`);
    configureFeatureMap("docs", { cwd, home });
    expect(readFileSync(context.manifestPath, "utf8")).toContain("keep: true");
  });

  test("손상되거나 context와 불일치하는 기존 매니페스트를 재생성하지 않는다", () => {
    const cwd = gitRepo();
    const home = tempDir();
    const context = resolveFeatureMapContext({ cwd, home });
    mkdirSync(join(home, ".feature-maps", context.projectKey), { recursive: true });
    writeFileSync(context.manifestPath, "project: [broken]\n");
    expect(() => ensureFeatureMapManifest({ cwd, home })).toThrow();
    expect(readFileSync(context.manifestPath, "utf8")).toBe("project: [broken]\n");
  });

  test("worktree는 같은 저장소 key를 공유하고 이름이 같은 저장소는 분리한다", () => {
    const root = gitRepo("same-name");
    execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
    writeFileSync(join(root, "README"), "x");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", ["-C", root, "commit", "-qm", "init"]);
    const worktree = join(tempDir(), "same-name");
    execFileSync("git", ["-C", root, "worktree", "add", "-q", worktree, "HEAD"]);
    const home = tempDir();
    expect(resolveFeatureMapContext({ cwd: root, home }).projectKey)
      .toBe(resolveFeatureMapContext({ cwd: worktree, home }).projectKey);
    const other = gitRepo("same-name");
    expect(resolveFeatureMapContext({ cwd: root, home }).projectKey)
      .not.toBe(resolveFeatureMapContext({ cwd: other, home }).projectKey);
  });

  test("중첩 디렉터리에서 상대 git common dir을 올바르게 해석한다", () => {
    const root = gitRepo("nested");
    const nested = join(root, "packages", "app", "deep");
    mkdirSync(nested, { recursive: true });
    const home = tempDir();
    const context = resolveFeatureMapContext({ cwd: nested, home });
    expect(context.projectRoot).toBe(realpathSync(root));
    expect(context.projectKey).toContain("nested-");
  });

  test("이름이 다른 worktree도 같은 저장소 key를 공유한다", () => {
    const root = gitRepo("main-repo");
    execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
    writeFileSync(join(root, "README"), "x");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", ["-C", root, "commit", "-qm", "init"]);
    const worktree = join(tempDir(), "different-worktree-name");
    execFileSync("git", ["-C", root, "worktree", "add", "-q", worktree, "HEAD"]);
    const home = tempDir();
    expect(resolveFeatureMapContext({ cwd: root, home }).projectKey)
      .toBe(resolveFeatureMapContext({ cwd: worktree, home }).projectKey);
  });

  test("중복 키와 여러 YAML 문서를 거부한다", () => {
    const cwd = gitRepo();
    const home = tempDir();
    const context = resolveFeatureMapContext({ cwd, home });
    mkdirSync(join(home, ".feature-maps", context.projectKey), { recursive: true });
    writeFileSync(context.manifestPath, "version: 1\nproject: x\nproject: y\nstorage: null\n");
    expect(() => ensureFeatureMapManifest({ cwd, home })).toThrow();
    writeFileSync(context.manifestPath, "version: 1\nproject: x\nstorage: null\n---\nversion: 1\n");
    expect(() => ensureFeatureMapManifest({ cwd, home })).toThrow();
  });
});
