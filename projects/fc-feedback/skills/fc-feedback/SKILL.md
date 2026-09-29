---
name: fc-feedback
description: Use when an EA FC (EA Sports FC)/football or futsal coaching-feedback YouTube video needs to become an interactive HTML feedback document and a published team archive entry. Triggers include 코칭 피드백 영상 정리, EA FC 프로클럽 피드백 문서화, 영상 피드백을 팀원별 카드로 정리, feedback video to interactive doc, coaching video archive.
---

# fc-feedback

코칭 피드백 영상을 인터랙티브 HTML 문서로 만들어 아카이브에 발행하는 파이프라인이다.
**유일한 진입점은 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts <command>`다** — 셸 내장
`fc`(zsh 히스토리 명령)는 전혀 다른 프로그램이니 단독으로 실행하지 않는다. 작업 폴더는
기본 `$OMT_DIR/fc-feedback/<세션 id>`(`--work`로 재정의)이며, `session.json`/
`lines.json`/`candidates.json`·`sheets.json`/`plan.validated.json`/`notes.json`… 중
이미 있는 파일을 보고 묻지 않고 **다음으로 비어 있는 단계부터** 잇는다.

## 원칙

- **LLM은 시간을 만들지 않는다.** `lines.json`의 인덱스(`i`)만 고르면 스크립트가 초로
  계산한다 — `plan.json`에 초를 직접 쓰지 않는다.
- **이번 실행에서 web search/fetch 도구(Claude: WebSearch/WebFetch; Codex: web search)가
  실제로 반환한 URL만** `refs-draft.json`에 쓴다. 기억이나 추정 URL은 금지.
- **모든 id는 스크립트가 검증한다.** exit 1이면 JSON을 고쳐 재실행한다. 검증으로 생성된
  파일은 손으로 고치지 않는다.
- **페이지는 `render`만 만든다.** `data.json`/HTML을 손으로 쓰지 않는다 — 검증은 `check`
  명령과 `render`의 링크 검사로 끝나고 브라우저는 필요 없다.

파일 계약 전체는 `references/contracts.md`를 읽는다.

## 0–11 단계

0. **설정 확인**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts config status`. `unconfigured`면
   아카이브/명단/공개 URL을 물어 `config set --archive <dir> --roster <file> --pages-url
   <https://.../>`을 실행하거나, 원하면 `config disable`(아카이브 없이 `$OMT_DIR`에만
   렌더). 동의 후 `init-archive`로 없는 파일만 생성한다.
1. **fetch**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts fetch <url...>`. 봇 체크 실패 시
   `--cookies`로 재시도(자동 1회 재시도 있음).
2. **transcribe**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts transcribe [--hq] [--captions-only]`.
3. **scan**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts scan` — 무음/장면 후보와 미리보기,
   HUD 시트를 만든다.
4. **분할안 작성(에이전트)**: `lines.json`(줄+텍스트)과 HUD 시트(경기 시계 리셋 = 새 경기,
   §세그먼트 판단), 후보 미리보기(`cand/*.jpg`, Claude는 Read, Codex는 view_image로
   본다)를 보고 `plan.json`을 줄 인덱스만으로 작성한다. key frame으로 쓸 순간이 후보에
   없으면 이 단계에서도 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts add-frame --video <VID>
   --t <sec>`로 후보를 추가할 수 있다(add-frame은 후보만 늘리며 게이트 대상이 아니다).
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check plan` 실행.
5. **REVIEW GATE**: `check plan`의 exit code로 분기한다.
   - exit 1(무효): 오류 JSON을 보고 `plan.json`을 고쳐 4번부터 재실행.
   - exit 2(pending, `proposed_tags` 사용): 게이트 표(`tableMd`)와 제안 태그를 사용자에게
     보여주고 **명시적 승인**을 받는다. 승인되면 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts
     taxonomy add <tag...>`로 새 태그를 넣고 `check plan`을 다시 실행해 exit 0을 받는다.
   - exit 0: 게이트 표를 보여주고 사용자 승인을 받는다. 승인 전에는 6단계로 진행하지 않고,
     **승인 후에는 멈추지 말고 11단계 PUBLISH GATE까지 한 실행 안에서 이어서 진행한다.**
6. **notes 작성(에이전트)**: 승인된 유닛마다 해당 줄 범위 + 프레임을 보고 `notes.json`
   (v2, 아래 참고)을 작성한다. 필요한 프레임이 후보에 없으면 `bun
   ${CLAUDE_SKILL_DIR}/scripts/fc.ts add-frame --video <VID> --t <sec>`로 추가한다.
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check notes`로 검증.
7. **frames**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts frames`.
8. **similar**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts similar`로 후보를 만들고,
   후보 목록 안에서 유닛당 최대 3개를 골라 `similar-choices.json`을 쓴 뒤
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check similar`.
9. **refs**: web search/fetch 도구로 EA FC·전술 자료를 찾아(원칙의 URL 규칙 적용)
   `refs-draft.json`에 쓰고 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check refs` 후
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts verify-refs`로 접근 가능 여부를 확인한다.
10. **render**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts render [--site-only]` — 재검증 후
    렌더한다(경로/링크 오류는 exit 1).
11. **PUBLISH GATE**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts publish-prep`의 링크 검사와
    `git status --porcelain` 결과, 제안된 `git add`/`commit`/`push` 명령을 그대로 보여주고
    사용자의 명시적 "예"/"yes" 응답을 받은 후에만 그 명령을 실행한다. 응답이 없거나
    거절이면 아무 git 명령도 실행하지 않는다.

### disabled 모드 분기

`config disable`(또는 `config status`가 `disabled`) 상태면: 8단계는 과거 세션이 없으므로
빈 `similar-choices.json`(`{"version":1,"units":{}}`)을 쓰고 `check similar`만 통과시킨다.
10단계는 `render --site-only`로 `$OMT_DIR`에만 만든다(아카이브 미변경). 11단계
PUBLISH GATE는 생략하고 사이트 경로만 안내한다 — git 명령은 실행하지 않는다. roster가
없으므로 `member_ids`는 항상 빈 배열이어야 한다(아니면 `check plan`이 거부한다).

## notes.json 작성 규칙 (품질의 핵심)

- 첫 번째 `text` 블록은 **두괄식**이다 — 장면(누가 공을 잡았고 무엇이 일어났는지)을 한
  문장으로 그리고, 원문의 지시·평가를 `**볼드**`로 짚는다. "코치가 ~라고 설명합니다" 류
  화법 보고로 시작하지 않는다. 원문에 없는 행동을 지어내지 않는다. 문제/누구/대신 같은
  고정 라벨은 쓰지 않는다.
- **유닛 범위 안 지시·평가·결과는 전부 옮긴다** — 하나만 골라 볼드로 짚고 나머지를
  요약으로 흘리지 않는다. 지시가 둘 이상이면 각각 볼드로 짚고, 비판·아쉬움 평가와 장면의
  결과(실점·파울 등)를 빼거나 완화하지 않는다.
- **누구에게 하는 말인지, 누가 하는 행동인지 모호하지 않아야 한다** — 명단의 실제
  이름으로 지적 대상·행위자·패스 수신자를 구분해 쓴다. 특정 인명이 없는 팀 전체
  총평을 직전 언급 팀원의 개인 지시로 바꾸지 않는다.
- 뒤따르는 문단+프레임은 **그 유닛의 줄 범위 안 원문에서 확인한** 근거만 보태 장면을
  재구성한다. 다른 유닛의 내용이나 일반 축구 지식·전술 원리를 가져오지 않는다.
- 볼드는 그 문장의 핵심 행동/대상 하나에만 쓴다. 장식적 강조 금지.
- 프레임 캡션은 **그 프레임에 실제로 보이는 것만** 쓴다 — 정지된 같은 장면 사이에 시간
  경과나 상황 변화를 지어내지 않는다.
- 필요한 순간이 기존 후보에 없으면 요약하지 말고 `add-frame`으로 그 순간을 새로 뽑는다.
- 화자 신원·ASR 오류 처리·문장별 원문 대조·캡션 점검은 `references/contracts.md`의
  「원문 근거 대조」를 따른다.

### 유닛 분할 기준

새 유닛은 **지시 또는 교정 행동이 분명한 평가가 있는 한 장면**이다. 대상 전환 발화나
15초 이상 무음은 경계 *후보*일 뿐이다 — 그 구간에 행동 근거가 없으면 독립 유닛으로
만들지 말고 같은 장면의 인접 유닛에 흡수하고, 합칠 수 없으면 해당 주제의 `summary`에
보존한다. 20초 이상 떨어진 두 장면은 한 유닛으로 합치지 않는다.
HUD 시트의 경기 시계가 리셋되면 새 경기(`matches[]`의 새 항목)로 나눈다.

## 권장 실행 모델

(모델 비교 결과로 확정 예정)
