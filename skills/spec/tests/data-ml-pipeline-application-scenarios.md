# Data / ML Pipeline Application Scenarios

Area: Data / ML Pipeline
Reference: `skills/spec/references/data-ml-pipeline.md`
Scenario Count: 2

---

### DMP-1: 배치+스트림 하이브리드 + ML 서빙 전체 파이프라인 (Happy Path)

**Technique Under Test**: Steps 1-4 Full Pipeline (data-ml-pipeline.md lines 40-151) — Source Inventory + Transformation + Storage + ML Pipeline

**Input**: 커머스 개인화 추천 플랫폼. 데이터 소스: (1) RDBMS 주문 DB(일 100만 건 배치 추출), (2) Kafka 클릭스트림 이벤트(초당 5천 건 스트림), (3) 외부 상품 카탈로그 API(시간당 증분 동기화). ML 컴포넌트: 사용자 행동 기반 상품 추천 모델, 온라인 서빙(p99 < 200ms), 월 1회 재학습. 비즈니스 요구: 추천 클릭률 A/B 테스트 지원. 컴플라이언스: 개인정보 포함(클릭스트림에 사용자 ID).

**Expected Output**: 전체 파이프라인 설계 결과물 — (1) **Step 1 데이터 소스 인벤토리**: 3개 소스 각각에 대해 포맷/볼륨/소유권/신뢰성 명시, 스키마 진화 전략(Kafka Avro + 호환성 정책) 정의. (2) **Step 2 변환 전략**: 배치(주문 이력 집계)와 스트림(실시간 클릭 이벤트 처리)의 처리 모델 선택 근거, 각 변환 단계별 입출력 형태와 실패 처리 명시, 데이터 품질 검증 위치(수집 직후 vs 변환 후) 정의. (3) **Step 3 스토리지 설계**: Raw/Curated/Serving 3개 티어 정의, 파티션 키(사용자 ID + 날짜) 선택 근거, BI 도구/ML 학습/API 서빙 소비자별 접근 SLA. (4) **Step 4 ML 파이프라인**: Feature Engineering 전략(재사용 Feature Store 필요 여부), 온라인 서빙 패턴(p99 200ms SLA), 모델 버전 롤아웃 전략(카나리/블루-그린), A/B 테스트 배정 방식과 성공 기준.

**Pass Criteria**: (1) Step 1에서 3개 소스 모두 Source Characterization(포맷/볼륨/소유권/신뢰성)이 완료되고, (2) Step 2에서 배치와 스트림 처리 모델 선택 근거가 명시되며, (3) Step 3에서 스토리지 티어별 역할과 파티셔닝 전략이 구체적으로 정의되고, (4) Step 4에서 ML 파이프라인 설계가 수행되며 서빙 실패 시 폴백이 정의됨. 데이터 소스를 나열만 하고 특성 분석이 없으면 RED. 처리 모델을 근거 없이 선택하면 RED. ML 파이프라인이 있음에도 Step 4를 스킵하면 RED. 특정 도구(Airflow, Spark 등)를 권장하면 RED.

---

### DMP-2: ML 없는 ETL 파이프라인 — Step 4 Assess Necessity 스킵

**Technique Under Test**: Step 4 Assess Necessity gate (data-ml-pipeline.md lines 123-127) — ML 컴포넌트 부재 시 Step 4 스킵 후 Step 5(Document Generation) 진행

**Input**: 사내 영업 분석 데이터 웨어하우스 구축 프로젝트. 데이터 소스: CRM 시스템(일 1회 배치 추출), ERP 매출 DB(일 1회 배치 추출), 마케팅 캠페인 CSV 파일(주 1회 수동 업로드). 목적: BI 도구(Tableau)에서 영업 KPI 대시보드 조회. 요구사항: 데이터 신선도 T+1(전일 데이터 익일 오전 8시 반영), ML 모델이나 예측 기능 없음, 순수 ETL + 분석 쿼리 최적화만 필요.

**Expected Output**: Step 4 처리 결과 — (1) **Step 1-3 정상 수행**: 데이터 소스 인벤토리(3개 소스 특성 분석), 일배치 변환 전략 및 데이터 품질 검증(T+1 SLA 기준), Raw/Curated/Serving 스토리지 티어와 BI 도구 접근 패턴 설계. (2) **Step 4.1 Assess Necessity 수행**: 아키텍처 내 ML/모델 서빙 컴포넌트 존재 여부 분석 → ML 컴포넌트 없음 확인 → Step 4 나머지 서브스텝(4.2 Feature Engineering, 4.3 Model Serving, 4.4 Experiment Tracking) 스킵 판정. (3) **스킵 근거 명시**: "ML/모델 서빙 컴포넌트 없음, 순수 ETL 파이프라인으로 ML 파이프라인 설계 불필요"로 근거 제시. (4) **Step 5 Document Generation 진행**: ML 스킵 후 바로 문서 생성 단계로 전환.

**Pass Criteria**: (1) Step 4.1 Assess Necessity에서 ML 컴포넌트 존재 여부 분석이 수행되고, (2) ML 없음 판정 시 4.2-4.4 서브스텝이 명시적으로 스킵되며, (3) 스킵 근거가 "ML 컴포넌트 없음"으로 구체적으로 명시되고, (4) 스킵 후 Step 5(Document Generation)로 올바르게 전환됨. Step 4 Assess Necessity 분석 없이 바로 ML 설계를 시작하면 RED. ML이 없음에도 Feature Engineering이나 Model Serving 설계를 강제하면 RED. Assess Necessity 스킵 결정을 사용자 확인 없이 단독 결정하면 RED.
