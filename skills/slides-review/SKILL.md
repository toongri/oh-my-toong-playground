---
name: slides-review
description: Gemini CLI를 활용한 HTML 디자인 리뷰 스킬. 생성된 HTML 파일을 Gemini에게 전달하여 시각 디자인 개선 지침을 받고, 메인 세션에서 CSS/HTML을 수정한다. Gemini 불가 시 in-session fallback. 트리거: "디자인 리뷰", "gemini review", "design review", "디자인 검토", "디자인 보완", "slides review", "슬라이드 리뷰".
---

# Slides Review

## Overview

HTML 파일의 시각 디자인 품질을 Gemini CLI로 검토하고, 반환된 개선 지침을 메인 세션(Claude)이 직접 적용하는 스킬이다.
다른 스킬(예: `create-slides`)의 후처리 단계로 호출되거나, 사용자가 직접 호출할 수 있다.
에이전트(Gemini CLI)가 불가하거나 전원 실패하면 in-session fallback으로 직접 리뷰한다.

**핵심 원칙**: gemini CLI가 불가하면(`missing_cli` 등) 아무 일도 하지 않는 대신 in-session fallback으로 직접 리뷰한다. 진짜 quiet pass는 리뷰 대상 HTML 파일 경로가 유효하지 않은 경우뿐이다.

---

## Input

이 스킬은 아래 정보를 필요로 한다:

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| HTML 파일 경로 | Yes | 리뷰 대상 HTML 파일의 절대 경로 |
| 디자인 경로 | No | 사용된 디자인 스타일 (예: "frontend-design", "자체 심플", "직접 제공"). Gemini에게 맥락을 전달하여 디자인 방향에 맞는 리뷰를 유도한다 |
| 보호 규칙 | No | 호출자가 지정하는 수정 금지 항목 (예: scroll-snap, 특정 폰트) |

**호출 패턴:**

- **다른 스킬에서 호출**: 호출자가 파일 경로와 보호 규칙을 컨텍스트로 전달
- **사용자 직접 호출**: 대화에서 HTML 파일 경로를 파악하거나 AskUserQuestion으로 확인

---

## Workflow

### Step 1: HTML 파일 확인

리뷰 대상 HTML 파일 경로를 확인한다.
- 다른 스킬에서 호출 시: 호출자가 전달한 경로 사용
- 사용자 직접 호출 시: 대화 컨텍스트에서 파악하거나 AskUserQuestion으로 확인

### Step 2: 리뷰 Job 시작

**CRITICAL**: 모든 Bash 호출에 `timeout: 180000`을 설정한다.

프롬프트 파일을 작성하고 job을 시작한다:

```bash
PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" << 'PROMPT_EOF'
[HTML 파일 전체 내용을 여기에 포함]

Design path used: {design-path}
PROMPT_EOF
JOB_DIR=$(bun ${CLAUDE_SKILL_DIR}/scripts/job.ts start --stdin < "$PROMPT_FILE")
```

- HTML 파일 전문을 Read 도구로 읽은 뒤 프롬프트 파일에 포함
- 디자인 경로가 없으면 `Design path used:` 행 생략
- JOB_DIR이 stdout에 출력됨

**`start` 실패 시 in-session fallback**: `start`가 non-zero로 종료되거나 `$JOB_DIR`이 비어 있으면 Steps 3–5(collect/clean 없음)를 건너뛰고, `prompts/default.md`를 READ한 뒤 그 페르소나가 되어 in-session으로 HTML 디자인 리뷰를 수행한다. stderr에 `to dispatch`가 포함된 경우(멤버 0개 — 예상된 경로)는 조용히 fallback으로 진입한다. 그 외 non-zero 종료(디스크/권한 오류, spawn 실패 등 예상치 못한 실패)는 실패 사유(stderr 한 줄)를 출력한 뒤 in-session fallback을 수행한다.

### Step 3: 결과 수집

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/job.ts collect "$JOB_DIR"
```

- `"overallState": "done"` → Step 4로 진행
- `"running"` / `"queued"` → `collect` 재호출 (동일 명령)
- 멤버 상태가 `missing_cli` / `error` / `timed_out` / `canceled` / `non_retryable` → **in-session fallback** (아래 참조). "unavailable"로 끝내지 않는다.
- 멤버 상태가 `awaiting_resume` 이거나 내용이 비-답변(플랜/프레이밍/대기 패턴) → `resume-member`로 완답을 이끌어낸다 (최대 3회). cap 소진 또는 실패 시 **in-session fallback**.

**in-session fallback 진입 시**: `prompts/default.md`를 READ하고 그 페르소나가 되어 in-session으로 HTML 디자인 리뷰를 수행한다. fallback 전에 `clean`을 먼저 실행하지 않는다 — `clean`은 모든 처리가 끝난 마지막 단계다.

### Step 4: 지침 적용

collect 결과의 manifest에서 gemini의 `outputFilePath`를 Read 도구로 읽는다.

Gemini가 반환한 개선 지침을 **그대로** Edit 도구로 CSS/HTML에 적용한다.

**적용 원칙:**
- Gemini의 지침을 있는 그대로 적용한다. Claude가 자체 판단으로 지침을 필터링하거나 추가 보정하지 않는다.
- 각 지침의 Target(셀렉터)을 HTML에서 찾아 Fix에 명시된 값을 정확히 반영한다.
- 지침에 없는 추가 개선을 임의로 수행하지 않는다.

**호출자 보호 규칙만 예외:**
호출자가 보호 규칙을 전달한 경우, 해당 규칙에 **정확히** 위배되는 지침만 제외한다.

### Step 5: 정리 및 보고

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/job.ts clean "$JOB_DIR"
```

**주의**: `clean`은 모든 처리가 끝난 마지막 단계다. quiet pass로 빠져나온 경우도 마찬가지로 `clean`을 호출해 임시 파일을 정리한다.

적용 완료 후 사용자에게 간략히 요약:

```
Gemini 디자인 리뷰 반영: {적용 항목 수}/{전체 지침 수}건 적용
- {적용한 항목 1줄 요약}
...
```

quiet pass인 경우 아무것도 출력하지 않는다.

---

## Quiet Pass 조건

아래 경우에서 에러 없이 조용히 건너뛴다:

| 조건 | 동작 |
|------|------|
| HTML 파일 경로가 유효하지 않음 | 즉시 종료, 메시지 없음 |

## In-Session Fallback 조건

아래 경우에서 `prompts/default.md`를 읽고 in-session 리뷰를 수행한다:

| 조건 | 동작 |
|------|------|
| `start` 비정상 종료 / `$JOB_DIR` 빔 (멤버 없음) | Steps 3–5 생략, in-session fallback 즉시 진입 (clean 없음) |
| `gemini` CLI 미설치 (`missing_cli` 상태) | in-session fallback 수행 후 `clean` |
| Gemini 호출 타임아웃 (`timed_out` 상태) | in-session fallback 수행 후 `clean` |
| Gemini 호출 에러 (`error` 상태) | in-session fallback 수행 후 `clean` |
| `awaiting_resume` — resume cap 소진 또는 전원 실패 | in-session fallback 수행 후 `clean` |

---

## Anti-Patterns

- Claude가 Gemini 지침을 자체 판단으로 필터링하거나 추가 보정하지 않는다 -- 보호 규칙 위반 외에는 전부 적용
- 한 번에 전체 `<style>` 블럭을 교체하지 않는다 -- 개별 CSS 속성 단위로 Edit
- Gemini 설치를 사용자에게 권유하지 않는다
- 리뷰 실패를 에러로 취급하지 않는다 -- 이 스킬은 항상 "성공"으로 종료

---

## Reference Files

- `review.config.yaml`: Gemini 리뷰어 설정 (command, model, timeout)
- `scripts/job.ts`: Job 매니저 (start/collect/clean). generic-job.ts 프레임워크 기반 thin wrapper.
- `scripts/worker.ts`: Gemini CLI 워커. worker-utils.ts 기반.
- `prompts/gemini.md`: Gemini에 전달하는 디자인 리뷰 시스템 프롬프트. 리뷰 기준 6가지, 출력 포맷(Target/Issue/Fix), 제약 조건 정의.
- `prompts/default.md`: in-session fallback 페르소나 프롬프트 — 에이전트 불가 시 in-session fallback에서 로드. 동일한 리뷰 기준 6가지 + 직접 Edit 적용 지침.
