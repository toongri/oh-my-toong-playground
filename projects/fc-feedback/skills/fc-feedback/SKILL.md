---
name: fc-feedback
description: Use when an EA FC (EA Sports FC)/football or futsal coaching-feedback YouTube video — narrated, or with feedback left as timestamped YouTube comments — needs to become an interactive HTML feedback document and a published team archive entry. Triggers include 코칭 피드백 영상 정리, 댓글 피드백 정리, EA FC 프로클럽 피드백 문서화, 영상 피드백을 팀원별 카드로 정리, feedback video to interactive doc, coaching video archive.
---

# fc-feedback

코칭 피드백 영상을 인터랙티브 HTML 문서로 만들어 아카이브에 발행하는 파이프라인이다.
피드백은 영상 속 음성 해설일 수도, 영상에 달린 **타임스탬프 댓글**일 수도, 둘 다일 수도
있다 — 둘 다 `lines.json`의 줄(`source: speech | comment`)이 되어 같은 단계를 거친다.
**유일한 진입점은 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts <command>`다** — 셸 내장
`fc`(zsh 히스토리 명령)는 전혀 다른 프로그램이니 단독으로 실행하지 않는다. 작업 폴더는
기본 `$OMT_DIR/fc-feedback/<세션 id>`(`--work`로 재정의)이며, `session.json`/
`lines.json`/`candidates.json`·`sheets.json`/`plan.validated.json`/`notes.json`… 중
이미 있는 파일을 보고 묻지 않고 **다음으로 비어 있는 단계부터** 잇는다.

## 원칙

- **LLM은 시간을 만들지 않는다.** `lines.json`의 인덱스(`i`)만 고르면 스크립트가 초로
  계산한다 — `plan.json`에 초를 직접 쓰지 않는다.
- **이번 실행에서 검색·조회 도구(Claude: WebSearch/WebFetch; Codex: web search; 유튜브
  검색 `uvx yt-dlp "ytsearch…"`)가 실제로 반환한 URL만** `refs-draft.json`에 쓴다. 기억이나
  추정 URL은 금지.
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
   `--cookies`로 재시도(자동 1회 재시도 있음). 영상의 댓글도 함께 받는다.
2. **transcribe**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts transcribe [--hq] [--captions-only]`.
   타임스탬프 댓글은 항상 줄로 들어간다. 해설 음성이 없는 영상(경기 녹화 + 댓글 피드백)은
   `--no-speech`로 음성 전사를 건너뛴다 — 해설이 있는지 모르면 사용자에게 묻는다. 결과의
   `comments` 통계(`empty`=내용 없는 타임스탬프, `untimed`=타임스탬프 없는 댓글,
   `out_of_range`=영상 밖 시각)는 줄이 되지 않은 개수이므로 사용자에게 그대로 알린다.
3. **scan**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts scan` — 무음/장면/댓글 시각 후보와
   미리보기, HUD 시트를 만든다(transcribe 뒤에 실행해야 댓글 시각 후보가 생긴다).
4. **분할안 작성(에이전트)**: `lines.json`(줄+텍스트)과 HUD 시트(경기 시계 리셋 = 새 경기,
   §세그먼트 판단), 후보 미리보기(`cand/*.jpg`, Claude는 Read, Codex는 view_image로
   본다)를 보고 `plan.json`을 줄 인덱스만으로 작성한다. key frame으로 쓸 순간이 후보에
   없으면 이 단계에서도 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts add-frame --video <VID>
   --t <sec>`로 후보를 추가할 수 있다(add-frame은 후보만 늘리며 게이트 대상이 아니다).
   시트/미리보기 경로는 `sheets.json`/`candidates.json`에서 읽는다. 유닛 제목과
   대상, 반복되는 잘못(`recurring`)은 아래 「유닛 제목과 대상」대로 쓴다.
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check plan` 실행.
5. **REVIEW GATE**: `check plan`의 exit code로 분기한다.
   - exit 1(무효): 오류 JSON을 보고 `plan.json`을 고쳐 4번부터 재실행.
   - exit 2(pending, `proposed_tags` 사용): 게이트 표(`tableMd`)와 제안 태그를 사용자에게
     보여주고 **명시적 승인**을 받는다. 승인되면 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts
     taxonomy add <tag...>`로 새 태그를 넣고, `plan.json`의 `proposed_tags`에서 넣은 태그
     항목을 지운 뒤 `check plan`을 다시 실행해 exit 0을 받는다(`proposed_tags`는 taxonomy에
     아직 없는 태그만 담는다).
   - exit 0: 게이트 표를 보여주고 사용자 승인을 받는다. 승인 전에는 6단계로 진행하지 않고,
     **승인 후에는 멈추지 말고 11단계 PUBLISH GATE까지 한 실행 안에서 이어서 진행한다.**
6. **notes 작성(에이전트)**: 유닛 하나씩 쓴다.
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts notes next`가 다음 유닛의 브리프(원문 줄, 이 경기
   색 범례, 이미 짚은 사람, 프레임 후보)를 낸다.
   그 프레임을 보고 유닛 노트(v2, 아래 참고)를 파일로 쓴 뒤 `bun
   ${CLAUDE_SKILL_DIR}/scripts/fc.ts notes submit <unit-id> --file <path>`로 기록한다. submit은
   그 유닛을 검사해 통과하면 `notes.json`에 쓰고 다음 브리프를 낸다. 실패하면 오류를 고쳐
   다시 submit한다. "다음은 SOURCE REVIEW"가 나올 때까지 반복한다. 필요한 프레임이 후보에
   없으면 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts add-frame --video <VID> --t <sec>`로 추가한다.
   유닛 구간을 훑을 때는 브리프가 알려 주는 `scan-range` 명령을 쓴다(후보와 한 장짜리 시트).
   **SOURCE REVIEW**: `check notes` 통과 후 `presentation-reviewer` 에이전트를
   디스패치해 원문과 대조한다. 번들·루프는 `references/contracts.md`의 「원문 대조
   리뷰 번들」을 따르고, 리뷰어에게 이 문서의 작성 규칙도 읽게 한다. 규칙대로 쓴 문장을
   리뷰어 취향으로 고치지 않는다 — 규칙과 반대되는 지적은 리뷰어가 그 규칙이 독자에게 주는
   해를 밝힐 때만 결함으로 본다. `APPROVE`/`COMMENT`면 진행하고, 나머지는 고쳐
   재디스패치한다. `COMMENT`에서는 원문·프레임과 어긋난 사실(행위자·방향·위치·인원·결과)만
   고치고, 고쳤으면 새 에이전트로 다시 리뷰받는다. 표현만 바꾸거나 정보를 보태라는 제안은
   반영하지 않는다. 리뷰는 최대 3회다 — 3회째 지적은 사실 수정만 반영하고 다시 리뷰받지 않고
   진행하며, 반영하지 못한 지적은 최종 보고에 적는다.
7. **frames**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts frames`.
8. **similar**: `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts similar`로 후보를 만들고,
   후보 목록 안에서 유닛당 최대 3개를 골라 `similar-choices.json`을 쓴 뒤
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check similar`.
9. **refs**: 아래 「참고자료 찾기」대로 자료를 찾아 `refs-draft.json`에 쓰고
   `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts check refs`로 검증한다.
   **REFS REVIEW**: `check refs` 통과 후 `bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts refs-bundle`로
   `refs-review.md`(자료×유닛마다 원문 줄, `relevance_ko`, `video_starts` 앞뒤 90초 자막)를
   만들고 `presentation-reviewer` 에이전트를 디스패치한다. 번들·점검은
   `references/contracts.md`의 「참고자료 리뷰 번들」을 따른다. `APPROVE`/`COMMENT`면
   진행하고, `REQUEST_CHANGES`면 `refs-draft.json`을 고쳐 `check refs`·`refs-bundle` 후 새
   에이전트를 다시 디스패치한다(SOURCE REVIEW와 같이 최대 3회). 통과하면
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


## 작성 규칙

세부 형식(금지어, 필드 길이, 필수 조합)은 `check plan`/`check notes`/`check refs`가 검사하고,
에러·경고 메시지가 고칠 방법을 말한다 — 메시지대로 고쳐 다시 실행한다. 아래는 스크립트가
판단할 수 없는 것들이다.

### 카드 본문 (notes.json)

- **두괄식.** 첫 `text` 블록은 장면을 한 문장으로 그리고 원문의 교정 행동을 `**볼드**`로
  짚는다. 볼드는 **할 행동**에만 둔다. 볼드는 지시 하나에 한 번만 쓴다 — 볼드만 훑으면 고칠
  행동 목록이 된다. 잘못한 행동·평가·결과는 볼드하지 않는다. 원문에 교정 행동이 없으면 볼드 없이 쓰고,
  무엇을 고칠지는 제목이 말한다. "코치가 ~라고 설명합니다" 같은 화법 보고로 시작하지 않는다.
- **원문에 충실하게.** 유닛 범위 안의 지시·평가·결과를 빠짐없이, 원문 순서대로, 원문의
  어조(바람은 "~하면 좋겠다", 요구는 "~해야 한다")와 유보("~보임", "아직까진")를 살려
  옮긴다. 원문에 없는 행동·인과·방향·결과를 지어내지 않고, 다른 유닛 내용이나 일반 전술
  지식을 가져오지 않는다. 화자·인명·ASR 오류 처리는 `references/contracts.md`의 「원문 근거
  대조」를 따른다.
- **누구 이야기인지 분명하게.** 명단의 실제 이름으로 지적 대상·행위자·패스 수신자를
  구분한다. 이름 없는 팀 총평을 직전에 불린 팀원의 개인 지시로 바꾸지 않는다.
- 본문은 장면과 지적만 쓴다. 작성자 소개, 작업 과정("사진에서 확인되지 않는다"), 사진 설명
  문장은 쓰지 않는다 — 작성자·미식별자는 카드가 따로 표시하고, 사진 읽는 법은 캡션이 말한다.
- 팀 은어·게임 용어(벌리기, 슈퍼 캔슬 등)는 그 뜻을 댓글이나 이번에 확인한 자료에서 그대로
  확인할 수 있을 때만 처음 나올 때 괄호로 푼다. 짐작해야 하면 원문 그대로 둔다.
- **토픽**: 한 경기 안 같은 문제 영역의 유닛을 한 토픽에 묶는다(시간순). 토픽 제목과
  `summary`는 그 토픽 유닛 모두에 공통된 것만 말하고, 카드 첫 문장이나 제목을 되풀이하지
  않는다. 요약에 사람 이름을 쓰면 그 토픽의 고칠 사람을 모두 쓰거나 아무도 쓰지 않는다.

### 프레임과 캡션

프레임은 카드의 장면 사진이고, 캡션은 그 사진을 읽는 법이다.

- **첫 프레임 = 지적한 잘못이 보이는 순간.** 실점·위기의 원인을 짚었으면 댓글 시각
  1–3초 전처럼 원인이 보이는 순간을 고른다 — 실점 뒤 세리머니·킥오프 프레임은 두 번째
  근거로만 쓴다. 프레임은 시간순이므로 그보다 앞선 장면은 프레임으로 쓰지 않는다. 후보에 그 순간이 없으면 `add-frame`으로 뽑고, 범위를 훑어야 하면
  `scan-range`를 쓴다. 이름표를 찾으려고 같은 플레이 밖 프레임을 쓰지 않는다.
- **캡션은 그 프레임에 실제로 보이는 것만** 쓴다. 공 위치와, 그 유닛이 짚은 선수·행동이 화면
  어디 있는지 쓴다. 위치 말은 잘리지 않은 프레임 전체 기준(왼쪽·가운데·오른쪽, 위·아래)이고,
  화면 위치를 짚으면 `focus_x`(대상의 가로 위치 0–1)를 쓴다. 보이지 않는 동작("크로스")이나
  두 프레임 사이 경과를 지어내지 않는다. 형태 지적(라인, 쏠림, "1:1:2")은 그 형태가 보이는
  프레임을 고르고 무리마다 인원과 위치를 쓴다.
- **사람 짚기.** 고칠 사람마다 캡션 하나는 그 사람을 이름과 화면 위치로 짚는다. 이름은
  그 프레임에서 알아볼 수 있는 선수에게만 쓴다:
  - 이름표가 명단의 게이머태그·이름·`aliases`와 같거나 그 일부·로마자 표기면 그 사람이다
    (TOONG ↔ toongri). 이렇게 정한 대응은 REVIEW GATE 표 아래 적어 확인받고 `aliases`에 더한다.
    이름표 앞뒤에는 클럽명·시그니처가 붙기도 한다(CEF_Rume, Gerrard_CEF, RFA_…) — 떼고
    맞춘다. 한글 이름을 한글 자판으로 친 영문 이름표(dnjswo = 원재)는 그 이름으로 읽는다.
    명단과 맞지 않는 이름표는 짐작으로 사람을 정하지 않고 notes `unmatched_name_tags`에 적으며
    (카드 범례에 보인다), 최종 보고에서 누구인지 묻는다. 한글로 읽히는 이름표는 본문·캡션에서
    그 이름으로 부른다("원재(CEF_dnjswo313 이름표)").
  - 업로더 채널이 명단의 그 사람이면 조작 선수 표시(머리 위 별 등, 보이는 모양을 말로)가
    그 사람이다. 비슷하기만 하면 REVIEW GATE에서 묻는다.
  - 사람이 조작하는 선수는 머리 위에 경기 내내 같은 색 삼각형이 있다. 한 경기에서 이름표와
    색 삼각형이 함께 보이는 프레임을 찾으면 notes `marker_colors`에 적고, 이름표 없는
    프레임에서도 그 색으로 짚는다("뎁스차저(분홍 삼각형, 화면 가운데 위)" — 카드의 경기 머리에
    색 범례가 자동으로 붙는다). 비슷한 색이 한 프레임에 둘 이상이면 위치를 함께 써서 구별한다
    ("분홍 삼각형 둘 중 아래쪽"). 흰 삼각형은 쓰지 않는다. 색 기록이 있는데도 그 유닛에서 그
    사람을 짚지 못했으면 이유를 notes 유닛의 `marker_unresolved_ko`에 적는다 — 카드에는 보이지
    않으므로 캡션에는 쓰지 않는다.
  - 범위를 `scan-range`로 훑어도 알아볼 수 없을 때만 `unidentified_member_ids`에 넣고,
    그 잘못의 대상(놓친 상대, 빈 공간)이 보이는 프레임과 `look_at`(사진에서 대신 볼 곳)을 쓴다.
  - 패스·시선을 짚은 유닛(제목에 "<이름>에게", "<이름> 쪽")은 공 가진 선수와 받을 선수의
    위치를 둘 다 쓴다.
- **팀과 방향.** 캡션은 "우리 수비수"·"상대 공격수"로 부르고, 유니폼 색은 경기 첫 캡션에
  한 번 밝힌다. 원문의 좌/우는 우리가 공격하는 방향 기준이다 — 하프마다 우리 골문 위치로
  "이 하프에서 우리 좌측은 화면 위쪽"을 정한다. 앞뒤 프레임 어디에서도 원문의 방향이
  보이지 않으면, 본문은 원문 표현을 그대로 두고 판정하지 않으며 캡션은 사진에 보이는 것만 쓴다.
  어긋남은 notes 유닛의 `direction_check_ko`에 한 문장으로 적는다("댓글은 좌측, 사진에서 몰린
  쪽은 화면 위쪽(이 하프의 우리 우측)") — 카드에 "방향 확인 필요" 줄로 보인다. 최종 보고와
  PUBLISH GATE 질문에도 적는다.

### 댓글 피드백 줄

`source: "comment"` 줄의 화자는 그 댓글 작성자(`author`)다 — 명단과 대조해 정한다(카드에
"댓글 작성 <이름>"이 자동으로 붙는다). 작성자가 자기 이름을 3인칭으로 쓴 자기 비판도 그
팀원에게 하는 피드백으로 옮긴다. 댓글은 짧으므로 장면은 그 시각 전후 프레임에서 **실제로
보이는 것**으로만 보탠다.

### 유닛 제목과 대상 (plan.json)

- **제목 = 카드 첫 줄.** 조각마다 `행위자: ~기`(할 일) 또는 `행위자: ~ㅁ`(지적)이다.
  - 원문에 교정 행동이 있으면 그 행동("뎁스차저: 공을 잡으면 바로 앞으로 패스하기"). 잘못과
    대비해 바른 행동을 말했으면 그것이 교정 행동이다.
  - 교정 행동이 없고 잘못이 행동이면 그 행동을 부정한 꼴("무리하게 가로채지 않기",
    "코너 수비 때 상대 마크 비우지 않기").
  - 잘못이 상태·결과("정신 놓음", "간격이 벌어짐")면 부정해도 할 수 있는 행동이 아니므로
    -ㅁ 지적으로 쓰고, notes `fault_scene`에 그 잘못이 프레임에서 어떻게 보였는지(무엇이
    누구 대비 어디로 벗어났는지, 대형이면 무리마다 인원·위치)를 쓴다.
  - 원문의 유보는 제목 끝 괄호로도 남긴다("(아직까진 나아 보임)"). 평가어·가정문으로 쓰지
    않고, 원문에 없는 교정 행동을 지어내지 않는다.
- **행위자.** 원문이 부른 사람. 생략됐으면 그 행동을 장면에서 한 사람만 할 수 있을 때만
  그 사람을 쓰고(예: "~했을 때" 뒤 리턴 패스는 그 시점 공 가진 사람), `inferred_member_ids`에도
  넣는다 — 카드가 "(추정 — 문장에 주어 없음)"을 붙인다. 아니면 단위("수비 라인"), 포지션
  ("수비진"), 전원("전원")을 쓴다. `member_ids`의 사람마다 자기 조각이 제목에 있어야 한다
  ("A: ~기 / B: ~ㅁ", 같으면 "A·B: ~기").
- **`member_ids` = 행동을 바꾸라는 사람.** 칭찬받았거나, 장면의 계기로만 불렸거나, 등장만
  한 선수는 넣지 않는다(이름이 나온 팀원은 스크립트가 `named_member_ids`로 따로 잡는다).
  "센터백들", "풀백 둘"처럼 복수 역할을 부르면 그 경기에서 그 역할로 뛴 팀원을 모두 넣는다.
- **`position_tags` / `group_positions` / `addressed_to_all`.** 그 피드백이 다루는 포지션(코치가 지목한
  포지션, 불린 팀원이 그 장면에서 뛴 포지션 — 확인 안 되면 명단의 주포지션)은 `position_tags`다.
  해당하면 `member_ids`·`position_tags`·`addressed_to_all` 셋을 함께 넣는다. 제목 행위자가 단위·포지션이면 그 포지션을 `group_positions`에도 넣어 그
  포지션으로 뛴 팀원에게 "내 포지션 대상"으로 보이게 한다. 포지션과 무관하게 누구에게나 통하는
  말과, 사람을 부르지 않은 세트피스 마크 잘못은 `addressed_to_all: true`(행위자 "전원"). "키 작은
  선수"처럼 포지션과 무관한 조건 집단도 `addressed_to_all`이지만 제목은 원문 조건대로 쓴다.
- **`recurring`**: 같은 잘못이 둘 이상의 유닛에서 나오면 묶는다. `label`은 원문에 가까운
  잘못된 행동, `lines`는 유닛마다 그 잘못을 직접 말한 줄. 표현이 달라도 같은 사람에게 같은
  교정을 요구하면 같은 잘못이다. "빌드업"처럼 주제 수준으로 넓게 묶지 않는다. `member_ids`는
  그 반복 행동의 주인(이름 불린 사람)만, 단위의 잘못이면 `[]`.

### 유닛 분할

**댓글 줄** 하나가 유닛 하나다 — 작성자가 나눈 단위를 그대로 쓰고, 평가만 있는 줄도
버리지 않는다. **음성 줄**은 지시나 교정 행동이 분명한 평가가 있는 한 장면이 유닛이다.
대상 전환이나 15초 이상 무음은 경계 후보일 뿐이고, 20초 이상 떨어진 두 장면은 합치지 않는다.
HUD 시트의 경기 시계가 리셋되면 새 경기다. 피드백 없는 경기는 `matches[]`에서 빼고
`matches_without_feedback`에 제목을 넣는다(서수는 영상 안 순서 — 빠진 경기도 센다). 경기마다
`lineup`에 그 경기에서 뛴 것이 확인된 팀원과 그 경기 포지션을 적는다(명단의 주포지션을
그대로 옮기지 않는다).

## 참고자료 찾기

참고자료는 **그 유닛 장면의 구체 문제를 직접 다루는 자료**다. 일반 공략 모음을 여러 유닛에
뿌리지 않는다. 모든 유닛에 자료가 있을 필요는 없다.

1. **순서**: 반복 지적(유닛 많은 순) → 실점·위기 유닛 → 나머지. 반복 지적 자료는 그 항목
   유닛 전부에 붙이고, 그 문제를 실제로 다루는 자료에만 `recurring_labels`를 적는다.
2. **검색**: 장면의 행동·상황을 한국어와 영어로 검색한다. EA FC·프로클럽 자료(최신 버전,
   한 사람이 한 포지션), 한국어 포지션 강의("프로클럽 센터백 강의"), 실제 축구 코칭 자료를
   모두 찾는다. 조작 기능이 걸린 label은 기능 설명("how to <기능> fc 26")과 증상 검색어를
   함께 쓴다. 맞는 영상을 낸 채널은 같은 주제의 다른 영상도 찾는다. 유튜브는
   `uvx yt-dlp "ytsearch10:<검색어>" --flat-playlist --print "%(id)s %(title)s"`.
3. **영상은 자막으로 확인한다.** `uvx yt-dlp --skip-download --write-auto-subs --sub-langs
   <en|ko> --sub-format vtt -o "<작업 폴더>/refsubs/%(id)s" <url>`로 받아, 증상 단어로 구간을
   찾고 `video_starts`를 그 구간 시작으로 정한다. 앞뒤 90초 자막을 읽어 그 구간이 **결국
   권하는 행동**이 원문 지적과 같은 방향인지, 상황(오픈 플레이·세트피스·역할)이 같은지
   확인한다 — 반대거나 상황이 다르면 붙이지 않는다. 원문이 스스로 잠정이라 밝힌 조언이면
   조건별로 어느 쪽을 택하는지 설명하는 구간을 붙이고 그 조건을 `relevance_ko`에 쓴다.
   `refs-bundle`이 받아 둔 자막 전체에서 유닛별 적중 줄을 보여 주니 붙이기 전에 읽는다.
4. **버전**: 자료의 버전은 제목·설명·화면에 적힌 것만 쓰고(없으면 올린 연월), 경기 버전은
   경기 영상 제목에 적힌 것만 쓴다. 오래된 조작 팁은 판단 문제 유닛에 붙이지 않고, 오래된
   주장을 옮길 때는 기준 시점("2023년 영상 기준")을 쓴다. 싱글 플레이 전제 자료는 프로클럽에서
   그대로 못 쓰는 부분을 `summary_ko`에 밝힌다.
5. **`relevance_ko`**: 유닛마다 "이 자료의 무엇이 그 장면의 무엇을 다루는지" 한 문장. 자료
   쪽 말은 그 구간 자막에 실제로 나와야 하고, 유닛이 짚은 것과 같은 행동을 말해야 한다.
   구체적으로 쓸 수 없으면 붙이지 않는다. -ㅁ 지적 유닛에는 자료 하나 이상의 `lesson_ko`에
   그 자료가 권하는 행동을 쓴다.
6. **못 찾으면** `recurring_unfound`/`units_unfound`에 써 본 검색어와 자막 핵심어를 남긴다.
   세션 전체에 영상이 하나도 없으면 사용자에게 알린다.
