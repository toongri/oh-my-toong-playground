# slugify — URL/파일명 안전 슬러그 변환

## Overview

`slugify`는 채용공고 수집 워크플로에서 **company** 값과 **role_title** 값을 파일시스템 및 URL에 안전한 슬러그 문자열로 변환하는 유틸리티다.

디렉토리 구조 예시:

```
jd/
└── toss-bank/
    └── 백엔드-엔지니어.md
```

슬러그는 파일명 충돌을 방지하고, 사람이 읽기 쉬우며, 특수문자로 인한 셸/URL 이스케이프 문제를 없앤다.

---

## 단계별 알고리즘 (7단계)

| # | 동작 | 입력 예 | 출력 예 |
|---|------|---------|---------|
| 1 | **NFKD** → combining diacritic 제거(`[̀-ͯ]`) → **NFC**. Hangul은 NFC 재조합으로 음절 보존. Latin precomposed 문자는 NFKD 분해 후 diacritic mark 스트립되어 base character만 남음. | `"Café"` | `"Cafe"` |
| 2 | Latin 소문자화 | `"AX Backend"` | `"ax backend"` |
| 3 | 공백 → 하이픈 | `"ax backend"` | `"ax-backend"` |
| 4 | 허용 문자 외 제거 `[^a-z0-9가-힣-]` | `"ax-(backend)"` | `"ax-backend"` |
| 5 | 연속 하이픈 압축 (`-+` → `-`) | `"ax--backend"` | `"ax-backend"` |
| 6 | 선/후행 하이픈 트림 | `"-ax-backend-"` | `"ax-backend"` |
| 7 | 길이 64 초과 시 truncate (후행 `-` 재트림) | `"a".repeat(80)` | `"a".repeat(64)` |

---

## 한글 정책

### 1. 라이브러리 의존 회피

한글 로마자 변환(romanization) 라이브러리(`hangul-romanize` 등)를 사용하지 않는다.

- 외부 의존성 추가 없이 동작해야 한다.
- 로마자 변환은 정보 손실을 유발한다 (`서버` → `seobeo` 는 검색에 불리하다).

### 2. 검색 가능성 유지

한글 음절을 원형 그대로 보존하면:

- 파일명에서 `grep`, `find` 로 한글 검색이 가능하다.
- 사람이 디렉토리를 탐색할 때 원래 이름을 즉시 알아볼 수 있다.
- 공백은 하이픈으로 치환하되 음절 자체는 손대지 않는다.

### 3. NFKD → diacritic 제거 → NFC 파이프라인

Latin precomposed 문자(`é`, `ü`, `ñ` 등)를 처리하면서 Hangul 음절을 보존하기 위해 세 단계 파이프라인을 사용한다:

| 단계 | 동작 | Hangul 결과 | Latin 결과 |
|------|------|-------------|------------|
| NFKD | 음절→자모 분해, precomposed→base+mark 분해 | 자모 분리 상태 | `é` → `e` + combining acute |
| `[̀-ͯ]` 제거 | combining diacritic mark 스트립 | 자모 그대로 | combining mark 제거, base만 남음 |
| NFC | 자모 → 음절 재조합 | 원래 음절 복원 | base character 그대로 |

```
"토스".normalize('NFKD')  → 자모 분해
  → .replace(/[̀-ͯ]/g, '') → 자모 영향 없음 (combining mark 없음)
  → .normalize('NFC')      → "토스" 재조합 (보존)

"Café".normalize('NFKD')  → "Café" (combining acute accent)
  → .replace(/[̀-ͯ]/g, '') → "Cafe"
  → .normalize('NFC')      → "Cafe"
```

---

## Fixture 표

| 입력 | 기대 출력 | 설명 |
|------|-----------|------|
| `'토스'` | `'토스'` | 한글 음절 보존 |
| `'AX Backend Engineer'` | `'ax-backend-engineer'` | 라틴 lowercase + 공백 → 하이픈 |
| `'백엔드 / 서버'` | `'백엔드-서버'` | 한글 + 특수문자 제거 |
| `'Toss Bank (Korea)'` | `'toss-bank-korea'` | 괄호 제거 |
| `'   spaces   '` | `'spaces'` | 선후 공백 트림 |
| `'a'.repeat(80)` | length ≤ 64 | 64자 truncate |
| `'카카오 Frontend Dev'` | `'카카오-frontend-dev'` | 한글 + 영문 혼합 |
| `'hello---world'` | `'hello-world'` | 연속 하이픈 압축 |
| `'-trim-'` | `'trim'` | 선후 하이픈 트림 |
| `'a'.repeat(63) + '-extra'` | no trailing `-`, length ≤ 64 | truncate 후 trailing 하이픈 재트림 |
| `'Café'` | `'cafe'` | Latin precomposed diacritic 제거 (French) |
| `'Zürich Tech'` | `'zurich-tech'` | German umlaut 제거 |
| `'Björn & Co'` | `'bjorn-co'` | Scandinavian diacritic 제거 |

---

## 구현 파일

- **TypeScript 구현**: [`lib/collect-jd/slugify.ts`](../../../lib/collect-jd/slugify.ts)
- **테스트**: [`lib/collect-jd/slugify.test.ts`](../../../lib/collect-jd/slugify.test.ts)

---

## 실행 방법

```bash
# 테스트만 실행
bun test lib/collect-jd/slugify.test.ts

# 전체 테스트
bun test
```

---

## 허용 문자 집합

```
[a-z0-9가-힣-]
```

- `a-z`: 소문자 라틴 (NFKD 분해 후 결합 문자는 제거됨)
- `0-9`: ASCII 숫자
- `가-힣`: Unicode Hangul Syllables 블록 (U+AC00–U+D7A3)
- `-`: 하이픈 (단어 구분자)

그 외 문자(대문자, 특수기호, 이모지, 결합 발음 기호 등)는 모두 제거된다.
