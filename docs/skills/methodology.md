한국어 | [English](methodology.en.md)

---

# 개발 방법론 스킬

oh-my-toong의 개발 방법론 스킬은 [superpowers](https://github.com/obra/superpowers) 플러그인에서 벤더링한 스킬 집합입니다. 코드 구현·리뷰 수용·스킬 저작이라는 세 가지 프로세스에 각각 TDD(테스트 주도 개발)의 규율을 적용합니다.

---

## 핵심 요약

| 스킬 | 역할 한 줄 요약 | 언제 사용하나 |
|------|----------------|---------------|
| `test-driven-development` | 실패하는 테스트 먼저 작성 → 통과시키는 RED-GREEN-REFACTOR 방법론 | 기능 구현 또는 버그 수정 코드를 작성하기 전 |
| `receiving-code-review` | 코드 리뷰 피드백을 기술적으로 검증하며 수용하는 규율 | 리뷰 피드백을 받고 구현에 반영하기 전 — 특히 피드백이 불명확하거나 기술적으로 의심스러울 때 |
| `writing-skills` | 스킬을 작성·편집·검증하는 방법론 (프로세스 문서에 적용한 TDD) | 새 스킬을 만들거나 기존 스킬을 수정·배포 전 검증할 때 |

---

## 스킬 상세

### test-driven-development

**목적**: 테스트를 먼저 작성하고, 실패를 확인한 뒤, 통과시키는 최소한의 코드를 작성하는 RED-GREEN-REFACTOR 사이클을 규율합니다.

**핵심 원칙**: "테스트가 실패하는 것을 보지 않았다면, 그 테스트가 올바른 것을 검증하는지 알 수 없다."

**언제 사용하나**: 새 기능 또는 버그 수정 코드를 작성하기 전. 구현 코드보다 항상 먼저 호출됩니다.

---

### receiving-code-review

**목적**: 코드 리뷰 피드백을 감정적 반응이나 맹목적 구현이 아니라 기술적 검증을 거쳐 수용하도록 규율합니다.

**핵심 원칙**: "구현 전에 검증하라. 가정하기 전에 물어라. 사회적 편안함보다 기술적 정확성이 우선한다." 수행적 동의(performative agreement) — 이해 없이 동의부터 표현하는 것 — 를 배격합니다.

**언제 사용하나**: 코드 리뷰 피드백을 받고 그것을 구현에 반영하기 전. 피드백이 불명확하거나 기술적으로 의심스러울 때 특히 유용합니다.

---

### writing-skills

**목적**: 스킬 저작 자체를 프로세스 문서에 적용한 TDD로 취급합니다 — 압박 시나리오(서브에이전트)로 테스트 케이스를 작성하고, 실패(베이스라인 행동)를 관찰한 뒤, 스킬(문서)을 작성하고, 통과(에이전트 준수)를 확인하고, 리팩터(허점 제거)합니다.

**핵심 원칙**: "스킬 없이 에이전트가 실패하는 것을 보지 않았다면, 그 스킬이 올바른 것을 가르치는지 알 수 없다."

**언제 사용하나**: 새 스킬을 만들거나, 기존 스킬을 편집하거나, 배포 전에 스킬이 실제로 동작하는지 검증할 때.

---

## 출처 (Provenance)

`receiving-code-review`와 `test-driven-development`는 [obra/superpowers](https://github.com/obra/superpowers) v6.1.1에서 verbatim(원문 그대로) 벤더링되었습니다. `writing-skills`는 아래 재배선을 제외하면 원문과 동일합니다. 라이선스는 MIT (Copyright (c) 2025 Jesse Vincent)입니다.

**재배선(rewiring)**: `writing-skills` 원본은 여러 자매 superpowers 스킬을 플러그인-네임스페이스 참조로 가리켰습니다. superpowers 제거 후 매달린 참조를 남기지 않기 위해, 벤더링하면서 그 참조들을 전부 OMT 로컬 스킬로 재배선했습니다 — 총 8줄이며, 그 외 본문은 원문과 동일합니다:

- `superpowers:test-driven-development` → `test-driven-development` (SKILL.md 3곳 + testing-skills-with-subagents.md 1곳)
- `superpowers:systematic-debugging` → `diagnose` (SKILL.md 예시 1곳)
- `verification-before-completion`, `designing-before-coding` → `qa`, `prometheus` (SKILL.md 예시 1줄)
- `../subagent-driven-development` → `../test-driven-development` (render-graphs.js 도움말 2줄)

**출처 표기 위치**: 벤더된 스킬 파일 자체(`skills/test-driven-development/`, `skills/receiving-code-review/`, `skills/writing-skills/`)에는 출처를 표기하지 않습니다. 출처 추적은 이 문서에서만 담당합니다.

---

## 참고 자료

- [README](../../README.md) — 프로젝트 개요
- [핵심 파이프라인 스킬](./core-pipeline.md) — prometheus, sisyphus, sisyphus-junior
- [리뷰 & 품질 스킬](./review-quality.md) — code-review, qa 등
- [저작 스킬](./authoring.md) — 문서·슬라이드 생성
