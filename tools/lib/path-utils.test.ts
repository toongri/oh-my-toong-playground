import { describe, it, expect } from "bun:test";
import os from "os";
import path from "path";
import { expandTilde } from "./path-utils.ts";

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
