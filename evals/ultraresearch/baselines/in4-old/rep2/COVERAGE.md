# Coverage gate

| 요구 항목 | 상태 |
| --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | covered |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | covered |
| 배포와 함께 안전하게 실행하는 방법 | covered |
| 롤백 없이 forward-only로 운영하는 방법 | covered |
| 현재 AlgoCare의 Python + Drizzle + 배포 제약과의 적합성 | covered |

## 판정 이유

1. **Alembic multi-head를 대체하거나 줄이는 병합 모델** — REPORT §1이 자동 의미 병합의 부재와 선형 migration history·merge queue 모델을 직접 설명한다.
2. **TypeScript 진영의 쓸 만한 라이브러리/도구 비교** — REPORT §2가 Flyway, Kysely, Drizzle Kit, Atlas, Prisma, Sqitch 및 기타 후보를 비교한다.
3. **배포와 함께 안전하게 실행하는 방법** — REPORT §4가 singleton migration Job, 성공 후 rollout, CI 검증 흐름을 구체화한다.
4. **롤백 없이 forward-only로 운영하는 방법** — REPORT §4가 immutable migration, 새 forward migration, expand/contract 순서를 명시한다.
5. **현재 AlgoCare의 Python + Drizzle + 배포 제약과의 적합성** — REPORT §3과 최종 선택이 Python/Alembic authority, Drizzle 상태, 현 배포 순서를 기준으로 권고를 제시한다.
