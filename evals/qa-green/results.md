# QA GREEN 실행 기록

[criteria.md](./criteria.md)의 기준으로 채점한다. 실행은 [harness/run.sh](./harness/run.sh)로 한 번에
PR 하나나 둘씩 한다. 모델은 codex `gpt-6-luna`, 추론 강도 `max`, 샌드박스 없음이다. #4442 r1 이후 실행은 fast 서비스 등급(`service_tier=fast`)을 쓴다.

## 대상 PR

| 축 | PR | 변경 | 기대하는 액터 판정 |
|---|---|---|---|
| mobile | [#4442](https://github.com/algo-care/algocare-home/pull/4442) | 한 번에 담기로 들어온 영양제 목록이 남은 일수 순서를 지킨다 | 모바일 앱 사용자 `render` |
| dispenser | [#4345](https://github.com/algo-care/algocare-home/pull/4345) | stg 페어링 QR이 stg 앱을 열게 한다 | 디스펜서 화면 `render`, QR을 찍는 앱 사용자 |
| backend | [#4444](https://github.com/algo-care/algocare-home/pull/4444) | 섭취 원장 대조 작업의 매일 04:50 예약 제거 | 작업 큐 운영자 `none` |
| commerce | [#4413](https://github.com/algo-care/algocare-home/pull/4413) | 가구 초대 하단 버튼을 visualViewport 맞춤 레이아웃으로 | 초대받은 사용자 `render`, 키보드 상태 |
| admin | [#4438](https://github.com/algo-care/algocare-home/pull/4438) | 자가섭취 보유분 카테고리를 응답 맵에서 조회 | 어드민 운영자 `render` |

기대 판정은 채점자가 diff를 읽고 미리 적은 것이다. QA가 다르게 판정했으면 diff 근거로 누가 맞는지 따진다.

## 기기 프로필

algocare-home 매니페스트(`~/.qa-cases/<projectKey>/device-profiles.yaml`)에 15개를 저장했다.
폰 4개(아이폰 375×667·414×896·440×956, 갤럭시 360×780), 폴더블 4개(Z Fold8 커버 475×751·메인 696×933,
iPhone Duo 접힘 466×678·펼침 626×890), iPad Air 11 세로·가로, 데스크톱 3개(1536×864, 1920×1080,
21:9 3440×1440), 디스펜서 2개(v2 667×1117, v1 601×961)다. Z Fold8 크기는 DPR 2.625를 가정한 값이다.

## 회차별 결과

(실행할 때마다 PR별로 A축·B축 판정, 실패 항목과 근거, 고친 것을 덧붙인다.)

### 1회차 무효 (round1)

하네스가 호출한 Claude 세션의 `OMT_SESSION_ID`를 codex에 넘겨서 #4444와 #4438이 상태 파일 하나를
같이 썼다. 두 실행을 멈추고 무효로 했다. 하네스가 `OMT_DIR`·`OMT_PROJECT`·`OMT_SESSION_ID`를 지우고
codex를 띄우게 고친 뒤 `r1`로 다시 돌렸다.

### r1 — #4444 backend (런타임 325e5a17)

판정 **실패** (B축 MUST 1건). QA 판정은 APPROVE, 시나리오 8개(통과 7, 검증 불가 1).

A축은 MUST를 모두 통과했다.

- A1: AC 4개가 PR 본문의 의도(예약 제거, 수동 실행 경로 유지, 위키 수정, 배포 후 확인 조건)를 한국어
  관찰 결과로 덮는다. 스토리에 goal과 Given/When/Then이 있다.
- A2: 액터는 운영자 1명, `none`. 앱·디스펜서·커머스·어드민 코드는 이 예약을 읽지 않는다(diff는
  `schedules.ts` 7줄 삭제와 위키뿐).
- A3: 제목이 모두 "운영자가 …한다"이다. 위험 1·2·4·5·6은 시나리오 태그, 3은 "고정 key·cron·JobName만
  쓴다"로 N/A 선언했고 diff와 맞다. why-needed가 시나리오마다 다르다.
- A5: 격리 Redis에 구 예약을 심고 실제 cron-worker를 띄워 제거를 확인했다(전후 파일 있음). 동시 기동
  2대도 실제로 돌렸다. 삭제 실패·메타데이터 손상은 `--evidence-surface test`로, 해당 테스트
  (`schedule-reconciler.test.ts` 87·104행)가 기대를 단언한다. 9/30 운영 구간은 OpenSearch 403으로
  `blocked`, 시도 10건과 attempt log가 있다. PR 본문의 배포 후 확인 조건이 운영 로그라서 운영 계정
  읽기 조회는 근거가 있다. 자원 9개를 기록하고 모두 해제했다.
- A6: blocked 1건은 해결 상태라 APPROVE가 게이트와 맞다. flaky-rerun은 H 시나리오를 격리 Redis에서
  다시 몰았고 테스트는 vitest를 직접 재실행했다.

B축 실패 항목:

- **B5.3 실패.** 감사 표가 1280px에서 958px로 본문(792px)을 넘어 결과·증거 열이 표 안 가로 스크롤
  뒤로 숨었다. 원인은 렌더러 `.audit-story { white-space: nowrap }`이 긴 스토리 id
  (`daily_parity_schedule_lifecycle`)를 한 줄로 고정한 것. → `.audit-story code`가 줄바꿈되게 고쳤다
  (주입 확인: 792/792).
- B4(권장 수준 결함): 검증 불가 카드 끝에 "presentation.md 참조"가 붙었다. 저자용 누락 표시(`gap()`)를
  막힘 안내에 재사용한 탓. presentation-reviewer도 COMMENT로 지적했다. → 막힘 안내는 참조 없이 렌더.
- B5.4(경계): 제목이 "QA Report — QA GitHub PR #4444 (merge commit in current worktree)"로 영어였다.
  → 제목을 "QA 보고서 —"로, SKILL.md에 target을 보고서 언어의 변경 이름으로 쓰라고 추가.

그 밖의 B축(판정 요약줄, 배너, AC 판정과 scenarioRefs, 액터 블록, 접힌 N/A, 375px 가로 스크롤 없음,
다크 모드 다이어그램)은 통과다.

### r1 — #4442 mobile (런타임 630c378bfc13)

판정 **실패** (A축 MUST 여러 건). QA 판정은 COMMENT, 시나리오 7개 모두 검증 불가. 판정과 보고는
기록과 맞고(AC 2개 모두 미검증으로 표시), 띄운 서버·시뮬레이터 9개를 모두 해제했다. 실패는 실행에 있다.

- **A2.2·A4.2 실패.** 모바일 앱은 iOS와 Android로 출시하는데(`apps/mobile/docs/qa-runbook.md` 3행)
  액터 프로필이 iOS 5개뿐이었다. 원인은 스킬의 두 규칙 충돌: 비용 원칙 "React Native는 한 플랫폼"을
  따르면서 프로필도 그 플랫폼 것만 골랐다.
- **A5.5 실패.** 막힘 사유가 변경 밖의 구조적 한계가 아니다.
  - iPhone 18 Pro Max·iPhone Duo는 "설치된 기기 종류가 없다"로 막혔다. 프로필은 논리 크기라서
    같은 크기의 설치 기기나 크기를 맞춘 Android 에뮬레이터로 돌릴 수 있었다.
  - iPhone SE는 비밀번호 칸 입력 실패, iPhone 11은 개발 오류 배너가 버튼을 가려서 2~3회 시도 뒤
    막힘으로 기록했다. 드라이버 장애이며 다른 입력 경로·오버레이 닫기·Android·문서화된 딥링크를
    시도하지 않았다.
- A4.3~A4.5: 기록된 profile 시나리오가 없어 판정할 수 없다(위 실패의 결과).

고친 것(8d778810): SKILL.md에 프로필은 기기 모델이 아닌 논리 크기라고 명시했다. 앱이 출시하는 모든
플랫폼의 프로필을 고르고, 레이아웃은 한 플랫폼 기기를 각 크기로 맞춰 돌린다(Android `wm density 480` +
`wm size <w×3>x<h×3>`, iOS는 같은 크기 기기). 미설치 모델과 드라이버 입력 장애는 `blocked` 사유가 아니라는
red flag를 추가했다.
