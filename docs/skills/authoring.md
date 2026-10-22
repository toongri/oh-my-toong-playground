한국어 | [English](authoring.en.md)

---

## 핵심 요약 - 작성 및 커뮤니케이션 스킬

| 스킬 | 목적 | 사용 시점 |
|------|------|-----------|
| **html-report** | 인라인 SVG가 든 단일 HTML 리포트의 공통 작성 계약 | 리포트 스킬(qa·explain-diff·deep-interview·prometheus 등)이 참조 |
| **create-slides** | HTML 스크롤텔링 발표자료 생성 | 기술 발표, 제안서, 피치덱 |
| **technical-writing** | 한국어 기술 문서 리뷰/작성 | API 문서, 가이드, 기술 블로그 |
| **technical-copywriting** | 기술 블로그 홍보 텍스트 리뷰 | SNS 공유 티저, LinkedIn 포스트 |
| **humanizer** | AI 글쓰기 흔적 제거 | 한국어/영어 콘텐츠 자연화 |
| **make-pr** | PR 설명 작성 | 코드 변경사항 PR 제출 전 |
| **scan-pdf-to-notes** | 스캔본 PDF → 마크다운/정리 | OCR 책 챕터 추출 및 정리 |
| **git-master** | 커밋 메시지 + 브랜치 명명 | git 커밋, 브랜치 생성 |
| **compacting-skills** | 동작을 유지한 채 스킬·에이전트 지침 압축 (규칙 목록, 시나리오 전후 측정, 압축 회귀 감사) | 길어지거나 중복·모순이 쌓인 SKILL.md를 줄일 때, 압축본을 머지 전에 점검할 때 |

---

## 1. 개요

이 스킬들은 작성, 정제, 게시에 걸친 **문서·커뮤니케이션 생산 파이프라인**을 담당합니다.

각 스킬은 서로 다른 산출물 유형을 겨냥하지만 공통된 원칙 위에 작동합니다:
- 정확성: 내용을 날조하거나 부풀리지 않는다
- 컨텍스트 수집: 충분한 정보 없이 생산하지 않는다
- 독자 중심: 작성자가 아닌 독자의 시선으로 결과물을 검증한다

---

## 2. 스킬 상세

### html-report

**역할**: 사람이 읽는 리포트를 Mermaid/`mmdc` 사전 렌더 없이 자기완결 HTML 한 파일로 직접 쓰는 공통 계약입니다. 독립 호출용이 아니라 소비 스킬(deep-interview·prometheus·qa·explain-diff·ultraresearch·review-report·create-slides)이 `${CLAUDE_SKILL_DIR}/../html-report/...` 경로로 단방향 참조합니다. 소비 스킬이 무엇을 말할지(내용 규칙)를 정하고, 이 스킬은 어떻게 짓고 검사할지(형식 규칙)를 정합니다.

**특징**:
- 외부 CSS·JS·이미지 없는 단일 파일, 라이트/다크, 400–1280px, 한국어 우선
- 노드 3개 이상 방향 그래프는 엣지가 보이는 인라인 SVG, 색상·타이포는 디자인 토큰으로 정의
- 필수 자기 비평 루프: `capture.sh`로 캡처하고 `lint.sh`로 검사하며, lint 오류가 0이면 `lint.sh --receipt`가 HTML 바이트에 묶인 영수증을 씀
- `make validate`가 소비 스킬과 같은 sync 스코프·플랫폼에 `html-report`가 함께 배포되는지 검사

**사용 시점**: 리포트 스킬이 HTML을 쓸 때 자동 참조

---

### create-slides

**역할**: 슬라이드 라이브러리 없이 순수 HTML+CSS로 발표자료를 생성합니다. 수직 스크롤 + scroll-snap 방식의 스크롤텔링 프레젠테이션을 단일 HTML 파일로 출력합니다.

**특징**:
- 다크/라이트 테마, highlight.js 코드 블럭, 나눔스퀘어 네오 폰트 지원
- title, content, card-grid, code, timeline, flow, comparison, diagram 등 13종 슬라이드 타입
- 사용자 컨펌 없이 생성 진행 불가 (테마·슬라이드 구성·악센트 컬러를 먼저 제안)
- reveal.js, Bootstrap, base64 이미지, 임의 수치 날조 금지

**사용 시점**: "발표자료", "슬라이드", "ppt", "제안서", "pitch deck", "tech talk"

**출력**: 현재 디렉토리의 단일 `.html` 파일

---

### technical-writing

**역할**: 한국어 기술 문서를 3단계 순서로 리뷰하고 개선안을 제안합니다.

- **Area 1 (유형 분류)**: 문서 유형 식별 및 유형별 필수 요소 검증
- **Area 2 (아키텍처 리뷰)**: 헤딩 구조, 개요, 가독성, 정보 예측 가능성 검토
- **Area 3 (문장 리뷰)**: 주어 명확성, 간결성, 한국어 자연스러움 검토

각 Area가 끝난 뒤 결과를 제시하고 사용자 승인을 받은 뒤 다음 Area로 진행합니다. 모든 개선 제안은 Before/After 형식에 원칙 ID(T1~T16, P1~PA17)를 함께 명시합니다.

**사용 시점**: "문서 리뷰", "테크니컬 라이팅", "기술 문서", "doc review", "writing review"

---

### technical-copywriting

**역할**: 기술 블로그 공유에 딸린 티저·홍보 텍스트를 3단계 순서로 리뷰합니다.

- **Area 1 (유형 분류)**: 티저 유형(발표형/학습형/의견형 등) 식별 및 플랫폼 제약 검증
- **Area 2 (구조 리뷰)**: 오프닝, 가치 전달 방식, 클로징 패턴, 분량 균형 검토
- **Area 3 (Voice & Authenticity)**: 개발자 진정성, 마케팅 어구 제거, 플랫폼 톤 검토

technical-writing과 동일한 3단계 프레임워크를 사용하지만 대상 산출물이 다릅니다. 기술 문서가 아닌 공유 티저, LinkedIn 포스트, SNS 본문 등을 다룹니다.

**사용 시점**: "티저 리뷰", "포스트 공유", "copywriting review", "LinkedIn post review"

---

### humanizer

**역할**: 한국어(주) 및 영어 텍스트에서 AI 글쓰기 흔적을 감지하고 제거합니다. 35개 이상의 패턴(K1~K21, E1~E18, C1~C9)을 탐지합니다.

두 가지 모드로 동작합니다:
- **audit**: 패턴 감지 후 보고서만 출력. 텍스트 수정 없음.
- **rewrite**: 패턴 감지 후 직접 텍스트 수정. 기본 모드.

콘텐츠 유형(블로그/기술 문서/마케팅/학술/SNS)에 따라 적용 규칙이 달라집니다. 기술 문서에는 사실 추가·성격 주입이 금지되며, 블로그/에세이에는 1인칭 관점과 의견 표현을 적극 유도합니다.

**주요 탐지 대상**:
- 한국어: "오늘날", "혁신적인", "이를 통해", 에엠대시(—), 가운뎃점(·), "결론적으로" 등
- 영어: "pivotal", "seamless", "leverage", "Let's dive in", curly quotes 등

**사용 시점**: "humanize", "AI 흔적 제거", "사람답게", "자연스럽게 고쳐", "de-AI"

---

### make-pr

**역할**: 시니어 백엔드 엔지니어 관점에서 한국어 PR 설명을 작성합니다. 변경사항(Changes)과 논의 필요 사항(Review Points)을 명확히 분리해 리뷰어가 diff 없이도 핵심 판단을 이해할 수 있는 PR을 생성합니다.

핵심 제약:
- Clearance Checklist(4개 항목) 전부 YES 전까지 작성 진행 불가
- `gh pr create` 실행 전 반드시 사용자 확인 필요
- git diff 파일 내용 직접 읽기 금지 (메타데이터 + explore만 사용)
- PR 전체를 한국어로 작성

워크플로우:
1. 베이스 브랜치 탐지 → 후보 테이블 제시 → 타겟 브랜치·동기화 방식·충돌 처리 방침을 한 번의 질문으로 확정
2. 브랜치 동기화 (merge/rebase, 충돌은 확정된 방침대로 처리)
3. git 메타데이터 수집 + PR 컨벤션 서베이 (최근 PR 최대 30개에서 제목·브랜치명·label 관례 도출) → 코드베이스 탐색
4. 1회 1문 인터뷰 → Clearance Checklist 통과
5. 스코프 평가 (단일 테제 vs 분할 필요, 분할 시 sub-PR마다 worktree 생성)
6. PR 제목 + 본문 작성 (서베이한 컨벤션 준수) → 사용자 리뷰 → PR 생성 (gh 인증 유저에게 assign, 실재 label만 적용, push 전 브랜치명 컨벤션 체크)

**출력 형식**: `📌 Summary`, `🔧 Changes`, `💬 Review Points`, `✅ Checklist`, `📎 References` 이모지 헤더 섹션

**사용 시점**: "PR 작성", "PR description", "make PR", "풀리퀘", "pull request 작성"

---

### scan-pdf-to-notes

**역할**: ABBYY FineReader 등 OCR 엔진으로 스캔된 책 PDF에서 특정 챕터·페이지 범위를 추출하여 두 가지 산출물을 생성합니다.

- **추출 원문**: 책과 1:1 대응하는 OCR 원문. 검증 소스로서 절대 삭제하지 않음.
- **정리본**: 추출 원문을 재서술·압축한 학습 노트.

추출 계층:
- **Tier 1 (항상)**: `pymupdf4llm`(마크다운 구조) + `pdftotext -layout`(공간 정렬 텍스트)
- **Tier 2 (실제 그리드 표/코드 블럭 포함 시)**: `marker-chunked.sh` (재-OCR, 표 복원)

OCR 정밀값(해시, 포트, 버전 등)은 컨텍스트 추론 금지 — `get_pixmap()`으로 이미지 렌더링 후 육안 검증합니다. 시리즈 정리본이 이미 존재하면 톤·밀도·파일 명명 규칙을 맞춥니다.

**사용 시점**: "PDF 텍스트 발췌", "스캔본 PDF 추출", "책 챕터 정리", "OCR 깨짐", "pdftotext", "scanned book extraction"

---

### git-master

**역할**: 코드 변경사항을 분석하여 프로젝트 규범에 맞는 한국어 커밋 메시지를 생성하고, 브랜치 명명 규칙을 적용합니다.

**3가지 절대 원칙**:
1. 하나의 논리적 변경만 포함 (필요시 분할)
2. 제목 50자 이하
3. 외부 맥락 없이 git log 독자가 이해할 수 있는 제목

커밋 메시지 형식:
- 유형 접두어: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`
- 언어: 한국어 명사형 종결 (예: "추가", "수정", "구현")
- 계획 단계 번호(`Step N`), AC ID(`AC M1`), 우선순위 라벨(`P1`) 제목 포함 금지

브랜치 명명: `<type>/<description>` 형식, kebab-case, 영어 (예: `feature/user-auth`, `fix/login-redirect`)

3개 이상 파일 변경 시 커밋 실행 전 커밋 플랜을 출력합니다. 테스트 파일은 반드시 대응 구현체와 같은 커밋에 포함합니다.

**사용 시점**: "commit", "커밋", "git commit", "branch name", "브랜치 이름"

---

### compacting-skills

**역할**: 기존 스킬·에이전트·rules 문서를 줄이되, 그 문서가 만들어 내는 동작은 유지합니다. 줄어든 크기는 결과이지 목표가 아닙니다. writing-skills의 짝입니다. writing-skills는 스킬을 테스트 우선으로 만들고 고치고, compacting-skills는 이미 있는 스킬을 줄입니다.

**증거 세 종류**: 각 증거는 다른 증거가 놓치는 결함을 잡습니다.
- **규칙 목록 + 추적표**: 압축 중 사라진 규칙을 찾습니다.
- **시나리오 전후 측정**: 새 에이전트가 전후 문서로 같은 시나리오를 5회씩 풀고, 채점하고 판정해 동작 변화를 찾습니다.
- **압축 회귀 감사**: 네 방향으로 봅니다. 옛 문서→새 문서 존재 여부, 새 문서→옛 문서 충실도(규칙이 넓어지거나 좁아졌는지), 코드와 소비자(문서의 상태 목록이 코드가 만드는 모든 상태를 덮는지 포함), 삭제된 전제입니다.

**남기는 기준**: 계약, 안전, 핵심 보장, 실제 실패, 이 저장소만의 의미. 나머지는 AI 판단에 맡깁니다.

**제약**: 스크립트와 훅은 바꾸지 않습니다. 코드에 맞춰 문서를 고칩니다.

**구성 파일**: `SKILL.md`, `references/`(rule-inventory, behavior-measurement, rewriting, regression-audit), `scripts/measure.ts` (측정 증거 `measurement.json`을 쓰는 유일한 CLI)

**사용 시점**: 길어지거나 중복·모순이 쌓인 SKILL.md를 줄일 때, 압축본을 머지 전에 점검할 때

---

## 3. 스킬 선택 가이드

```
무엇을 만들어야 하는가?
  |-- 발표자료/슬라이드 → create-slides
  |-- 기술 문서 리뷰/개선 → technical-writing
  |-- 블로그 공유 티저 리뷰 → technical-copywriting
  |-- AI 흔적 제거 → humanizer
  |-- PR 설명 → make-pr
  |-- 스캔본 PDF 추출·정리 → scan-pdf-to-notes
  |-- 커밋·브랜치 명명 → git-master
  |-- SKILL.md가 길어지고 중복·모순이 쌓였다 / 압축본을 머지 전에 점검 → compacting-skills
```

---

## 참고 자료

- [README](../../README.md) - 프로젝트 개요
- [오케스트레이션 가이드](../ORCHESTRATION.md) - 계획 + 실행 파이프라인
- 관련 스킬 문서:
  - [핵심 파이프라인](./core-pipeline.md)
  - [리뷰 및 품질](./review-quality.md)
  - [리서치](./research.md)
  - [Knowledge Graph Pins](./knowledge-graph-pins.md)
  - [유틸리티·개인 도구](./utilities-personal.md)
