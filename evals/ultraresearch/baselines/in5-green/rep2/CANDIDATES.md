# DB 마이그레이션 후보 비교

## 근거 범위와 판정 기준

이 비교는 `wave-1.md`와 `wave-2.md`에 기록된 조사만으로 작성했다. 현재 디렉터리에는 `SYNTHESIS.md`가 없으므로, 각 프로필의 `SYNTHESIS.md 검증 근거`는 **unknown — not gathered**로 남긴다. 또한 저널에 없는 라이선스·정확한 조사 버전·최근 유지보수 일자는 추정하지 않고 동일하게 표기한다.

판정의 우선순위는 다음과 같다: (1) PostgreSQL에서 배포 시 마이그레이션 실행을 직렬화할 수 있는가, (2) 동시 브랜치의 이력을 어떻게 수렴시키는가, (3) TypeScript/Drizzle 환경에 현실적으로 도입 가능한가. 롤백은 사용자가 의도적으로 비중을 낮춘 항목이지만, 각 후보에서 별도로 기록한다.

## 후보 프로필

### Prisma Migrate

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | PostgreSQL advisory lock을 사용한다. 배포 명령은 `migrate deploy`다. |
| 이력/병합 모델 | 파일의 어휘순(linear) 이력이다. 브랜치 충돌은 수동 rebase/squash가 필요하며 Git식 의미 병합은 아니다. |
| 기능 메모 | TS-native이며 CI/CD에서 실행 가능하다. 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **보류.** 배포 동시 실행은 막지만, 현재의 multi-head/브랜치 이력 경합을 자동으로 해소하지 못한다. |

저널 직접 인용: “`migrate deploy` is a CI/CD command and uses a PostgreSQL advisory lock, but migrations are lexically ordered files and branch history conflicts require manual rebase/squash.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Drizzle Kit

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | `drizzle-kit` 0.31.5 (대상 저장소); migrator 소스 조사 revision `273c78071d4841b497f5144734b38294df7ec64b` |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | 대상 저장소에서 `drizzle-orm` 0.44.5 / `drizzle-kit` 0.31.5 사용 중. 최근 릴리스·활동 일자는 unknown — not gathered. |
| 동시성/잠금 | 조사한 PostgreSQL migrator 소스에는 트랜잭션은 있으나 advisory lock은 없다. 별도 singleton migration Job 또는 외부 잠금이 필요하다. |
| 이력/병합 모델 | 병렬 생성에서 journal/index 충돌 위험이 문서화되어 있다. 부모 baseline에서 재생성하는 방식이 현재 권고이며 Git식 자동 병합은 아니다. |
| 기능 메모 | TS-native이고 현 저장소의 ORM과 맞닿아 있다. 현 저장소 정책상 Alembic만 migration authority이고 Drizzle은 schema synchronization 전용이다. 롤백 지원 여부는 unknown — not gathered. |
| 판정 | **비추천.** 기존 Drizzle 친화성은 장점이나, 잠금 부재와 journal/index 충돌 모델이 현재 문제를 직접 완화하지 못한다. |

저널 직접 인용: “published PostgreSQL migrator source has a transaction and no advisory lock” 및 “Parallel migration generation also has documented journal/index collision hazards.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Kysely Migrator

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered (소스 조사 revision `f24018c789c3cf7ad03ccc672ada63a1ded87f88`) |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | PostgreSQL adapter가 advisory lock을 사용하며 기본적으로 트랜잭션 안에서 실행한다. |
| 이력/병합 모델 | 기본 prefix-order 검사를 `allowUnorderedMigrations`로 완화할 수 있지만, 충돌하는 DDL은 해결하지 않는다. Git식 의미 병합은 아니다. |
| 기능 메모 | TypeScript-native다. 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **조건부 추천.** 배포 경쟁 방지에는 강하지만, 병합 정책(재정렬·rebase·충돌 DDL 검토)을 팀 프로세스로 강제해야 한다. |

저널 직접 인용: “PostgreSQL adapter uses advisory lock and runs transactionally by default. `allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Knex

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | 내장 DB lock이 있다. PostgreSQL-specific lock 종류 및 배포 명령은 unknown — not gathered. |
| 이력/병합 모델 | filename ledger 기반의 선형 이력이며 branch DAG merge는 제공하지 않는다. |
| 기능 메모 | TS-friendly다. 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **보류.** 기본 잠금은 유용하지만 선형 ledger이므로 multi-head를 없애려면 엄격한 생성·병합 규율이 별도로 필요하다. |

저널 직접 인용: “TS-friendly, linear filename ledger with built-in DB lock; no branch DAG merge.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### TypeORM

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | 조사 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않았다. 전용 migration job과 외부 lock이 필요하다. |
| 이력/병합 모델 | unknown — not gathered |
| 기능 메모 | 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **탈락.** 배포 경쟁 방지가 핵심 요구인데 기본 분산 잠금이 없어서 운영 구성 부담이 크다. |

저널 직접 인용: “TypeORM / Umzug / dbmate: none provides a PostgreSQL distributed migration lock by default in the investigated paths; they need a dedicated migration job plus an external lock.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Umzug

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | 조사 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않았다. 전용 migration job과 외부 lock이 필요하다. |
| 이력/병합 모델 | unknown — not gathered |
| 기능 메모 | 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **탈락.** 잠금과 배포 orchestration을 별도 설계해야 하므로, Alembic multi-head 문제를 줄이는 교체안으로 단순하지 않다. |

저널 직접 인용: “TypeORM / Umzug / dbmate: none provides a PostgreSQL distributed migration lock by default in the investigated paths.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### dbmate

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | v2.34.1 |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | v2.34.1이 조사 대상이었다. 최근 릴리스·활동 일자는 unknown — not gathered. |
| 동시성/잠금 | v2.34.1에는 잠금이 없다. 전용 migration job과 외부 lock이 필요하다. |
| 이력/병합 모델 | timestamp 선형 이력이다. Git식 의미 병합 여부는 저널에서 별도로 확인하지 않았으므로 unknown — not gathered. |
| 기능 메모 | TypeScript library가 아니라 CLI 성격 여부는 저널에서 명시하지 않아 unknown — not gathered. 롤백 지원 여부는 unknown — not gathered. |
| 판정 | **탈락.** 내장 잠금이 없어 배포 실패·경합을 해결하려는 핵심 목적에 맞지 않는다. |

저널 직접 인용: “dbmate is timestamp-linear and no-lock in v2.34.1.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Flyway Community

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | database lock을 제공하며 Docker/CI에 적합하다. PostgreSQL-specific lock 세부는 unknown — not gathered. |
| 이력/병합 모델 | immutable linear SQL migration history다. `outOfOrder`는 브랜치의 의미적 병합을 수행하지 않는다. |
| 기능 메모 | TS-native는 아니지만 언어 독립 CLI로 CI/컨테이너에서 실행할 수 있다. 유료판 없이 forward-only 운영이 가능하다. 롤백은 사용자가 비중을 낮췄고, 기능 제공 여부는 unknown — not gathered. |
| 판정 | **조건부 추천.** ORM 교체 없이 배포 단계의 잠금·불변 SQL 이력을 얻는 현실적인 선택지지만, 병합은 여전히 팀의 선형화 정책으로 해결해야 한다. |

저널 직접 인용: “immutable linear SQL migration history, database lock, Docker/CI fit; forward-only use needs no paid edition. `outOfOrder` does not semantically merge branches.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Liquibase

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | `DATABASECHANGELOGLOCK`을 사용한다. |
| 이력/병합 모델 | changelog ordering 기반이며 Git DAG merge는 제공하지 않는다. |
| 기능 메모 | 언어 독립 도구다. 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **보류.** 잠금은 장점이나, 현재의 병합 문제를 자동으로 해결하지 않고 TS-native도 아니다. |

저널 직접 인용: “changelog ordering plus `DATABASECHANGELOGLOCK`; flexible but not Git DAG merge.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Atlas

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | unknown — not gathered (소스 조사 revision `9a6bc601212130aaaefcbc8dd36c710baf9716ff`) |
| 라이선스 | Community/OSS에 대한 구분은 조사됐으나 정확한 라이선스는 unknown — not gathered. |
| 유지보수 신호 | unknown — not gathered |
| 동시성/잠금 | PostgreSQL advisory lock을 제공한다. |
| 이력/병합 모델 | `atlas.sum`이 migration-directory의 divergent changes를 의도적으로 Git merge conflict로 만든다. 팀은 linear history를 보존하려 rebase/rehash해야 하며 자동 의미 병합은 아니다. |
| 기능 메모 | Drizzle-compatible external schema다. `migrate rebase`는 OSS/community에는 없고 official/Pro 유료 기능이다. 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **조건부 추천(강한 정책형).** 잠금과 Drizzle 호환성은 좋지만, 충돌을 의도적으로 표면화하는 설계다. 유료 rebase 없이도 수동 선형화 규칙을 받아들일 팀에만 적합하다. |

저널 직접 인용: “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict, so teams rebase/rehash to retain linear history.” 및 “`migrate rebase` is unavailable in the OSS/community build; paid official/Pro is required.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

### Sqitch

| 필드 | 내용 |
| --- | --- |
| 조사한 정확한 버전 | v1.6.1 |
| 라이선스 | MIT |
| 유지보수 신호 | 조사한 current stable은 v1.6.1이다. 릴리스 날짜는 unknown — not gathered. |
| 동시성/잠금 | PostgreSQL target lock/advisory lock으로 Sqitch 프로세스를 직렬화한다. |
| 이력/병합 모델 | 의존성 메타데이터를 가지지만 Git식 의미 병합 엔진은 아니다. 중앙 append-only plan에서 동시 브랜치 추가는 `sqitch.plan` Git conflict를 만들며, 해결 후 사람이 순서를 검토해야 한다. |
| 기능 메모 | `sqitch check`로 hash divergence를, `sqitch verify`로 실행 순서를 확인한다. Perl/SQL CLI라 TS library나 Drizzle integration은 아니다. 공식 컨테이너로 singleton CI 또는 ArgoCD `PreSync` Job에서 실행할 수 있다. 롤백/다운 마이그레이션 지원 여부는 unknown — not gathered. |
| 판정 | **조건부 추천(비TS 운영 도구).** 의존성 선언·검증과 DB 잠금이 필요하고 SQL CLI 도입을 감수할 수 있다면 좋은 대안이다. 다만 central plan conflict와 명시적 병합 정책은 남는다. |

저널 직접 인용: “It is dependency-aware rather than a Git-like semantic merge engine.” 및 “concurrent branch additions create a `sqitch.plan` Git conflict and requires a human to check ordering after resolving it.” ([wave-2.md](wave-2.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).

## 비교 결론

저널의 근거만 놓고 보면, **Git처럼 migration 이력을 자동 의미 병합하는 후보는 없다.** 이 문제는 라이브러리 하나로 없애기보다, DB-level lock으로 배포 실행을 직렬화하고 migration history는 선형화(rebase/재생성/명시적 순서 검토)하는 정책을 함께 두어야 한다. 이 전제에서 Kysely Migrator는 TS-native 중 잠금이 확인된 선택지이고, Atlas는 Drizzle 호환성과 강한 무결성 검사를 원하는 경우, Flyway Community와 Sqitch는 ORM과 분리된 migration runner를 원하는 경우에 조건부 후보가 된다.

이 결론을 지지하는 저널 직접 인용: “No target-repository TS migration directory is active; Drizzle config is latent.” 및 “A replacement must therefore be idempotent and use a database-level lock.” ([wave-1.md](wave-1.md))  
SYNTHESIS.md 검증 근거: **unknown — not gathered** (파일 부재).
