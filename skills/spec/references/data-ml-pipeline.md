# Data / ML Pipeline

## Role

As a data and ML pipeline design specialist, systematically define how data flows from source to consumption — including ingestion, transformation, storage, and optionally ML model serving — with explicit decisions on processing models, data quality strategies, and access patterns.

**Output Format**: See `templates/area-outputs.md`

## Principles

- Design at the architectural decision level, not at the tool or implementation level
- Distinguish between batch, streaming, and hybrid processing tradeoffs explicitly
- ML pipeline design is optional — most data pipelines have no ML component
- Every pipeline stage must have explicit data quality expectations and failure handling

### Document Scope

- **Include**: Data source identification, ingestion patterns, schema evolution strategy, transformation logic, processing model selection rationale, storage layer design, partitioning strategy, access patterns, data quality validation, ML feature engineering strategy, model serving pattern, experiment tracking policy
- **Exclude**: Specific tool recommendations (Airflow vs Prefect, Spark vs Flink, dbt vs custom), model architecture details, hyperparameter guidance, embedding parameters, specific orchestration platform configurations

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "데이터 그냥 넣으면 되지" | "데이터 소스의 포맷은? 스키마 변경 시 대응 전략은? 중복·누락 데이터 처리 정책은?" |
| "실시간이면 좋겠어" | "'실시간'의 허용 지연 시간은? 초 단위? 분 단위? 데이터 정합성과 지연 중 우선순위는?" |
| "그냥 S3에 쌓으면 돼" | "데이터 접근 패턴은? 쿼리 빈도와 규모는? 파티셔닝 전략은? 콜드/핫 데이터 구분이 필요한가요?" |
| "나중에 ML 붙이면 되지" | "ML 컴포넌트가 현재 아키텍처에 포함되나요? 포함된다면 어떤 예측/분류 문제를 해결하나요?" |
| "데이터 품질은 팀이 알아서" | "데이터 품질 검증을 파이프라인 어느 단계에서 수행하나요? 품질 실패 시 파이프라인 동작은?" |
| "변환 로직은 간단해" | "'간단하다'는 것이 룩업 조인인가요, 집계인가요, 아니면 복잡한 비즈니스 규칙인가요? 변환 실패 시 처리는?" |
| "배치로 돌리면 되지" | "배치 주기는? 데이터 볼륨과 처리 완료 SLA는? 배치 실패 시 재처리 전략은?" |
| "스키마는 그냥 고정이야" | "스키마 변경이 전혀 없다고 확신하나요? 하위 호환·상위 호환 변경에 대한 정책은 무엇인가요?" |
| "feature는 그냥 원본 데이터 써" | "원본 데이터를 바로 feature로 사용할 때 결측치·이상치 처리는? feature store가 필요한 재사용 범위는?" |
| "모델은 그냥 API 호출" | "모델 서빙의 지연 허용 범위는? 모델 버전 전환 전략은? 서빙 실패 시 폴백은?" |

## Process

### Step 1: Data Source & Ingestion Design

#### 1.1 Input Document Review
- Review: Analyze requirements, solution design, and other completed design documents
- Identify: All data sources — internal databases, external APIs, event streams, file uploads, third-party feeds
- Summarize: Present data source inventory with estimated volume and update frequency to user

#### 1.2 Source Characterization
- **For each data source**:
  - **Format**: Structured, semi-structured, or unstructured data; schema definition
  - **Volume & Velocity**: Expected data size and rate of arrival
  - **Ownership**: Internal system, external provider, or user-generated
  - **Reliability**: Expected availability and delivery guarantees
- Confirm: Get user agreement on source inventory

#### 1.3 Ingestion Pattern Selection
- **Ingestion mode**: Batch pull, event-driven push, CDC (Change Data Capture), or hybrid
- **Delivery semantics**: At-least-once, at-most-once, or exactly-once — and the tradeoff rationale
- **Idempotency strategy**: How duplicate records are detected and handled
- Review: Discuss with user

#### 1.4 Schema Evolution Strategy
- **Compatibility policy**: Backward-compatible, forward-compatible, or full compatibility requirement
- **Breaking change handling**: What happens when upstream schema changes incompatibly
- **Schema registry**: Whether a centralized schema registry is warranted
- Confirm: Get user agreement

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Transformation & Processing Design

#### 2.1 Transformation Strategy
- **For each transformation stage**:
  - **Purpose**: What business logic or cleaning does this stage apply
  - **Input/Output**: What data shape enters and exits
  - **Failure handling**: What happens when transformation logic fails or produces unexpected output
- Review: Discuss with user

#### 2.2 Processing Model Selection
- **Options and tradeoffs**:
  - **Batch**: Simpler, higher throughput, higher latency — suitable when freshness is not critical
  - **Stream**: Lower latency, more complex state management — suitable for time-sensitive use cases
  - **Hybrid (Lambda/Kappa)**: When both historical reprocessing and real-time paths are needed
- **Selection rationale**: Record which model is chosen and why, given the latency SLA and complexity tradeoff
- Confirm: Get user agreement

#### 2.3 Data Quality & Validation
- **Validation placement**: Where in the pipeline quality checks run (at ingestion, post-transformation, pre-load)
- **Quality dimensions**: Completeness, consistency, freshness, referential integrity — which apply
- **Failure policy**: Quarantine bad records, fail the pipeline, or pass through with flagging
- **Alerting threshold**: What level of quality degradation triggers an alert vs. automatic remediation
- Review: Discuss with user

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Storage & Access Design

#### 3.1 Storage Layer Selection
- **Storage tiers**: Raw/landing zone, curated/cleansed zone, serving/aggregated zone — which tiers are needed
- **Storage model**: Object storage, columnar store, relational, document, time-series — selection rationale based on query patterns
- **Retention policy**: How long each tier retains data; archival or deletion strategy
- Review: Discuss with user

#### 3.2 Partitioning Strategy
- **Partition key**: What dimension(s) data is partitioned by (time, region, entity ID, etc.)
- **Partition granularity**: Hour, day, month — chosen based on query patterns and file size tradeoffs
- **Skew handling**: Whether any partition key creates data skew and mitigation approach
- Confirm: Get user agreement

#### 3.3 Access Pattern Design
- **Consumer types**: BI tools, application APIs, data scientists, ML training jobs — each with distinct access needs
- **Access SLA**: Freshness and latency requirements per consumer type
- **Caching strategy**: Whether a query cache or materialized view layer is warranted
- **Access control**: Row-level or column-level security requirements
- Review: Discuss with user

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: ML Pipeline Design

#### 4.1 Assess Necessity
- Analyze: Determine if the data pipeline includes ML/model serving components
- Present: Explain whether ML pipeline design is needed with rationale
- Decide: Skip to Step 5 if no ML components are part of the architecture
- Confirm: Get user agreement

#### 4.2 Feature Engineering Strategy (if proceeding)
- **Feature sources**: Which pipeline stages produce features; raw fields vs. derived aggregations
- **Feature reuse scope**: Whether features are shared across multiple models (warrants a feature store)
- **Missing value policy**: Imputation strategy or record exclusion — defined per feature, not globally
- **Freshness requirement**: How current features must be at training vs. inference time
- Review: Discuss with user

#### 4.3 Model Serving Pattern (if proceeding)
- **Serving mode**: Online (synchronous inference), batch (pre-computed scores), or near-real-time
- **Latency SLA**: Acceptable p95/p99 inference latency for the serving mode
- **Model version rollout**: Blue/green, canary, or shadow deployment — and rollback trigger criteria
- **Serving failure fallback**: What the application does when the model endpoint is unavailable
- Confirm: Get user agreement

#### 4.4 Experiment Tracking & A/B Testing Policy (if proceeding)
- **Experiment tracking scope**: What metadata is captured per training run (data version, hyperparameters excluded — focus on lineage)
- **A/B test assignment**: How users or records are assigned to model variants; exclusion criteria
- **Success criteria**: What metric and threshold determines the winning variant
- **Promotion gate**: Who approves promotion from experiment to production, and what evidence is required
- Review: Discuss with user

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Data / ML Pipeline Complete
- Announce: "Data / ML Pipeline complete. Proceeding to next selected Design Area: [next area name]."
