# Type Classification

## Role

Classifies document type and verifies that required elements for that type are met.

## 4 Document Types

| Type | Reader State | Core Question |
|------|-------------|---------------|
| Tutorial | First encounter | "어떻게 시작하지?" |
| How-to | Has background, problem occurred | "이 문제 어떻게 해결하지?" |
| Reference | Knows usage, checking details | "이 파라미터 뭐였지?" |
| Explanation | Wants deep understanding | "이게 왜 이렇게 동작하지?" |

## Process

### Step 1: Type Classification

Read the document's title, overview, and first paragraph to determine the type.

**P16. Type selection criteria:**
- "에러 해결", "문제 발생 시" → How-to
- "개념", "원리", "왜" → Explanation
- "API", "파라미터", "시그니처" → Reference
- "시작하기", "설치", "첫 번째" → Tutorial
- Hybrid types allowed: Tutorial+Reference, etc.

### Step 2: Verify Required Elements by Type

#### P17. Tutorial Required Elements

1. Clear learning objectives (at document start)
2. Prerequisites (versions, tools, prior knowledge)
3. Step-by-step structure (simple → progressive difficulty)
4. Executable code examples (reader can verify independently)
5. FAQ or next steps guide

**Template:**

```
# [튜토리얼 제목]

## 목표

[이 튜토리얼을 따라하고 나면 독자가 달성할 목표를 간략히 설명하세요.]

## 사전 요구사항

- [이 튜토리얼을 따라 하기 전에 필요한 사전 지식, 설치해야 할 도구를 정리하세요. 없다면 생략해도 돼요.]
- [예: Node.js 버전, API 키, 필수 패키지 등]

## 단계별 가이드

### [첫 번째 단계 제목]

[이 단계에서 해야 할 작업을 설명하고 코드 예제 또는 UI 캡처를 포함하세요.]

### [두 번째 단계 제목]

[다음 단계에서 수행할 작업을 설명하세요.]

// ...

### 최종 결과 확인

[독자가 목표를 달성했을 때, 어떤 결과가 나오는지 설명하세요.]
```

**P18. Getting Started vs Tutorial distinction:**
- Getting Started: Understand overall flow (overview-focused, quick start)
- Tutorial: Clear goal + deliverable (step-by-step hands-on)

**Example: React 시작하기**

> # React 시작하기
>
> React는 컴포넌트 기반으로 UI를 만들 수 있는 라이브러리예요. 여기서는 가장 기본적인 React 프로젝트를 실행해보고 동작 방식을 이해해요.
>
> ## React 실행하기
>
> ### 1. 프로젝트 만들기
>
> ```
> npx create-react-app my-app
> cd my-app
> npm start
> ```
>
> 개발 서버가 실행된 후, 브라우저에서 `http://localhost:3000`을 열어 React 기본 화면을 확인하세요.
>
> ## React에서 화면을 만드는 방법
>
> React에서는 컴포넌트라는 개념을 사용해서 화면을 구성해요. 컴포넌트는 UI의 가장 작은 단위예요.
>
> ### 기본 컴포넌트 만들기
>
> `src/App.js` 파일을 열고 내용을 아래처럼 바꿔보세요.
>
> ```javascript
> function App() {
>   return <h1>안녕하세요! React를 시작해 봅시다.</h1>;
> }
>
> export default App;
> ```
>
> 파일을 저장한 후, 브라우저를 새로고침하면 React 기본 화면 대신 "안녕하세요! React를 시작해 봅시다."라는 문구가 표시됩니다.
>
> ## 직접 컴포넌트 만들기
>
> 1. `src` 폴더 안에 `Welcome.js` 파일을 생성하세요.
> 2. 다음 코드를 입력하고 저장하세요.
>
> ```javascript
> function Welcome({ name }) {
>   return <h2>안녕하세요, {name}님!</h2>;
> }
>
> export default Welcome;
> ```
>
> 이제 `App.js`에서 새로운 `Welcome` 컴포넌트를 추가해보세요.
>
> ```javascript
> import Welcome from "./Welcome";
>
> function App() {
>   return (
>     <div>
>       <h1>React 학습을 시작해봅시다!</h1>
>       <Welcome name="주연" />
>     </div>
>   );
> }
>
> export default App;
> ```

Notes:

1. Introduces essential concepts and basic usage. Learning objectives must be clearly stated.
2. Guides through the most basic installation and setup. Includes how to verify results after execution.
3. Structured so users can run with minimal code. Expected results at each step must be clear so readers can self-verify success.

#### P19. How-to Document Required Elements

1. Clear problem definition (distinguish cause vs symptom)
2. Include error message/log examples
3. Immediately applicable solution + code/commands
4. Explanation of why the solution works
5. Environment-specific differences (OS, library versions)

**Template:**

```
# [문제 해결 문서 제목]

## 문제 정의

[독자가 겪을 수 있는 문제 상황을 설명하세요.]

## 사전 요구사항

[문제를 해결하기 전에 필요한 환경 설정이나 필수 조건을 정리하세요. 없다면 생략해도 돼요.]

## 해결 방법

### [첫 번째 해결 방법]

[첫 번째 해결 방법을 설명하세요.]

### [두 번째 해결 방법]

[다른 해결 방법이 있다면 추가하세요.]

### 문제 해결 후 확인 방법

[문제가 해결된 후의 모습이나 확인하는 방법을 설명하세요.]
```

**P20. How-to Guide vs Troubleshooting distinction:**
- How-to guide: Focused on implementing a specific feature ("how to do X")
- Troubleshooting: Diagnosing + resolving an existing problem

**Example 1: How-to Guide — React에서 자동 재시도 기능 통합 가이드**

> 자동 재시도 로직을 React 컴포넌트에 통합하여 API 요청 실패 시 자동으로 재시도하는 기능을 구현하는 방법을 알려드려요. 이 기능으로 네트워크 불안정 상황에서도 안정적인 데이터 요청을 보장하여 사용자 경험을 개선할 수 있어요.
>
> ### UI 구현하기
>
> 다음 예제는 자동 재시도 로직을 활용해 API 데이터를 불러오고, 로딩 상태와 오류 처리를 포함한 UI를 구현하는 코드입니다.
>
> ```jsx
> import { useEffect, useState } from "react";
>
> function App() {
>   const [data, setData] = useState(null);
>   const [error, setError] = useState(null);
>   const [loading, setLoading] = useState(true);
>
>   useEffect(() => {
>     fetchWithRetry("https://jsonplaceholder.typicode.com/todos/1", {}, 3, 1000)
>       .then(json => {
>         setData(json);
>         setLoading(false);
>       })
>       .catch(err => {
>         setError(err.message);
>         setLoading(false);
>       });
>   }, []);
>
>   return (
>     <div>
>       {loading ? (
>         <p>데이터 로딩 중...</p>
>       ) : error ? (
>         <p style={{ color: "red" }}>{error}</p>
>       ) : (
>         <div>
>           <h2>API 데이터</h2>
>           <pre>{JSON.stringify(data, null, 2)}</pre>
>         </div>
>       )}
>     </div>
>   );
> }
>
> export default App;
> ```

Notes: Clearly defines the document goal and target audience. Shows how to use the retry logic (`fetchWithRetry`) to reliably request API data and reflect results in state.

**Example 2: Troubleshooting — "Module not found: Can't resolve 'react'" 에러 해결 가이드**

> "Module not found: Can't resolve 'react'" 에러가 발생했을 때 해결 방법을 알려드려요.
>
> ### 1. 패키지 설치 여부 확인
>
> 이 에러는 React 패키지가 설치되어 있지 않거나, `node_modules` 디렉토리 내에 해당 모듈이 존재하지 않을 때 발생합니다.
>
> 터미널에서 아래 명령어를 실행하여 React 패키지가 설치되어 있는지 확인하세요.
>
> ```bash
> npm list react
> ```
>
> ### 2. 패키지 재설치 및 환경 점검
>
> 문제가 계속된다면, React 및 React-DOM 패키지를 재설치해 보세요.
>
> `node_modules` 디렉토리와 `package-lock.json` 파일을 삭제한 후 다시 설치하면, 환경 관련 문제가 해결될 가능성이 높습니다.
>
> ```bash
> # React 및 React-DOM 재설치
> npm install react react-dom
>
> # 또는, 재설치 절차:
> rm -rf node_modules package-lock.json
> npm install
>
> # 이후 프로젝트 실행
> npm start
> ```
>
> ### 3. [선택] Node.js 버전 확인 및 조정
>
> Node.js 버전이 호환되지 않는 경우에도 이 에러가 발생할 수 있어요. 현재 Node.js 버전을 확인하고, 필요하다면 호환되는 버전으로 전환하세요.
>
> ```bash
> node -v
> nvm use 18
> ```

Notes: First step guides quick diagnosis of the most basic cause. Suggests alternative solutions to increase resolution probability. Includes `npm start` step for final verification that the problem is resolved.

#### P21. Reference Document Standard Structure

Function name → Signature → Parameters (type/default/required) → Return value → Usage examples (basic → advanced)

**Template:**

```
# [참조 문서 제목]

## 개요
[이 요소가 무엇이며, 언제 사용하는지, 어떤 가치를 제공하는지 설명하세요.]

## 속성 및 옵션
| 속성명 | 타입 | 기본값 | 설명 |
|--------|------|--------|------|
| prop1 | string | "default" | 이 속성은 ... |

## 시그니처

[// 예제 코드]

## 반환 값

[이 함수나 API가 반환하는 값을 설명하세요.]

## 사용 예제

[어떤 상황에서 사용하는지 구체적인 예시와 함께 예제 코드를 알려주세요.]
```

**P22. Reference Document Quality Criteria:**
- Accuracy & completeness: No technical errors, no omissions, up-to-date
- Searchability: Table of contents, keywords, anchor links
- Place prerequisite info (API keys, auth methods) at the beginning

**Example: fetch API 참조 문서**

> ### `fetch` API
>
> `fetch` 함수는 네트워크 리소스를 요청하고 응답을 처리하는 API예요. 비동기적으로 동작하고, `Promise<Response>` 객체를 반환해요. `fetch` 함수를 활용하면 클라이언트와 서버 간 데이터를 쉽게 주고받을 수 있어, REST API와 같은 서비스와의 통신을 효율적으로 처리할 수 있어요. `XMLHttpRequest`보다 간결한 문법을 제공하고, `async/await`와 함께 사용하면 가독성이 뛰어나다는 장점도 있어요.
>
> #### 시그니처
>
> ```typescript
> fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
> ```
>
> #### 매개변수
>
> - `input` (필수): 요청할 URL 또는 `Request` 객체예요.
> - `init` (선택): 요청의 옵션을 담은 객체예요.
>   - `method`: HTTP 요청 방식 (GET, POST, PUT, DELETE 등)
>   - `headers`: 요청에 포함할 헤더 정보 (예: { 'Content-Type': 'application/json' })
>   - `body`: 요청 본문 (예: JSON.stringify({ name: 'John' }))
>   - `mode`: 요청 모드 (cors, no-cors, same-origin)
>   - `credentials`: 쿠키 포함 여부 (omit, same-origin, include)
>   - `cache`: 캐시 정책 (default, no-store, reload, force-cache 등)
>   - `redirect`: 리디렉션 처리 방식 (follow, error, manual)
>
> #### 반환값
>
> `fetch`는 `Promise<Response>` 객체를 반환해요.
>
> - `ok`: 응답이 성공(200~299)했는지 여부 (true / false)
> - `status`: HTTP 상태 코드 (200, 404, 500 등)
> - `headers`: 응답 헤더 (Headers 객체)
> - `json`(): 응답을 JSON으로 변환 (Promise\<object\>)
> - `text`(): 응답을 문자열로 변환 (Promise\<string\>)
> - `blob`(): 응답을 Blob 객체로 변환 (Promise\<Blob\>)
>
> #### 사용 예제
>
> ##### 기본 GET 요청
>
> ```javascript
> fetch('https://jsonplaceholder.typicode.com/posts/1')
>   .then(response => {
>     if (!response.ok) {
>       throw new Error('네트워크 응답이 올바르지 않아요.');
>     }
>     return response.json();
>   })
>   .then(data => console.log(data))
>   .catch(error => console.error('오류 발생:', error));
> ```
>
> ##### POST 요청 예제
>
> ```javascript
> fetch('https://api.example.com/user', {
>   method: 'POST',
>   headers: {
>     'Content-Type': 'application/json',
>   },
>   body: JSON.stringify({ name: 'John', age: 30 }),
> })
>   .then(response => {
>     if (!response.ok) {
>       throw new Error('요청이 실패했어요.');
>     }
>     return response.json();
>   })
>   .then(data => console.log('서버 응답:', data))
>   .catch(error => console.error('오류 발생:', error));
> ```
>
> ##### async/await 사용
>
> ```javascript
> async function fetchData() {
>   try {
>     const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
>
>     if (!response.ok) {
>       throw new Error('네트워크 응답이 올바르지 않아요.');
>     }
>
>     const data = await response.json();
>     console.log(data);
>   } catch (error) {
>     console.error('오류 발생:', error);
>   }
> }
>
> fetchData();
> ```

Notes: Explains the function's capability and value. Signature provides intuitive understanding of inputs and outputs. Parameters and return values are organized, with examples progressing from basic usage to async/await.

#### P23. Explanation Document Composition Order

Background (problem situation) → Concept definition → How it works (step-by-step) → Visual diagram → Code example

**Template:**

```
# [개념명]

## 개념 소개

[이 개념이 무엇인지 간략히 설명하세요.]

## 등장 배경

[이 개념이 왜 등장했는지, 어떤 문제를 해결하는지 정리하세요.]

## 활용

[실제 프로젝트에서 이 개념이 어떻게 사용되는지 설명하세요.]
```

**P24. Mandatory use of visualizations:**
- Supplement complex concepts with diagrams/flowcharts
- Always add visual materials when text alone is insufficient

**Example: React의 가상 DOM 작동 원리**

> ### React의 가상 DOM 작동 원리
>
> "React의 가상 DOM(Virtual DOM)은 UI 변경을 효율적으로 감지하고 최소한의 변경만 실제 DOM에 반영하는 방식을 통해 성능을 최적화하는 핵심 기술입니다."
>
> #### 가상 DOM이 등장한 배경
>
> 웹 애플리케이션이 복잡해지면서, 기존의 DOM 조작 방식에는 다음과 같은 문제가 발생했습니다.
>
> - DOM 조작 비용이 크다: 직접적인 DOM 변경이 많아질수록 브라우저의 렌더링 성능이 저하됩니다.
> - 전체 페이지 리렌더링 문제: 특정 부분만 변경해도 전체 UI가 다시 그려지는 경우가 많습니다.
> - UI 성능 저하: 많은 DOM 업데이트가 발생하면 프레임 속도가 떨어지고 사용자 경험(UX)이 저하될 가능성이 높습니다.
>
> React는 이러한 문제를 해결하기 위해 가상 DOM을 도입했습니다. 가상 DOM을 활용하면 변경 사항을 먼저 계산하고, 최소한의 연산으로 실제 DOM을 업데이트할 수 있습니다.
>
> #### 개념
>
> "가상 DOM(Virtual DOM)은 실제 DOM의 경량화된 JavaScript 객체 모델입니다." React는 UI 변경이 발생하면 이 가상 DOM을 업데이트한 후, 변경된 부분만 실제 DOM에 반영합니다. 이 방식의 장점은 다음과 같습니다:
>
> - 빠른 연산 가능: 가상 DOM은 메모리에서 동작하므로 계산 속도가 빠릅니다.
> - 효율적인 업데이트: 변경 사항을 비교하여 최소한의 DOM 업데이트만 수행합니다.
> - 예측 가능성 향상: 선언적 UI 모델을 유지하면서도 최적화된 성능을 제공합니다.
>
> #### 작동 방식
>
> 가상 DOM은 다음과 같은 과정을 거쳐 렌더링을 최적화해요.
>
> 1. UI 변경 감지: React는 컴포넌트의 상태(state)나 속성(props)이 변경되면 새로운 가상 DOM을 생성합니다.
> 2. Diffing 알고리즘 적용: 이전 가상 DOM과 새로운 가상 DOM을 비교하여 변경된 요소를 찾습니다.
> 3. 최소한의 변경만 반영: 변경된 부분만 실제 DOM에 적용하여 성능을 최적화합니다.
>
> 이 과정은 React의 핵심 알고리즘인 Reconciliation(조정 과정)을 기반으로 작동합니다.
>
> #### 시각적 다이어그램
>
> ```
> UI 변경 감지
> ┌─────────────────────────────────┐
> │           UI 변경 감지            │
> │   (컴포넌트의 상태/props 변경 감지)   │
> └─────────────────────────────────┘
>               │
>               ▼
> 가상 DOM 업데이트
> ┌─────────────────────────────────┐
> │       가상 DOM 생성 및 업데이트      │
> └─────────────────────────────────┘
>               │
>               ▼
> Diffing 알고리즘 적용
> ┌─────────────────────────────────┐
> │       이전 가상 DOM과 비교하여       │
> │           변경된 요소 도출          │
> └─────────────────────────────────┘
>               │
>               ▼
> 최소 변경 반영 (실제 DOM)
> ┌─────────────────────────────────┐
> │     변경된 부분만 실제 DOM에 반영     │
> └─────────────────────────────────┘
> ```
>
> #### 코드 예제
>
> React의 가상 DOM을 활용하는 간단한 예제입니다.
>
> ```javascript
> import React, { useState } from 'react';
>
> function Counter() {
>   const [count, setCount] = useState(0);
>
>   return (
>     <div>
>       <p>현재 카운트: {count}</p>
>       <button onClick={() => setCount(count + 1)}>증가</button>
>     </div>
>   );
> }
>
> export default Counter;
> ```
>
> 이 코드에서 `setCount`를 호출하면 React는 새로운 가상 DOM을 생성하고, 이전 상태와 비교하여 변경된 부분만 실제 DOM에 반영합니다.

Notes: Follows P23 composition order exactly — background (problem situation) → concept definition → how it works (step-by-step) → visual diagram → code example.

### Step 3: Type Mismatch Reporting

When the document's actual content doesn't match the expected type:
- Specify mismatch points between current type and actual content
- Suggest appropriate type or list missing elements
