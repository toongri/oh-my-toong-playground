# Coverage

| 요구 항목 | 상태 | workers |
| --- | --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | uncovered: expansion-log가 이 항목의 작업자 배정을 기록하지 않아 수집 주체를 검증할 수 없음 | 미기록 |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | uncovered: expansion-log가 이 항목의 작업자 배정을 기록하지 않아 수집 주체를 검증할 수 없음 | 미기록 |
| 배포와 함께 안전하게 실행하는 방법 | uncovered: expansion-log가 이 항목의 작업자 배정을 기록하지 않아 수집 주체를 검증할 수 없음 | 미기록 |
| 롤백 없이 forward-only로 운영하는 방법 | uncovered: expansion-log가 이 항목의 작업자 배정을 기록하지 않아 수집 주체를 검증할 수 없음 | 미기록 |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | uncovered: expansion-log가 이 항목의 작업자 배정을 기록하지 않아 수집 주체를 검증할 수 없음 | 미기록 |

- Alembic multi-head를 대체하거나 줄이는 병합 모델: Sqitch 확장 작업은 기록되어 있지만 이 요구 항목에 배정되었다는 항목별 기록이 없어, Wave 1의 합계만으로는 커버리지를 입증할 수 없다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: REPORT에 비교 내용은 있으나 expansion-log에는 이 항목에 배정된 작업자가 기록되어 있지 않다.
- 배포와 함께 안전하게 실행하는 방법: REPORT에 singleton migration job과 배포 순서가 있으나 expansion-log에는 이 항목에 배정된 작업자가 기록되어 있지 않다.
- 롤백 없이 forward-only로 운영하는 방법: REPORT에 immutable migration과 forward-only 규칙이 있으나 expansion-log에는 이 항목에 배정된 작업자가 기록되어 있지 않다.
- 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성: REPORT에 현재 상태 및 SSOT 판단이 있으나 expansion-log에는 이 항목에 배정된 작업자가 기록되어 있지 않다.
