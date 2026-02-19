# Architecture Review Application Scenarios

Area: Architecture Review
Reference: `skills/technical-writing/references/architecture.md`
Scenario Count: 8

---

### AR-1: H4 이상 깊이 문서 분리 감지

**Technique Under Test**: P1 H4 이상이면 문서 분리 (architecture.md Step 1)

**Input**:
```markdown
# Docker 완벽 가이드
## 설치
### macOS
#### Homebrew로 설치
##### M1 Mac 주의사항
### Windows
#### WSL2 설정
##### WSL2 네트워크 설정
## 기본 명령어
### 컨테이너 관리
#### docker run 옵션
##### 볼륨 마운트
```

**Expected Output**:
P1 기준:
1. H5(#####) 수준까지 도달 — 문서 분리 필요
2. 분리 제안: "Docker 설치 (macOS)" / "Docker 설치 (Windows)" / "Docker 기본 명령어" 등 별도 문서로 분리
3. 개요 페이지(P2)에서 각 문서로 링크하는 구조 제안

**Pass Criteria**:
(1) H4/H5 깊이를 문서 분리 신호로 지적
(2) 구체적 분리 방안 제안 (최소 2개 이상 별도 문서)
(3) 개요 페이지 활용 제안
(4) 깊이 문제를 지적하지 않으면 RED

---

### AR-2: 소제목 스타일 불일관 감지

**Technique Under Test**: P4 소제목 스타일 일관성 (architecture.md Step 2)

**Input**:
```markdown
# API 인증 가이드
## 토큰 발급받기
## 인증 헤더 설정
## API 키를 관리하세요
## 만료된 토큰 갱신
## 보안 주의사항에 대해
```

**Expected Output**:
P4 기준:
- "토큰 발급받기" / "인증 헤더 설정" / "만료된 토큰 갱신" → '~하기'/'~설정' 명사형 혼재
- "API 키를 관리하세요" → 명령형 (나머지와 불일치)
- "보안 주의사항에 대해" → 불완전한 문장
- 통일 제안: "토큰 발급하기" / "인증 헤더 설정하기" / "API 키 관리하기" / "토큰 갱신하기" / "보안 주의사항 확인하기"

**Pass Criteria**:
(1) 소제목 스타일 불일관을 지적
(2) 최소 2개 이상 불일치 소제목 구체적 지목
(3) 일관된 스타일로 통일한 대안 제시
(4) "API 키를 관리하세요"의 명령형 불일치를 감지하지 못하면 RED

---

### AR-3: 개요 누락 및 품질 검증

**Technique Under Test**: P6 개요, P7 핵심 정보 먼저 (architecture.md Step 3)

**Input**:
```markdown
# Kafka 프로듀서 설정

## 기본 설정

bootstrap.servers를 설정합니다.

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
```

## 메시지 전송

send() 메서드로 메시지를 전송합니다.
```

**Expected Output**:
P6 기준:
- 개요 완전 누락: 제목 바로 아래에 "이 문서를 읽으면 무엇을 할 수 있는가"에 대한 답변 없음
- 개요 추가 제안: "Kafka 프로듀서의 기본 설정 방법과 메시지 전송 방법을 알아봅니다. 이 가이드를 따르면 Java 애플리케이션에서 Kafka로 메시지를 발행할 수 있습니다."

P7 기준:
- 코드가 설명 없이 바로 등장 (P9 설명→코드 순서 위반이기도 함)

**Pass Criteria**:
(1) 개요 누락을 Critical로 지적
(2) 구체적 개요 문구 제안
(3) 2개 중 2개 모두 검출하면 PASS. If 개요 누락을 지적하지 않으면 RED

---

### AR-4: 코드 먼저 등장 (설명→코드 순서 위반)

**Technique Under Test**: P9 설명→코드 순서 (architecture.md Step 4)

**Input**:
```markdown
# 환경 변수 설정

## 데이터베이스 연결

```yaml
database:
  host: localhost
  port: 5432
  name: mydb
  username: admin
  password: secret
```

위 설정을 application.yml에 추가하면 데이터베이스에 연결할 수 있습니다.

## Redis 캐시

```yaml
redis:
  host: localhost
  port: 6379
```

Redis 캐시 서버 설정입니다.
```

**Expected Output**:
P9 위반 2건:
1. "데이터베이스 연결" 섹션: YAML 코드가 설명보다 먼저 등장
2. "Redis 캐시" 섹션: YAML 코드가 설명보다 먼저 등장
- 개선: 각 섹션에서 설명을 먼저, 코드를 나중에 배치

**Pass Criteria**:
(1) 2개 섹션 모두에서 코드→설명 순서 위반 지적
(2) 설명→코드 순서로 변경하는 Before/After 제안
(3) 1개 섹션만 지적하면 부분 PASS. 0개면 RED

---

### AR-5: 논리 순서 위반 (심화→기본)

**Technique Under Test**: P10 논리 순서 (architecture.md Step 4)

**Input**:
```markdown
# TypeScript 제네릭

## 제네릭 조건부 타입
type IsString<T> = T extends string ? "yes" : "no";

## 제네릭 유틸리티 타입
Partial<T>, Required<T>, Pick<T, K>를 활용합니다.

## 제네릭이란?
타입을 매개변수처럼 사용하는 기능입니다.

## 제네릭 함수 만들기
function identity<T>(arg: T): T { return arg; }
```

**Expected Output**:
P10 기준 순서 위반:
- 현재: 조건부 타입(고급) → 유틸리티 타입(심화) → 정의(기본) → 함수(기본)
- 올바른 순서: 정의(기본) → 함수(기본) → 유틸리티 타입(심화) → 조건부 타입(고급)

**Pass Criteria**:
(1) 기본 개념이 심화 내용 뒤에 있음을 지적
(2) 기본→심화→고급 순서 재배치 제안
(3) 순서 문제를 지적하지 않으면 RED

---

### AR-6: 가치보다 배경 먼저 제시

**Technique Under Test**: P12 도입부에 가치 먼저, P13 기능 전에 유용성 (architecture.md Step 5)

**Input**:
```markdown
# gRPC 도입하기

gRPC는 2015년 Google에서 개발한 오픈소스 원격 프로시저 호출 프레임워크입니다. Protocol Buffers를 IDL로 사용하며, HTTP/2 기반으로 동작합니다. 원래는 Google 내부의 Stubby라는 시스템에서 발전했습니다.

## 주요 특징
- HTTP/2 멀티플렉싱
- Protocol Buffers 직렬화
- 양방향 스트리밍
- 다양한 언어 지원

## 설치 방법
...
```

**Expected Output**:
P12 기준:
- 도입부가 역사/배경 정보로 시작 (2015년, Google, Stubby)
- 독자가 얻을 가치가 먼저 제시되어야 함

P13 기준:
- 주요 특징이 기능 나열 형태 (왜 유용한지 설명 없음)

개선 제안:
> gRPC를 도입하면 REST API 대비 최대 10배 빠른 마이크로서비스 간 통신을 구현할 수 있습니다.

**Pass Criteria**:
(1) 도입부의 배경/역사 먼저 제시 문제를 지적
(2) 가치/이점을 먼저 제시하도록 개선 제안
(3) 기능 나열에 "왜 유용한지" 부재를 지적
(4) 배경 먼저 제시를 지적하지 않으면 RED

---

### AR-7: PA16 다중 페이지 구조 설계 검증

**Technique Under Test**: PA16 다중 페이지 구조 설계 (architecture.md Step 7)

**Input**:
```markdown
# Next.js 성능 최적화

## 개요
Next.js 애플리케이션의 성능을 최적화하는 방법을 알아봅니다.

## 코드 분할이란?
코드 분할은 번들을 작은 청크로 나누는 기법입니다.

## 코드 분할 적용하기
dynamic import를 사용해 코드 분할을 적용합니다.

## 이미지 최적화란?
next/image 컴포넌트를 사용한 이미지 최적화입니다.

## 이미지 최적화 적용하기
next/image를 import하여 사용합니다.

## 캐싱 전략 개요
캐싱은 서버 응답을 저장하는 기법입니다.

## 캐싱 전략 적용하기
Cache-Control 헤더를 설정합니다.

## 문제 해결
성능 저하 시 확인할 사항들입니다.
```

P1에 의해 문서 분리가 권고된 상태이나, 분리 후 디렉토리 구조가 설계되지 않음.

**Expected Output**:
PA16 기준:
1. 여러 주제(코드 분할, 이미지 최적화, 캐싱 전략)가 한 문서에 혼재 — 유형별 디렉토리 구조 필요
2. 디렉토리 구조 제안:
```
nextjs-performance-optimization/
├── index.md                    # 개요
├── fundamentals.md             # 성능 최적화 기본 개념
├── guides/                     # 목표별 가이드
│   ├── code-splitting.md         # 코드 분할
│   ├── image-optimization.md     # 이미지 최적화
│   └── caching-strategies.md     # 캐싱 전략
└── troubleshooting.md          # 문제 해결
```
3. 개념 설명("~이란?")과 적용 방법("~적용하기")을 각 가이드 문서 내에서 통합

**Pass Criteria**:
(1) 유형별 디렉토리 구조를 구체적으로 제안
(2) 최소 2개 이상의 유형별 분류 (가이드, 개요, 트러블슈팅 등)
(3) 기본 템플릿 또는 주제 특화 구조를 참고한 설계
(4) 단순 파일 나열만 하고 디렉토리 구조를 제안하지 않으면 RED

---

### AR-8: PA17 크로스링크 누락 감지

**Technique Under Test**: PA17 크로스링크 활용 (architecture.md Step 7)

**Input**:
```markdown
<!-- docs/tutorials/getting-started.md -->
# 시작하기

## 프로젝트 생성
npx create-next-app을 실행합니다.

## 기본 라우팅
pages 디렉토리에 파일을 추가하면 자동으로 라우팅됩니다.

## 데이터 페칭
getServerSideProps를 사용해 서버 사이드 렌더링을 합니다.
```

```markdown
<!-- docs/guides/data-fetching.md -->
# 데이터 페칭 가이드

## getServerSideProps
요청마다 서버에서 데이터를 가져옵니다.

## getStaticProps
빌드 시 데이터를 가져옵니다.

## ISR (Incremental Static Regeneration)
정적 페이지를 주기적으로 재생성합니다.
```

```markdown
<!-- docs/reference/api-reference.md -->
# API 참조

## getServerSideProps
- 반환 타입: { props: object } | { redirect: object } | { notFound: boolean }
- 실행 시점: 매 요청마다

## getStaticProps
- 반환 타입: { props: object, revalidate?: number }
- 실행 시점: 빌드 타임
```

여러 문서로 구성되어 있으나 문서 간 크로스링크가 전혀 없는 상태.

**Expected Output**:
PA17 기준:
1. 튜토리얼 → 가이드 크로스링크 누락:
   - "시작하기"의 "데이터 페칭" 섹션에서 [데이터 페칭 가이드](../guides/data-fetching.md)로 링크 필요
2. 가이드 → 참조 크로스링크 누락:
   - "데이터 페칭 가이드"의 각 함수 설명에서 [API 참조](../reference/api-reference.md)로 링크 필요
3. 튜토리얼 → 참조 크로스링크:
   - "시작하기"의 getServerSideProps 언급에서 API 참조로 직접 링크 가능

**Pass Criteria**:
(1) 최소 2개 이상의 크로스링크 방향 제안 (튜토리얼→가이드, 가이드→참조 등)
(2) 구체적 링크 위치와 대상 문서를 명시
(3) 크로스링크 설정 원칙(튜토리얼→가이드→참조 흐름)에 부합
(4) 크로스링크 누락을 지적하지 않으면 RED
