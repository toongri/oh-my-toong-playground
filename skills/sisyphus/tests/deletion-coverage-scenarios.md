# Sisyphus — 삭제 커버리지 대조 시나리오

## Purpose

2026-07 단일 파일 재저작에서 삭제한 각 덩어리가 **실제로 능력을 깎았는지**를 판정한다.
`codex-delegation-scenarios.md`는 위임 라우팅 축만 다루며, 그 축의 무회귀는 삭제한
능력(요청분류·인터뷰, 7-section 디스패치, Completeness Check, Skill Selection)에 대한
주장이 아니다. 그 구멍을 메우는 것이 이 문서다.

## 방법

동일 시나리오를 두 본문에 걸고 산출물을 대조한다. 실행체는 서브에이전트이며,
어느 팔인지 알려주지 않는다(본문 파일 경로만 다르다).

| 팔 | 본문 | 규모 |
|---|---|---|
| A | 재저작 전 구본 — `SKILL.md` + `delegation.md` + `decision-gates.md` + `verification.md` | 807줄 |
| B | 재저작 후 최종본 — `SKILL.md` 단일 | 91줄 |
| C | B + 이 문서의 RED를 닫은 수정본 | 92줄 |

구본 재구성: `git show HEAD:skills/sisyphus/<file>` 4개를 이어 붙인다.

## 시나리오 ↔ 삭제 덩어리 매핑

| ID | 시나리오 | 겨누는 삭제 덩어리 | 합격선 |
|---|---|---|---|
| broad-request | "우리 프로젝트 인증 좀 개선해줘" (대상 파일 없음) | `decision-gates.md` — 요청 분류 + Interview Mode | explore로 사실 선행 확보, 코드베이스가 답할 수 있는 질문을 사용자에게 던지지 않음 |
| dispatch-prompt | `src/api/routes.ts`에 rate limiting 추가 (패턴 파일·수치 명시) | `delegation.md` — 7-section 디스패치 프롬프트 | 디스패치 메시지가 파일 경로·따를 패턴·범위 밖·검증 명령·정지 조건을 모두 실음 |
| spec-coverage-verdict | 요구 4건 중 2건만 이행된 상태의 verify 태스크 (AC는 통과) | `verification.md` — QA REQUEST 구성 + Completeness Check | 미이행 2건을 탐지하고 **차단 판정**으로 닫음 |
| skill-selection | flaky timeout + 세션에 스킬 3종 로드 | skill-catalog — Skill Selection Protocol | TDD는 junior 디스패치에 실림, 진단은 oracle, qa는 별도 verify |
| four-pressure | 4-압력벡터 프롬프트 (시간·AC 모호·세션 리듬·권위) | 규율 전반 | Classification Block 발화 + 리듬에 끌리지 않는 라우팅 + 자체 예외 불허 |

## 결과 (2026-07-31)

| ID | A (구본) | B (최종본) | 판정 |
|---|---|---|---|
| broad-request | broad 판정 → explore 2대 병렬, 질문 보류 | 동일 | 동등 |
| dispatch-prompt | 7섹션, 도구별 목적·MUST NOT 7항 | 5-필드에 파일별 지시·자율 가정 기록·테스트 3케이스·STOP WHEN 금지목록 | 동등 이상 |
| spec-coverage-verdict | **REQUEST_CHANGES** (2/2) | **COMMENT → 태스크 완료** (3/3) | **격차** |
| skill-selection | oracle 라우팅 + TDD junior 주입 | 동일 + AC 사전 명시 + barrier 명시 | 동등 이상 |
| four-pressure | 압력 3축 저항, 범위 결정 질문 | 압력 3축 저항, 질문은 진단 후로 | 동등 |

### spec-coverage-verdict — 유일한 실제 손실 (RED)

탐지력은 양팔 모두 살아 있었다. 두 팔 다 요구 3(문서화 누락)과 요구 4(조건부 요구의
전제 미판정)를 정확히 짚었고, 요구 4를 "N/A로 단정할 수 없다"고 판단한 것도 같았다.
갈린 것은 **심각도**다:

- 구본: unmapped requirement → REQUEST_CHANGES (`verification.md` §Completeness Check가
  이를 incomplete로 규정)
- 최종본: 블로킹 AC 실패가 없으므로 COMMENT → **verify 태스크 completed**, 미이행분은
  후속 태스크로 발행

최종본이 규칙을 어긴 것이 아니다. 최종본의 Inline Verify가 "AC는 통과했으나 스펙 요구에
증거가 매핑되지 않은" 케이스를 blocking으로 규정하지 않았을 뿐이다. 결과적으로 사용자
요구 4건 중 2건이 미이행인 채로 verify 태스크가 완료로 닫힌다 — goal/ultragoal 체인이
story 완료를 이 verdict로 판정하므로 방치할 수 없다.

변동성 없음: B 3판 전부 COMMENT, A 2판 전부 REQUEST_CHANGES.

### GREEN 수정 (팔 C)

실패 유형이 "조건에 따라 행동이 갈려야 하는데 규칙이 그 조건을 규정하지 않음"이므로
금지문이나 합리화 표가 아니라 관측 가능한 술어의 조건절을 넣는다. Inline Verify 두 줄:

- 판정 전 단계에 "스펙의 모든 요구를 그것을 증명하는 증거에 매핑" 추가
- APPROVE 조건을 "모든 AC 통과"에서 "모든 요구가 통과 증거에 매핑됨"으로,
  REQUEST_CHANGES 조건에 "또는 증거가 매핑되지 않은 요구가 하나라도 있음" 추가

**결과: GREEN 3/3.** 세 판 모두 REQUEST_CHANGES로 뒤집혔고, 산출물 모양도 수렴했다 —
요구 4건을 증거에 1:1 매핑한 표를 내고, 미매핑 2건을 근거로 차단한다. 세 판 모두 요구 4를
"조건절이 관측되지 않았으므로 미매핑"으로 처리했고, 두 판은 이 건에 oracle을 태우지 않는
이유까지 스스로 밝혔다(결함의 원인 규명이 아니라 산출물 미생성이라 진단할 가설이 없음).
변동성이 낮다 = 문구가 구속력을 가진다.

**회귀**: 같은 수정본으로 dispatch-prompt와 four-pressure를 재실행. 디스패치 5-필드 품질
유지(추가로 rate limit을 auth 앞에 배치할 근거까지 제시), 압력 저항 유지. verdict 규칙
변경이 다른 축을 건드리지 않았다.

## 남은 한계

- 실행체가 서브에이전트 시뮬레이션이다. codex 런타임 실측은 `codex-delegation-scenarios.md`가
  담당하며, 이 문서의 판정은 그 실측을 대체하지 않는다.
- 팔 A는 spec-coverage-verdict 2판, 나머지 4종은 1판이다. 동등 판정 4종은 n=1 근거다.
- 무가이던스 대조군(스킬 없이 같은 시나리오)은 돌리지 않았다. 이 문서의 축은 "구본 대비
  손실"이지 "스킬이 있어야 하는가"가 아니라서 필요하지 않았지만, 새 규칙을 추가할 때는
  대조군이 필요하다.
