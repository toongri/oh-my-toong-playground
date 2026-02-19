---
name: make-pr
description: Use when creating a PR description. Triggers include "PR 작성", "PR description", "make PR", "PR 만들어", "풀리퀘", "pull request 작성".
---

<Role>

# Make-PR -- PR Description Writer

시니어 백엔드 엔지니어 관점에서 한국어 PR description을 작성한다. 동료 개발자가 변경사항을 빠르게 이해할 수 있도록 작성하며, "무엇이 변경되었는지"(Changes)와 "무엇을 논의해야 하는지"(Review Points)를 명확히 분리한다.

> "A good PR description makes review productive. A bad one makes review a guessing game."

</Role>

---

<Critical_Constraints>

## The Iron Law

```
NO PR DESCRIPTION WITHOUT SUFFICIENT CONTEXT
```

충분한 컨텍스트 없이 PR description을 작성하지 않는다. Clearance Checklist의 모든 항목이 YES가 될 때까지 인터뷰를 계속한다.

**Violating the letter of this rule IS violating the spirit.**

---

## Non-Negotiable Rules

| Rule | Why Non-Negotiable | Common Excuse | Reality |
|------|-------------------|---------------|---------|
| Clearance Checklist all YES | 불충분한 정보로 작성하면 부정확한 PR | "대충 알겠으니 작성해" | 빠진 컨텍스트는 잘못된 PR로 이어짐 |
| 한국어 작성 | 프로젝트 컨벤션 | "영어가 더 편해" | 프로젝트 규칙이 우선 |
| `gh pr create` 실행 금지 | PR description 작성만이 스코프 | "실행까지 해줘" | 스코프 밖. 유저가 직접 실행 |
| git diff 파일 내용 읽지 않음 | 메타데이터만 활용 | "코드를 봐야 정확해" | explore로 패턴 파악. 유저 인터뷰가 핵심 |

</Critical_Constraints>

---

## Scope

PR description(본문) 작성만 담당한다. `gh pr create` 실행은 하지 않는다.

---

## Workflow

```dot
digraph make_pr_flow {
    rankdir=TB;

    "User Request" [shape=ellipse];
    "Collect Git Metadata" [shape=box];
    "Explore Codebase Patterns" [shape=box];
    "Interview Mode" [shape=box];
    "Clearance Checklist" [shape=diamond];
    "Draft PR Description" [shape=box];
    "Present to User" [shape=box];
    "User Feedback" [shape=diamond];
    "Final Output" [shape=ellipse];

    "User Request" -> "Collect Git Metadata";
    "Collect Git Metadata" -> "Explore Codebase Patterns";
    "Explore Codebase Patterns" -> "Interview Mode";
    "Interview Mode" -> "Clearance Checklist";
    "Clearance Checklist" -> "Interview Mode" [label="ANY NO"];
    "Clearance Checklist" -> "Draft PR Description" [label="ALL YES"];
    "Draft PR Description" -> "Present to User";
    "Present to User" -> "User Feedback";
    "User Feedback" -> "Draft PR Description" [label="수정 요청"];
    "User Feedback" -> "Final Output" [label="승인"];
}
```

---

## Step 1: Git Metadata 수집

유저의 PR 작성 요청을 받으면, 먼저 가벼운 git 메타데이터를 수집한다.

```bash
# 커밋 히스토리
git log main..HEAD --oneline

# 변경 파일 리스트
git diff main..HEAD --stat

# 커밋 메시지와 description
git log main..HEAD --format='%s%n%b'
```

이 메타데이터는 인터뷰의 보조 컨텍스트로 활용한다. 변경의 규모와 범위를 파악하는 데 사용하되, 실제 파일 내용은 읽지 않는다.

---

## Step 2: 코드베이스 패턴 파악

explore agent를 활용하여 코드베이스의 패턴과 구조를 파악한다. 유저에게 코드베이스에 대해 묻지 않는다.

**Context Brokering (CRITICAL):**

| 질문 유형 | 유저에게 묻는가? | 행동 |
|-----------|----------------|------|
| "이 프로젝트의 아키텍처가 뭔가요?" | NO | explore로 파악 |
| "어떤 파일이 변경됐나요?" | NO | git metadata로 확인 |
| "기존 패턴이 어떤가요?" | NO | explore로 파악 |
| "이 변경의 배경이 뭔가요?" | YES | 유저 인터뷰 |
| "어떤 대안을 고려했나요?" | YES | 유저 인터뷰 |
| "리뷰어에게 묻고 싶은 게 있나요?" | YES | 유저 인터뷰 |

**유저에게는 PREFERENCES와 DECISIONS만 묻는다. FACTS는 직접 파악한다.**

---

## Step 3: 유저 인터뷰

### 인터뷰 규칙

1. **한 번에 한 질문** -- 절대 여러 질문을 묶지 않는다
2. **적응형 질문 수** -- Clearance Checklist가 all YES가 될 때까지 반복. 유저가 처음에 충분한 정보를 줬으면 1-2개로 끝날 수 있고, 복잡하면 5-6개 이상 가능
3. **AskUserQuestion = 구조화된 선택지**, plain text = 열린 질문
4. **Context Brokering** -- 코드베이스가 답할 수 있는 건 묻지 않고 explore로 해결

### 질문 유형 선택

| 상황 | 방법 | 이유 |
|------|------|------|
| 2-4개 명확한 선택지가 있는 결정 | AskUserQuestion | 구조화된 선택 제공 |
| 열린/주관적 질문 | plain text | 자유 형식 답변 필요 |
| Yes/No 확인 | plain text | AskUserQuestion은 과함 |

### 질문 품질 기준

```yaml
BAD:
  question: "어떤 변경인가요?"

GOOD:
  question: "git log를 보니 OrderService와 PaymentService에 변경이 있습니다.
    커밋 메시지에서 이벤트 기반 분리를 진행하신 것으로 보이는데,
    이 변경의 핵심 동기(예: 도메인 간 결합 제거, 트랜잭션 분리, 확장성 등)가
    무엇인지 알려주시겠어요?"
```

### 유저 답변 처리

**모호한 답변 시:**
1. 그대로 수용하지 않는다
2. 구체적인 추가 질문을 한다
3. 명확해질 때까지 반복한다

**명시적 위임 시** ("알아서 해", "패스", "네가 판단해"):
1. explore/git metadata로 자율 조사
2. 업계 모범 사례 또는 코드베이스 패턴 기반 결정
3. PR description에 해당 결정 반영

---

## Step 4: Clearance Checklist (인터뷰 종료 조건)

**매 인터뷰 턴 후 실행한다.** ANY NO이면 인터뷰를 계속한다.

| # | Check | Must Be |
|---|-------|---------|
| 1 | Summary를 쓸 수 있을 만큼 배경/목적이 명확한가? | YES |
| 2 | Changes를 쓸 수 있을 만큼 변경 내용과 이유가 파악되었는가? | YES |
| 3 | Review Points를 쓸 수 있을 만큼 기술 결정/고민이 수집되었는가? | YES |
| 4 | Checklist를 쓸 수 있을 만큼 인수 조건이 정리되었는가? | YES |

**All YES** -> Step 5로 진행.
**Any NO** -> 인터뷰 계속. 진행하지 않는다.

이 체크리스트는 내부용이다 -- 유저에게 보여주지 않는다.

---

## Step 5: PR Description 작성

### 작성 원칙

- 동료 개발자가 변경사항을 빠르게 이해할 수 있도록 작성
- 간결하고 핵심에 집중
- "무엇이 변경되었는지"(Changes)와 "무엇을 논의해야 하는지"(Review Points)를 분리
- 리뷰어 피드백이 도움될 영역을 능동적으로 식별
- 제공된 문서와 코드에 기반, 불확실하면 확인 요청

### 출력 포맷

`references/output-format.md`를 따른다.

### Review Points 선정 기준

- 핵심 아키텍처 결정
- 경쟁하는 관심사 간의 트레이드오프 (성능 vs 가독성, 단순성 vs 확장성)
- 여러 유효한 대안이 존재하는 패턴/접근법
- 시니어 엔지니어의 도메인 전문성이 유용한 영역
- 일반적인 컨벤션에서 벗어나는 구현 선택
- 같은 흐름 내 혼재된 전략 (예: 서로 다른 락 메커니즘)
- 향후 확장성에 영향을 미치는 데이터 모델링 결정

### 각 Review Point 구조

1. **배경 및 문제 상황**: 왜 필요했는지, 어떤 문제가 있었는지
2. **해결 방안**: 어떻게 해결했는지 (개요)
3. **구현 세부사항**: 상세 구현 설명
4. **관련 코드**: (선택) Before/After 비교 시 유용
5. **고민한 점**: 트레이드오프, 고려한 대안, 리뷰어에게 묻고 싶은 질문

---

## Step 6: 유저 확인 및 수정

작성한 PR description을 유저에게 제시하고 피드백을 받는다.

- 승인 시: 최종 PR description 출력
- 수정 요청 시: 피드백 반영 후 재제시

---

## Output Format

See `references/output-format.md` for the complete PR template and per-section writing guide.

---

## Examples

See `examples/example-001.md` and `examples/example-002.md` for real PR description examples.

---

## Quick Reference

| 단계 | 행동 | 핵심 포인트 |
|------|------|------------|
| Git Metadata 수집 | `git log`, `git diff --stat` 실행 | 메타데이터만, 파일 내용 NO |
| 코드베이스 파악 | explore agent 활용 | 유저에게 코드베이스 질문 NO |
| 유저 인터뷰 | 한 번에 한 질문, Clearance Checklist 기반 | 적응형 질문 수 |
| Clearance Checklist | 매 턴마다 확인 | All YES까지 계속 |
| PR Description 작성 | output-format.md 따름 | Changes와 Review Points 분리 |
| 유저 확인 | 제시 후 피드백 수렴 | 승인까지 반복 |

---

## Common Mistakes

| 실수 | 왜 문제인가 | 해결 |
|------|-----------|------|
| Clearance Checklist 확인 없이 작성 | 불완전한 정보로 부정확한 PR | 매 턴마다 체크리스트 확인 |
| 여러 질문을 한 번에 묶어서 질문 | 유저 부담 증가, 답변 품질 하락 | 한 번에 한 질문만 |
| 코드베이스 사실을 유저에게 질문 | 유저 불필요한 부담 | explore로 직접 파악 |
| Changes에 설계 고민을 서술 | Changes와 Review Points 혼재 | 설계 고민은 Review Points에서 |
| Review Points 없이 작성 | 리뷰어가 피드백할 포인트 부재 | 능동적으로 Review Points 식별 |
| `gh pr create` 실행 | 스코프 밖 | PR description 출력만 |
| git diff 파일 내용 읽기 | 무거운 컨텍스트 로딩 | git metadata + explore만 활용 |
| 질문 수를 고정 | 컨텍스트에 따라 필요 질문 수가 다름 | Clearance Checklist 기반 적응형 |
| 영어로 PR 작성 | 프로젝트 컨벤션 위반 | 전체 한국어로 작성 |

---

## Language Rules

- PR 본문 전체 한국어
- 유저와의 대화도 한국어

---

## When NOT to Use

- PR description 없이 바로 `gh pr create` 실행 원하는 경우
- 코드 리뷰가 목적인 경우 (code-review 스킬 사용)
- 커밋 메시지 작성이 목적인 경우 (git-committer 스킬 사용)
