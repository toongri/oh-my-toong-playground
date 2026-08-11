# Coverage gate

| 요구 항목 | 상태 |
| --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | covered |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | covered |
| 배포와 함께 안전하게 실행하는 방법 | covered |
| 롤백 없이 forward-only로 운영하는 방법 | covered |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | covered |

- Alembic multi-head를 대체하거나 줄이는 병합 모델: §1이 자동 의미 병합 부재와 선형 migration history·merge queue 기반의 대체 모델을 설명한다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: §2가 Flyway, Kysely, Drizzle Kit, Atlas, Prisma, Sqitch 및 기타 후보를 조건별로 비교한다.
- 배포와 함께 안전하게 실행하는 방법: §4가 singleton migration job, DB history lock, 성공 후 rollout, CI 검증 흐름을 제시한다.
- 롤백 없이 forward-only로 운영하는 방법: §4가 immutable migration, 새 forward migration 수정, out-of-order 비활성화와 expand/contract 절차를 명시한다.
- 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성: §3이 실제 authority와 배포 순서를 바탕으로 SSOT 결정 및 도입 순서를 판단한다.
