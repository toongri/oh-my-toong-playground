# Type Classification Application Scenarios

Area: Type Classification
Reference: `skills/technical-writing/references/type.md`
Scenario Count: 5

---

### TY-1: 학습 문서 유형 분류

**Technique Under Test**: P16 유형 선택 기준 (type.md Step 1)

**Input**:
```markdown
# Spring Boot 시작하기

Spring Boot는 자바 기반의 프레임워크입니다.

## 설치

먼저 JDK 17을 설치하세요.

## 프로젝트 생성

Spring Initializr에서 프로젝트를 생성합니다.

## 첫 번째 API 만들기

@RestController를 사용해 간단한 API를 만들어 봅시다.
```

**Expected Output**:
- 유형: **학습** 문서로 분류
- 근거: "시작하기" 제목 + 설치→생성→실습의 단계별 구조 + 처음 접하는 독자 대상

**Pass Criteria**:
(1) "학습" 유형으로 정확히 분류
(2) 분류 근거에 "시작하기", "단계별", "처음 접하는 독자" 중 하나 이상 언급
(3) 다른 유형(문제 해결, 참조, 설명)으로 분류하면 RED

---

### TY-2: 학습 문서 필수 요소 누락 검출

**Technique Under Test**: P17 학습 문서 필수 요소 (type.md Step 2)

**Input**:
```markdown
# React Hooks 배우기

## useState

useState는 상태를 관리하는 Hook입니다.

const [count, setCount] = useState(0);

## useEffect

useEffect는 부수 효과를 처리합니다.

useEffect(() => {
  document.title = `${count}번 클릭`;
}, [count]);
```

**Expected Output**:
P17 기준 누락 요소 검출:
1. 학습 목표 없음 (문서 시작에 "이 문서를 읽으면 무엇을 할 수 있는가" 없음)
2. 사전 준비사항 없음 (React 버전, Node.js 버전 등)
3. 코드가 실행 불가 (import 없음, 컴포넌트 래핑 없음)
4. FAQ/다음 단계 없음

**Pass Criteria**:
(1) "학습 목표 누락"을 Critical로 지적
(2) "사전 준비사항 누락"을 지적
(3) "실행 불가 코드"를 지적
(4) 4개 누락 중 3개 이상 검출하면 PASS. If 1개 이하만 검출 RED

---

### TY-3: 문제 해결 문서 유형 분류 및 필수 요소 검증

**Technique Under Test**: P16 유형 선택 + P19 문제 해결 필수 요소 (type.md Step 1, Step 2)

**Input**:
```markdown
# CORS 에러 해결

CORS는 Cross-Origin Resource Sharing의 약자입니다. 브라우저에서 다른 도메인의 리소스에 접근할 때 보안 정책으로 인해 차단되는 현상입니다.

## 해결 방법

서버에 Access-Control-Allow-Origin 헤더를 추가하세요.
```

**Expected Output**:
- 유형: **문제 해결** 문서로 분류
- P19 기준 누락 요소:
  1. 에러 메시지/로그 예시 없음 (실제 콘솔에 표시되는 에러 메시지)
  2. 구체적 코드/명령어 없음 (어떤 서버에서 어떻게 추가하는지)
  3. 환경별 차이 없음 (Express, Nginx, Spring Boot 등 서버별)
  4. 해결 원리 설명 불충분

**Pass Criteria**:
(1) "문제 해결" 유형으로 분류
(2) "에러 메시지 예시 없음"을 지적
(3) "구체적 코드/명령어 없음"을 지적
(4) 3개 누락 중 2개 이상 검출하면 PASS. If 누락 검출 없이 "잘 작성됨"으로 평가하면 RED

---

### TY-4: 참조 문서 표준 구조 검증

**Technique Under Test**: P21 참조 문서 표준 구조, P22 품질 기준 (type.md Step 2)

**Input**:
```markdown
# Array.prototype.map()

배열의 각 요소에 대해 함수를 호출한 결과로 새로운 배열을 만듭니다.

## 예제

const numbers = [1, 2, 3];
const doubled = numbers.map(n => n * 2);
// [2, 4, 6]
```

**Expected Output**:
P21 표준 구조 기준 누락:
1. 시그니처 없음 (`arr.map(callback(element, index, array), thisArg)`)
2. 매개변수 설명 없음 (callback의 인자, thisArg 등 타입/기본값/필수여부)
3. 반환값 명시 없음
4. 응용 예제 없음 (기본 예제만 존재)

**Pass Criteria**:
(1) "참조" 유형으로 분류
(2) "시그니처 누락"을 지적
(3) "매개변수 설명 누락"을 지적
(4) "반환값 명시 없음"을 지적
(5) 4개 누락 중 3개 이상 검출하면 PASS. If "예제가 있으므로 충분"으로 평가하면 RED

---

### TY-5: 설명 문서 구성 순서 검증

**Technique Under Test**: P23 설명 문서 구성 순서 (type.md Step 2)

**Input**:
```markdown
# 가비지 컬렉션

## Mark and Sweep 알고리즘

1. Root에서 시작해 접근 가능한 객체를 마킹합니다.
2. 마킹되지 않은 객체를 제거합니다.

## 가비지 컬렉션이란?

프로그램이 사용하지 않는 메모리를 자동으로 해제하는 메커니즘입니다.

## 왜 필요한가?

수동 메모리 관리는 메모리 누수와 댕글링 포인터 문제를 일으킵니다.
```

**Expected Output**:
P23 기준 구성 순서 위반:
1. 등장 배경/문제 상황이 맨 뒤에 위치 ("왜 필요한가?" → 맨 앞이어야 함)
2. 개념 정의("가비지 컬렉션이란?")가 알고리즘 설명 뒤에 위치
3. 올바른 순서: 등장 배경 → 개념 정의 → 작동 방식 → 시각적 다이어그램 → 코드 예제

**Pass Criteria**:
(1) "설명" 유형으로 분류
(2) 구성 순서 위반을 지적 (배경이 뒤에, 정의가 알고리즘 뒤에)
(3) 올바른 순서를 제안
(4) 순서 문제를 지적하지 않으면 RED
