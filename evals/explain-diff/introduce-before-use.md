# 쓰기 전에 소개 (introduce before you use) — RED 기록

`skills/explain-diff/references/rubric.md`의 **R24**(judge, code 스텝)와 `<ul class="gloss">`
"이 그림의 요소" 각주 슬롯은 여기 기록한 RED에서 나왔다. R24의 임계값("설명 없이 쓰인
1급 엔티티는 구멍")을 확인하려면 이 문서를 본다.

## RED — 서브에이전트 압박 베이스라인 (재현 불가, n=1 셀)

실제 SKILL.md를 읽히고 gloss 스포트라이트 없이 식별자 밀집 섹션 3개를 쓰게 한 압박
베이스라인에서 관측한 것:

- 모델은 **일부** 코인된 용어를 자유 산문에서 스스로 풀었다(예: "용어를 먼저 고정한다"
  문단). 즉 "전혀 설명 안 함"이 문제가 아니다.
- 그러나 **구조화된 각주(`<ul class="gloss">`)를 0건** 생성했고, 다이어그램의 코드명
  노드(sequenceDiagram 메시지·시스템 레벨 flowchart 노드)는 아무 카드로도, 아무 각주로도
  풀리지 않은 채 남았다.
- 결론: 결함은 "안 푼다"가 아니라 **풂이 일관적이지 않고(습관에 의존) 구조화된 표면에서
  누수**한다는 것. 특히 카드(R18/R21)가 닿지 않는 다이어그램 요소가 통째로 빈다.

같은 관측을 rubric.md R24 아래 RED 인용 블록에도 요약해 두었다(문서에서 바로 읽히도록).

## GREEN 응답 (강제 아님, 일관성 장치)

사용자 지시대로 **결정론 기계 게이트는 넣지 않는다**(sequenceDiagram participant 오추출로
false-positive가 나고, 강제는 우선순위가 아니라는 판단). 대신:

1. **positive recipe 규칙** — SKILL.md "쓰기 전에 소개" 1급 블록(kind→depth 표).
2. **필수 슬롯** — `references/markdown-template.md`의 시스템 레벨/기능 단위 다이어그램 밑
   `<ul class="gloss">` 각주 슬롯 + `## Sanctioned components`의 `gloss` 항목.
3. **렌더 능력** — `skills/explain-diff/scripts/render.ts`에 `ul.gloss` CSS 이식
   (deep-interview/prometheus에는 이미 있던 "이 그림의 요소" 상자), `lib/explain-diff-structure.ts`
   `SANCTIONED_CLASSES`에 `gloss` 추가(R11이 각주를 반려하지 않도록).
4. **judge 항목 R24** — rubric.md + judge-prompt.md + `lib/explain-diff-core.ts`
   `REQUIRED_JUDGE_IDS.code = ["R7","R24"]` + final-checklist.md 축 10.

## 재확인 방법 (지속 그린 테스트)

- 렌더 능력·승인 클래스: `bun test skills/explain-diff/scripts/render.test.ts -t "gloss"`,
  `bun test lib/explain-diff-structure.test.ts -t "gloss 박스"`.
- judge 계약(code 스텝이 R7·R24 둘 다 요구): `bun test lib/explain-diff-core.test.ts -t "필수 심사"`,
  `bun test skills/explain-diff/scripts/explain-diff-state.test.ts -t "R24"`.
- 모델 산출 일관성(사람/모델 루프): 스킬을 실제 diff에 통과시키고, 다이어그램 코드명 요소가
  카드나 gloss로 전부 풀렸는지, 산문 1급 엔티티가 첫 등장에 소개됐는지를 R24 judge가
  기각/통과로 가른다. 결정론 점수기(`harness/score-structure.ts`)는 이 항목을 채점하지
  않는다 — R24는 judge 항목이라 산문 표면의 false-positive를 피한다.
