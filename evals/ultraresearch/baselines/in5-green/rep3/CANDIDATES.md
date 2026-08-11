# 후보 비교

## 판정

저널에 이력/병합 모델이 수집된 후보 중 Git처럼 분기된 migration을 자동으로 의미 병합하는 후보는 없다. 따라서 Alembic multi-head 경합의 직접 해법은 라이브러리 교체가 아니라 **단일 migration 실행 주체와 병합 전 선형화(rebase/squash 또는 명시적 순서 결정) 정책**이다. TS 후보 중에는 PostgreSQL advisory lock과 기본 트랜잭션 실행이 모두 확인된 **Kysely Migrator**를 조건부 1순위로 둔다. 다만 배포 시 실행하는 구체적 CI/Argo 통합은 저널에 수집되지 않았고, 충돌 DDL은 여전히 사람이 해결해야 한다.

대상 저장소의 배포 순서는 이미 `migration → backend deploy → verification`이며, Argo는 환경별 backend deploy를 직렬화한다. 저널은 대체안에 idempotency와 database-level lock이 필요하다고 결론 낸다. “The immediate Alembic problem is material”하며, 현 트리에 “296 revisions, 56 merge revisions and two heads”가 있다는 관찰이 위 판정의 배경이다. ([wave-1.md](wave-1.md), Target-repository reality)

## 검증 근거 상태

이 디렉터리에는 `wave-1.md`와 `wave-2.md`만 제공되었고 `SYNTHESIS.md`는 없다. 따라서 아래의 모든 검증 백킹은 **`SYNTHESIS.md`: unavailable — not present in supplied directory**다. 각 프로필의 사실 주장은 합성 문서가 아니라 해당 wave 저널의 직접 인용에만 근거한다. 저널에 없는 필드는 추론하지 않고 `unknown — not gathered`로 표기했다.

## Prisma Migrate

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** PostgreSQL advisory lock을 사용한다: “uses a PostgreSQL advisory lock.”
- **이력/병합 모델:** lexical-order 파일 이력이며, “branch history conflicts require manual rebase/squash.” Git식 자동 병합 근거는 없다.
- **기능 메모 (롤백 포함):** `migrate deploy`는 “a CI/CD command.” 롤백은 unknown — not gathered.
- **판정:** **조건부 차선.** 배포 실행과 DB 락은 확인됐지만, 현재의 분기 병합 실패는 수동 rebase/squash를 요구하므로 해결하지 못한다.
- **저널 인용:** “migrations are lexically ordered files and branch history conflicts require manual rebase/squash.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Drizzle Kit

- **조사 버전:** `drizzle-kit` 0.31.5; 같은 대상 저장소에 `drizzle-orm` 0.44.5가 설치됨. 이는 대상 설치 버전이며, 조사 시점의 최신 릴리스라는 뜻은 아니다.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** PostgreSQL migrator에 transaction은 있으나 “no advisory lock.”
- **이력/병합 모델:** 병렬 생성에 “journal/index collision hazards”가 있고 parent baseline에서 재생성하라는 조언이 있다. 생산용 자동 병합 또는 lock은 저널의 inspected published source에서 입증되지 않았다.
- **기능 메모 (롤백 포함):** “TS-native and operationally easy.” 현재 프로젝트 정책에서는 Python/Alembic만 migration authority이고 Drizzle은 schema synchronization only다. 롤백은 unknown — not gathered.
- **판정:** **기각.** 이미 TS 친화적이지만 DB-level lock 부재와 병렬 journal 충돌이 현재의 경합 조건에 정면으로 불리하다.
- **저널 인용:** “Parallel migration generation also has documented journal/index collision hazards.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Kysely Migrator

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** PostgreSQL adapter가 advisory lock을 사용하고 기본 transactional 실행이다.
- **이력/병합 모델:** `allowUnorderedMigrations`는 기본 prefix-order 거부를 피할 수 있지만 “cannot resolve conflicting DDL.” 따라서 Git DAG/의미 병합은 아니다.
- **기능 메모 (롤백 포함):** TypeScript-native. 배포 명령 또는 CI/Argo 통합 방식은 unknown — not gathered. 롤백은 unknown — not gathered.
- **판정:** **조건부 1순위.** 조사된 TS-native 후보 중 DB 락과 transactional 실행이 동시에 확인된 유일한 프로필이다. 단, 충돌 DDL은 해결하지 않으므로 선형화 정책은 필수다.
- **저널 인용:** “PostgreSQL adapter uses advisory lock and runs transactionally by default.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Knex

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** built-in DB lock.
- **이력/병합 모델:** “linear filename ledger”이며 “no branch DAG merge.”
- **기능 메모 (롤백 포함):** TS-friendly. 배포 통합과 롤백은 unknown — not gathered.
- **판정:** **기각.** 락은 충족하지만 선형 파일 ledger라 Git식 분기 병합 요구에는 맞지 않는다.
- **저널 인용:** “linear filename ledger with built-in DB lock; no branch DAG merge.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## TypeORM

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** 조사 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다; dedicated migration job과 external lock이 필요하다.
- **이력/병합 모델:** unknown — not gathered.
- **기능 메모 (롤백 포함):** dedicated job과 external lock이 필요한 점 외에는 unknown — not gathered; 롤백도 unknown — not gathered.
- **판정:** **기각.** 도구 자체로 필요한 DB-level distributed lock을 충족한다는 근거가 없다.
- **저널 인용:** “none provides a PostgreSQL distributed migration lock by default in the investigated paths.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Umzug

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** 조사 경로에서 PostgreSQL distributed migration lock을 기본 제공하지 않는다; dedicated migration job과 external lock이 필요하다.
- **이력/병합 모델:** unknown — not gathered.
- **기능 메모 (롤백 포함):** dedicated job과 external lock이 필요한 점 외에는 unknown — not gathered; 롤백도 unknown — not gathered.
- **판정:** **기각.** 별도 락 운영을 추가해야 하므로 “배포 때 함께 쉽게 실행”이라는 운영 단순화 기준에서 불리하다.
- **저널 인용:** “TypeORM / Umzug / dbmate: none provides a PostgreSQL distributed migration lock by default in the investigated paths.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## dbmate

- **조사 버전:** v2.34.1.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** “no-lock in v2.34.1”; dedicated migration job과 external lock이 필요하다.
- **이력/병합 모델:** timestamp-linear.
- **기능 메모 (롤백 포함):** 배포 통합과 롤백은 unknown — not gathered.
- **판정:** **기각.** 선형 이력이고 내장 락이 없어 동시 배포 실패 방지라는 핵심 조건에 맞지 않는다.
- **저널 인용:** “dbmate is timestamp-linear and no-lock in v2.34.1.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Flyway Community

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** database lock.
- **이력/병합 모델:** immutable linear SQL migration history. `outOfOrder`도 branch를 의미적으로 병합하지 않는다.
- **기능 메모 (롤백 포함):** language-independent이고 Docker/CI에 맞는다. forward-only 사용에는 paid edition이 필요 없다. 롤백은 unknown — not gathered.
- **판정:** **TS 비네이티브 대안으로 조건부 고려.** 배포와 락은 요구에 맞지만, 분기 의미 병합을 제공하지 않으므로 Alembic multi-head의 근본 문제에는 해법이 아니다.
- **저널 인용:** “`outOfOrder` does not semantically merge branches.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Liquibase

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** `DATABASECHANGELOGLOCK`.
- **이력/병합 모델:** changelog ordering이며 Git DAG merge가 아니다.
- **기능 메모 (롤백 포함):** flexible. 배포 통합과 롤백은 unknown — not gathered.
- **판정:** **기각.** 락은 갖추었지만, 저널상 Git식 의미 병합이 없으므로 대상 문제의 해결책으로 볼 근거가 없다.
- **저널 인용:** “Liquibase: language-independent changelog ordering plus `DATABASECHANGELOGLOCK`; flexible but not Git DAG merge.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Atlas

- **조사 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered. 다만 OSS/community build와 paid official/Pro 구분은 기록됐다.
- **유지보수 신호 (최신 릴리스 또는 활동일):** unknown — not gathered.
- **동시성/락:** PostgreSQL advisory lock.
- **이력/병합 모델:** `atlas.sum`은 divergent migration-directory 변경을 의도적으로 merge-conflict로 만들며, linear history를 위해 팀이 rebase/rehash한다. 자동 의미 병합이 아니다.
- **기능 메모 (롤백 포함):** Drizzle-compatible external schema. `migrate rebase`는 OSS/community build에서 사용할 수 없고 paid official/Pro가 필요하다. 롤백은 unknown — not gathered.
- **판정:** **기각.** Drizzle 호환성과 락은 장점이지만, central conflict를 드러내고 Community에서 rebase 기능도 제한돼 병합 부담을 낮추지 못한다.
- **저널 인용:** “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict.” ([wave-1.md](wave-1.md), Tool findings)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## Sqitch

- **조사 버전:** v1.6.1.
- **라이선스:** MIT.
- **유지보수 신호 (최신 릴리스 또는 활동일):** “current stable investigated was v1.6.1.” 최신 릴리스 날짜 또는 활동일은 unknown — not gathered.
- **동시성/락:** PostgreSQL에서 “serializes Sqitch processes with a target lock/advisory lock.” `sqitch check`은 hash-based divergence 검사, `sqitch verify`는 실행 순서 검증을 제공한다.
- **이력/병합 모델:** dependency-aware지만 “rather than a Git-like semantic merge engine.” central, append-only plan의 concurrent branch addition은 `sqitch.plan` Git conflict가 되며, 해결 뒤 사람이 순서를 확인해야 한다.
- **기능 메모 (롤백 포함):** Perl/SQL CLI이며 TS library나 Drizzle integration은 아니다. 공식 컨테이너로 singleton CI 또는 ArgoCD `PreSync` Job에서 실행할 수 있다. 롤백은 unknown — not gathered.
- **판정:** **비-TS 운영 대안으로 조건부 고려.** DB 락과 CI/Argo 실행 방식은 가장 구체적으로 수집됐지만, central plan 충돌과 명시적 병합 정책의 필요성은 사라지지 않는다.
- **저널 인용:** “It is dependency-aware rather than a Git-like semantic merge engine.” ([wave-2.md](wave-2.md), Wave 2 — expansion: Sqitch)
- **검증 백킹:** `SYNTHESIS.md`: unavailable — not present in supplied directory.

## 운영 결론

롤백을 의도적으로 사용하지 않는다면, 후보 판단에서 rollback 기능의 가중치는 낮다. 대신 다음 두 조건을 배포 계약으로 고정해야 한다.

1. migration 실행은 환경당 하나의 Job/CI 주체로만 수행하고 DB-level advisory/distributed lock으로 직렬화한다.
2. merge 전에 migration 이력을 하나의 선형 순서로 확정한다. 도구가 이를 자동으로 의미 병합한다는 저널 근거는 없으므로, 충돌 DDL은 소유자가 판정한다.

이 결론은 “No target-repository TS migration directory is active; Drizzle config is latent.”라는 현 상태에도 적용된다. ([wave-1.md](wave-1.md), Verbatim expansion markers)
