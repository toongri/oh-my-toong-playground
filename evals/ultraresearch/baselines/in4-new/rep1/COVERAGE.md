# 커버리지 게이트 결과

| 요구 항목 | workers | 상태 |
| --- | --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | 확인 불가 — Wave 1은 총 4 codebase + 6 external tool lanes만 기록하고 축별 배정을 남기지 않음 | uncovered: expansion-log에 이 축의 배정 워커가 기록되지 않아 이 요구사항에 수집된 자료를 입증할 수 없음 |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | Wave 2: Sqitch dependency-plan expansion; Wave 1 축별 배정은 확인 불가 | uncovered: Wave 2는 Sqitch 한 후보만 다루며, 전체 도구 비교를 뒷받침할 Wave 1 축별 수집 자료의 배정 기록이 없음 |
| 배포와 함께 안전하게 실행하는 방법 | 확인 불가 — Wave 1은 총 4 codebase + 6 external tool lanes만 기록하고 축별 배정을 남기지 않음 | uncovered: expansion-log에 이 축의 배정 워커가 기록되지 않아 이 요구사항에 수집된 자료를 입증할 수 없음 |
| 롤백 없이 forward-only로 운영하는 방법 | 확인 불가 — Wave 1은 총 4 codebase + 6 external tool lanes만 기록하고 축별 배정을 남기지 않음 | uncovered: expansion-log에 이 축의 배정 워커가 기록되지 않아 이 요구사항에 수집된 자료를 입증할 수 없음 |
| 현재 AlgoCare의 Python + Drizzle + 배포 제약과의 적합성 | 확인 불가 — Wave 1은 총 4 codebase + 6 external tool lanes만 기록하고 축별 배정을 남기지 않음 | uncovered: expansion-log에 이 축의 배정 워커가 기록되지 않아 이 요구사항에 수집된 자료를 입증할 수 없음 |

## 행별 판정 근거

- Alembic multi-head를 대체하거나 줄이는 병합 모델: 보고서에 병합 모델 결론은 있으나, expansion-log는 이 축을 맡은 워커를 식별하지 않아 해당 근거가 수집됐음을 검증할 수 없다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: Wave 2의 Sqitch 확장 워커는 확인되지만, 보고서의 전체 후보 비교를 수집한 Wave 1 워커와 이 축의 연결은 로그에 없다.
- 배포와 함께 안전하게 실행하는 방법: 보고서의 singleton migration job 제안과 달리, 이 축에 실제 배정된 워커는 expansion-log에서 확인되지 않는다.
- 롤백 없이 forward-only로 운영하는 방법: 보고서의 forward-only 운영 규칙과 달리, 이 축에 실제 배정된 워커는 expansion-log에서 확인되지 않는다.
- 현재 AlgoCare의 Python + Drizzle + 배포 제약과의 적합성: 보고서의 현재 저장소 적합성 판단과 달리, 이 축에 실제 배정된 워커는 expansion-log에서 확인되지 않는다.
