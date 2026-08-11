# Coverage gate 결과

| 요구 항목 | workers | 상태 |
| --- | --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | unresolvable — Wave 1은 `4 codebase + 6 external tool lanes`로만 집계되고 축별 배정이 없다 | uncovered: expansion-log.md에서 이 항목에 실제 배정된 worker를 확인할 수 없다 |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | unresolvable — Wave 1은 `4 codebase + 6 external tool lanes`로만 집계되고 축별 배정이 없다 | uncovered: expansion-log.md에서 이 항목에 실제 배정된 worker를 확인할 수 없다 |
| 배포와 함께 안전하게 실행하는 방법 | unresolvable — Wave 1은 `4 codebase + 6 external tool lanes`로만 집계되고 축별 배정이 없다 | uncovered: expansion-log.md에서 이 항목에 실제 배정된 worker를 확인할 수 없다 |
| 롤백 없이 forward-only로 운영하는 방법 | unresolvable — Wave 1은 `4 codebase + 6 external tool lanes`로만 집계되고 축별 배정이 없다 | uncovered: expansion-log.md에서 이 항목에 실제 배정된 worker를 확인할 수 없다 |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | unresolvable — Wave 1은 `4 codebase + 6 external tool lanes`로만 집계되고 축별 배정이 없다 | uncovered: expansion-log.md에서 이 항목에 실제 배정된 worker를 확인할 수 없다 |

## 행별 판정 근거

- Alembic multi-head를 대체하거나 줄이는 병합 모델: REPORT 본문은 존재하지만, 해당 축에 배정된 worker가 expansion-log.md에 특정되어 있지 않아 `covered`가 될 수 없다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: 도구 비교 내용은 REPORT에 있으나, 축별 worker 귀속이 없는 집계 로그만으로는 coverage를 입증할 수 없다.
- 배포와 함께 안전하게 실행하는 방법: 배포 Job 설계가 보고되었어도, 이 요구 항목을 실제로 수집한 worker가 축별로 기록되어 있지 않다.
- 롤백 없이 forward-only로 운영하는 방법: forward-only 운영 규칙은 보고되었어도, 이 축의 worker 배정이 확인되지 않는다.
- 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성: 현재 저장소 적합성 판단은 보고되었어도, 해당 축에 실제 배정된 worker를 expansion-log.md에서 복원할 수 없다.
