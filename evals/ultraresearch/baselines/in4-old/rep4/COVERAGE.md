# Coverage gate

| 요구 항목 | 상태 |
| --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | covered |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | covered |
| 배포와 함께 안전하게 실행하는 방법 | covered |
| 롤백 없이 forward-only로 운영하는 방법 | covered |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | covered |

## 판정 이유

- Alembic multi-head를 대체하거나 줄이는 병합 모델: 자동 의미 병합의 부재와 선형 history·CI/merge queue로의 해결 모델을 REPORT §1이 다룹니다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: REPORT §2가 Flyway, Kysely, Drizzle, Atlas, Prisma, Sqitch 및 기타 후보를 동시성·병합 기준으로 비교합니다.
- 배포와 함께 안전하게 실행하는 방법: REPORT §4가 singleton migration job, DB lock, 성공 후 rollout, verify 순서를 명시합니다.
- 롤백 없이 forward-only로 운영하는 방법: REPORT §4가 immutable migration, 새 forward migration, `outOfOrder=false`, replay CI, expand/contract 절차를 명시합니다.
- 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성: REPORT §3이 Python/Alembic authority, Drizzle migration 부재, migration SSOT와 배포 순서의 적합성을 검토합니다.
