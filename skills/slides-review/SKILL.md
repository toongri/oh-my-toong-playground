---
name: slides-review
description: Gemini CLI를 활용한 HTML 디자인 리뷰 스킬. 생성된 HTML 파일을 Gemini에게 전달하여 시각 디자인 개선 지침을 받고, 메인 세션에서 CSS/HTML을 수정한다. gemini CLI 미설치 시 quiet pass. 트리거: "디자인 리뷰", "gemini review", "design review", "디자인 검토", "디자인 보완", "slides review", "슬라이드 리뷰".
---

# Slides Review

## Overview

HTML 파일의 시각 디자인 품질을 Gemini CLI로 검토하고, 반환된 개선 지침을 메인 세션(Claude)이 직접 적용하는 스킬이다.
다른 스킬(예: `create-slides`)의 후처리 단계로 호출되거나, 사용자가 직접 호출할 수 있다.

**핵심 원칙**: gemini CLI가 없으면 아무 일도 하지 않는다 (quiet pass).

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
JOB_DIR=$(bun .claude/skills/slides-review/scripts/job.ts start --stdin < "$PROMPT_FILE")
```

- HTML 파일 전문을 Read 도구로 읽은 뒤 프롬프트 파일에 포함
- 디자인 경로가 없으면 `Design path used:` 행 생략
- JOB_DIR이 stdout에 출력됨

### Step 3: 결과 수집

```bash
bun .claude/skills/slides-review/scripts/job.ts collect "$JOB_DIR"
```

- `"overallState": "done"` → Step 4로 진행
- `"running"` / `"queued"` → `collect` 재호출 (동일 명령)
- 멤버 상태가 `missing_cli` → **quiet pass** (Step 5로 직행, 지침 적용 없음)
- 멤버 상태가 `error` / `timed_out` → **quiet pass** (기존 HTML 유지)

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
bun .claude/skills/slides-review/scripts/job.ts clean "$JOB_DIR"
```

적용 완료 후 사용자에게 간략히 요약:

```
Gemini 디자인 리뷰 반영: {적용 항목 수}/{전체 지침 수}건 적용
- {적용한 항목 1줄 요약}
...
```

quiet pass인 경우 아무것도 출력하지 않는다.

---

## Quiet Pass 조건

아래 **모든 경우**에서 에러 없이 조용히 건너뛴다:

| 조건 | 동작 |
|------|------|
| `gemini` CLI 미설치 (`missing_cli` 상태) | 즉시 종료, 메시지 없음 |
| Gemini 호출 타임아웃 (`timed_out` 상태) | 기존 HTML 유지, 메시지 없음 |
| Gemini 호출 에러 (`error` 상태) | 기존 HTML 유지, 메시지 없음 |
| HTML 파일 경로가 유효하지 않음 | 즉시 종료, 메시지 없음 |

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
