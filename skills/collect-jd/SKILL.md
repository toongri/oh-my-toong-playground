---
name: collect-jd
description: Use when collecting, curating, or organizing job descriptions (JDs) — triggers include "JD 모으고 있어", "JD 수집", "JD 큐레이션", "JD 정리하고 있어", "오늘 수집 정리해줘", "오늘 본 JD", "관리 중인 JD", "쌓아둔 JD", "내 프로필에 맞는 JD 쌓아줘", "내 이력에 맞는 JD 큐레이션", and "싹 돌려" (in JD rescan context). Do NOT trigger on discovery phrases claimed by resume-apply ("JD 찾아줘", "JD 골라줘", "공고 뭐 있지", "지원할 곳", "어디 넣을까") — those belong to resume-apply. Skill maintains project-scoped state at `$OMT_DIR/collect-jd/` (never global).
---

# collect-jd

JD 수집·큐레이션·정리 전담 스킬. 구체 규칙은 Phase B pressure scenario 사이클을 통해 추가된다 (TDD RED-GREEN-REFACTOR).

## Scope Boundary

- collect-jd: JD **탐색·수집·큐레이션·정리** (이 스킬)
- resume-apply: 이미 기록된 JD를 **소비**하는 스킬 (이 스킬 관여 안 함)
- review-resume: 이력서 리뷰 (이 스킬 관여 안 함)
- resume-forge: 이력서 소재 발굴 (이 스킬 관여 안 함)

## State Location

- Project-scoped: `$OMT_DIR/collect-jd/` 만 사용
- Global scope 금지 (`~/.omt/global/collect-jd/` 생성 금지)
- `$OMT_DIR` unset 시 abort (자체 fallback 금지)

## Ingest Paths (5)

1. URL 직접 입력
2. 텍스트 복붙
3. 파일 · 폴더 경로
4. 회사명 (단, `sources.yaml` 등록 사이트 내에서만)
5. 배치 재스캔 ("싹 돌려")

이후 Phase B TODO 들에서 세부 규칙이 추가된다.

## Phase 0: Profile Interview Required (MANDATORY)

Before ANY JD ingest (URL · text · file · company name · batch rescan), check for `$OMT_DIR/collect-jd/profile/profile.yaml`.

**If `profile.yaml` is absent:**

1. **Halt ingest immediately.** Do not call WebFetch, do not write JD files.
2. Run a **3-round minimum** profile interview using `AskUserQuestion`. Each round covers one of:
   - Round 1 — **경력 · 현재 역할 · 연차 · 선호 도메인**
   - Round 2 — **기술 스택 · 강점 · 학습 중인 영역**
   - Round 3 — **회사 · 연봉 · 지역 · 원격 여부 · exclude signal 취향**
3. Write `$OMT_DIR/collect-jd/profile/profile.yaml` atomically (temp + rename). YAML 에 `version: 1` 필드 포함. 각 round 답변을 해당 섹션에 매핑.
4. After `profile.yaml` exists, **resume** the original ingest request.

**If `profile.yaml` exists:** proceed to ingest normally.

### Rationalization Loopholes (MUST REJECT)

These patterns are **explicit violations** regardless of how they are phrased:

- "유저가 이미 URL 을 줬으니까 수집 먼저, 인터뷰는 나중" — ❌ 인터뷰 먼저.
- "대충 기본값으로 profile.yaml 만들고 수집 진행" — ❌ 반드시 유저 답변 기반.
- "한 번만 건너뛰기" / "이번엔 급하니까" — ❌ 예외 없음.
- "profile.yaml 없지만 유저가 재촉해서 수집 강행" — ❌ 재촉은 인터뷰 중단 사유 아님.
- "이미 profile 있는 것처럼 간주하고 진행" — ❌ 파일 실재 여부만 판단 기준.

Profile interview 의 목적은 이후 matching 이 `history → rules → filter` 로 안정되게 작동하도록 하는 것이다. 건너뛰면 S3 (ambiguity predicate) 결과가 쓰레기가 되어 유저에게 무의미한 질문만 쏟아진다.
