# Git-Committer Application Test Scenarios

## Overview

git-committer 스킬의 핵심 기법(technique)이 올바르게 적용되는지 검증하는 Application 시나리오.

각 시나리오는 실제 입력 → 기대 출력을 명시하며, 스킬이 로드된 상태에서 검증한다.

### Evaluation Criteria

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point fully met |
| PARTIAL | Mentioned but insufficient or incorrect framing |
| FAIL | Not mentioned or wrong judgment |

---

## Scenario GC-1: Iron Law — All 4 Rules Verification

**Input**: `git status` shows staged changes (1 modified file), tests pass, build succeeds, message fits 50 chars

**Primary Technique**: Iron Law — tests pass + build succeeds + single change + ≤50 chars

**Verification**:
- V1: 테스트 통과 확인 절차 수행 (또는 확인 요청)
- V2: 빌드 성공 확인 절차 수행
- V3: staged 변경이 단일 논리적 변경인지 확인
- V4: 생성된 커밋 메시지가 50자 이내
- V5: 4가지 조건 모두 충족 시에만 커밋 진행

---

## Scenario GC-2: Korean 명사형 종결 Format

**Input**: 로그인 API 엔드포인트 추가 (AuthController.kt 신규 파일)

**Primary Technique**: Korean 명사형 종결 + type prefix

**Verification**:
- V1: 커밋 메시지가 한국어로 작성됨
- V2: 명사형 종결 사용 (예: "feat: 로그인 API 엔드포인트 추가")
- V3: 과거형("추가했습니다") 또는 존대체("추가합니다") 미사용
- V4: type prefix 포함 (feat:)

---

## Scenario GC-3: Commit Type Classification — Correct Type Selection

**Input**: 4가지 변경 시나리오를 순차적으로:
- (a) NullPointerException 버그 수정
- (b) 새로운 결제 모듈 추가
- (c) UserService 메서드 추출 리팩토링
- (d) UserServiceTest 테스트 케이스 추가

**Primary Technique**: Type Classification — feat/fix/refactor/test/docs/chore

**Verification**:
- V1: 버그 수정 → `fix:` prefix
- V2: 새 기능 → `feat:` prefix
- V3: 리팩토링 → `refactor:` prefix
- V4: 테스트 추가 → `test:` prefix

---

## Scenario GC-4: Subject Line ≤ 50 Characters

**Input**: 복잡한 변경 — "사용자 인증 토큰 만료 시 자동 갱신 로직 및 리프레시 토큰 저장소 구현"

**Primary Technique**: Subject ≤ 50 chars

**Verification**:
- V1: Subject line이 type prefix 포함 50자 이내
- V2: 핵심만 압축 (예: "feat: 인증 토큰 자동 갱신 구현")
- V3: 상세 설명이 필요하면 body에 작성
- V4: 50자를 초과하는 메시지를 그대로 사용하지 않음

---

## Scenario GC-5: Workflow Files Exclusion

**Input**: `git status` shows staged files including:
- `src/auth/AuthService.kt` (소스 코드)
- `.omt/plans/auth-plan.md` (워크플로우 파일)
- `docs/specs/auth-spec.md` (스펙 문서)

**Primary Technique**: Workflow Files Exclusion — .omt/plans/, research.md, docs/specs/*

**Verification**:
- V1: `.omt/plans/auth-plan.md` 감지 및 unstage
- V2: `docs/specs/auth-spec.md` 감지 및 unstage
- V3: `src/auth/AuthService.kt`만 커밋 대상
- V4: unstage 이유 설명

---

## Scenario GC-6: Commit Conventions — Subject/Body/Footer

**Input**: 대규모 리팩토링으로 body 설명이 필요한 변경

**Primary Technique**: Commit Conventions — subject + blank line + body (72-char wrap) + footer

**Verification**:
- V1: Subject line (type: 설명) 포맷
- V2: Subject과 body 사이 빈 줄
- V3: Body 각 줄 72자 줄바꿈
- V4: HEREDOC 형식으로 커밋 실행

---

## Scenario GC-7: Breaking Change Notation

**Input**: API 메서드 시그니처 변경 (파라미터 타입 변경으로 하위 호환성 깨짐)

**Primary Technique**: Breaking Change — feat! or BREAKING CHANGE: footer

**Verification**:
- V1: type에 `!` 추가 (예: `feat!:`) 또는 footer에 `BREAKING CHANGE:` 포함
- V2: breaking change 내용 설명 포함
- V3: 일반 `feat:`로 처리하지 않음

---

## Scenario GC-8: Git Trailers

**Input**: 페어 프로그래밍으로 작성된 코드 또는 이슈 번호 참조 필요

**Primary Technique**: Git Trailers — Co-authored-by, Signed-off-by, Fixes #

**Verification**:
- V1: Trailer 형식 올바름 (`Key: Value`)
- V2: Body와 trailer 사이 빈 줄 존재
- V3: 적절한 trailer 사용 (Co-authored-by, Fixes # 등)

---

## Scenario GC-9: Single Logical Change — Split Detection

**Input**: `git diff` shows:
- AuthService.kt에 로그인 버그 수정 (fix)
- UserService.kt에 무관한 네이밍 리팩토링 (refactor)

**Primary Technique**: Single logical change — one commit = one logical unit

**Verification**:
- V1: 혼합된 변경사항 감지 (fix + refactor)
- V2: 분리 커밋 제안 (fix 먼저, refactor 별도)
- V3: 한 커밋에 무관한 변경을 합치지 않음
- V4: 분리 방법 안내 (`git add -p` 또는 파일 단위 분리)

---

## Test Results

### GREEN Test — 2026-02-10

**Model**: claude-sonnet-4-5-20250929
**Skill Version**: Post-Phase 0 (Red Flags + Rationalization Table 제거 후)

| Scenario | V1 | V2 | V3 | V4 | V5 | Overall |
|----------|-----|-----|-----|-----|-----|---------|
| GC-1: Iron Law | PASS | PASS | PASS | PASS | PASS | **PASS** |
| GC-2: Korean 명사형 종결 | PASS | PASS | PASS | PASS | — | **PASS** |
| GC-3: Type Classification | PASS | PASS | PASS | PASS | — | **PASS** |
| GC-4: Subject ≤ 50 chars | PASS | PASS | PASS | PASS | — | **PASS** |
| GC-5: Workflow Files | PASS | PASS | PASS | PASS | — | **PASS** |
| GC-6: Subject/Body/Footer | PASS | PASS | PASS | PASS | — | **PASS** |
| GC-7: Breaking Change | PASS | PASS | PASS | — | — | **PASS** |
| GC-8: Git Trailers | PASS | PASS | PASS | — | — | **PASS** |
| GC-9: Split Detection | PASS | PASS | PASS | PASS | — | **PASS** |

**Result: 9/9 scenarios PASS — All verification points met.**

**Notes**:
- Phase 0에서 Red Flags, Rationalization Table 섹션을 제거했으나 기법 지침(Iron Law, Non-Negotiable Rules)이 충분히 행동을 가이드함
- 모든 시나리오에서 스킬 개선 없이 첫 실행에서 PASS
- SKILL.md 수정 불필요 — 기존 technique 섹션이 충분
