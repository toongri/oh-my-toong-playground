# Wrapup Application Scenarios

Area: Wrapup
Reference: `skills/spec/references/wrapup.md`
Scenario Count: 3

---

### WU-1: Next-Spec Influence Filter

**Technique Under Test**: Principles "Next-Spec Influence Filter" (wrapup.md line 13) + Step 1.2 Extract Candidates (lines 42-52)

**Input**: 완료된 스펙에서 추출한 6개 결정 레코드 — (1) 아키텍처: "모놀리스 우선, 마이크로서비스 전환 기준 정의됨", (2) 아키텍처: "이벤트 소싱 대신 CRUD+이벤트 발행 선택", (3) 기술 선택: "PostgreSQL 선택 (팀 익숙도)", (4) 기술 선택: "Redis 캐시 선택 (성능 요구)", (5) 범위 제외: "실시간 알림은 MVP 이후로 연기", (6) 네이밍 관례: "도메인 객체 한국어 이름 사용".

**Expected Output**: Next-Spec Influence Test 적용 ("이 정보가 빠지면 다음 설계에서 잘못된 방향으로 갈 수 있는가?"). 통과: (1) 모놀리스 우선 (다음 스펙에서 불필요한 마이크로서비스 분리 방지), (2) CRUD+이벤트 발행 (다음 스펙에서 이벤트 소싱 가정 방지), (5) 실시간 알림 연기 (다음 스펙에서 이미 있다고 가정 방지). 필터: (3) PostgreSQL (기술 선택 자체는 project.md에 이미), (4) Redis (마찬가지), (6) 네이밍 관례 (영향도 낮음).

**Pass Criteria**: (1) 6개 레코드 모두에 필터 테스트가 적용되고, (2) 통과/필터 분류가 올바르며, (3) 각 판정에 근거가 명시됨. 필터 없이 모든 레코드를 context에 포함하면 RED.

---

### WU-2: Team Tendency Extraction

**Technique Under Test**: Step 2.3 Decisions — "How to extract tendencies" (wrapup.md lines 117-151)

**Input**: 5개 관련 결정 — 모두 복잡한 옵션 대신 단순한 옵션 선택: (1) gRPC 대신 REST 선택, (2) 마이크로서비스 대신 모놀리스 선택, (3) NoSQL 대신 SQL 선택, (4) 이벤트 드리븐 대신 동기 통신 선택, (5) 멀티 DB 대신 단일 DB 선택.

**Expected Output**: (1) 패턴으로 그룹핑 — "Simplicity Bias" (또는 유사 이름). (2) 패턴 이름 부여. (3) 5개 결정을 Evidence로 나열 (한 줄씩). (4) 패턴의 향후 설계 의미 요약 — "이 팀은 검증된 단순 기술을 선호하며, 복잡성 도입 시 강한 정당화가 필요함". Variant format (lines 136-151) 사용.

**Pass Criteria**: (1) 공통 원칙으로 그룹핑되고, (2) 패턴 이름이 부여되며, (3) Evidence가 나열되고, (4) 향후 설계에 대한 함의가 요약됨. 개별 ADR 항목을 나열만 하면 RED.

---

### WU-3: Context File Boundary

**Technique Under Test**: Step 2 Context File Boundaries table (wrapup.md lines 60-67) + 각 섹션의 "What belongs here" / "What does NOT belong here"

**Input**: 혼합된 스펙 산출물 — (1) 프로젝트 비전: "실시간 주문 처리 플랫폼, 확장성 우선", (2) 팀 결정 패턴: "단순성 편향 — 검증된 기술 선호", (3) 코딩 관례: "에러 발생 시 3채널 알림(Slack, 이메일, PagerDuty)", (4) 구현 함정: "Redis TTL 미설정 시 메모리 누수 발생".

**Expected Output**: 각 항목을 올바른 context 파일에 배정 — (1) -> project.md (프로젝트 정체성/철학), (2) -> decisions.md (팀 성향), (3) -> conventions.md (코딩 레벨 패턴), (4) -> gotchas.md (구현 함정). 각 배정의 근거 포함. 경계 규칙 적용: "코드 작성 일관성 가이드 = convention, 설계 결정 가이드 = tendency".

**Pass Criteria**: (1) 4개 항목 모두 올바른 파일에 배정되고, (2) 각 배정에 근거가 있으며, (3) 파일 간 경계가 준수됨. 모든 항목을 하나의 파일에 넣거나 경계를 무시하면 RED.
