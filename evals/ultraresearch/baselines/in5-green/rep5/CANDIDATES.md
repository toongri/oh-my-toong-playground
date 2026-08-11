# 후보 비교

## 비교 전제와 검증 상태

이 비교는 `wave-1.md`와 `wave-2.md`에 기록된 조사 결과만 사용한다. 이 디렉터리에는 `SYNTHESIS.md`가 없으므로, 아래 모든 후보의 검증 근거는 **`SYNTHESIS.md` 기준으로는 unavailable — not present**이며, 인용한 wave 저널이 유일한 근거다. 저널이 버전·라이선스·유지보수·롤백을 기록하지 않은 후보는 추정하지 않고 `unknown — not gathered`로 표기했다.

현재 배포 흐름은 migration → backend deploy → verification이며, 대체 도구는 idempotent하고 DB 수준 잠금을 가져야 한다. 또한 조사 범위의 어떤 후보도 Git처럼 충돌 DDL을 의미적으로 자동 병합하는 모델은 제공하지 않았다. [wave-1.md:6, 11-18; SYNTHESIS.md: unavailable — not present]

## 결론

**TS 네이티브 후보 중에는 Kysely Migrator가 가장 요구에 가깝다.** PostgreSQL advisory lock과 기본 트랜잭션이 있어 배포 동시 실행을 직렬화하지만, 충돌하는 DDL의 의미적 병합까지 해결하지는 않는다. 따라서 도구 교체와 함께 “migration 파일은 선형 히스토리로 rebase/재생성 후 병합하고, 배포에서는 DB advisory lock을 획득한 단일 migration Job만 실행한다”는 운영 규칙이 필요하다. [wave-1.md:13; SYNTHESIS.md: unavailable — not present]

Drizzle Kit은 현 스택에 가깝지만 저널상 PostgreSQL migrator에 advisory lock이 없고 병렬 생성 journal/index 충돌 위험이 확인되어, Alembic multi-head 경합을 해소하는 선택으로는 부적합하다. [wave-1.md:12, 23; SYNTHESIS.md: unavailable — not present]

## 후보 프로필

### Prisma Migrate

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered (최신 릴리스/활동 날짜 미기록).
- **동시성/잠금:** `migrate deploy`는 CI/CD 명령이고 PostgreSQL advisory lock을 사용한다.
- **히스토리/병합 모델:** 파일을 lexical order로 적용하는 선형 모델이며, 브랜치 충돌은 수동 rebase/squash가 필요하다.
- **기능 메모:** TS-native. 롤백 기능은 unknown — not gathered.
- **판정:** **조건부 채택 가능.** 배포 잠금은 요구에 맞지만 Git식 의미 병합은 없으므로, 선형화 규칙을 팀 프로세스로 강제할 때만 적합하다.

근거: “uses a PostgreSQL advisory lock”, “migrations are lexically ordered files and branch history conflicts require manual rebase/squash.” [wave-1.md:11; SYNTHESIS.md: unavailable — not present]

### Drizzle Kit

- **검토한 정확한 버전:** 대상 저장소 설치본 `drizzle-kit 0.31.5` (`drizzle-orm 0.44.5`); 조사한 published migrator의 정확한 버전은 unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** PostgreSQL migrator는 transaction을 사용하지만 advisory lock이 없다.
- **히스토리/병합 모델:** 병렬 migration 생성에서 journal/index collision hazard가 있으며, parent baseline에서 재생성하라는 지침이 기록되어 있다.
- **기능 메모:** TS-native이며 운영은 간단하다. 롤백은 unknown — not gathered.
- **판정:** **기각.** 현재 문제의 핵심인 배포 직렬화와 브랜치 경합을 모두 해결한다는 근거가 없다. v1 RC 문서도 production-ready 자동 병합/잠금을 입증하지 못했다.

근거: “transaction and no advisory lock”, “journal/index collision hazards”, “does not establish a production-ready automatic merge or lock.” [wave-1.md:5, 12, 23; SYNTHESIS.md: unavailable — not present]

### Kysely Migrator

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** PostgreSQL adapter가 advisory lock을 사용하며 기본으로 transaction 안에서 실행한다.
- **히스토리/병합 모델:** 기본 prefix-order 거부는 `allowUnorderedMigrations`로 우회할 수 있으나, 충돌 DDL을 해결하거나 DAG를 의미적으로 병합하지는 못한다.
- **기능 메모:** TypeScript-native. 롤백은 unknown — not gathered.
- **판정:** **권고.** 배포 시 동시 migration 실행을 DB lock으로 막고 transactional apply를 제공한다. 다만 Alembic의 multi-head를 “자동 병합”할 수는 없으므로, PR 단계에서 migration을 선형화하는 정책은 별도로 필요하다.

근거: “PostgreSQL adapter uses advisory lock and runs transactionally by default”, “cannot resolve conflicting DDL.” [wave-1.md:13; SYNTHESIS.md: unavailable — not present]

### Knex

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** built-in DB lock을 제공한다.
- **히스토리/병합 모델:** linear filename ledger이며 branch DAG merge는 없다.
- **기능 메모:** TS-friendly. 롤백은 unknown — not gathered.
- **판정:** **차선.** 잠금은 충족하지만 선형 ledger만 제공하므로 Kysely 대비 이 요구에 특별한 이점이 저널에 확인되지 않았다.

근거: “linear filename ledger with built-in DB lock; no branch DAG merge.” [wave-1.md:14; SYNTHESIS.md: unavailable — not present]

### TypeORM

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** 조사 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않으며, dedicated migration job과 external lock이 필요하다.
- **히스토리/병합 모델:** unknown — not gathered.
- **기능 메모:** 롤백은 unknown — not gathered.
- **판정:** **기각.** 배포 동시성 안전성을 별도 구성으로 보완해야 하며, 저널상 merge 문제에 대한 이점도 확인되지 않았다.

근거: “none provides a PostgreSQL distributed migration lock by default … need a dedicated migration job plus an external lock.” [wave-1.md:15; SYNTHESIS.md: unavailable — not present]

### Umzug

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** 조사 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않으며, dedicated migration job과 external lock이 필요하다.
- **히스토리/병합 모델:** unknown — not gathered.
- **기능 메모:** 롤백은 unknown — not gathered.
- **판정:** **기각.** 기본 잠금이 없고 병합 모델의 우위도 저널에 확인되지 않았다.

근거: TypeORM/dbmate와 함께 “none provides a PostgreSQL distributed migration lock by default”로 기록됐다. [wave-1.md:15; SYNTHESIS.md: unavailable — not present]

### dbmate

- **검토한 정확한 버전:** v2.34.1.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** no-lock이며 external lock/dedicated migration job이 필요하다.
- **히스토리/병합 모델:** timestamp-linear.
- **기능 메모:** 롤백은 unknown — not gathered.
- **판정:** **기각.** 무잠금·선형 히스토리 조합이라 현재 배포 실패와 경합을 줄이지 못한다.

근거: “dbmate is timestamp-linear and no-lock in v2.34.1.” [wave-1.md:15; SYNTHESIS.md: unavailable — not present]

### Flyway Community

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** database lock을 제공한다.
- **히스토리/병합 모델:** immutable linear SQL migration history. `outOfOrder`도 브랜치를 의미적으로 병합하지는 않는다.
- **기능 메모:** TS-native는 아니지만 Docker/CI에 맞고, forward-only 사용에는 유료 에디션이 필요 없다. 롤백은 forward-only 맥락 외에는 unknown — not gathered.
- **판정:** **운영용 대안이나 비권고.** 단일 migration Job과 forward-only SQL에는 좋지만 TS 라이브러리 요구와 Git식 merge 요구에는 맞지 않는다.

근거: “language-independent (not TS-native) immutable linear SQL migration history, database lock, Docker/CI fit”, “outOfOrder does not semantically merge branches.” [wave-1.md:16, 24; SYNTHESIS.md: unavailable — not present]

### Liquibase

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered.
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** `DATABASECHANGELOGLOCK`을 사용한다.
- **히스토리/병합 모델:** changelog ordering을 사용하며 Git DAG merge가 아니다.
- **기능 메모:** language-independent이며 유연하다. 롤백은 unknown — not gathered.
- **판정:** **비권고.** lock은 갖추지만 TS-native가 아니고 Git식 의미 병합도 없다.

근거: “changelog ordering plus `DATABASECHANGELOGLOCK`; flexible but not Git DAG merge.” [wave-1.md:17, 24; SYNTHESIS.md: unavailable — not present]

### Atlas

- **검토한 정확한 버전:** unknown — not gathered.
- **라이선스:** unknown — not gathered (Community/OSS와 official/Pro 유료 기능 구분만 확인).
- **유지보수 신호:** unknown — not gathered.
- **동시성/잠금:** PostgreSQL advisory lock을 사용한다.
- **히스토리/병합 모델:** `atlas.sum`은 migration directory의 divergent 변경을 의도적으로 merge conflict로 만들며, 선형 히스토리를 유지하려면 rebase/rehash가 필요하다.
- **기능 메모:** Drizzle-compatible external schema. Community/OSS에는 `migrate rebase`가 없고 official/Pro에서만 가능하다. 롤백은 unknown — not gathered.
- **판정:** **유료 도입 의사가 있으면 조건부 검토.** Drizzle 호환과 advisory lock은 강점이나, 기본 모델은 자동 병합이 아니라 의도적인 conflict와 선형화다. Community만으로는 `migrate rebase`도 쓸 수 없다.

근거: “`atlas.sum` deliberately makes divergent migration-directory changes merge-conflict”, “migrate rebase is unavailable in the OSS/community build; paid official/Pro is required.” [wave-1.md:18, 25; SYNTHESIS.md: unavailable — not present]

### Sqitch

- **검토한 정확한 버전:** v1.6.1.
- **라이선스:** MIT.
- **유지보수 신호:** “current stable investigated was v1.6.1”; 날짜는 unknown — not gathered.
- **동시성/잠금:** PostgreSQL target/advisory lock으로 Sqitch process를 직렬화한다.
- **히스토리/병합 모델:** dependency-aware이지만 central append-only plan이다. 동시 브랜치 추가는 `sqitch.plan` Git conflict를 만들며, 해소 뒤 사람이 순서를 점검해야 한다.
- **기능 메모:** hash-based divergence check(`sqitch check`)와 execution-order verification(`sqitch verify`)을 제공한다. singleton CI 또는 ArgoCD `PreSync` Job으로 실행 가능하다. Perl/SQL CLI로서 TS library나 Drizzle integration은 아니다. 롤백은 unknown — not gathered.
- **판정:** **기각.** 실행 잠금과 검증은 좋지만 TS/Drizzle-native가 아니며 central plan conflict와 explicit merge policy 필요성을 없애지 못한다.

근거: “dependency-aware rather than a Git-like semantic merge engine”, “target lock/advisory lock”, “not a TypeScript library or Drizzle integration.” [wave-2.md:3, 5, 7; SYNTHESIS.md: unavailable — not present]

## 병합 문제에 대한 운영 결론

저널상 해답은 “Git처럼 자동 병합되는 migration 라이브러리”가 아니라 **DB-level lock + 선형 migration history + PR에서의 의도적 conflict resolution**이다. Sqitch의 dependency metadata도 central append-only plan 충돌을 없애지 못하고, Atlas의 무결성 파일도 divergent 변경을 명시적 conflict로 만든다. 따라서 릴리스 단계에서는 Kysely/Prisma/Knex/Atlas/Flyway/Liquibase/Sqitch처럼 DB 잠금이 확인된 도구를 단일 migration Job으로 실행하고, 개발 단계에서는 생성 파일을 rebase 후 재생성/재정렬해 하나의 선형 히스토리로 merge해야 한다. [wave-1.md:11-18; wave-2.md:3-7; SYNTHESIS.md: unavailable — not present]
