# 후보 비교 — TypeScript DB 마이그레이션

판단 기준은 (1) 배포 시 안전한 단일 실행/잠금, (2) 동시 브랜치에서의 히스토리 충돌 관리, (3) 현재 Node 22·pnpm·TypeScript·Drizzle 환경과의 적합성이다. 저널에서 확인하지 않은 필드는 추정하지 않고 `unknown — not gathered`로 표기했다. 어느 후보도 Git처럼 충돌하는 DDL을 의미적으로 자동 병합하지 않는다. 따라서 라이브러리 선택과 별개로 **마이그레이션은 배포 전용 단일 잡에서 DB 잠금을 잡고 실행하고, 브랜치 병합 시에는 한 사람이 기준 브랜치 위에서 migration history를 재생성/정렬하는 선형-히스토리 정책**이 필요하다.

## 1. Kysely Migrator — 권장

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | PostgreSQL adapter가 advisory lock을 사용하며, 기본적으로 트랜잭션 안에서 실행한다. |
| 히스토리 / 병합 모델 | 마이그레이션 파일 기반의 선형 ledger다. 기본 prefix 순서 검증을 `allowUnorderedMigrations`로 완화할 수 있으나, 충돌하는 DDL을 해결하거나 Git DAG를 병합하지는 않는다. |
| 기능 메모 | TypeScript-native이다. 되돌리기 지원 여부는 unknown — not gathered. |
| 판정 | **채택 후보 1순위.** 배포 경쟁 조건에는 DB advisory lock으로 직접 대응하고 TS에서 실행 경로를 통제하기 쉽다. 다만 multihead 자체를 없애려면 `allowUnorderedMigrations`에 의존하지 말고, PR 병합 직전 기준 브랜치에서 migration 파일을 재정렬/재생성하는 선형화 규칙을 운영해야 한다. |

근거: wave-1.md의 Kysely 공식 문서 및 PostgreSQL adapter 조사.

## 2. Prisma Migrate — Prisma ORM도 함께 쓸 때만 고려

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | `migrate deploy`는 CI/CD 실행용 명령이며 PostgreSQL advisory lock을 사용한다. |
| 히스토리 / 병합 모델 | 사전식으로 정렬되는 파일의 선형 히스토리다. 브랜치 충돌은 수동 rebase 또는 squash가 필요하며 자동 DAG 병합은 없다. |
| 기능 메모 | TypeScript-native. 마이그레이션 squash 워크플로가 문서화되어 있다. rollback 기능은 unknown — not gathered. |
| 판정 | **현재 스택에는 비권장.** 잠금과 배포 UX는 좋지만 Drizzle을 Prisma로 교체할 만큼의 이점은 저널에서 확인되지 않았다. Prisma ORM 도입을 별도로 결정한 경우에만 유력하다. |

근거: wave-1.md의 Prisma CLI·squashing 문서 및 Prisma Engines PostgreSQL 구현 조사.

## 3. Drizzle Kit — 현 스택의 최소 변경안, 단독 채택은 비권장

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | drizzle-orm 0.44.5 / drizzle-kit 0.31.5 (대상 저장소에서 확인) |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | 조사한 PostgreSQL migrator는 트랜잭션은 사용하지만 advisory lock은 없다. |
| 히스토리 / 병합 모델 | journal/index 기반이다. 병렬 생성 시 journal/index 충돌 위험이 있으며, 권고는 부모 baseline에서 재생성하는 것이다. Git식 자동 병합은 없다. |
| 기능 메모 | TypeScript-native이고 현재 저장소가 이미 의존한다. 다만 현재 정책상 Drizzle은 schema synchronization용이고 Python/Alembic만 migration authority다. rollback 기능은 unknown — not gathered. |
| 판정 | **그대로 migration authority로 바꾸는 것은 비권장.** migration job에 외부 PostgreSQL advisory lock을 추가하고, migration 생성을 한 브랜치/한 PR 단계로 직렬화할 수 있다면 최소 변경 대안이다. 하지만 현 문제와 같은 병렬 히스토리 충돌을 도구 자체가 해소하지 못한다. |

근거: wave-1.md의 대상 저장소 버전·정책, Drizzle Kit 문서·migrator source·issue 조사.

## 4. Knex — 단순한 TS 대안

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | 내장 DB lock을 제공한다. |
| 히스토리 / 병합 모델 | 파일명 기반 선형 ledger이며 branch DAG 병합은 지원하지 않는다. |
| 기능 메모 | TypeScript-friendly. rollback 기능은 unknown — not gathered. |
| 판정 | **차선.** 실행 잠금은 만족하지만 Kysely 대비 현재 Drizzle 환경에서의 명확한 이점은 확인되지 않았고, multihead를 해결하는 병합 모델도 없다. |

근거: wave-1.md의 Knex migration lock 문서 조사.

## 5. Atlas — 강한 무결성 검사, 유료 의존성 때문에 조건부

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | Community/OSS 기능 및 유료 Pro 기능을 조사했으나 정확한 라이선스는 unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | PostgreSQL advisory lock을 사용한다. |
| 히스토리 / 병합 모델 | `atlas.sum`은 migration directory가 갈라진 변경을 의도적으로 merge conflict로 만든다. 팀은 rebase/rehash해 선형 히스토리를 유지해야 하며, Git식 의미적 병합은 제공하지 않는다. |
| 기능 메모 | Drizzle 외부 schema와 호환된다. `migrate rebase`는 OSS/Community에서 사용할 수 없고 공식 Pro가 필요하다. rollback 기능은 unknown — not gathered. |
| 판정 | **조건부 고려.** 잠금과 drift/integrity 방어는 강점이지만, 현재 목표인 쉬운 동시 변경 병합에는 유료 rebase와 명시적 선형화 절차가 남는다. Pro 비용을 감수해 migration governance를 강화할 때만 선택한다. |

근거: wave-1.md의 Atlas migration-directory integrity·apply 문서 및 CLI source 조사.

## 6. Flyway Community — TS 라이브러리는 아니지만 운영 대안

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | Community edition 존재는 확인했으나 정확한 라이선스는 unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | database lock을 제공한다. |
| 히스토리 / 병합 모델 | immutable한 선형 SQL migration history다. `outOfOrder`는 브랜치의 의미적 병합이 아니다. |
| 기능 메모 | Docker/CI에 잘 맞고 forward-only 운용은 유료판이 필요 없다. TypeScript-native도 Drizzle integration도 아니다. rollback 기능은 unknown — not gathered. |
| 판정 | **조건부 고려.** SQL-first migration job을 표준화하고 ORM과 분리하려면 안정적인 선택이지만, 요청한 TS 진영 라이브러리와 Git식 병합 문제의 직접 해법은 아니다. |

근거: wave-1.md의 Flyway migration versioning 및 FAQ 조사.

## 7. Liquibase — 운영 기능은 넓지만 이 문제에는 과함

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | `DATABASECHANGELOGLOCK`으로 실행을 직렬화한다. |
| 히스토리 / 병합 모델 | changelog ordering 모델이며 Git DAG 병합은 아니다. |
| 기능 메모 | language-independent. rollback 기능은 unknown — not gathered. |
| 판정 | **비권장.** 잠금은 충족하지만 TS-native가 아니고, Alembic multihead의 근본 원인인 브랜치 히스토리 조정을 제거하지 않는다. |

근거: wave-1.md의 Liquibase changelog lock 문서 조사.

## 8. Sqitch 1.6.1 — dependency metadata가 있어도 중앙 계획 충돌은 남음

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | 1.6.1 |
| 라이선스 | MIT |
| 유지보수 신호 | 현재 stable로 1.6.1을 조사함; release/activity date는 unknown — not gathered |
| 동시성 / 잠금 | PostgreSQL target/advisory lock으로 Sqitch 프로세스를 직렬화한다. |
| 히스토리 / 병합 모델 | dependency-aware지만 Git식 의미적 병합 엔진은 아니다. 중앙의 append-only `sqitch.plan`에 병렬 branch 추가가 생기면 Git conflict가 나고 사람이 순서를 검토해야 한다. |
| 기능 메모 | hash divergence check(`sqitch check`)와 execution-order verification(`sqitch verify`)가 있다. Perl/SQL CLI이며 TS/Drizzle integration은 아니다. 공식 컨테이너로 singleton CI 또는 ArgoCD `PreSync` Job에서 실행할 수 있다. rollback 기능은 unknown — not gathered. |
| 판정 | **비권장.** 의존성 메타데이터와 검증은 유용하지만, 중앙 plan 충돌을 없애지 못하고 TS stack에도 맞지 않는다. |

근거: wave-2.md의 Sqitch manual·tutorial·download/container 조사.

## 9. TypeORM — 외부 잠금 없이는 부적합

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | 조사한 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않는다. dedicated migration job과 외부 lock이 필요하다. |
| 히스토리 / 병합 모델 | unknown — not gathered |
| 기능 메모 | TypeScript ORM이지만 Drizzle integration은 unknown — not gathered. rollback 기능은 unknown — not gathered. |
| 판정 | **비권장.** 핵심 요구인 배포 시 동시 실행 방어를 기본 제공하지 않는다. |

근거: wave-1.md의 TypeORM issue 조사.

## 10. Umzug — 러너 라이브러리일 뿐, 잠금은 직접 구현

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | unknown — not gathered |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | 조사한 경로에서는 PostgreSQL distributed migration lock을 기본 제공하지 않는다. dedicated migration job과 외부 lock이 필요하다. |
| 히스토리 / 병합 모델 | unknown — not gathered |
| 기능 메모 | TypeScript 사용 가능 여부는 저널에서 명시적으로 확인되지 않아 unknown — not gathered. rollback 기능은 unknown — not gathered. |
| 판정 | **비권장.** 독자적인 advisory-lock wrapper와 migration governance를 전부 구현할 의도가 있을 때만 검토할 수 있다. |

근거: wave-1.md의 Umzug 조사.

## 11. dbmate 2.34.1 — 단순 SQL 도구지만 동시 배포 요구 미충족

| 항목 | 내용 |
| --- | --- |
| 확인 버전 | 2.34.1 |
| 라이선스 | unknown — not gathered |
| 유지보수 신호 | unknown — not gathered |
| 동시성 / 잠금 | v2.34.1에서 lock이 없다. dedicated migration job과 외부 lock이 필요하다. |
| 히스토리 / 병합 모델 | timestamp 기반 선형 history다. Git식 병합 지원은 unknown — not gathered. |
| 기능 메모 | SQL CLI; TypeScript-native/integration은 unknown — not gathered. rollback 기능은 unknown — not gathered. |
| 판정 | **비권장.** 운영 단순성은 있어도 동시 배포 실패를 직접 막지 못한다. |

근거: wave-1.md의 dbmate v2.34.1 source 조사.

## 실행 결론

1. **Kysely Migrator를 migration runner로 채택**하고 migration 전용 컨테이너/잡을 배포 첫 단계에 둔다. 대상 배포 파이프라인은 이미 migration → backend deploy → verification 순서이며 Argo는 환경별 backend deploy를 직렬화한다.
2. migration 파일은 **선형만 허용**한다. 두 PR이 같은 baseline에서 migration을 만들었으면 뒤에 병합되는 PR은 최신 main 위에서 파일을 재생성/순번 조정하고, CI가 중복/순서 위반을 차단한다. 이는 Alembic의 `merge revision`을 새 도구에서도 반복하지 않기 위한 운영 규칙이다.
3. DB rollback은 사용하지 않는다는 요구에 맞춰, 실패 수정은 항상 새 forward migration으로만 한다. 다만 각 후보의 rollback capability 자체는 위 프로필에 저널 범위대로 남겼다.

