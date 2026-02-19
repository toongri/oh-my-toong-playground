# Architecture Review (정보 구조 리뷰)

## Role

문서의 정보 구조를 리뷰한다. 제목, 개요, 페이지 구성, 예측 가능성, 가치 우선, 배경 설명을 검증한다.

## Process

### Step 1: 페이지 구성 검증

**P1. H4 이상이면 문서 분리 검토:**
- H4(####) 이상 깊이가 존재하면 문서 분리 필요 신호
- 1페이지 = 1핵심 목표 원칙 위반 여부 확인

Before:
```markdown
# React 사용법
## 컴포넌트 생성
### 기본 구조
#### JSX 사용법
##### JSX 문법 세부사항
```

After:
```markdown
# React 컴포넌트 생성하기
## 컴포넌트 기본 구조
## 상태 관리
## 라이프사이클 메서드
```

**P2. 개요 페이지 활용:**
- 여러 개념을 다뤄야 한다면 개요 페이지에서 개별 문서로 링크

### Step 2: 제목 검증

**P3. 제목에 핵심 키워드 포함:**

Before: `# 에러를 해결하는 방법은?`
After: `# NOT_FOUND_USER 에러를 해결하는 방법`

**P4. 소제목 스타일 일관성** (동사형/명사형 통일):

Before:
```markdown
## 키워드를 포함하세요
## 일관성 유지
## 평서문으로 작성하기
```

After:
```markdown
## 키워드 포함하기
## 일관성 유지하기
## 평서문으로 작성하기
```

**P5. 30자 이내, 평서문:**
- 제목에 `!`, `?` 사용 금지
- 30자 초과 시 핵심 키워드만 남기고 축약

### Step 3: 개요 검증

**P6. 개요에서 "이 문서를 읽으면 무엇을 할 수 있는가?" 답하기:**

Before:
> 이 문서는 TypeScript의 유틸리티 타입을 소개합니다. Partial, Pick, Omit 등의 유틸리티 타입을 사용할 수 있어요.

After:
> TypeScript의 유틸리티 타입을 사용해서 객체 타입을 변형하는 방법을 알아볼게요. 유틸리티 타입을 활용하면 반복적인 타입 선언을 줄이고 코드를 간결하게 유지할 수 있습니다.

**P7. 기술적 배경보다 핵심 정보 먼저:**

Before:
> React에서 상태 관리란 무엇일까요? React는 컴포넌트 기반 UI 라이브러리로...

After:
> 이 문서는 React에서 상태(state) 관리의 개념과 주요 기법을 설명합니다. `useState`, `useReducer`, Context API, Redux 등의 방법을 비교합니다.

### Step 4: 예측 가능성 검증

**P8. 섹션 위계 일관성:**
- 같은 수준 섹션인데 H2와 H3 혼용하지 않기
- 동일 레벨 개념은 동일 헤딩 수준 사용

**P9. 설명 → 코드 순서:**

Before:
```markdown
```python
response = requests.get(url)
data = response.json()
```​
서버에서 데이터를 가져옵니다.
```

After:
```markdown
서버에서 데이터를 가져와 JSON으로 변환합니다.
```python
response = requests.get(url)
data = response.json()
```​
```

**P10. 논리 순서: 기본 → 심화 → 예제 → 고급:**

Before:
```markdown
## 비동기 데이터 요청하기
## 기본적인 사용법
```

After:
```markdown
## 기본적인 사용법
## 비동기 데이터 요청하기
## 클린업 함수 활용하기
```

**P11. 용어 일관성:**

Before: "상태를 관리... 데이터 저장을 위해... 값 유지가 필요할 때"
After: "상태(state)를 관리... 상태를 저장하기 위해... 더 복잡한 상태 관리가 필요할 경우"

### Step 5: 가치 우선 검증

**P12. 도입부에 가치 먼저:**

Before:
> 리버스 프록시 설정은 2019년에 도입되었고, 많은 수정이 있었습니다...

After:
> 리버스 프록시 설정을 적용하면 네트워크 지연 문제를 최소화할 수 있어요.

**P13. 기능 나열 전에 왜 유용한지 먼저:**

Before:
> 이 스니펫은 다양한 설정 옵션을 제공합니다. 먼저 `connection_timeout`, `retry_attempts`... 를 수정하세요.

After:
> 이 스니펫을 사용하면 PostgreSQL 데이터베이스 연결 속도가 50% 빨라집니다.

### Step 6: 배경 설명 검증

**P14. 새 개념 등장 즉시 정의:**

Before:
> 이 서비스는 이벤트 소싱 방식을 사용해 상태를 관리합니다.

After:
> 이 서비스는 이벤트 소싱(Event Sourcing) 방식을 사용해 상태를 관리합니다. 이벤트 소싱은 상태의 최종 결과만 저장하는 대신, 상태 변화를 일으킨 모든 이벤트를 기록하는 방식입니다.

**P15. 동작 조건·단위·상태 변화 명시:**

Before:
> `sessions[].duration`: 세션의 지속 시간을 나타냅니다.

After:
> `sessions[].duration`: 세션의 지속 시간으로, 사용자가 로그인을 유지한 시간을 의미합니다. 수동 로그아웃 시 실제 이용 시간, 시간 초과 시 마지막 활동 시점까지의 시간. 단위는 밀리초(ms).

### Step 7: 문서 구조 설계

**PA16. 다중 페이지 구조 설계** (유형별 디렉토리 구조):
- 여러 페이지로 구성된 문서는 유형별 디렉토리로 분리
- 왼쪽 내비게이션 메뉴를 짜본다고 생각하고 구조 설계
- 유형 조합은 자유롭게 — 템플릿에 얽매이지 않기

기본 템플릿:
```
docs/
├── get-started.md
├── tutorials/        # 학습 중심 문서
│   ├── a-tutorial.md
│   └── another-tutorial.md
├── how-tos/          # 문제 해결 중심 문서
│   ├── a-how-to.md
│   └── another-how-to.md
├── explanations/     # 개념 설명 문서
│   ├── a-concept.md
│   └── a-topic.md
├── reference/        # 참조 문서
│   ├── an-element.md
│   └── another-element.md
├── troubleshooting.md  # 문제 해결 (에러 해결 가이드)
└── glossary.md         # 용어 사전
```

주제 특화 구조 예시 (Next.js 성능 최적화 가이드):
```
nextjs-performance-optimization/
├── index.md                  # 개요 (Overview)
├── fundamentals.md           # 성능 최적화의 기본 개념
├── tutorial.md               # 성능 최적화를 적용하는 간단한 튜토리얼
├── guides/                   # 특정 목표를 달성하기 위한 가이드
│   ├── code-splitting.md       # 코드 분할 (Code Splitting)
│   ├── image-optimization.md   # 이미지 최적화
│   └── caching-strategies.md   # 캐싱 전략
└── troubleshooting.md        # 문제 해결 (Troubleshooting)
```

유형별 구조 참고:
- 학습 문서: 개요 → 실습 → 심화의 계층 구조
- 문제 해결/설명 문서: 같은 레벨의 병렬 구조
- 참조 문서: 별도 페이지에서 목록 제공

**PA17. 크로스링크 활용** (문서 간 연결 관계 설정):
- 튜토리얼에서 간략히 설명한 내용 → 가이드/참조 문서로 링크
- 독자가 더 깊은 정보가 필요할 때 바로 찾을 수 있도록 연결
- 연계 관계가 있는 문서끼리 상호 링크 추가

Before (링크 없음):
```markdown
코드 분할을 적용하면 초기 로딩 속도가 빨라집니다.
```

After (크로스링크 활용):
```markdown
코드 분할을 적용하면 초기 로딩 속도가 빨라집니다. 코드 분할과 함께 [Lazy Loading](./lazy-loading.md)을 적용하면 더 효과적입니다.
```

크로스링크 설정 원칙:
- 튜토리얼 → 가이드: 심화 내용을 다루는 가이드로 연결
- 가이드 → 참조: 상세 스펙이나 API 목록으로 연결
- 트러블슈팅 → 가이드/설명: 근본 원인 이해를 위한 문서로 연결
- 개요 페이지에서 모든 하위 문서로의 진입점 제공
