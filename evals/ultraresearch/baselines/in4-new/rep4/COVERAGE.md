# Coverage gate 결과

| 요구 항목 | 상태 | workers |
| --- | --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | covered | Wave 2: Sqitch dependency-plan expansion (Wave 1의 `Sqitch DAG/dependency semantics` lead 확장) |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | uncovered: expansion-log에 이 요구 축에 배정된 worker가 기록되지 않아 수집 소재의 축별 출처를 입증할 수 없음 | 없음(축별 배정 미기록; Wave 1 총계만 기록) |
| 배포와 함께 안전하게 실행하는 방법 | uncovered: expansion-log에 이 요구 축에 배정된 worker가 기록되지 않아 수집 소재의 축별 출처를 입증할 수 없음 | 없음(축별 배정 미기록; Wave 1 총계만 기록) |
| 롤백 없이 forward-only로 운영하는 방법 | uncovered: expansion-log에 이 요구 축에 배정된 worker가 기록되지 않아 수집 소재의 축별 출처를 입증할 수 없음 | 없음(축별 배정 미기록; Wave 1 총계만 기록) |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | uncovered: expansion-log에 이 요구 축에 배정된 worker가 기록되지 않아 수집 소재의 축별 출처를 입증할 수 없음 | 없음(축별 배정 미기록; Wave 1 총계만 기록) |

- Alembic multi-head를 대체하거나 줄이는 병합 모델: REPORT의 병합 모델 분석이 있으며, Wave 1의 Sqitch DAG/dependency lead를 확장한 Wave 2 worker가 이 축에 추적된다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: REPORT에 비교 소재는 있으나, expansion-log는 Wave 1의 총 worker 수만 기록해 이 축의 실제 담당 worker를 식별하지 못한다.
- 배포와 함께 안전하게 실행하는 방법: REPORT에 singleton migration job과 배포 흐름 소재는 있으나, 이 축에 배정된 worker가 expansion-log에 기록되지 않았다.
- 롤백 없이 forward-only로 운영하는 방법: REPORT에 immutable migration·expand/contract 소재는 있으나, 이 축에 배정된 worker가 expansion-log에 기록되지 않았다.
- 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성: REPORT에 현재 저장소 적합성 소재는 있으나, 이 축에 배정된 worker가 expansion-log에 기록되지 않았다.
