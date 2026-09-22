import { describe, expect, test } from "bun:test";

import {
  parseFeature,
  serializeFeature,
  validateFeature,
  type FeatureDocument,
  type FeatureMetadata,
} from "@lib/feature-map/schema";

const validMetadata: FeatureMetadata = {
  schema_version: 1,
  id: "stock.view",
  title: "Stock view",
  aliases: ["inventory"],
  entrypoints: [{ id: "main", kind: "screen" }],
  state_changed_by: ["user"],
  state_variants: ["loading"],
  source_refs: ["docs/stock.md", "https://example.com/req"],
  future_key: { preserved: true },
};

const validDocument: FeatureDocument = {
  metadata: validMetadata,
  body: "# Stock view\n\nShows current stock.\n",
};

describe("feature-map schema", () => {
  test("유효한 문서를 파싱하고 직렬화한 뒤 왕복 보존한다", () => {
    const text = serializeFeature(validDocument);
    expect(parseFeature(text)).toEqual(validDocument);
  });

  test("알 수 없는 메타데이터를 손실 없이 보존한다", () => {
    const parsed = parseFeature(serializeFeature(validDocument));
    expect(parsed.metadata.future_key).toEqual({ preserved: true });
  });

  test("__proto__ 확장 메타데이터도 왕복 보존한다", () => {
    const parsed = parseFeature(
      "---\nschema_version: 1\nid: a\ntitle: 제목\n__proto__:\n  preserved: true\n---\n본문\n",
    );
    const roundTripped = parseFeature(serializeFeature(parsed));
    expect(Object.hasOwn(roundTripped.metadata, "__proto__")).toBe(true);
    expect(roundTripped.metadata["__proto__"]).toEqual({ preserved: true });
  });

  test("필드 순서를 결정적으로 직렬화하고 끝 개행을 하나로 맞춘다", () => {
    const first = serializeFeature({
      body: "본문",
      metadata: { title: "제목", id: "a", schema_version: 1, zeta: 1, alpha: 2 },
    });
    const second = serializeFeature({
      body: "본문\n\n",
      metadata: { alpha: 2, schema_version: 1, zeta: 1, id: "a", title: "제목" },
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^---\nschema_version: 1\nid: a\ntitle: 제목\nalpha: 2\nzeta: 1\n---\n본문\n$/);
  });

  test("CRLF 프런트매터를 읽고 본문 개행을 정규화한다", () => {
    const text = "---\r\nschema_version: 1\r\nid: a\r\ntitle: 제목\r\n---\r\n# 제목\r\n본문\r\n";
    expect(parseFeature(text).body).toBe("# 제목\n본문\n");
  });

  test("ID의 대문자, 공백, 경로 traversal을 거부한다", () => {
    for (const id of ["Stock.View", "bad id", "../secret", "a/b", ".", "-"]) {
      expect(() => validateFeature({ ...validDocument, metadata: { ...validMetadata, id } })).toThrow();
    }
  });

  test("필수 필드 누락과 빈 본문을 거부한다", () => {
    expect(() => validateFeature({ ...validDocument, metadata: { id: "a", title: "제목" } as FeatureMetadata })).toThrow();
    expect(() => validateFeature({ ...validDocument, metadata: validMetadata, body: " \n" })).toThrow();
  });

  test("알 수 없는 schema version과 알려진 필드의 잘못된 타입을 거부한다", () => {
    expect(() => validateFeature({ ...validDocument, metadata: { ...validMetadata, schema_version: 2 } })).toThrow();
    expect(() => validateFeature({ ...validDocument, metadata: { ...validMetadata, aliases: ["ok", 1] } as unknown as FeatureMetadata })).toThrow();
    expect(() => validateFeature({ ...validDocument, metadata: { ...validMetadata, entrypoints: [{ id: "x" }] } as FeatureMetadata })).toThrow();
  });

  test("entrypoint ID 중복을 거부한다", () => {
    expect(() => validateFeature({
      ...validDocument,
      metadata: { ...validMetadata, entrypoints: [{ id: "main", kind: "screen" }, { id: "main", kind: "action" }] },
    })).toThrow();
  });

  test("중복 YAML 키를 블록 스타일과 flow 스타일 모두 거부한다", () => {
    const block = "---\nschema_version: 1\nid: a\ntitle: 하나\ntitle: 둘\n---\n본문\n";
    const flow = "---\n{schema_version: 1, id: a, title: 하나, title: 둘}\n---\n본문\n";
    expect(() => parseFeature(block)).toThrow();
    expect(() => parseFeature(flow)).toThrow();
  });

  test("본문 안의 YAML처럼 보이는 Markdown을 그대로 보존한다", () => {
    const text = "---\nschema_version: 1\nid: a\ntitle: 제목\n---\n본문\n---\nid: b\n";
    expect(parseFeature(text).body).toBe("본문\n---\nid: b\n");
  });

  test("메타데이터가 객체가 아니거나 프런트매터가 없으면 거부한다", () => {
    expect(() => parseFeature("본문만 있음\n")).toThrow();
    expect(() => parseFeature("---\n- item\n---\n본문\n")).toThrow();
  });
});
