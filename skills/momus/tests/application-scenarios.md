# Momus Skill — Application Test Scenarios

## Purpose

These scenarios test whether the momus skill's **core techniques** are correctly applied. Each scenario targets simulation protocol, reference verification, four-criteria evaluation, and verdict format compliance.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| MO-1 | Simulation Protocol | 단계별 시뮬레이션으로 숨겨진 모호성 발견 | Action sequence 식별 |
| MO-2 | Reference Verification | 구체적 참조 수용 / 모호한 참조 거부 | Codebase 접근 불가 시 평가 |
| MO-3 | Four Criteria — Full Pass | 4개 기준 전체 통과 평가 | OKAY 판정 |
| MO-4 | Four Criteria — Partial Fail | Verifiability/Completeness 실패 감지 | REJECT 판정 + 개선안 |
| MO-5 | Final Verdict Format | 출력 형식 준수 | 판정 구조 검증 |

---

## Scenario MO-1: Simulation Protocol — Ambiguity Discovery

**Primary Technique:** Simulation Protocol — 단계별 시뮬레이션으로 숨겨진 모호성 발견

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 주문 상태 알림 시스템 구현 플랜

### Task 1: 주문 상태 변경 이벤트 발행
- OrderService에서 상태 변경 시 도메인 이벤트 발행
- 이벤트에 주문 ID, 이전 상태, 새 상태 포함

### Task 2: 알림 전송 핸들러 구현
- 이벤트 수신 후 사용자에게 알림 전송
- 알림 채널은 기존 패턴을 따름
- 적절한 메시지 템플릿 사용

### Task 3: 알림 이력 저장
- 전송된 알림을 DB에 기록
- 기존 테이블 구조를 활용

### 기술 스택
- Kotlin, Spring Boot, Spring Events
- PostgreSQL
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Task 1 시뮬레이션 수행 | Task 1을 단계별로 시뮬레이션하여 OrderService의 상태 변경 트리거 조건(어떤 상태 전이?) 모호성을 발견 |
| V2 | Task 2 시뮬레이션에서 모호성 발견 | "기존 패턴을 따름"이 구현 시 해결 불가능한 모호성임을 식별 (어떤 패턴? 어디에 정의?) |
| V3 | Task 3 시뮬레이션에서 참조 부재 발견 | "기존 테이블 구조"가 구체적으로 어떤 테이블인지 특정 불가능함을 식별 |
| V4 | 차단 갭(blocking gap)으로 모호성 분류 | 발견된 모호성을 차단 갭으로 판정에 반영 |

---

## Scenario MO-2: Reference Verification — Specific vs Vague References

**Primary Technique:** Reference Verification Strategy — 구체적 참조 수용, 모호한 참조 거부

**Prompt:**
```
다음 작업 플랜을 리뷰해줘 (코드베이스 접근 불가 상태로 평가해줘):

## 인증 토큰 갱신 로직 리팩토링 플랜

### Task 1: 토큰 갱신 엔드포인트 수정
- `src/main/kotlin/com/example/auth/TokenController.kt:45-67`의 refreshToken() 메서드를 수정
- 현재 만료 시간 고정값을 설정 기반으로 변경
- `src/main/resources/application.yml`의 `auth.token.refresh-ttl` 속성 추가

### Task 2: 토큰 검증 로직 개선
- 기존 검증 로직을 참고하여 개선
- 표준적인 JWT 검증 방식 적용
- 에러 처리는 기존 방식을 따름

### Task 3: 테스트 작성
- `src/test/kotlin/com/example/auth/TokenControllerTest.kt`에 테스트 추가
- 갱신 성공, 만료 토큰, 잘못된 토큰 케이스

### 기술 스택
- Kotlin, Spring Boot, jjwt 0.11.5
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Task 1 구체적 참조 수용 | `TokenController.kt:45-67`, `application.yml` 참조를 구체적이라고 판단하여 수용 |
| V2 | Task 2 "기존 검증 로직" 거부 | "기존 검증 로직을 참고"가 모호함을 REJECT 사유로 지적 (어떤 파일? 어떤 메서드?) |
| V3 | Task 2 "표준적인 방식" 거부 | "표준적인 JWT 검증 방식"이 구체성 부족임을 지적 (어떤 표준? 어떤 라이브러리 API?) |
| V4 | Task 2 "기존 방식" 거부 | "에러 처리는 기존 방식을 따름"이 참조 불충분임을 지적 |
| V5 | Task 3 구체적 참조 수용 | 테스트 파일 경로와 테스트 케이스가 구체적이라고 판단 |

---

## Scenario MO-3: Four Criteria Evaluation — Full Pass

**Primary Technique:** 4개 기준 전체 평가 — OKAY 판정

**Prompt:**
```
다음 작업 플랜을 리뷰해줘 (코드베이스 접근 불가 상태로 평가해줘):

## CSV → JSON 변환 CLI 스크립트 구현 플랜

### 비즈니스 이유
매달 마케팅팀에서 CSV 포맷 고객 데이터를 받아 JSON으로 수동 변환 중. 월 2시간 소요되며 수동 변환 시 필드 매핑 오류 빈번. 자동화 스크립트로 교체하여 오류 제거 및 시간 절약.

### Task 순서
Task 1 → Task 2 → Task 3 → Task 4 (순차 실행)

### Task 1: 프로젝트 초기화 및 타입 정의
- `scripts/csv-converter/` 디렉토리 생성
- `scripts/csv-converter/package.json` 생성: `{ "name": "csv-converter", "scripts": { "build": "esbuild src/index.ts --bundle --platform=node --outdir=dist" }, "devDependencies": { "esbuild": "^0.20.0", "typescript": "^5.4.0" } }`
- `scripts/csv-converter/tsconfig.json` 생성: `{ "compilerOptions": { "target": "ES2022", "module": "Node16", "moduleResolution": "Node16", "strict": true, "outDir": "dist" }, "include": ["src"] }`
- `scripts/csv-converter/src/types.ts` 생성: `export type CsvRow = Record<string, string>`
- `npm install` 실행하여 devDependencies 설치

### Task 2: CSV 파서 모듈 작성
- `scripts/csv-converter/src/parser.ts` 생성
- 함수: `parseCsv(filePath: string): CsvRow[]`
- 입력: UTF-8 인코딩 CSV 파일 (첫 행은 헤더)
- 출력: `CsvRow[]` (각 행을 `Record<string, string>` 매핑)
- 에러 처리: 파일 미존재 시 `FileNotFoundError`, 빈 파일 시 `EmptyCsvError`

### Task 3: JSON 변환 및 출력 모듈 작성
- `scripts/csv-converter/src/converter.ts` 생성
- 함수: `convertToJson(rows: CsvRow[], outputPath: string): void`
- 출력 형식: JSON 배열 (pretty-printed, 2-space indent)
- 파일 쓰기: `fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2))`

### Task 4: CLI 엔트리포인트 작성
- `scripts/csv-converter/src/index.ts` 생성
- `process.argv`로 입력 파일 경로와 출력 파일 경로를 받음
- 사용법: `node dist/index.js input.csv output.json`
- 인자 부족 시 사용법 출력 후 `process.exit(1)`
- 성공 시 "Converted N rows to {outputPath}" 출력

### 프로젝트 구조
scripts/csv-converter/
├── src/
│   ├── index.ts          # CLI 엔트리포인트
│   ├── parser.ts         # CSV 파싱
│   ├── converter.ts      # JSON 변환
│   └── types.ts          # CsvRow 타입 정의 (type CsvRow = Record<string, string>)
├── package.json          # esbuild 빌드 스크립트
└── tsconfig.json         # TypeScript 설정

### 테스트 전략
- 수동 테스트: 샘플 CSV(3행 2열)로 변환 실행, JSON 출력 파일 비교
- 테스트 명령: `node dist/index.js test/sample.csv test/output.json && diff test/output.json test/expected.json`
- 에러 케이스: 존재하지 않는 파일 경로 전달 시 에러 메시지와 exit code 1 확인

### 성공 기준
- `npm run build` 성공 (esbuild로 `dist/index.js` 번들 생성)
- 샘플 CSV 변환 후 올바른 JSON 출력 확인 (diff 명령으로 검증)
- 파일 미존재 시 에러 메시지 출력, exit code 1
- 빈 CSV 시 에러 메시지 출력, exit code 1

### 기술 스택
- TypeScript 5.x, Node.js 20+
- esbuild (빌드)
- 외부 런타임 의존성 없음 (내장 fs, path 모듈만 사용)

### Out of Scope
- 대용량 파일 스트리밍 처리 (1MB 이하 파일만 대상)
- CSV 방언 처리 (탭 구분, 커스텀 구분자 등)
- 웹 UI
- 자동화된 단위 테스트 프레임워크 도입 (Jest 등)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Clarity 통과 | 모든 파일 경로, 메서드명, 응답 코드가 구체적이라고 판단하여 Pass |
| V2 | Verifiability 통과 | 테스트 전략(단위+통합), 구체적 테스트 케이스, 실행 명령어가 있어 Pass |
| V3 | Completeness 통과 | 기술 스택, 의존성, 에러 처리가 명시되어 있어 Pass |
| V4 | Big Picture 통과 | 목표, 범위 경계(Out of Scope), 성공 기준이 있어 Pass |
| V5 | OKAY 판정 | 최종 판정이 **OKAY**이며, 4개 기준 모두 Pass로 Summary에 표시 |

---

## Scenario MO-4: Four Criteria Evaluation — Partial Fail

**Primary Technique:** 4개 기준 평가 — 부분 실패 감지

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 상품 검색 기능 구현 플랜

### 목표
사용자가 상품명, 카테고리, 가격 범위로 상품을 검색할 수 있는 기능 구현

### Task 1: 검색 API 엔드포인트 생성
- `src/main/kotlin/com/example/product/ProductSearchController.kt`에 `GET /api/products/search` 추가
- Query parameters: keyword (String?), categoryId (Long?), minPrice (BigDecimal?), maxPrice (BigDecimal?)
- 페이지네이션 지원 (page, size)

### Task 2: 검색 쿼리 구현
- `src/main/kotlin/com/example/product/ProductRepository.kt`에 QueryDSL 기반 동적 쿼리 추가
- 각 조건은 null이면 필터 미적용
- 결과는 최신 등록순 정렬 (createdAt DESC)

### Task 3: 응답 DTO 생성
- `src/main/kotlin/com/example/product/dto/ProductSearchResponse.kt` 생성
- 필드: id, name, price, categoryName, thumbnailUrl

### 비즈니스 이유
- 사용자 피드백에서 검색 기능이 가장 많이 요청됨
- 상품 수가 1000개를 넘어서 목록 스크롤만으로 부족

### 기술 스택
- Kotlin, Spring Boot 3.2, QueryDSL 5.0
- PostgreSQL

### Out of Scope
- 전문 검색 엔진(Elasticsearch) 도입
- 자동완성
- 검색어 추천
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Clarity 통과 | 파일 경로, 파라미터, DTO 필드가 구체적이라고 판단하여 Pass |
| V2 | Verifiability 실패 | 테스트 전략이 전혀 없음을 지적하여 Fail (어떤 테스트? 어떤 케이스? 실행 명령어?) |
| V3 | Completeness 실패 | 환경 설정 누락을 지적하여 Fail (QueryDSL 설정, 인덱스 전략, "관련도순"의 정의) |
| V4 | Big Picture 통과 | 비즈니스 이유와 Out of Scope가 있어 Pass |
| V5 | REJECT 판정 | 최종 판정이 **REJECT**이며, Verifiability Fail + Completeness Fail을 명시하고 구체적 개선안 제시 |

---

## Scenario MO-5: Final Verdict Format Compliance

**Primary Technique:** Final Verdict Format 출력 준수

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 로깅 표준화 플랜

### 목표
애플리케이션 전반의 로깅을 SLF4J + Logback으로 표준화

### 작업 항목
1. System.out.println을 logger로 교체
2. 로그 레벨 가이드라인 정의
3. 구조화된 로그 포맷(JSON) 적용
4. 로그 파일 로테이션 설정

### 기술 스택
- Kotlin, Spring Boot
- SLF4J, Logback
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | [OKAY/REJECT] 판정 존재 | 출력에 `**[OKAY]**` 또는 `**[REJECT]**` 형식의 판정이 포함됨 |
| V2 | Justification 존재 | `**Justification**:` 레이블과 1-2문장 근거가 포함됨 |
| V3 | Summary with Per-Criterion 존재 | `**Summary**:` 아래에 Clarity, Verifiability, Completeness, Big Picture 각각의 Pass/Fail이 포함됨 |
| V4 | 개선안 (REJECT인 경우) | REJECT 판정 시 구체적 개선 항목이 3-5개 포함됨 |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| MO-1 | Simulation Protocol | **PASS** | 2026-02-10 | 4/4 VP 충족. 시뮬레이션 수행, 모호성 발견, 차단 갭 분류 정상 |
| MO-2 | Reference Verification | **PASS** | 2026-02-10 | 4/5 VP 충족. 구체적 참조 수용, 모호한 참조 거부 정상. V5 borderline (extra critical) |
| MO-3 | Four Criteria — Full Pass | **PENDING** | 2026-02-10 | 시나리오 재설계 (도메인 변경: 비밀번호 변경 API → CSV 변환 CLI). iteration 3 대기 |
| MO-4 | Four Criteria — Partial Fail | **PASS** | 2026-02-10 | 4/5 VP 충족. REJECT 판정 + Verifiability/Completeness Fail 정상. V1 borderline |
| MO-5 | Final Verdict Format | **PASS** | 2026-02-10 | 4/4 VP 충족. 판정, Justification, Summary, 개선안 형식 모두 정상 |
