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

### r1 — #4438 admin (런타임 325e5a17, 구버전)

판정 **실패**. QA 판정은 APPROVE이고 두 사이클 모두 시나리오 7개가 통과했다. 실행 시간이 길었다.
codex 재개 뒤 9시간 가까이 돌았고, 대부분 증거 가림 처리와 문맥 압축 뒤 복구에 썼다.

- **A4.5 실패.** 프로필 시나리오의 근거 검토에 잘림·겹침·가로 넘침·줄바꿈 점검이 없다. 이 런타임은
  layout claim 게이트(ff85fd79) 이전 버전이다.
- **A5.3·B4.4 실패(새 결함).** `unmapped-category-fallback`(맵에 없는 카테고리)과
  `household-switch-stale-response`(가구 전환 경합)는 컴포넌트 테스트로 증명했다. 그런데 두 시나리오에
  노트북 프로필이 붙어 있어서 CLI가 전후 캡처를 요구했다. QA는 폴백도 경합도 보이지 않는 일반 매핑 행
  캡처를 "행동 전/후 화면"으로 붙였다. PO는 카드의 이미지를 근거로 읽는다.
  - 원인: `author-scenario`가 render 액터의 시나리오마다 `--profile`을 강제했다. 프로필이 붙으면
    `record-scenario`는 전후 캡처를 요구했다. 그래서 테스트로 증명하는 시나리오도 화면 캡처를 달아야 했다.
  - 고친 것(4822a85a): 프로필은 화면에서 구동하는 시나리오에만 붙인다. render 액터의 시나리오도
    `--profile`이 선택이 됐다. 각 프로필에는 여전히 시나리오가 하나 이상 있어야 한다. 프로필 시나리오를
    `--evidence-surface test`로 기록하면 CLI가 거부한다. SKILL.md에 red flag를 추가했다.
- B5.3·B5.4 실패: 감사 표 907px/792px, 제목 영어. 둘 다 07774a38에서 이미 고쳤다.

통과한 것:

- A1: AC 2개가 PR 본문의 두 동작(맵에서 이름 조회, 없으면 식별자 표시)을 덮는다. 타입체크 복구는
  baseline의 `pnpm check admin` 통과 기록으로 확인했다.
- A2: 어드민 운영자 하나, `render`. diff는 어드민 컴포넌트와 그 테스트뿐이다.
- A3: 주입·실패 경로·경합 시나리오가 사용자 행동으로 쓰였다. 위험 6(상태 변경)의 N/A 사유는
  읽기 전용 표시라는 diff 사실과 맞다.
- A5: 조회 실패는 실제 응답 프레임을 바꿔 화면에서 확인했다. 특수 문자열은 표시 이름을 바꿔 DOM에서
  실행되지 않는 것을 확인했다.
- B1·B2·B5.1·B5.2: 판정 요약줄, AC 판정, 다크 모드 다이어그램, 375px에서 가로 스크롤 없음.

경계(권장): 근거 검토 claim 문장이 카드에 그대로 나와 코드 심볼(`displayName`,
`SelfIntakeSections.test.tsx:316-344`)과 영어 출처 라벨("Action/Observation:", "Recovery:")이 보인다.
감사 표의 driven-at에도 영어 자유 문장이 있다. 다른 PR에서도 나오면 고친다.

### r1 — #4413 commerce (런타임 bf301e0e, fast)

판정 **실패**, 오염된 실행. 시나리오 30개 중 통과 24, 검증 불가 6. 판정을 기록하지 않았고 사용자에게
강제 종료를 요청하며 멈췄다. 띄운 자원 20개는 모두 해제했다.

- **하네스 오염.** 문맥 복구 뒤 전역 구버전 스킬(`~/.agents/skills/qa/SKILL.md`, presentation.md)을
  열 번 넘게 읽고 인용했다. 격리 런타임은 전역 스킬을 목록에서 끌 뿐이고, 경로로 읽는 것은 막지 못한다.
  → 실행 프롬프트에 이 워크트리의 `.agents/skills/qa`만 쓰고 전역 사본은 읽지 말라고 적었다. 다른
  실행의 전역 읽기 횟수: #4438 r1 1회, 나머지 0회.
- **A5.5 실패.** 검증 불가 6건(iPhone SE·갤럭시 360의 실제 키보드 동작)이 모두 기기 구동 문제다.
  - Android: 처음에 세션 이름 없이 `agent-device open`을 실행해 `default-android` 세션이 생겼고, 그
    세션이 확보한 에뮬레이터를 잡았다. 오류가 `agent-device close --session default-android`를
    알려 줬는데 실행하지 않았다.
  - iOS: 직접 만든 시뮬레이터를 지정하지 못해 다른 시뮬레이터에 연결됐다.
  - 고친 것(96d46aab): `acquire-device`가 그 기기의 agent-device 플래그(`--serial|--udid`,
    `--session qa-<id>`)를 출력한다. stage3-handson.md에 자기가 연 세션을 닫고 다시 시도하는 절차를,
    SKILL.md에 red flag를 넣었다.
- **A6.1 실패.** AC 4개가 미검증인데 COMMENT 판정으로 완료하지 않고 사용자에게 강제 종료를 요청했다.
  스킬 규칙상 검증 불가가 남아도 COMMENT로 완료할 수 있다. 구버전 스킬을 읽은 뒤의 행동이라 오염의
  결과로 보고, 다시 돌려서 확인한다.
- B축은 판정 없는 초안 보고서라 채점하지 않았다.

### r2 — #4444 backend (런타임 96d46aab, fast)

판정 **실패** (B축 MUST 2건). QA 판정은 COMMENT이고 시나리오 8개 중 통과 6, 실패 1, 검증 불가 1이다.
A축은 MUST를 모두 통과했다.

- A2: 액터가 4명으로 늘었다. 어드민 큐 화면이 실제로 보내는 `queueAdmin.getJobs` 응답으로 검증한
  `contract` 액터가 들어왔다. r1에는 이 액터가 없었다.
- A6.3: 실패 1건(`wiki_describes_manual_run`)은 실제 문서 결함으로 인정한다. 위키는 "필요할 때 큐에 넣어
  실행한다"고 안내한다. 그런데 운영자가 쓸 수 있는 경로는 처리기를 직접 부르는 Job CLI뿐이고, 어드민 큐
  API는 조회·재시도·삭제만 제공한다(QA가 위험 3의 N/A 사유에 직접 적은 사실). 실패의 심각도가 낮아
  COMMENT로 둔 것도 기록과 맞다.
- A5.5: PRD 구간은 OpenSearch 403으로 막혔다. 재시작 지표는 직접 조회해 0을 확인했다. 시도 기록이 있다.

B축 실패 항목:

- **B1.3 실패.** 기능 개요 첫 문단이 판정(COMMENT), 시나리오 수, "신뢰도 70/100 LOW",
  PRD 확인 상태, 기능 계획 자료 부재를 한 문단에 몰아넣었다. 정작 무엇이 누구에게 바뀌었는지는 그 뒤에
  나온다. presentation.md의 금지문("한 문단에 몰아넣지 말라")이 효과가 없었다.
  → 고친 것(e40a70b9): 개요를 쓰는 순서를 정했다(누가 무엇을 쓰는가 → 무엇이 달라지는가 → 고치는 문제,
  필요할 때만 운영 반영 상태). 최종 렌더는 개요에 판정·"검증 불가"·"미검증"·신뢰도가 있으면 거부한다.
- **B5.3 실패.** 감사 표가 1280px에서 859px/792px로 넘쳤다. "driven at" 열의 긴 영어 토큰
  (테스트 파일 경로)이 줄바꿈되지 않았다. → 고친 것(457b56e7): 그 열의 `overflow-wrap: anywhere`, 위험 열
  최소 폭 11rem→8rem. 주입 확인: #4444 r2·#4438 r1 보고서 모두 792/792.

그 밖의 B축(배너, AC 판정과 근거, 액터 블록, 접힌 N/A, 375px 가로 스크롤 없음)은 통과다. 권장 결함:
감사 표 driven-at과 시나리오 기대 결과에 영어·코드 용어(`delayed`, `processor`, `scheduler`)가 남아 있다.

### r1 — #4345 dispenser (런타임 bf301e0e, fast)

판정 **실패** (A축·B축 MUST 여러 건). QA 판정은 REQUEST_CHANGES이고 시나리오 9개 중 통과 4, 실패 1,
검증 불가 2, 미실행 2다. 디스펜서 런북이 에뮬레이터 기동 전 승인을 요구해서 한 번 `await-user`로 멈췄다.
정당한 질문이고, 하네스가 QA가 제안한 범위대로 승인했다.

- 통과: A1(AC 3개가 PR 본문의 STG 링크 교체와 설치·미설치 두 경로를 덮는다), A2(디스펜서 화면
  `render` 액터와 Android·iOS·모바일 딥링크 `contract` 액터), A3.
- **A4.3·A4.4·A5.5 실패.** 이 PR의 핵심 화면인 디스펜서 QR 시나리오 2건(v1·v2 프로필)이 검증 불가다.
  - 사유 1: "실제 QR 발급은 STG 서버에 nonce를 기록해 승인된 서버 무변경 범위에 어긋난다". 그 범위는 QA가
    직접 제안한 것이다. 페어링 화면을 여는 데 필요한 쓰기를 승인 요청에 넣지 않았다.
  - 사유 2: iOS H 시나리오가 실패하자 "H 실패 시 구동 중단" 규칙으로 나머지 전부를 멈췄다. iOS 스토어
    응답의 실패는 디스펜서 화면과 무관하다. 같은 이유로 설치 앱 도착 시나리오 2건이 미실행으로 남았다.
  - 프로필 시나리오 스크린샷이 하나도 없다.
- 고친 것(eb0d2902):
  - SKILL.md: 런북 때문에 승인을 구할 때는 H 시나리오에 필요한 행동과 그 행동이 쓰는 데이터를 모두
    한 요청에 넣게 했다. 스스로 정한 범위 때문에 막혔으면 `await-user`로 묻는다. red flag도 추가했다.
  - stage3-handson.md: 직접 작성한 H 시나리오가 실패하면 그 액터의 행만 중단한다. 다른 액터의 H 시나리오는
    끝까지 구동한다.
- A6.3 경계: iOS 실패("The app you are looking for is unavailable")는 AppsFlyer 콘솔 설정 문제로 보인다.
  PR은 콘솔 작업을 범위 밖이라고 적었다. 하지만 사용자가 겪는 결과이고, "STG QR이 STG 앱을 연다"는
  PR 의도에 비춰 실패로 기록할 근거가 있다. 보고서도 원인을 확정하지 않았다고 적었다. 실패 처리는 인정한다.
- B5.3 실패: 감사 표 980px/792px. 457b56e7에서 고쳤다.
- B1.3 실패: 기능 개요에 "실제 QR 화면·payload와 설치 앱 도착은 확인하지 않았습니다"가 섞였다. e40a70b9의
  개요 게이트가 막는 형태다.
