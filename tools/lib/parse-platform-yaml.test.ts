import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { parseAndMergePlatformYaml } from "./parse-platform-yaml.ts";

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("parseAndMergePlatformYaml", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "parse-platform-yaml-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("기본 파일만 있으면 기본 값을 반환한다", async () => {
    await writeFile(path.join(tmpDir, "claude.yaml"), "config:\n  theme: dark\n");

    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toEqual({ config: { theme: "dark" } });
  });

  it("두 파일이 모두 없으면 null을 반환한다", async () => {
    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toBeNull();
  });

  it("local 파일만 있으면 local 값을 반환한다", async () => {
    await writeFile(path.join(tmpDir, "claude.local.yaml"), "config:\n  theme: light\n");

    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toEqual({ config: { theme: "light" } });
  });

  it("local 파일이 기본 파일을 오버레이한다", async () => {
    await writeFile(path.join(tmpDir, "claude.yaml"), "config:\n  theme: dark\n  lang: en\n");
    await writeFile(path.join(tmpDir, "claude.local.yaml"), "config:\n  theme: light\n");

    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toEqual({ config: { theme: "light", lang: "en" } });
  });

  it("local 파일이 기본 파일에 없는 키를 추가한다", async () => {
    await writeFile(path.join(tmpDir, "claude.yaml"), "config:\n  theme: dark\n");
    await writeFile(path.join(tmpDir, "claude.local.yaml"), "statusLine: custom\n");

    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toEqual({ config: { theme: "dark" }, statusLine: "custom" });
  });

  it("플랫폼별로 독립적으로 동작한다 — gemini는 claude에 영향 없음", async () => {
    await writeFile(path.join(tmpDir, "claude.yaml"), "config:\n  theme: dark\n");
    await writeFile(path.join(tmpDir, "gemini.yaml"), "config:\n  theme: light\n");
    await writeFile(path.join(tmpDir, "gemini.local.yaml"), "statusLine: gemini-custom\n");

    const claudeResult = await parseAndMergePlatformYaml(tmpDir, "claude");
    const geminiResult = await parseAndMergePlatformYaml(tmpDir, "gemini");

    expect(claudeResult).toEqual({ config: { theme: "dark" } });
    expect(geminiResult).toEqual({ config: { theme: "light" }, statusLine: "gemini-custom" });
  });

  it("비어있는 기본 파일과 유효한 local 파일이 있으면 local 값을 반환한다", async () => {
    await writeFile(path.join(tmpDir, "claude.yaml"), "");
    await writeFile(path.join(tmpDir, "claude.local.yaml"), "config:\n  theme: light\n");

    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toEqual({ config: { theme: "light" } });
  });

  it("두 파일 모두 비어있으면 null을 반환한다", async () => {
    await writeFile(path.join(tmpDir, "claude.yaml"), "");
    await writeFile(path.join(tmpDir, "claude.local.yaml"), "");

    const result = await parseAndMergePlatformYaml(tmpDir, "claude");

    expect(result).toBeNull();
  });

  it("프로젝트 스코프 격리 — 루트 디렉토리와 프로젝트 디렉토리가 독립적으로 병합된다", async () => {
    const rootDir = path.join(tmpDir, "root");
    const projectDir = path.join(tmpDir, "project");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });

    await writeFile(path.join(rootDir, "claude.yaml"), "config:\n  theme: dark\n");
    await writeFile(path.join(rootDir, "claude.local.yaml"), "config:\n  rootOnly: true\n");
    await writeFile(path.join(projectDir, "claude.yaml"), "config:\n  theme: light\n");
    await writeFile(path.join(projectDir, "claude.local.yaml"), "config:\n  projectOnly: true\n");

    const rootResult = await parseAndMergePlatformYaml(rootDir, "claude");
    const projectResult = await parseAndMergePlatformYaml(projectDir, "claude");

    expect(rootResult).toEqual({ config: { theme: "dark", rootOnly: true } });
    expect(projectResult).toEqual({ config: { theme: "light", projectOnly: true } });
    expect(rootResult).not.toHaveProperty("config.projectOnly");
    expect(projectResult).not.toHaveProperty("config.rootOnly");
  });
});
