# Frontend / UX Surface Application Scenarios

Area: Frontend / UX Surface
Reference: `skills/spec/references/frontend-ux-surface.md`
Scenario Count: 2

---

### FUX-1: SPA 컴포넌트 아키텍처 분석 (Happy Path)

**Technique Under Test**: Step 1 Component Architecture Analysis (frontend-ux-surface.md lines 40-62) + Principles "Define frontend architecture at Strategy + Boundary level" (lines 11-14)

**Input**: 전자상거래 플랫폼 SPA 프로젝트. 공유 디자인 시스템(버튼, 인풋, 모달, 테이블 등 20+ 공통 컴포넌트) 보유. 주요 페이지: 홈/검색 결과/상품 상세/장바구니/결제/마이페이지/관리자 대시보드 총 7개 기능 영역. 팀 구성: 피처팀 3개(상품, 주문, 사용자)가 각 기능 영역 독립 개발. 요구사항: 공통 컴포넌트는 별도 패키지로 관리, 피처팀 간 스타일 충돌 없이 동시 개발 가능해야 함.

**Expected Output**: 3가지 계층 구조로 구성된 컴포넌트 아키텍처 결과물 — (1) **컴포넌트 계층 구조**: 공통 컴포넌트 계층(디자인 시스템 래퍼) → 레이아웃 컴포넌트(페이지 골격) → 피처 컴포넌트(도메인별) → 페이지 컴포넌트의 4단계 계층 명시. (2) **공유 컴포넌트 전략**: 도메인 무관한 UI 원자 단위는 공통 패키지, 도메인 로직 포함 컴포넌트는 피처 소유로 분리 기준 정의. (3) **컴포넌트 소유권**: 공통 컴포넌트 유지보수 담당 팀/프로세스 명시. (4) **컴포넌트 간 통신 패턴**: 피처 간 데이터 전달 방식(이벤트 버스, 공유 상태, Props drilling 회피 전략) 명시.

**Pass Criteria**: (1) 1.1 Application Structure Overview에서 주요 기능 영역 7개가 식별되고, (2) 1.2 Component Decomposition Strategy에서 공유/도메인 컴포넌트 분리 기준이 모호하지 않게 정의되며, (3) 1.3 Composition Patterns에서 페이지-레이아웃-피처 관계가 구조적으로 설명되고, (4) 컴포넌트 소유권이 명시됨. "컴포넌트를 잘 나눠서 쓰면 된다"와 같은 모호한 전략이면 RED. 프레임워크나 라이브러리 선택(React vs Vue)이 포함되면 RED. 소유권 없이 공유 컴포넌트만 열거하면 RED.

---

### FUX-2: 조건부 서브스텝 스킵 — SSR/애니메이션/i18n 불필요 프로젝트

**Technique Under Test**: Step 4 Interaction & UX Patterns — conditional sub-steps (if applicable) (frontend-ux-surface.md lines 131-147) + Step 4.1 Core User Flows (lines 112-116)

**Input**: 사내 HR 관리자 전용 대시보드 프로젝트. 사용자: 회사 HR 담당자 50명, 인터넷 노출 없는 사내망 전용. 기능: 직원 정보 조회/수정, 급여 명세 관리, 휴가 승인. 제약: SEO 불필요(사내망), 애니메이션 없이 깔끔한 테이블 UI 선호, 한국어 단일 언어 서비스, 성능 요구사항 없음(50명 동시 사용). SSR/애니메이션/i18n 필요 여부를 검토해달라는 요청.

**Expected Output**: Step 4 처리 결과 — (1) **4.1 Core User Flows**: 직원 조회→상세 보기→수정→저장의 핵심 플로우, 휴가 승인 플로우 정의. (2) **4.2 Loading/Error/Empty States**: 직원 목록 로딩 중 스켈레톤 UI, 저장 실패 시 인라인 에러, 검색 결과 없음 메시지 각각 정의. (3) **4.3 Accessibility**: 키보드 탐색(탭 순서), 색 대비 기준 정의. (4) **4.4 SSR/SSG 스킵**: SEO 불필요(사내망), 성능 요구사항 없음(50명), 크롤링 대상 없음으로 SSR/SSG 불필요 판정 + 근거 명시. (5) **4.5 Animation 스킵**: 심미적 애니메이션 없는 테이블 UI 선호로 Motion System 불필요 판정 + 근거 명시. (6) **4.6 i18n 스킵**: 한국어 단일 언어로 i18n 불필요 판정 + 근거 명시.

**Pass Criteria**: (1) 4.4/4.5/4.6의 각 서브스텝에서 "if applicable" 분석이 수행되고, (2) 스킵 판정 시 구체적 근거(SEO 불필요/단일 언어 등)가 명시되며, (3) 스킵된 서브스텝이라도 Analyze → Present → Confirm 순서로 처리됨 (스킵 판정이면 Define 단계 생략). (4) 스킵 대상 서브스텝에도 불구하고 4.1~4.3(Core Flows, Loading/Error/Empty, Accessibility)은 정상 수행됨. 근거 없이 "SSR 안 씀"만 선언하면 RED. SSR/i18n/Animation을 분석 없이 일괄 스킵하면 RED. Core User Flows 정의 없이 조건부 스텝만 처리하면 RED.
