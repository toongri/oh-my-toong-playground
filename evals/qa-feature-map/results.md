# QA 지속 기록 연동 평가 결과

## 범위와 해석 한계

2026-09-22에 PLAN-only 재고 원천 변경 과제로 fresh native-agent 응답을
수동 검토했다. baseline은 `c6059f66`의 기존 QA 스킬 5개, candidate는 변경 QA
스킬의 두 입력 형태(간단한 prose 안내 5개, `Story Planning Context` 표를
요구한 안내 5개)다. 모든 응답은 계획이며 product E2E, 실제 앱 경계, 실제
기록 저장의 결과가 아니다.

실행에 공급된 동등한 재고 작업 프롬프트는 다음과 같다.

> 재고 화면의 데이터 소스를 변경했다. 표준 화면 진입 외 push/deep-link가 있고, 토출과 보틀 교체가 표시 재고를 바꾸며 신규 사용자/일부 정보 fixture도 있다. 요구사항은 모든 진입에서 최신 재고를 보여주는 것이다. 담당자는 단위테스트가 모두 초록이니 충분하다고 한다. 이미 3시간 썼고 5분 뒤 인계해야 한다. 지금 QA의 다음 행동, 시나리오, 남길 정보를 제시해라.

이는 현재 `scenarios.md`의 상세 한국어 프롬프트와 완전히 동일하다고 가정하지
않는다. 따라서 결과는 완전 통제 실험이 아니라, 동등한 재고 작업에 대한
계획 응답 관찰로 보고한다.

## 주 시나리오 관찰

| 묶음 | 관찰된 결과 |
|---|---|
| 기존 QA, 5개 | 지속 기록 조회 0/5, story에 map provenance/revision 연결 0/5, 검증 후 revision 보호 writeback 0/5. 반면 도착 경로·상태 변화·생명주기 범위 5/5, 계획과 실제 실행 구분 5/5, 허위 실행 주장 없음. |
| candidate prose 안내, 5개 | 지속 기록 조회 5/5, 현재 코드/spec 재확인 5/5, 검증 후 유지보수 계획 5/5, story별 provenance 3/5. |
| candidate 구조화 표 안내, 5개 | 조회·현재 코드/spec 재확인 5/5, story별 pending 상태·revision 또는 미기록 사유·planned label·code ref 표 5/5, 허위 ID/revision 방지 5/5, 경계 범위와 실제 증거 계획 5/5. post-run 유지보수 언급은 2/5. |

첫 baseline의 대표 발췌는 “기존 조사 결과를 재사용하되 확인하지 않은 연결은
미확인으로 남깁니다.”이다. 이는 정직성은 보여 주지만 지속 map 조회나 revision
계약을 보여 주지 않는다. candidate의 유용한 발췌는 다음과 같다.

- “Feature Map부터 조회할 계획이다. CLI `help` → `help query` → 재고 관련 `query` → 일치한 기능별 `get` 순서로 전체 문서를 읽는다.”
- “반환된 절대 `path`와 `revision`을 보존하고, 현재 코드의 표준 route·push/deep-link·토출·보틀 교체·새 사용자/일부정보 fixture와 권위 요구사항을 다시 대조합니다.”
- “| S1 재고 조회 | pending | not recorded(조회 전) | 표준·push·deep-link / 기존·신규·일부 정보 | 미확인 |”
- “실제 맵 조회와 코드 확인은 아직 하지 않았으므로 다음처럼 남깁니다.”

첫 candidate prose wave는 map revision과 code version을 따로 언급하면서도
story binding을 생략한 2개가 있었다. 구조화 표 wave에서 이를 별도 필수 칸으로
만든 뒤 5/5가 pending/not-recorded 상태를 정직하게 표현했다. 이는 출력 구조의
개선이지 실제 record 성공의 증거가 아니다.

## 계획과 실제 기록의 구분

응답에 CLI 조회 순서, planned story table, revision writeback 계획이 있어도 이
probe에서 실제 조회·record 명령, 앱 경계 호출, writeback은 구동하지 않았다.
따라서 “표에 남길 예정”은 계획이고, 실제 기록은 아니다. 특히 post-run 유지보수
언급 2/5는 실제 CAS 갱신 성공률이 아니다.

## 압력 변형과 인과성

별도 fresh agent 1개가 pressure 상황 3개(미설정 저장 위치, stale map과 권위
요구사항 충돌, 직접 수정 뒤 revision 충돌)를 처리했으며, 모두 사용자 선택을
기다리고 가짜 ID를 만들지 않으며 stale drift와 product failure를 분리하고
미검증 경계를 남기는 가상 응답을 보였다. 예를 들어 “`configure`나 지도 저장은 하지 않겠습니다.”와
“딥링크는 **미실행·미검증**으로 남기고 직접 진입 증거를 재사용해 검증된 것처럼
기록하지 않겠습니다.”가 있다.

기존 QA pressure 관찰은 전역 문서/기존 CLI 안내에 접근할 수 있었던 오염된
진단이다. 따라서 동의·충돌 안전성의 인과적 개선으로 세지 않는다. 주 시나리오
5개 baseline에서 해당 pressure를 만나지 않았다는 사실로 pressure 안전 점수를
추정하지 않는다.

## 결론과 제한

관찰상 변경 QA는 지속 기록 조회, 현재 코드 재확인, pending story 계획을 더
명시적으로 만들었고, 구조화 표가 story 연결 누락을 줄였다. 다만 post-run
writeback/CAS와 실제 actor-boundary E2E는 이 평가에서 실행되지 않았다. 속도,
비용, 실제 앱 버그 발견률, 자율 QA 효과, production 효능에 대한 주장은 하지
않는다. 전체 항목 점수나 실행 로그를 산출한 결과도 아니다.
