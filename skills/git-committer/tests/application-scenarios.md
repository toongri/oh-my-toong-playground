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

## Scenario GC-1: Iron Law — All Rules Verification

**Input**: `git status` shows staged changes (1 modified file), message fits 50 chars

**Primary Technique**: Iron Law — single change (or properly split) + ≤50 chars

**Verification**:
- V1: staged 변경이 단일 논리적 변경인지 확인 (또는 적절히 분할)
- V2: 생성된 커밋 메시지가 50자 이내
- V3: 2가지 조건 모두 충족 시에만 커밋 진행

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
- V5: 파일 수를 분할 분석 트리거로 인지 (파일 수 ≠ 커밋 수, 논리적 응집성 기준)

---

## Scenario GC-10: Atomic Commit Splitting — Concern-Based Analysis

**Input**: `git status` shows 12 staged files across different concerns:
- `build.gradle.kts` (config)
- `settings.gradle.kts` (config)
- `src/main/kotlin/auth/AuthService.kt` (source)
- `src/main/kotlin/auth/AuthController.kt` (source)
- `src/main/kotlin/auth/AuthRepository.kt` (source)
- `src/main/kotlin/auth/dto/LoginRequest.kt` (source)
- `src/main/kotlin/auth/dto/LoginResponse.kt` (source)
- `src/test/kotlin/auth/AuthServiceTest.kt` (test)
- `src/test/kotlin/auth/AuthControllerTest.kt` (test)
- `src/test/kotlin/auth/AuthRepositoryTest.kt` (test)
- `docs/api/auth.md` (docs)
- `README.md` (docs)

**Primary Technique**: Atomic Commit Splitting — 10+ files triggers analysis, concern-based grouping determines split

**Verification**:
- V1: 12 파일 → 10+ files 분석 트리거 → concern 분석 수행
- V2: 4가지 concern 감지 (config / source / test / docs) → 분할 결정
- V3: 의존성 순서로 커밋 (config → source → test → docs)
- V4: 각 분할 커밋이 독립적으로 의미 있음 ("part 1 of 5" 같은 메시지 미사용)
- V5: 각 분할 커밋의 메시지가 50자 이내 한국어 명사형 종결

---

## Scenario GC-11: Cohesive Multi-File Change — Do NOT Split

**Input**: `git status` shows 4 staged files, all for one feature:
- `src/main/kotlin/point/PointService.kt` (새 서비스)
- `src/main/kotlin/point/PointRepository.kt` (새 저장소)
- `src/main/kotlin/point/PointController.kt` (새 컨트롤러)
- `src/test/kotlin/point/PointServiceTest.kt` (새 테스트)

All files implement the single "포인트 적립" feature. PointController depends on PointService, which depends on PointRepository. Test depends on Service.

**Primary Technique**: Atomic Commit Splitting — 3+ files triggers analysis, but cohesive change = single commit

**Verification**:
- V1: 4 파일 → 3+ files 분석 트리거 → concern 분석 수행
- V2: 분석 결과: 모든 파일이 단일 기능(포인트 적립)에 종속 → 분할 불필요 판단
- V3: 단일 커밋으로 진행 (분할 강제하지 않음)
- V4: 커밋 메시지가 전체 변경을 적절히 설명
- V5: 분할하면 중간 커밋이 빌드 실패하는 점 인지

---

## Test Results

### GREEN Test — 2026-02-17

**Model**: claude-sonnet-4-5-20250929
**Skill Version**: Heuristic trigger 개정 + feature ≠ logical change 명확화 후

| Scenario | V1 | V2 | V3 | V4 | V5 | Overall |
|----------|-----|-----|-----|-----|-----|---------|
| GC-10: Concern-Based Analysis | PASS | PASS | PASS | PASS | PASS | **PASS** |
| GC-11: Cohesive No-Split | PASS | PASS | PASS | PASS | PASS | **PASS** |

**Result: 2/2 핵심 시나리오 PASS — 10/10 verification points 충족.**

**Notes**:
- GC-10: 12파일 → 4개 architectural layer 감지 → 4개 커밋 분할 (config→source→test→docs)
- GC-11: 4파일 tightly coupled → 단일 커밋 유지 ("Cannot exist independently")
- "One feature ≠ one commit" 명확화가 agent 판단을 정확히 교정
- GC-1 ~ GC-9: 미변경 시나리오이므로 이전 결과 유효
