# Architecture Review

## Role

Reviews document information architecture. Verifies headings, overview, page structure, predictability, value-first approach, and background explanations.

## Process

### Step 1: Page Structure

**P1. Split document if heading depth reaches H4 or deeper:**
- H4(####) or deeper indicates a document split is needed
- Verify 1-page = 1-core-goal principle

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

**P2. Use overview pages:**
- If multiple concepts must be covered, create an overview page linking to individual documents

### Step 2: Heading Verification

**P3. Include core keywords in headings:**

Before: `# 에러를 해결하는 방법은?`
After: `# NOT_FOUND_USER 에러를 해결하는 방법`

**P4. Maintain consistent subheading style** (unify verb/noun forms):

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

**P5. Keep headings under 30 characters, use declarative form:**
- No `!` or `?` in headings
- If over 30 characters, keep only core keywords

### Step 3: Overview Verification

**P6. Overview must answer "What can the reader do after reading this document?":**

Before:
> 이 문서는 TypeScript의 유틸리티 타입을 소개합니다. Partial, Pick, Omit 등의 유틸리티 타입을 사용할 수 있어요.

After:
> TypeScript의 유틸리티 타입을 사용해서 객체 타입을 변형하는 방법을 알아볼게요. 유틸리티 타입을 활용하면 반복적인 타입 선언을 줄이고 코드를 간결하게 유지할 수 있습니다.

**P7. Lead with core information, not technical background:**

Before:
> React에서 상태 관리란 무엇일까요? React는 컴포넌트 기반 UI 라이브러리로...

After:
> 이 문서는 React에서 상태(state) 관리의 개념과 주요 기법을 설명합니다. `useState`, `useReducer`, Context API, Redux 등의 방법을 비교합니다.

### Step 4: Predictability

**P8. Maintain section hierarchy consistency:**
- Do not mix H2 and H3 for same-level sections
- Use the same heading level for equivalent concepts

**P9. Explanation before code:**

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

**P10. Logical order: basic → intermediate → examples → advanced:**

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

**P11. Terminology consistency:**

Before: "상태를 관리... 데이터 저장을 위해... 값 유지가 필요할 때"
After: "상태(state)를 관리... 상태를 저장하기 위해... 더 복잡한 상태 관리가 필요할 경우"

### Step 5: Value-First

**P12. Lead with value in the introduction:**

Before:
> 리버스 프록시 설정은 2019년에 도입되었고, 많은 수정이 있었습니다...

After:
> 리버스 프록시 설정을 적용하면 네트워크 지연 문제를 최소화할 수 있어요.

**P13. Explain usefulness before listing features:**

Before:
> 이 스니펫은 다양한 설정 옵션을 제공합니다. 먼저 `connection_timeout`, `retry_attempts`... 를 수정하세요.

After:
> 이 스니펫을 사용하면 PostgreSQL 데이터베이스 연결 속도가 50% 빨라집니다.

### Step 6: Background Explanation

**P14. Define new concepts immediately upon introduction:**

Before:
> 이 서비스는 이벤트 소싱 방식을 사용해 상태를 관리합니다.

After:
> 이 서비스는 이벤트 소싱(Event Sourcing) 방식을 사용해 상태를 관리합니다. 이벤트 소싱은 상태의 최종 결과만 저장하는 대신, 상태 변화를 일으킨 모든 이벤트를 기록하는 방식입니다.

**P15. Specify operating conditions, units, and state changes:**

Before:
> `sessions[].duration`: 세션의 지속 시간을 나타냅니다.

After:
> `sessions[].duration`: 세션의 지속 시간으로, 사용자가 로그인을 유지한 시간을 의미합니다. 수동 로그아웃 시 실제 이용 시간, 시간 초과 시 마지막 활동 시점까지의 시간. 단위는 밀리초(ms).

### Step 7: Document Structure Design

**PA16. Design multi-page directory structure** (type-based directory organization):
- Split multi-page documents into type-based directories
- Design as if creating a left navigation menu
- Mix and match types freely — don't be constrained by templates

Default template:
```
docs/
├── get-started.md
├── tutorials/        # Learning-focused documents
│   ├── a-tutorial.md
│   └── another-tutorial.md
├── how-tos/          # Problem-solving focused documents
│   ├── a-how-to.md
│   └── another-how-to.md
├── explanations/     # Concept explanation documents
│   ├── a-concept.md
│   └── a-topic.md
├── reference/        # Reference documents
│   ├── an-element.md
│   └── another-element.md
├── troubleshooting.md  # Troubleshooting (error resolution guides)
└── glossary.md         # Glossary
```

Topic-specific structure example (Next.js performance optimization guide):
```
nextjs-performance-optimization/
├── index.md                  # Overview
├── fundamentals.md           # Core performance optimization concepts
├── tutorial.md               # Simple performance optimization tutorial
├── guides/                   # Goal-specific guides
│   ├── code-splitting.md
│   ├── image-optimization.md
│   └── caching-strategies.md
└── troubleshooting.md        # Troubleshooting
```

Type-specific structure guidelines:
- Tutorial documents: Overview → Hands-on → Advanced hierarchy
- Problem-solving/Explanation documents: Same-level parallel structure
- Reference documents: Provide lists on separate pages

**PA17. Use cross-links** (set up inter-document connections):
- Tutorial mentions a topic briefly → link to guide/reference for details
- Enable readers to find deeper information when needed
- Add mutual links between related documents

Before (no links):
```markdown
코드 분할을 적용하면 초기 로딩 속도가 빨라집니다.
```

After (with cross-links):
```markdown
코드 분할을 적용하면 초기 로딩 속도가 빨라집니다. 코드 분할과 함께 [Lazy Loading](./lazy-loading.md)을 적용하면 더 효과적입니다.
```

Cross-link principles:
- Tutorial → Guide: Link to guides for deeper content
- Guide → Reference: Link to detailed specs and API lists
- Troubleshooting → Guide/Explanation: Link to docs for understanding root causes
- Overview page provides entry points to all child documents
