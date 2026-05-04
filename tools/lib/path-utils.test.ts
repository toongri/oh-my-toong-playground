import { describe, it, expect } from "bun:test";
import os from "os";
import path from "path";
import { expandTilde, isGlobalSync } from "./path-utils.ts";

describe("expandTilde", () => {
  it("`~` 단독을 os.homedir()로 확장한다", () => {
    expect(expandTilde("~")).toBe(os.homedir());
  });

  it("`~/foo/bar`를 os.homedir() + '/foo/bar'로 확장한다", () => {
    expect(expandTilde("~/foo/bar")).toBe(path.join(os.homedir(), "foo/bar"));
  });

  it("`~user/foo` 형태는 지원하지 않으며 원본 그대로 반환한다", () => {
    expect(expandTilde("~user/foo")).toBe("~user/foo");
  });

  it("절대경로(`/Users/foo/bar`)는 원본 그대로 반환한다", () => {
    expect(expandTilde("/Users/foo/bar")).toBe("/Users/foo/bar");
  });

  it("상대경로(`foo/bar`)는 원본 그대로 반환한다", () => {
    expect(expandTilde("foo/bar")).toBe("foo/bar");
  });

  it("빈 문자열은 원본 그대로 반환한다", () => {
    expect(expandTilde("")).toBe("");
  });
});

describe("isGlobalSync", () => {
  it("expandTilde 후 homedir과 같으면 true — 단순 ~", () => {
    expect(isGlobalSync("~")).toBe(true);
  });

  it("expandTilde 후 homedir과 같으면 true — trailing slash ~/", () => {
    expect(isGlobalSync("~/")).toBe(true);
  });

  it("리터럴 절대경로 os.homedir()이면 true", () => {
    expect(isGlobalSync(os.homedir())).toBe(true);
  });

  it("홈 하위 디렉터리 ~/repos/foo는 false", () => {
    expect(isGlobalSync("~/repos/foo")).toBe(false);
  });

  it("비-홈 절대경로 /tmp/x는 false", () => {
    expect(isGlobalSync("/tmp/x")).toBe(false);
  });

  it("다른 사용자 home ~user/foo는 false (미지원)", () => {
    expect(isGlobalSync("~user/foo")).toBe(false);
  });

  it("리터럴 환경변수 문자열 $HOME은 false", () => {
    expect(isGlobalSync("$HOME")).toBe(false);
  });
});
