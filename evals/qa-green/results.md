# QA GREEN 실행 기록

[criteria.md](./criteria.md)의 기준으로 채점한다. 실행은 [harness/run.sh](./harness/run.sh)로 한 번에
PR 하나나 둘씩 한다. 모델은 codex `gpt-6-luna`, 추론 강도 `max`, 샌드박스 없음이다.

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
