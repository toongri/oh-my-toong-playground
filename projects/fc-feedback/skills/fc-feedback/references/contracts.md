# fc-feedback 파일 계약

`fc.ts`의 각 `check <name>` 명령이 강제하는 스키마다. 실패하면 exit 1(plan은 2도 있음)로
멈추고 stderr에 JSON 오류 배열을 낸다 — 이 문서가 아니라 **`core.ts`의 검증기가 최종
근거**다. 공통 패턴: `VID` = `^[A-Za-z0-9_-]{11}$`(유튜브 영상 id), `SID` =
`^\d{8}-[A-Za-z0-9_-]{11}$`(업로드일-첫 영상 id), `UID` = `<SID>#u\d{3}`, member id =
`^[a-z0-9][a-z0-9-]*$`, 태그 = 1–20자·`|` 없음·앞뒤 공백 없음, URL은 http(s)만.

## LLM이 쓰는 파일 (스크립트가 검증)

### plan.json → `check plan`

```json
{
  "session_title": "string",
  "matches": [{
    "title": "string(≤80자)",
    "lineup": { "gerrard": "CM" },
    "topics": [{
      "title": "string(≤80자)", "summary": "string",
      "units": [{
        "start_line": 0, "end_line": 0, "title": "string(≤80자)",
        "position_tags": ["CM"], "topic_tags": ["빌드업"],
        "member_ids": ["gerrard"], "inferred_member_ids": [],
        "key_frame_candidate_ids": ["c001"],
        "addressed_to_all": false, "group_positions": []
      }]
    }]
  }],
  "recurring": [{ "label": "수비 라인이 맞지 않음", "lines": [3, 10], "member_ids": [] }],
  "matches_without_feedback": ["2경기 · LVT 대 AL"],
  "proposed_tags": [{ "tag": "string", "reason": "string" }]
}
```

- `session_title`/각 `title`: 비어 있지 않음, `title`은 80자 이하.
- unit `title`: " / "로 나눈 조각마다 `행위자: …` 꼴이고, 조각 끝의 괄호 하나("(아직까진)")를
  뗀 뒤 "기"(할 일) 또는 받침 ㅁ 음절(-ㅁ 지적)로 끝난다("뎁스차저: 더 벌리기 / 동그리:
  무리하게 가로채지 않기", "뎁스차저: 첫판부터 정신 놓음"). 아니면 에러.
- unit마다 `member_ids`·`position_tags`·`addressed_to_all: true` 중 하나는 있어야 한다
  (대상 없는 유닛은 아무의 "내 피드백"에도 안 나오므로 에러).
- `inferred_member_ids`(선택 배열, 생략하면 `[]`): 원문에 주어가 없어 맥락으로 고칠 사람을 추정한 팀원. `member_ids`의 부분집합이어야 한다(아니면 에러 `u030.inferred_member_ids[0]: …`). 카드는 "고칠 사람" 줄의 그 사람 이름 옆에 "(추정 — 문장에 주어 없음)"을 보인다("사진에서 위치를 확인하지 못한 사람" 줄에는 되풀이하지 않는다). `recurring[].member_ids`의 사람이 연결 유닛의 `inferred_member_ids`에도 있으면 `check plan`이 비차단 경고 `반복 지적 <label>: <이름>는 <유닛>에서 추정한 행위자다`를 stderr에 낸다. 필드가 없는 옛 `plan.validated.json`은 `[]`로 읽는다.
- `matches` ≥1, `topics` ≥1, `units` ≥1.
- `start_line`/`end_line`: 0 이상 정수, `end_line < lines.length`, `start_line ≤ end_line`,
  같은 unit 안에서 같은 video. 한 topic 안의 unit은 `start_line` 오름차순이고, topic은 시간상 떨어진
  같은 경기의 unit을 묶을 수 있다(topic이 연속 구간일 필요 없음). 같은 video의 unit은 어느 topic에
  있든 서로 겹치지 않는다(video별로 모든 unit을 시작 줄 순으로 늘어놓고 확인). topic은 경기
  (`matches[]`) 안에만 있으므로 한 topic의 unit은 항상 한 경기에 속한다.
- `position_tags`: 포지션 트리에 있는 값만. 트리는 좌우를 가리지 않는다(피드백을 왼쪽·오른쪽으로 나누지
  않는다): 뿌리 GK(자식 없음) · DF(CB, FB, WB) · MF(CDM, CM, CAM, SM) · FW(WF, ST). 옛 좌우 코드(LB·RB→FB,
  LWB·RWB→WB, LM·RM→SM, LW·RW·LF·RF→WF, CF→ST)는 새로 쓰는 `position_tags`·`group_positions`·`lineup`·노트에서
  에러이고 메시지가 바꿀 코드를 말한다(`RB는 더 이상 쓰지 않는 포지션 코드다 — FB로 쓴다(좌우를 가리지 않는다)`).
  이미 만들어진 파일(`roster.yaml`, 발행된 `data.json`, 아카이브 `index.json`, 옛 `plan.validated.json`)은 고칠 수
  없으므로 읽을 때만 이름 있는 변환 함수 `positionFromLegacyCode`로 새 코드로 옮긴다(새 코드는 그대로,
  변환 뒤 중복은 합친다 — `[LW, RW, CM]`은 `[WF, CM]`). 그 피드백이
  다루는 포지션(코치가 지목한 포지션, 불린 팀원이 그 장면에서 뛴 포지션 — 확인 안
  되면 명단의 주포지션)을 담는다(member_ids·addressed_to_all과 함께 쓸 수 있음).
- `topic_tags` ≥1개, 각 태그는 taxonomy에 있거나 `proposed_tags`(유효하고 taxonomy에 아직
  없는 것)에 있어야 함 — proposed 태그를 하나라도 쓰면 `pending`.
- `member_ids`: 그 피드백이 행동을 바꾸라고 하는 사람(지적·지시를 받은 사람)만 담는다.
  roster가 있으면 그 id만 허용, **roster가 없는(disabled) 모드에서는 반드시 빈 배열**이어야
  함(비어 있지 않으면 에러). 원문에 이름만 나온 팀원은 스크립트가 줄 텍스트를 명단의
  이름·별칭·게이머태그와 대조해 검증된 plan의 `named_member_ids`로 따로 채운다 — LLM은
  쓰지 않는다.
- `addressed_to_all`: 생략 가능(옛 plan.json 호환 — 생략하면 `false`), 있으면 boolean만
  허용. 포지션과 무관하게 모두에게 통하는 말을 한 유닛에 `true`를 쓴다 — 이름이 없다는
  이유만으로 올리지 않으며, 행동을 바꿀 사람(`member_ids`)·다루는 포지션(`position_tags`)과 함께
  쓸 수 있다. roster가 없는(disabled) 모드에서도 허용(member_ids와 달리 roster 유무와 무관). `true`인 유닛의 `group_positions`는 비어야 한다(비어 있지 않으면 에러). 뷰어는 이 유닛을 그 경기 `lineup`에 있는 팀원에게만 "전원 대상"으로 보이고, `lineup`을 모르는 경기(`null`/없음)는 명단 전원에게 보인다.
- `matches[].lineup`: 그 경기에 뛴 팀원 id → 그 경기에서 뛴 포지션(포지션 트리 값 하나).
  이름표·원문·캡션으로 그 경기에 뛴 것을 확인한 팀원만 적는다 — 확인 못 한 팀원은 빼고,
  아무도 확인 못 했으면 `{}`. roster가 있으면 필수(객체), 명단에 없는 id·트리에 없는 값은
  에러. 그 경기 유닛의 `member_ids`는 모두 lineup에 있어야 한다(없으면 그 `member_ids`
  경로 에러). roster가 없으면 생략하거나 `{}`. "내 포지션 대상"과 "같은 포지션 참고"는 명단의
  주포지션이 아니라 이 값으로 정한다 — lineup에 없는 팀원은 그 경기 카드의 포지션
  대상·같은 포지션 참고에 들지 않는다. 전원 대상(`addressed_to_all`) 카드는 lineup 팀원과,
  포지션을 몰라 lineup에 없더라도 그 경기 유닛 원문에 이름이 나온 팀원(`named_member_ids`)에게 닿는다.
- unit `group_positions`: 필수 배열. 제목이 이름 없는 단위("수비 라인", "수비진")나 포지션을
  행위자로 부르면 그 단위의 포지션(`["DF"]`), 아니면 `[]`. 값마다 그 유닛의
  `position_tags`에 있어야 함. `member_ids`와 함께 쓸 수 있다("수비진: … / 동그리: …") — 그
  경기 lineup에서 이 포지션(또는 그 자손)으로 뛴 팀원의 "내 피드백"에 "내 포지션 대상"으로
  나온다.
- `key_frame_candidate_ids`: `candidates.json`에 실제 있는 id, 같은 video,
  `t ∈ [unit.start-5, unit.end+5]`.
- `proposed_tags[].tag`: 유효한 태그이고 taxonomy에 아직 없어야 함.
- `recurring`: 필수 배열(반복되는 잘못이 없으면 `[]`). 항목마다 `label`은 비어 있지 않은
  한 줄·40자 이하·plan 안에서 유일, `lines`는 2개 이상의 줄 인덱스 — 각 줄은 정확히 한
  unit의 `start_line..end_line` 안에 있고, 한 항목의 줄들은 서로 다른 unit에 있어야 함.
  `member_ids`(필수 배열)는 label이 말하는 반복 행동의 주인("동그리가 더 올라가지 않음" →
  동그리; 같은 잘못을 여러 사람이 각각 했으면 그 사람들 모두) — 각 id는 묶인 unit 중 하나
  이상의 `member_ids`에 있어야 한다. 특정인이 아니라 단위·포지션("수비 라인이 맞지 않음")이면
  `[]`, roster가 없으면 반드시 `[]`. 뷰어의 "내가 고칠 것"은 그 팀원이 고칠 사람인 카드 수이며,
  주인이 있으면 주인에게만 센다. **주인 누락 검사**: 항목의 각 줄이 속한 unit의 제목 조각 행위자("A·B"는
  이름별)가 **전부** 명단 팀원(이름·별칭·게이머태그)이고, 그 unit의 `member_ids`가 비어 있지 않은데, 항목의
  `member_ids`에 그 unit의 고칠 사람이 하나도 없으면 에러(`recurring '상대 마크를 놓침': u009의 고칠 사람 뎁스차저가
  member_ids에 없다` — 항목 `member_ids`가 `[]`여도 에러). 제목에 팀원이 아닌 행위자("수비진", "수비 라인", "전원")가
  있거나 unit의 `member_ids`가 비어 있으면 면제다.
  **함께 묶인 행위자 검사**: 항목의 한 줄이 속한 unit의 제목 조각 행위자("A·B")에 명단 팀원이 둘 이상이고
  그중 하나가 항목 `member_ids`에 있으면, 그 조각의 명단 팀원 전부가 `member_ids`에 있어야 한다(에러: 함께 묶인
  행위자가 member_ids에 없다). 같은 잘못을 한 줄이 함께 한 사람들에게 돌렸는데 한 사람만 주인으로 적는 누락을 막는다.
  검증된 plan에는 `recurring: [{label, unit_ids, member_ids}]`로 남는다.
- `matches_without_feedback`: 필수 배열. 영상에는 있지만 피드백 유닛이 없는 경기의 제목 문자열(예
  "2경기 · LVT 대 AL"), 항목마다 비어 있지 않고 80자 이하. 그런 경기가 없으면 `[]`(필드를 빼면
  `"matches_without_feedback": []`를 추가하라는 에러). `matches`에는 넣지 않는다 — 유닛이 없는 match는
  `topics ≥1`·`units ≥1` 규칙에 걸린다. 뷰어가 카드 목록 뒤에 "2경기 · LVT 대 AL — 피드백 없음" 줄로
  보여 페이지가 경기를 건너뛴 것처럼 읽히지 않게 한다. 제목이 "N경기"로 시작하면(서수는 영상 안 순서, 빠진 경기도 센다) 뷰어가 그 서수로 영상 순서 자리 — 서수가 더 큰 피드백 있는 경기의 구분선 바로 앞과 경기별 목차의 같은 자리 — 에 줄을 세우고, 가장 큰 서수보다 크거나 "N경기"로 시작하지 않는 제목은 카드 목록 뒤(목차는 맨 끝)에 둔다. 검증된 plan에 같은 이름·같은 값으로 남고, 이
  필드가 생기기 전의 `plan.validated.json`은 `[]`로 읽는다.

**exit 0**: 유효 + `proposed_tags` 미사용 → `plan.validated.json` 생성(`m1`, `m1-t1`,
`u001`… id를 시간 순서(시작 줄이 빠른 unit이 `u001`, 어느 topic에 있든)로 부여하고, `units`·topic의 `unit_ids`·`recurring[].unit_ids`도 그 순서로 두며 `start`/`end`(초)·`video`와 `line_range: {start_line, end_line}`(plan의 줄 범위를 그대로; 이 필드가 생기기 전의 `plan.validated.json`은 이름 있는 변환 함수 `lineRangeFromLegacyValidated`가 `null`로 읽고, 그때만 시간 범위로 줄을 고른다)를 채움) + 게이트 표
(`tableMd`, 경기/시간/제목/포지션/주제/팀원) + `proposed` 배열을 stdout에 JSON으로 출력.
스키마가 유효하면 stderr에 비차단 경고 한 줄(종료 코드는 그대로)을 낼 수 있다: 같은 행위자("A·B"는 이름별)의 두 unit 제목 행동이 내용어(조사 한 개를 뗀 한글 단어; 1음절·일반어("패스하기" 포함)·조건절 낱말(-면·-때 꼴: "잡으면", "받으면", "할때", "했을")·명단 팀원의 이름·별칭·게이머태그가 든 낱말은 제외)를 공유하는데 한 `recurring` 항목에 함께 있지 않으면 `fc-feedback: 경고 반복 지적 후보 u025·u027 "뎁스차저" 공통어 "반대편", "보기" — 같은 잘못이면 recurring에 묶는다`. 공통어는 한 줄에 정렬해 모두 나열한다. "측면"·"화면"처럼 -면으로 끝나는 명사는 조건절이 아니다(-면은 세 음절부터, 또는 하/되/보/오/가/서/나 뒤에서만 조건절로 본다).
같은 방식의 비차단 경고가 둘 더 있다(종료 코드·쓰는 파일은 그대로, 판단은 작성자 몫이고 경고는 놓친 사실만 보인다).
- **유닛 끝 직후 미배정 줄**: 어느 유닛에도 시간 범위로 들어가지 않는 줄(같은 영상의 유닛 `start <= 줄 start`이고 `줄 end <= end`인 유닛이 없음)이 한 유닛의 끝에서 5초(`TRAILING_LINE_WINDOW_SECONDS`) 안에 시작하면 유닛마다 한 줄 `fc-feedback: 경고 u011 끝 직후 어느 유닛에도 없는 줄: 157(18:57) "새로 패널티" — 그 장면의 결과나 지시면 유닛 범위에 넣는다`. 해설 음성은 유닛 사이에 군말 줄이 있어 끝에 아주 가까운 줄만 본다. 장면의 결과(실점·패널티)가 카드에서 빠지는 일을 막는다.
**exit 2**: 스키마는 유효하지만 `proposed_tags`를 실제로 쓴 unit이 있음(pending) —
`plan.validated.json`을 쓰지 않음, REVIEW GATE 통과 전 진행 금지. **exit 1**: 스키마 위반,
stderr에 오류 JSON.

### notes.json (v2) → `check notes`

`plan.validated.json` 필요. `problem`/`who`/`instead`/`key_frames`가 있는 v1 형식과
`version: 1`은 명시적으로 거부된다.

```json
{
  "version": 2,
  "units": {
    "u001": { "blocks": [
      { "type": "text", "text": "1–800자, 개행 금지, **볼드**만 허용" },
      { "type": "frame", "candidate_id": "c003", "caption": "1–120자" }
    ], "unidentified_member_ids": ["gamemaker"], "look_at": "화면 위쪽 마크 없는 RONALDO",
      "fault_scene": "1–120자, 개행 금지 — 제목에 -ㅁ 조각이 있을 때만",
      "direction_check_ko": "선택, 1–100자 한 줄 — 원문 좌/우와 프레임이 어긋날 때만",
      "marker_unresolved_ko": { "gamemaker": "선택, 1–80자 한 줄 — 색 삼각형으로 짚지 못한 이유(카드에 보이지 않음)" } }
  },
  "marker_colors": [
    { "match": 1, "member_id": "gerrard", "color": "노랑", "evidence_candidate_id": "c003" }
  ],
  "unmatched_name_tags": [
    { "match": 1, "tag": "SAMBA", "color": "자홍", "evidence_candidate_id": "c003" }
  ]
}
```

- `units`의 키 집합은 검증된 plan의 unit id 집합과 **정확히 일치**(부족·초과 모두 에러).
- `blocks`: 1–20개, `type:"text"` 블록 ≥1개, `type:"frame"` 블록 ≥1개(카드의 장면 사진 — 없으면 에러).
- `text` 블록: trim 후 1–800자, 개행 문자(`\r`/`\n`) 금지(블록 = 문단 하나),
  `**...**`는 짝이 맞아야 하고 안쪽이 비어있지 않아야 함(중첩은 구조상 불가능).
  유닛을 한 문단으로 제한하지 않는다. 첫 문단 뒤에 원문의 이유·선택지·결과를 설명할
  필요가 있으면 `text` 블록을 더 둔다. 원문에 없는 설명으로 문단을 늘리지 않는다.
  첫 `text` 블록에 `**`가 없는데 뒤 `text` 블록에만 있으면 에러(`u030: 볼드(할 행동)가 첫 문단에 없고
  뒤 문단에만 있다 — 행위자와 교정 행동을 첫 문단에 쓴다`). 어느 문단에도 볼드가 없으면 이 에러는 없다
  (볼드 없음은 `check notes`의 경고).
- `frame` 블록: unit당 최대 6개, `candidate_id`가 `candidates.json`에 실재하고 unit과 같은
  video, `t ∈ [unit.start-5, unit.end+5]`, unit 안에서 `candidate_id` 중복 금지,
  블록 등장 순서대로 `t`가 비감소(내림차순 금지). 첫 블록은 `text`여야 한다 — 사진이 먼저면 `blocks[0]` 에러(`u001: 첫 블록은 본문(text)이어야 한다 — …`). `caption`은 trim 후 1–120자, 개행 금지·필수,
  `34:11`처럼 시계·스코어로 시작하면 에러(경기 시간은 "경기 34분"으로 쓴다).
- 고칠 사람(검증된 unit의 `member_ids`)마다 어느 frame 캡션이 그 이름(명단 이름·별칭·
  게이머태그)을 짚어야 한다. 유닛 시간 범위 안 어느 프레임에서도 이름표로 식별할 수 없는
  사람만 `unidentified_member_ids`(생략 가능, 기본 `[]`)에 넣는다 — `member_ids`에 없는
  id나 캡션이 이미 짚은 사람을 넣으면 에러("X는 이 프레임에서 알아볼 수 없다"처럼 보이지 않는다고만 말하는 절은 짚은 것으로 세지 않는다). **범위 훑기 기록**: `unidentified_member_ids`가 비어 있지 않은 유닛은
  같은 video의 `kind: "range"` 후보(`scan-range`가 만든다)가 유닛 범위 전체를 덮어야 한다 — 유닛 시작에서 첫 후보,
  후보 사이, 마지막 후보에서 유닛 끝까지 어느 간격도 브리프의 `scan-range` step(2초, 유닛이 길면 36장에 들도록 넓힘)을
  넘지 않아야 한다. range 후보 한 장이나 범위 일부만 훑은 기록(이웃 유닛을 훑다 남은 프레임 포함)은 세지 않는다 — 아니면 에러
  (`u007: 고칠 사람을 사진에서 못 찾았다고 했지만 이 유닛 범위 전체를 scan-range로 훑은 기록이 없다`). 후보 몇 장만 보고
  "안 보인다"고 하지 않게 하는 검사다.
- 받는 사람: 제목 조각에 명단 멤버의 이름·별칭·게이머태그가 바로 "에게"나 " 쪽"과 붙어 나오면
  ("게임메이커: 우사에게 짧게 패스하기", "우사 쪽으로 열어주기") 그 유닛의 frame 캡션 중 하나가 그 멤버를 짚어야 한다(고칠 사람
  캡션 규칙과 같은 이름 매칭). 없으면 에러(`u022: 제목의 받는 사람 우사가 어느 캡션에도 없다 — 받는 사람
  위치를 캡션에 쓰거나, 프레임에 안 보이면 '우사는 이 프레임에 보이지 않는다'처럼 밝힌다`). `unidentified_member_ids`는
  이 검사를 면제하지 않는다. 받는 사람을 짚은 캡션이 모두 "보이지 않는다"(또는 "확인되지 않는다", "알아볼 수 없다")로 밝히는 것뿐이면 그 유닛에도
  위 `kind: "range"` 후보가 있어야 한다(에러, 같은 뜻의 메시지) — 범위를 훑고도 안 보일 때만 그렇게 쓴다.
- frame 캡션은 그 유닛의 `fault_scene`과 같을 수 없다(trim 후 같으면 에러: `u031: 캡션이 fault_scene과 같다 — 캡션은 그
  프레임에서 더 보이는 것을 쓴다`). 캡션은 그 사진에서 더 보이는 것을 쓴다.
- `fault_scene`(문자열, trim 후 1–120자, 개행 금지): 그 잘못이 유닛 프레임에서 어떻게 보였는지(누가 어디에
  섰는지, 대형이 어떻게 갈렸는지 — "뎁스차저가 페널티 아크 근처에서 상대 둘 사이에 서 있고 수비 라인 뒤에
  공간이 비어 있다"). 검증된 plan의 unit 제목에 -ㅁ(지적) 조각이 하나라도 있으면 **필수**(`check plan`의
  제목 조각 판정과 같은 규칙), 없으면 쓸 수 없다(에러). 단 그 유닛이 `direction_check_ko`를 가지면(원문 방향과 프레임이 어긋나 원문이 말한 장면을 프레임이 보여 주지 못한다) `fault_scene`을 쓸 수 없고(에러 `유닛 u026: direction_check_ko가 있으면 fault_scene을 쓸 수 없습니다 — …`) -ㅁ 제목이어도 필수가 아니다. 카드에는 제목 아래(자료 교훈 줄이 있으면 그 다음) "장면 · …"으로 보인다. 제목 조각이 모두 -ㅁ인 유닛에 어느 붙은 자료도 그 유닛의 `lesson_ko`를 주지 않으면 카드는 제목 아래에 "피드백에 고칠 행동은 적혀 있지 않다 — 장면 줄 참고"를 보인다(데이터에서 정해지는 표시, 새 필드 없음; 장면 줄이 없는 `direction_check_ko` 카드는 "— 장면 줄 참고" 없이 앞 문장만).
- `look_at`(문자열, trim 후 1–60자, 개행 금지, ":"와 " / " 금지 — 볼 곳은 한 문장): 고칠 사람을 알아볼 수 없을 때 사진 어디를 보면
  되는지("화면 위쪽 마크 없는 RONALDO"). `unidentified_member_ids`가 비어 있지 않거나, 제목의 받는 사람을 짚은 캡션이
  모두 "보이지 않는다"(또는 "확인되지 않는다", "알아볼 수 없다")로 밝히면(받는 사람이 사진에 없음) **필수**, 둘 다 아닌데 있으면 에러(원인별로 다른 메시지).
- `marker_colors`(선택 배열 — 사진의 선수 마커 색이 누구인지 근거를 남기는 기록. 항목 자체는 카드에 렌더하지 않지만 카드는 이 값으로 경기별 색 범례를 보인다: 경기 구분선(첫 경기는 첫 카드 제목 아래)에 "머리 위 표시: 뎁스차저 분홍 삼각형 · 동그리 민트 삼각형". 항목이 없는 경기에는 범례가 없고, `data.json`의 `matches[].marker_legend`(`[{member_id, color}]`)로 실리며 필드가 없는 옛 data.json은 `[]`로 읽는다. 같은 범례에 아래 `unmatched_name_tags`도 "SAMBA 이름표(명단에 없음) 자홍 삼각형"(색이 없으면 "SAMBA 이름표(명단에 없음)")으로 이어진다): 항목은 `{match, member_id, color, evidence_candidate_id}`. `match`는 1 이상 경기 수 이하 정수(plan `matches` 순서로 1부터 센 번호 — 영상 속 "3경기" 같은 경기 이름의 숫자가 아니다), `member_id`는 roster 팀원(lineup 소속까지는 보지 않는다), `color`는 한글 1–10자 색 이름("노랑"), `evidence_candidate_id`는 `candidates.json`에 있는 후보이며 그 시각이 그 경기 유닛들의 범위(같은 영상, ±5초) 안이어야 한다. 한 경기 안에서 같은 색이나 같은 팀원을 두 번 쓸 수 없다. roster가 없는 모드에서 비어 있지 않으면 에러.
- `unmatched_name_tags`(선택 배열 — 명단 어느 팀원의 이름·별칭·게이머태그도 아닌 이름표를 단 선수를 사진에서 봤을 때 그 이름표와 마커 색을 남기는 기록. 이름표가 누구인지는 사용자만 확정할 수 있으므로 팀원 id로 추정해 `marker_colors`에 넣지 않는다. `data.json`의 `matches[].unmatched_name_tags`(`[{tag, color?}]`, `member_id`와 섞지 않는 별도 키)로 실리며 필드가 없는 옛 data.json은 이름 있는 변환 함수 `unmatchedNameTagsFromLegacyData`가 `[]`로 읽는다): 항목은 `{match, tag, color?, evidence_candidate_id}`. `match`는 `marker_colors`와 같은 경기 번호, `tag`는 화면에 보이는 이름표 그대로 1–30자 한 줄, `color`(선택)는 그 이름표와 함께 본 한글 1–10자 색 이름이며 같은 경기 `marker_colors`의 색과 겹칠 수 없다, `evidence_candidate_id`는 이름표와 색이 함께 보이는 후보로 `marker_colors`와 같은 경기·영상·시간 범위 조건을 따른다. 한 경기에서 같은 `tag`(대소문자 무시)를 두 번 쓸 수 없다. `tag`가 명단 팀원의 이름·별칭·게이머태그와 같으면(`mentionsMember`) 에러다 — 그 사람은 `marker_colors`로 적는다. roster가 없는 모드에서 비어 있지 않으면 에러.
- `text` 블록과 `frame` 캡션에는 "원문"이라는 말을 쓸 수 없다(작업 과정의 말 — 에러).
- `direction_check_ko`(선택 문자열, trim 후 1–100자, 개행 금지): 소스(댓글·해설)의 좌/우가 프레임에서 보이는 방향과 어긋날 때 그 사실을 한 문장으로 쓴다("댓글은 좌측, 사진에서 몰린 쪽은 화면 위쪽(이 하프의 우리 우측)"). 판정은 하지 않고 어긋남만 밝힌다. `fault_scene`과 함께 쓸 수 없다. 카드에는 "방향 확인 필요 · …" 한 줄로(이 유닛에는 장면 줄이 없다), 같은 `.line-label` 머리말에 경고색(`--pos-gk-fg`)으로 보인다. "원문"이라는 말을 쓸 수 없다(에러). 어긋남은 최종 보고·PUBLISH GATE 질문에도 적는다. 이 필드가 생기기 전에 쓴 `data.json`은 이름 있는 변환 함수 `directionCheckFromLegacyData`로 `null`로 읽는다(`data.json` `units[].direction_check_ko`).
- `text` 블록·`frame` 캡션·`fault_scene`·`look_at`에는 "댓글은"·"댓글이"·"댓글에"를 쓸 수 없다 — 댓글 자체를
  말하는 문장("댓글은 좌측이라고 했다")은 카드 본문이 아니라 `direction_check_ko`(방향이 어긋날 때)나 최종 보고·PUBLISH GATE에 적는다
  (에러: `u026: 카드에 '댓글은 …' 꼴로 댓글 자체를 말하지 않는다 — 방향이 어긋나면 notes 유닛의 direction_check_ko에 한 문장으로 적는다`).
  캡션에 "이 하프에서" 방향 문장을 요구하던 규칙은 없어졌다(그 쓰임이 `direction_check_ko`로 옮겨 갔다).
- `frame` 캡션에는 작업 과정의 말 "가려내기 어렵"·"알아보기 어렵"을 쓸 수 없다(에러: `u031: 캡션에 작업 과정의 말 "가려내기 어렵"을 쓸 수 없습니다 — …`). 사람이 안 보이면 "<이름>는 이 프레임에 보이지 않는다"로 밝힌다.
- 같은 경기의 다른 유닛 캡션이 그 사람을 이름표로 짚었는데(캡션이 그 팀원 이름·별칭·게이머태그를 말하고 "이름표"가 들었으며 "보이지 않는다"·"확인되지 않는다"가 아님) 이 유닛이 그 사람을 `unidentified_member_ids`에 넣었고 `marker_colors`에 그 `{경기, 팀원}` 항목이 없으면 에러다: `u001: 뎁스차저는 같은 경기 u002 캡션에서 이름표로 짚혔다 — 그 프레임에서 머리 위 색 삼각형을 marker_colors에 적고, 이 유닛 프레임에서 그 색으로 찾아본다`. 색을 시도해 보고 나서야 "못 찾음"을 쓸 수 있다.
- 유닛이 팀원 M을 `unidentified_member_ids`에 넣었고 `marker_colors`에 그 유닛 경기·M의 색 C가 있으면, 그 유닛 frame 캡션 하나가 C와 "삼각형"을 함께 담아 M을 색으로 가리키거나("뎁스차저(분홍 삼각형, 화면 가운데 위)"), 그 유닛의 `marker_unresolved_ko[M]`에 짚지 못한 이유가 있어야 한다. 에러: `u001: 뎁스차저의 색(분홍 삼각형)이 marker_colors에 있다 — 이 유닛 프레임에서 그 색으로 짚는 캡션을 쓰거나, 짚지 못한 이유를 notes 유닛의 marker_unresolved_ko에 적는다(카드에는 보이지 않는다)`. 색이 다른 경기·다른 사람의 것이면 걸리지 않는다. 색으로 M을 찾았으면 M을 `unidentified_member_ids`에서 뺀다.
- frame 캡션이 "<TAG> 이름표"(TAG는 영문·숫자·`_`·`-` 낱말, 공백 한 칸까지 허용)를 쓰는데 그 TAG가 명단 팀원에 속하지 않고 그 유닛 경기의 `unmatched_name_tags`에도 없으면 에러다: `u004: SAMBA 이름표는 명단 멤버의 이름·별칭·게이머태그가 아니다 — unmatched_name_tags에 { match: 1, tag: "SAMBA", color?, evidence_candidate_id }로 기록한다`. TAG가 명단 팀원에 속한다는 판정은 둘 중 하나다: TAG 자체가 팀원의 이름·별칭·게이머태그를 담거나(`mentionsMember`; "CEF_" 같은 클럽 접두·접미가 붙어도 된다) TAG의 영문자 런을 한글 자판으로 읽은 것이 그 이름·별칭과 같거나(`nameTagIsMember`, "CEF_ghdrlfehd313" → 홍길동), 같은 캡션에서 TAG가 든 괄호 바로 앞이 팀원의 이름·별칭·게이머태그다("동그리(TOONG 이름표, 초록 삼각형)"처럼 줄여 보이는 게임 내 이름). 같은 쉼표 절에서 TAG보다 앞에 "상대"가 있으면 상대 팀 선수의 이름표라 검사하지 않는다("상대(HOJIN 이름표)").
- 유닛의 frame 캡션·`fault_scene`·`look_at`·`direction_check_ko`에 쓴 "<색> 삼각형"(한글 색 낱말 + 선택 공백 + 삼각형)은 그 유닛 경기의 `marker_colors` 색이나 `unmatched_name_tags` 색이어야 한다. 범례에 없는 색이면 유닛·색마다 한 번 에러다: `u003: 자홍 삼각형은 1경기 범례에 없다 — marker_colors/unmatched_name_tags에 기록하거나 위치로만 쓴다`. 같은 쉼표 절에서 그 색 앞에 "상대"가 있으면 상대 선수 이야기라 검사하지 않는다. 흰 삼각형은 범례에 들 수 없으므로 같은 에러다(스킬은 흰 삼각형을 쓰지 않는다).
- `marker_unresolved_ko`(선택 객체 `{<member_id>: 이유}`, 카드 어디에도 렌더하지 않는 작업 기록): 이유는 trim 후 1–80자 한 줄 문자열이고, 키는 그 유닛의 `unidentified_member_ids`에 든 팀원이어야 한다(아니면 에러 `유닛 u001: marker_unresolved_ko의 kim-cheolsu는 이 유닛의 unidentified_member_ids에 없는 사람입니다`). 색으로 짚지 못한 이유("분홍 삼각형이 두 선수 위에 있어 구별되지 않음")는 여기에 쓴다 — 캡션은 독자가 읽으므로, 캡션에 /색으로\s*(사람을\s*)?가리키지\s*않/ 또는 /삼각형이\s*(함께|같이)\s*(있어|보여)/ 꼴의 작업 메모를 쓰면 에러다(`u001: 캡션에 색 삼각형으로 가리킬 수 없는 이유를 쓸 수 없습니다 — … marker_unresolved_ko에 적고 …`). 비슷한 색이 한 프레임에 둘 이상이면 캡션에 위치를 함께 써 구별한다("분홍 삼각형 둘 중 아래쪽").
- 제목 조각에 "패스"가 있거나 받는 사람 꼴("<팀원 이름·별칭·게이머태그>에게")이 있는 유닛은 frame 캡션 하나 이상에 낱말 "공"(공이·공을·공은·공의·공과·공도·공에·공으로·공만·공까지 꼴 포함; 공격·공간·공중은 아니다)이 있어야 한다. 에러: `u022: 제목이 패스(또는 받는 사람)를 말하는데 어느 캡션에도 공이 없다 — 공이 어디 있는지 캡션에 '공'이라는 말로 쓴다(공이 안 보이면 그렇게 쓴다)`. 공이 안 보이는 프레임이면 캡션에 그렇게 쓰면 된다.

exit 0/1만 있다(pending 없음). 비차단 경고는 stderr에 나온다(종료 코드는 그대로): 볼드 행동 없음, 과거형 볼드, 화면 방향 캡션에 `focus_x` 없음, 그리고 본문 text 블록에 이름(명단 이름·별칭·게이머태그)이 나온 팀원이 어느 프레임 캡션에도 없고 `unidentified_member_ids`에도 없을 때 `fc-feedback: 경고 u001: 본문에 나온 김철수이(가) 어느 캡션에도 없음 — 패스 받을 사람·간격 상대면 둘이 함께 보이는 프레임을 고르고 캡션에 둘의 위치를 쓴다`(명단이 없으면 이 경고는 없다). 이름표 경고도 낸다: `unmatched_name_tags`의 `tag`가 영문자 런마다 한글 자판(두벌식)으로 읽혀 완성 음절 2개 이상으로 조립되면 `fc-feedback: 경고 이름표 CEF_dnjswo313는 한글 자판으로 "원재"로 읽힌다 — 명단에 없는 사람이면 본문·캡션에서 "원재(CEF_dnjswo313 이름표)"처럼 그 이름으로 부른다`(이름표마다 한 번). 한글 이름을 IME 꺼진 채 친 이름표(`dnjswo` = 원재)는 그 이름으로 불러도 된다. 읽기가 명단 이름·별칭과 같으면 그 멤버의 이름표다("CEF_ghdrlfehd313" → 홍길동) — `unmatched_name_tags`에 적으면 에러이고 캡션의 이름표도 명단 멤버로 본다. 낱자모가 남거나 1음절인 런("SAMBA")은 읽기가 없어 경고도 없다. 읽기가 명단 이름·별칭과 같지는 않지만 비슷하면(글자 수가 같고 한 글자만 다르며 그 두 글자의 초성이 같다: 원재/원전은 비슷하고 원재/존재는 아니다) 같은 경고 끝에 ` — 명단의 원전과 같은 사람일 수 있다: 같은 사람이면 그 팀원으로 쓰고, 모르면 그대로 둔다`를 붙인다(비슷한 팀원이 여럿이면 "원전·윈재와"처럼 "·"로 잇는다). 후보를 알릴 뿐 자동으로 그 팀원으로 배정하지 않으며, 이름표는 계속 명단에 없는 이름표다.

### notes next / notes submit (유닛 단위 작성 루프)

notes.json을 유닛 하나씩 쓰는 길이다. 작업 폴더가 상태이고 새 상태 파일은 없다. `frames`·`render`가 읽는
산출물은 여전히 notes.json 하나다. 둘 다 `plan.validated.json`이 필요하다(없으면 exit 1).

- `fc notes next [--work <dir>]`(읽기 전용, 항상 exit 0): 아래 순서로 첫 해당 항목을 출력한다.
  1. plan 순서로 notes.json `units`에 항목이 없는 첫 유닛 → 그 유닛의 **브리프**. notes.json이 없으면 유닛이 아직 없는 것이다.
  2. 모두 있으면 전체 `checkNotes`를 돌려, 오류가 있는 첫 유닛의 브리프(오류 메시지를 맨 위에). 유닛에 매이지 않은 오류
     (최상위 `marker_colors`·`unmatched_name_tags`)는 따로 나열하고, submit의 같은 이름 필드로 고치라는 안내를 붙인다.
  3. 오류가 없으면 완료 안내(다음은 SOURCE REVIEW).
- 브리프(한국어 마크다운, 그 유닛의 맥락만): 유닛 id·제목·경기·영상 시간 범위(m:ss–m:ss)·진행(12/36), 고칠 사람
  (명단 이름, 추정 표시)·반복 지적 label, 원문 줄(시각·댓글 작성자·텍스트), 이 경기의 색 범례(notes.json의
  `marker_colors`·`unmatched_name_tags`, 없으면 "없음"; 한글 자판으로 읽히는 이름표는 `CEF_dnjswo313 이름표(명단에 없음; 한글 자판 "원재")`처럼 읽기를 함께 보이고, 읽기가 명단 이름과 비슷하면 `CEF_dnjswo313 이름표(명단에 없음; 한글 자판 "원재", 명단 원전과 비슷)`처럼 그 팀원도 보인다), 같은 경기에서 이미 캡션이 이름을 짚은 사람(`checkNotes`와
  같은 이름 매칭), `[start-5, end+5]` 프레임 후보(id·시각·kind·`cand/<id>.jpg`, 유닛 가운데 시각에 가까운 20개까지, 생략 개수 표시),
  `range` 후보가 유닛 범위 전체를 덮지 않으면(위 범위 훑기 기록 규칙) 정확한 `scan-range` 명령, 그리고 다음에 실행할 `notes submit` 명령.
  원문 줄은 검증된 unit의 `line_range`(plan의 `start_line..end_line`) 안 줄만 보인다 — 시간이 겹치는 다른 유닛의 줄(15초짜리
  댓글 줄 안의 짧은 음성 줄 등)은 넣지 않는다. 참고자료 리뷰 번들의 유닛 원문과 `check plan`의 "유닛 끝 직후 어느 유닛에도 없는 줄" 경고도 같은 범위로 줄을 고른다.
- `fc notes submit <unit-id> --file <path> [--work <dir>]`: 파일은 아래 모양의 JSON이다(보통 `<work>/notes-units/<unit-id>.json`).

```json
{
  "unit": { "blocks": [ … ], "unidentified_member_ids": [ … ] },
  "marker_colors": [ { "match": 1, "member_id": "gerrard", "color": "노랑", "evidence_candidate_id": "c003" } ],
  "unmatched_name_tags": [ { "match": 1, "tag": "SAMBA", "color": "자홍", "evidence_candidate_id": "c003" } ]
}
```

  `unit`은 notes.json `units.<id>`에 들어갈 객체 그대로다(위 notes.json 절의 필드). 두 배열은 선택이고, 이 경기에
  적을 항목을 담는다 — 같은 이름의 notes.json 최상위 배열 뒤에 이어 붙는다(같은 모양). 같은 경기·같은 `member_id`의
  `marker_colors` 항목, 같은 경기·같은 `tag`(대소문자 무시)의 `unmatched_name_tags` 항목이 이미 있으면 새 항목이 그것을 바꾼다
  (다시 submit해도 겹치지 않고, 틀린 항목을 submit으로 고칠 수 있다).
  현재 notes.json(없으면 `{version: 2, units: {}}`)에 그 유닛을 넣거나 갈아 끼우고 새 항목을 붙인 객체를 전체
  `checkNotes`로 검증한다. **그 유닛(`units.<id>…`)과 최상위 `marker_colors`·`unmatched_name_tags` 경로의 오류만** 막는다:
  오류를 stderr JSON으로 내고 exit 1, notes.json은 쓰지 않는다. **다른 유닛의 오류는 미룬다** — submit을 막지 않고, `notes next`의
  2번이 나중에 알린다. 통과하면 notes.json을 쓰고(그 유닛의 `noteWarnings`와, 이번 submit 파일의 `unmatched_name_tags`에 대한 한글 자판 이름표 경고는 stderr에 내며 막지 않는다) 그 시점의 `notes next`
  출력을 stdout에 낸다. plan에 없는 유닛 id나 `unit` 객체가 없는 파일은 exit 1이다.

### similar-choices.json → `check similar`

`similar-candidates.json`(스크립트 산출물) 필요.

```json
{ "version": 1, "units": { "u001": ["20240101-abcdefghijk#u002"] } }
```

- 각 `units[unitId]`는 그 unit의 `similar-candidates.json` 후보 목록에 있는 `uid`만,
  unit당 최대 3개, 중복 금지. `similar-candidates.json`에 아예 없는 unitId는 에러.
  disabled 모드처럼 후보가 없으면 `{"version":1,"units":{}}`로 통과시킨다.

exit 0/1만.

### refs-draft.json → `check refs`

이번 실행에서 **web search/fetch 도구(Claude: WebSearch/WebFetch; Codex: web search) 결과로
실제 받은 URL만** 넣는다(유튜브 검색 `uvx yt-dlp "ytsearch…"` 결과 포함) — 다른 출처의 URL이나 기억에 의존한 URL은 금지.

```json
{
  "refs": [{
    "url": "https://...", "title": "string", "source_name": "string",
    "lang": "en", "kind": "eafc",
    "summary_ko": "lang≠ko면 필수", "key_points_ko": ["lang≠ko면 ≥1개"],
    "translations": [{ "orig": "string", "ko": "string" }],
    "unit_ids": ["u001"],
    "format": "video",
    "relevance_ko": { "u001": "두 센터백이 간격을 좁혀 크로스 헤딩 공간을 닫는 법을 보여준다" },
    "video_starts": { "u001": "4:05" },
    "game_version": "FC 25", "pro_clubs": true,
    "recurring_labels": ["수비 라인이 맞지 않음"]
  }],
  "recurring_unfound": [{ "label": "리턴 패스를 하지 않음", "queries": ["pro clubs return pass", "원투 패스 타이밍"], "subtitle_terms": ["리턴", "원투", "return"] }],
  "units_unfound": [{ "unit_id": "u014", "queries": ["pro clubs offside trap", "프로클럽 오프사이드 트랩"], "subtitle_terms": ["옵사", "오프사이드", "offside"] }]
}
```

- `url`: http(s)이고 정규화 가능(자세한 정규화 규칙은 `verify-refs` 단계, `javascript:`
  등은 거부).
- `lang`: 소문자 2글자. `kind`: `"eafc"` 또는 `"tactics"`만. `format`: `"video"` 또는
  `"article"`만(필수).
- `relevance_ko`: `unit_ids`의 유닛마다 정확히 하나씩, 그 자료가 그 유닛 장면의 무엇을
  다루는지 쓴 1–120자 한 줄 문장. `unit_ids`에 없는 키는 에러. 한 자료 안에서 두 유닛이
  같은 문장(앞뒤 공백 무시)을 쓰면 에러. 상황 차이를 양보하는 말("예시지만", "예시이지만", "예시에서는",
  "상황은 다르지만", "상황이 다르지만")이나 같은 뜻의 어미 변형(정규식 `상황(이|은|과는?|과도)\s*다르`, `상황\s*기준이` — "상황과는 다르다", "우리 숫자가 적은 상황 기준이다")이 `relevance_ko`·`lesson_ko`에 들어 있어도 에러 — 상황이 다른 구간은 붙이지 않는다
  (`<자료 제목> u003: relevance_ko가 상황 차이를 양보한다('예시지만') — 상황이 다른 구간은 붙이지 않는다`).
  독자에게 보이는 문장이라 우리 작업의 내부 용어 "카드 장면", "이 카드", "카드의", "유닛"(부분 문자열 일치)이 `relevance_ko`·`lesson_ko`에 들어 있으면 에러다 — 축구 독자는 "카드"를 옐로·레드 카드로 읽는다. 진짜 카드("옐로 카드", "옐로카드", "레드 카드", "레드카드", "경고 카드")는 걸리지 않는다. 낱말마다 에러 하나, 경로는 그 문장의 경로:
  `refs[0].relevance_ko.u003: 독자에게 보이는 문장에 내부 용어 "카드 장면"가 있다 — 장면은 "이 장면"으로 쓴다`. `summary_ko`·`key_points_ko`는 자료 내용을 옮긴 글이라 이 검사를 하지 않는다.
  카드에 자료 옆으로 렌더된다.
- `game_version`·`pro_clubs`: `kind: "eafc"`면 둘 다 필수 — `game_version`은 자료의
  제목·설명·화면에 적힌 버전(`FC 25`, `FIFA 23` 꼴)이거나, 적혀 있지 않으면 `null` — 이때는
  `published`(자료를 올린 연월 `"2023-01"`)도 필수다.
  `pro_clubs`는 자료가 프로클럽을 다루면 `true`. `kind: "tactics"`면 셋 다 쓰지 않는다.
- `video_starts`: 생략 가능, `format: "video"`일 때만, unit id → `m:ss`/`h:mm:ss`. 키는
  `unit_ids`에 있어야 한다. 유닛마다 **그 유닛 장면을 다루는 구간**의 시작을 자막에서
  확인해 쓴다 — 그 유닛 카드의 링크가 이 시각부터 열린다(참고자료 페이지는 인용한 유닛의
  시각이 모두 같을 때만 그 시각, 다르면 시각 없는 원문 링크). 옛 단일 `video_start`는 에러.
- `lesson_ko`: 생략 가능, unit id → 그 자료 **자신이** 그 유닛의 잘못에 권하는 행동 한 문장
  (trim 후 1–80자, 한 줄; 예 `{ "u001": "포백이 한 줄로 서서 한 덩어리로 움직인다" }`). 키는 `unit_ids`에
  있어야 한다. 자막·본문에서 자료가 실제로 하는 말만 쓴다(댓글 작성자의 말이나 작성자의 해석이 아니다).
  붙은 자료가 있는 유닛의 제목에 -ㅁ(지적) 조각이 있으면(`check plan`의 제목 조각 판정과 같은 규칙, `plan.validated.json`의
  유닛 제목으로 본다) 그 유닛에 붙은 자료 중 **적어도 하나**가 그 유닛의 `lesson_ko`를 줘야 하고, 없으면 에러
  (`u001: 제목에 -ㅁ(지적) 조각이 있고 자료가 붙었는데 어느 자료도 lesson_ko를 주지 않는다 …`). `verify-refs`가
  `refs.verified.json`에 그대로 옮기고, `render`가 `data.json`의 유닛 참고자료 `lesson_ko`(그 유닛 몫 한 문장, 없으면 `null`)와
  `source_name`으로 싣는다. 카드는 제목 바로 아래(장면 줄 앞) "자료가 권하는 것 · 교훈 (출처)"로 보이며 출처는 카드의 그 자료 항목으로
  이어진다. `lesson_ko`가 없는 옛 항목은 `lessonFromLegacyData`가 `null`(줄 없음)로 읽는다.
- `lang !== "ko"`면 `summary_ko`(비어있지 않음) + `key_points_ko`(≥1개) 필수.
- `translations`: 최대 5개, 각 `{orig, ko}` 문자열 쌍.
- `unit_ids`: ≥1개, 전부 검증된 plan의 unit id. **unit 하나당 참고자료 최대 3개**(전체
  draft를 통틀어 계산).
- `recurring_labels`: 필수 배열(없으면 `[]`). 이 자료가 **직접 다루는** plan `recurring`
  label만 적는다. label마다 plan에 있어야 하고, 이 자료의 `unit_ids`가 그 label의 유닛을
  하나 이상 포함해야 한다. 같은 유닛에 붙었어도 다른 문제를 다루는 자료는 그 label을 적지
  않는다.
- `recurring_unfound`: 필수 배열. 검증된 plan의 `recurring` 항목마다, 그 label을
  `recurring_labels`에 적은 자료가 있거나, 이 배열에 같은 `label`과 비어 있지 않은 검색어
  2개 이상(`queries`)이 있어야 한다. plan에 없는 label이나 이미 자료로 덮인 label은 에러.
  label을 적은 자료가 그 label의 일부 유닛에만 붙으면 "자료 없는 유닛" 경고(stderr)가 난다.
  항목마다 `subtitle_terms`(비어 있지 않은 문자열 1개 이상)도 필수다 — 그 label의 핵심
  행동을 `refsubs/` 자막에 나오는 표기로 쓴 검색어("옵사", "라인", "offside")다.
- 비차단 경고(stderr, 종료 코드 그대로): 가장 많은 유닛에 걸린 `recurring` label의 자료 중 `pro_clubs: true`가 하나도 없으면
  `가장 많이 반복된 '<label>'에 프로클럽 자료가 없다 — 프로클럽 수비전술 강좌·같은 채널 label 핵심어로 더 찾는다`.
  `refs-bundle`이 이 말이 나온 자막 줄을 모아 리뷰어에게 보여 준다.
- 비차단 경고(stderr): `recurring_unfound`·`units_unfound` 항목의 `subtitle_terms` 용어가 이미 붙은 영상 자료의 `refsubs/` 자막에 나오면 `보유 자료 재확인: <용어> — <영상 id> <m:ss>`(두 단어 이상 용어만 — 한 단어 용어는 거의 모든 자막에 걸린다. 용어·영상마다 가장 이른 적중). 용어는 자막 줄바꿈을 건너 찾는다 — 줄을 단일 공백으로 이은 글에서 찾고 시작한 줄의 시각을 쓴다. 못 찾았다고 적기 전에 이미 가진 자료를 다시 보게 하는 경고다.
- `units_unfound`: 필수 배열. 자료가 하나도 붙지 않은 유닛마다 정확히 한 항목
  `{unit_id, queries, subtitle_terms}`(`queries` 2개 이상, `subtitle_terms` 1개 이상, 모두
  비어 있지 않은 문자열)를 둔다. 빠진 유닛, 자료가 붙은 유닛, plan에 없는 id, 중복 id는
  에러다.
- unfound 기록은 실제 검색이어야 한다(`check refs`가 `recurring_unfound`·`units_unfound` 항목을 함께 본다): `queries`에 명단 팀원의 이름·별칭·게이머태그(대소문자 무시)가 들어 있으면 에러(`u002: 검색어 "…"에 팀원 이름 "뎁스차저"이 들어 있다 — …`, 명단이 없으면 이 검사는 건너뛴다), 같은 검색어 문자열(앞뒤 공백·대소문자 무시)이 항목 3개 이상에, 또는 같은 `subtitle_terms` 집합(순서 무관)이 항목 3개 이상에 나오면 에러(복사한 기록이지 그 label/유닛의 검색이 아니다 — 반복 하나당 에러 하나, 첫 항목 경로). `recurring_unfound` 항목은 게임 용어(fc·fifa·eafc·ea fc·pro clubs는 낱말 단위 영문, 피파·프로클럽은 어디서나; 대소문자 무시)가 없는 검색어를 하나 이상 가져야 한다 — 반복 지적은 실제 축구 강의·전술 영상에도 같은 설명이 있다. 모든 검색어가 게임 용어를 담으면 에러 `<label>: 검색어가 모두 게임 용어(fc·fifa·피파·프로클럽·pro clubs·eafc)를 담고 있다 — …`(경로 `recurring_unfound[N].queries`). `units_unfound`에는 걸리지 않는다.
- 이번 경기의 게임 버전: `summary_ko`·`key_points_ko`·`relevance_ko`에 "이번 경기(FC 26)"
  꼴로 적은 버전은 `session.json` 영상 제목에 적힌 버전(FC/FIFA + 두 자리)과 같아야 한다.
  제목에 버전이 없거나 영상끼리 다르면 이번 경기 버전을 적을 수 없다(에러).

exit 0/1만. 통과 후 `verify-refs`가 URL을 정규화·HTTP 확인해 `refs.verified.json`을 쓴다
(신규 참고자료 실패 시 exit 1은 아니고 `dropped[]`에 사유와 함께 남을 수 있음 — 자세한 것은
`fc.ts` 소스 참고).

### taxonomy add (append-only)

`fc taxonomy add <tag...>`는 유효한 태그(위 태그 규칙)만 받고, 이미 있는 태그는 그대로 두며
(멱등), 새 태그만 taxonomy에 추가한다. REVIEW GATE에서 승인된 `proposed_tags`만 이 명령으로
넣는다.

## 원문 근거 대조 (작성 계약 — 스키마 아님)

`check`는 구조만 검증한다(길이·개행·볼드 짝·frame 시각·caption 길이). 아래는 `check`가
잡지 못하는 의미 충실도 규칙이며, 에이전트가 notes를 쓰는 동안 스스로 지킨다. 순서가 곧
점검 순서다.

1. **행위자·수신자·방향을 원문 그대로 보존한다.** "A가 B에게 준다"를 "A에게 준다"로
   줄이지 않고, 측면→중앙을 중앙→측면으로 뒤집지 않는다. 지시·조건절 앞에서 호명한
   선수는 뒤 절의 주어가 생략됐을 때 그 행동의 행위자로 읽는다. 단 "A가 B에게 줬을
   때 …"처럼 조건절이 공을 옮기면, 뒤 절에서 생략된 주어는 그 시점에 공을 가진 B다.
   명시된 다른 주어·수신자·조사가 있으면 그것을 우선한다. 호명된 선수를 근거 없이 패스 수신자로
   바꾸지 않는다.
2. **화자를 먼저 확정한다.** 작성 전에 전사의 1인칭("저/제")이 누구인지 roster의
   `role: coach` 항목·이름·별칭과 HUD 이름표를 대조해 정한다. 확정되면 문서에서 처음
   나올 때 명단 이름으로 밝히고, 이후 "코치"를 그 이름과 다른 사람처럼 읽히게 쓰지
   않는다. 댓글 줄(`source: "comment"`)의 화자는 그 줄의 `author`다 — handle을
   roster의 이름·게이머태그·별칭과 대조해 정하고, 작성자를 "코치"로 단정하지 않는다.
   댓글 작성자는 렌더러가 카드마다 머리 줄(브레드크럼 뒤)에 "· 댓글 작성 이름"으로 보여 주므로 본문에서 따로 밝히지
   않는다(SKILL.md의 작성자 소개 금지).
   작성자가 자기 이름을 3인칭으로 쓴 지적은 그 팀원 자신의 잘못으로 옮긴다.
3. **인명은 명단 대조부터 한다.** 문맥상 사람을 가리키는 표현에서 호칭·조사(`님`,
   `한테`, `에게`, `이`, `가` 등)를 떼고 roster의 `name`/`gamertag`/`aliases`와
   대조한다. 한 사람에 명확히 일치하면 그 `name`을 쓰고, 일반 역할명(센터백 등)이나
   다른 선수 이름으로 바꾸지 않으며 빠뜨리지도 않는다. 일치하지 않는 표현은 비슷한
   이름에 억지로 맞추거나 "님"을 붙여 새 인물로 만들지 않고, 확인된 역할("공을 받을
   선수" 등)로 쓴다.
4. **원문에 없는 지시·인과 설명을 지어내지 않는다.** 전사가 손상됐거나 구체적 지시가
   없으면 확인된 관찰만 쓴다. "그래야 공간이 열린다" 류의 전술 원리를 원문 근거
   없이 보태지 않는다. **조건문의 방향을 뒤집지 않는다** — "A일 때만 B"를 "A면
   B하지 말라"로 바꾸지 않는다. 이름·행동·조건·결과는 각각 확인한다. 한 단어가
   불명확해도 확인된 나머지까지 유보하지 않는다. 복원할 수 없는 세부는 추정하지 말고
   생략하며, 생략하면 뜻이 달라질 때만 무엇이 불확실한지 짧게 쓴다. 독자용 문장에
   "전사", "ASR", "발화" 같은 작업 과정 용어를 쓰지 않는다. 원문 줄 인덱스(`i=`)도
   제목·요약·문장에 남기지 않는다. 따옴표 직접 인용은 해당
   줄 문자열을 그대로 옮길 때만 쓴다 — 표기를 고치거나 요약한 문장은 따옴표 없이
   의미만 서술한다. 평가에서 교정 행동을 정리할 때는 원문이 기대한 행동과 실제
   행동의 차이가 드러난 경우에만 그 차이만큼 쓴다. 원문에 없는 이동 경로·수신자·
   조건·이유를 덧붙이지 않고, 좋고 나쁨만 말한 평가를 행동으로 지어내지 않는다.
5. **유닛 경계를 넘어 내용을 가져오지 않는다.** 제목·요약·문장은 그 유닛의
   `start_line..end_line` 안 원문만 근거로 삼는다. 인접 줄은 생략된 주어·대명사를
   확인할 때만 참고한다. 제목과 본문의 행위자·수신자·방향·결과·확신 수준을 서로
   맞춘다. 본문에 없는 판단이나 본문이 유보한 내용을 제목에서 확정하지 않는다.
   topic `summary`도 같다 — 실점·페널티 같은 결과는 그 결과를 말한 줄이 있는 유닛의
   것으로만 쓰고, 원문이 잇지 않은 두 사건을 인과("…해서 …를 내줬다")로 잇지 않는다.
   평가는 누가 했는지 드러나게 쓴다 — "평가가 나왔다" 같은 주어 없는 피동 대신 작성자
   이름을 주어로 쓰거나 단정형으로 쓴다.
   `recurring` 항목의 각 유닛 원문은 그 `label`의 잘못을 직접 말해야 한다.
6. **캡션은 프레임을 다시 열어 확인한다.** 인물·위치·표식 개수·화면 위/아래·좌/우를
   그 프레임에서 확인한다. 화살표는 코치가 그린 경로 표시이지 실제 이동의 증거가
   아니며, 정지 사진만으로 패스 완료·추격·결과를 단정하지 않는다. 코치가 프레임에
   직접 써넣은 글자·표시는 보이는 그대로 캡션에 옮긴다. 프레임에 없는 이름표·마커를
   지어내지 않는다 — 이름표가 안 보이면 "선수"처럼 쓴다. 좌/우·위/아래는 화면상
   위치로 쓴다.

## 원문 대조 리뷰 번들

6단계에서 `check notes`가 통과하면, frames로 넘어가기 전에 `presentation-reviewer`
에이전트를 디스패치한다. 리뷰어는 이 스킬을 모르는 범용 에이전트이므로 아래 세 입력을
그대로 넘긴다.

- **presentation**: `notes.json` 전체(유닛별 `blocks` — text 블록과 frame 캡션)와
  `plan.json`의 해당 유닛 제목·대상(`member_ids`·`position_tags`·`addressed_to_all`)·
  topic summary·`recurring` 항목.
- **sources**: `lines.json`의 유닛별 `start_line..end_line` 원문 줄(댓글 줄은 `author`
  포함 — 리뷰어에게 그 줄이 작성자가 쓴 댓글이라고 알린다), roster(이름·
  `aliases`·`role`), 캡션이 가리키는 프레임 이미지 경로(`candidates.json`의
  `cand/<id>.jpg` 후보 또는 `add-frame` 결과), 유닛의
  `key_frame_candidate_ids`가 가리키는 대표 프레임 경로(장면의 공수·팀을 HUD로 확인하는 근거),
  그리고 이 문서의 위 「원문 근거 대조」 절 전문 — 리뷰어는 이 스킬의 작성 규칙을 모르므로 판단 기준으로 함께 넘긴다.
- **reader_persona**: "영상을 아직 안 본 팀원, 모바일에서 읽음".

리뷰어에게 요청하는 점검은 문장·캡션·제목·요약마다:
- **원문과 같은가**: 행위자·수신자·방향·조건·인과가 원문과 같고 뒤집히지 않았는가. 원문에
  없는 지시·해석·주어를 단정하지 않았는가. 어조(바람/요구)와 유보("아직까진")를 지켰는가.
  팀 전체에게 한 말을 특정인 지시로, 특정인에게 한 말을 전원 대상으로 바꾸지 않았는가.
- **누가 하는가**: 유닛 첫 문단에서 볼드 행동을 할 사람이 드러나는가 — 확인되지 않으면 원문
  표현을 그대로 쓰되, 문장에 함께 나온 다른 사람이 행동 주체로 읽히지 않게 한다. 주어 없는
  실패 문장이 바로 앞에 이름이 나온 사람 탓으로 읽히지 않는가.
- **볼드**: 볼드가 평가어·결과·잘못한 행동이 아니라 원문이 요청한 할 행동만 짚는가.
- **제목과 대상**: 제목 조각이 `행위자: ~기`(할 일) 또는 `행위자: ~ㅁ`(상태·결과 지적)인가.
  `member_ids`가 행동을 바꾸라는 사람만 담고(칭찬·계기·등장만 한 사람 제외), 그 사람마다
  자기 조각이 제목에 있는가. 생략된 행위자를 넣었다면 그 행동을 장면에서 그 사람만 할 수
  있는가. `recurring` 항목의 유닛 원문이 모두 그 잘못을 직접 말하는가.
- **장면과 프레임**: 장면이 공격인지 수비인지, 파울·득실점이 어느 팀 것인지 프레임의 HUD·팀
  색·이름표로 확인했는가 — 프레임으로도 정할 수 없으면 잘못이나 공로로 단정하지 않는다.
  캡션의 인물·이름·위치·인원·좌우·상하가 프레임과 맞는가. 이름은 그 프레임에서 알아볼 수 있는
  선수에게만 썼는가. 두 사람 사이 거리를 말하면 둘 다 확인했는가.

이 작성 규칙에 맞는 다음 경우는 결함으로 보지 않는다 — 원문에 교정 행동이 없는 유닛 본문에
볼드가 없는 것, 이름 없는 단위 지적의 제목 행위자를 그 단위("수비진")로 쓴 것, 틀리지 않은
캡션에 정보가 빠진 것(보강 제안이다), 표현·어순 취향.

반영 규칙: 지적마다 원문(줄 또는 프레임)을 다시 열어 고친다. 근거를 찾지 못한
문장은 지어내지 말고 지운다. 리뷰 통과 자체를 위해 근거 없는 새 내용을 보태지
않는다. `REQUEST_CHANGES`면 위 반영 규칙대로 notes.json을 고친다. 제목·topic
summary 문구나 `recurring` 항목(추가·삭제·label·lines·member_ids)만 고친 경우 `plan.json`을 고치고 `check plan`이 exit 0인지만
확인한다 — 유닛 경계·태그·member_ids를 바꾸지 않았으므로 사용자 재승인은 받지
않는다. 경계·태그·멤버를 바꿔야 하면 REVIEW GATE(5단계)로 돌아간다. `check notes`를
재검증한 뒤 새 에이전트를 다시 디스패치한다. `APPROVE`/`COMMENT`만 통과로 치고,
`INCONCLUSIVE`나 판정 누락은 통과가 아니다 — 빠진 입력을 채워 다시 디스패치한다.


## 참고자료 리뷰 번들

9단계에서 `check refs`가 통과하면 `verify-refs` 전에 `refs-bundle`로 `refs-review.md`를
만들고 `presentation-reviewer` 에이전트를 디스패치한다. `refs-review.md`는 자료마다 제목·
`kind`·`format`·`game_version`·`published`·`pro_clubs`·`summary_ko`·`key_points_ko`를, 그
자료가 붙은 유닛마다 유닛 제목·범위 안 원문 줄(작성자 포함)·`relevance_ko`·`lesson_ko`(있으면)·
`recurring_labels`·`video_starts`와 그 시각 앞뒤 90초의 자막(`refsubs/<영상 id>.*.vtt`)을
담는다. 끝에는 plan `recurring` 항목별로 그 label을 적은 자료와 `recurring_unfound`(못 찾은 label의 유닛에 붙은 다른 자료 포함), 자료가 하나도 없는 유닛
목록(`units_unfound`의 검색어 포함), 못 찾은 label과 자료 없는 유닛마다 `subtitle_terms`가 나온
`refsubs/` 자막 줄(영상·시각별; 용어가 자막 줄바꿈에 걸쳐 있으면 시작한 줄의 시각으로 걸친 줄 전체를 한 줄로 싣고, 같은 영상·시각·글의 중복 줄은 한 번만 싣고, 이미 어떤 유닛에 붙은 영상의 줄은 끝에
`[이미 붙은 자료: u029 18:13]`처럼 붙은 유닛과 그 붙인 시작 시각을 적어 다른 줄보다 먼저 싣는다 — 적중 줄이 이미
붙은 구간 바로 곁이면 "못 찾음"이 아니라 그 구간 확인 대상이다), 그리고 `refsubs/`에 받았지만 어느 자료에도 쓰지 않은 자막 파일 목록이 붙는다. 그 사이에 "같은 채널 후보" 절이 있다: 붙은 YouTube 영상 자료의 채널(`source_name`)마다 채널 안에서 검색한다 — 첫 붙은 자료의 영상에서 `uvx yt-dlp <영상 URL> --skip-download --print channel_url`로 채널 URL을 채널당 한 번 받아 `uvx yt-dlp "<채널 URL>/search?query=<키워드>" --flat-playlist --playlist-end 10 --print "%(id)s %(title)s"`를 돌린다(채널 URL을 못 받거나 채널 안 검색이 실패하면 `### …` 아래 "채널 안 검색 불가 — 전체 검색으로 대신함"을 적고 `ytsearch10:<채널> <키워드> <축구 단어>`로 대신한다: 한국어 채널은 "축구", 아니면 "football"). 결과의 id와 제목을 `### <채널> × <키워드>` 아래 싣고 이미 붙은 id에는 `[이미 붙은 자료: …]`를 단다. 채널은 붙은 자료가 덮는 유닛 수가 많은 순(같으면 `pro_clubs` 자료가 있는 채널 먼저, 그다음 draft 순)이고, 한 채널의 검색은 이 순서다: ① 그 채널에 붙은 자료 제목에 시리즈 표시("pt.4"·"Part 2"·"#3")가 있으면 표시를 뗀 제목(같은 채널의 다른 편을 찾는다) ② `recurring_unfound` label과 `units_unfound` 유닛마다의 키워드 — 팀원 이름·별칭·게이머태그가 든 낱말, 조건절(-면·-때) 낱말, 한 글자 낱말은 빼고 끝 조사는 뗀다(`check refs`의 unfound 검색어 검사와 같은 명단 대조). label은 앞 3낱말, 유닛은 제목 행동의 앞 2낱말과 `subtitle_terms` 앞 2개. 영어 채널(그 채널 자료의 `lang`이 모두 `ko`가 아님)은 그 기록의 첫 라틴 `subtitle_terms`를 우선하고 없으면 한국어 키워드를 쓴다. 검색은 12개까지만 하되 채널을 돌아가며(채널마다 첫 검색, 둘째 검색, …) 나눠 쓰므로 한 채널이 다 쓰지 않으며, 나머지는 "생략한 검색 N개(상한 12개)"로 알리며, 실패한 검색은 "검색 실패: 이유"로 적고 명령은 성공한다. `fc refs-bundle --no-search`는 검색하지 않는다("검색 안 함(--no-search)"). 테스트용으로 환경 변수 `FC_FEEDBACK_YTDLP_BIN`이 있으면 `uvx yt-dlp` 대신 그 실행 파일로 검색한다. 그 앞에 "유닛별 프로클럽 자막 적중" 절이 있다: 유닛 제목의 행동 핵심어(": " 뒤 행동에서 한글은 앞 2음절, 영문은 3자 이상 소문자; 흔한 어미(않기·하기·않는·않고)와 조사성 낱말(말고·혼자·대신·보다·계속·너무·바로·하지), 코퍼스에 너무 자주 나오는 핵심어는 뺀다. 게임 용어 동의어 표 — 오프사이드·옵사·offside, 슈퍼 캔슬·슈캔·super cancel, 크로스·cross, 헤딩·header, 프리킥·free kick, 코너킥·corner kick — 의 한 표기가 제목에 있으면 그 묶음의 다른 표기를 통째로 핵심어에 더한다. 동의어는 핵심어만 늘리고 기존 앞 2음절 핵심어는 그대로 둔다)로 `refsubs/` 전체에서 `pro_clubs: true` 영상의 자막을 훑어, 그 유닛에 아직 붙지 않은 영상의 적중 줄을 유닛마다 최대 10줄 싣는다(희귀한 핵심어에 가중, 위 `[이미 붙은 자료: …]` 표시 그대로). 제목에 "지 않기"가 든 유닛은 `### uXXX` 제목 아래(자료 없는 유닛 목록에서는 그 줄 아래)에 "이 유닛은 '하지 않기' — 구간이 참는 쪽을 말하는지 확인" 단서가 붙는다 — 구간이 "하라"를 가르치면 반대 방향이다. 자막이 없는 영상은
"자막 없음"으로 표시된다.

- **presentation**: `refs-draft.json`.
- **sources**: `refs-review.md`, `refsubs/` 폴더(붙이지 않은 자막까지 핵심어로 훑을 수
  있게), 글 자료는 리뷰어가 `curl -sL <url>`로 받은 본문.
- **reader_persona**: "자기 카드의 참고자료를 눌러 그 구간부터 보는 팀원, 모바일에서 읽음".

리뷰어에게 요청하는 점검은 자료×유닛마다:
- `relevance_ko`·`lesson_ko`가 말하는 자료 쪽 대상·행동·주어가 발췌 자막(글이면 본문)에 실제로 나오는가.
- 그 구간이 결국 권하는 행동이 유닛 원문 지적과 같은 방향인가(반대면 거부), 구간의 상황
  (오픈 플레이·세트피스·역습·공중볼, 공을 받는 사람의 역할)과 증상이 유닛 장면과 같은가,
  시작 시각이 그 증상을 말하는 곳에서 시작하는가.
- `recurring_labels`에 적은 label마다 그 구간이 고치는 행동을 가르치는가(핵심어만 스치면
  아니다). 반대로 덮는 구간이 붙어 있는데 그 label이 `recurring_unfound`에 있지 않은가.
- `game_version`·`published`·`pro_clubs`가 자료 제목·설명과 맞는가.
- 「자료 없는 유닛」·못 찾은 label·"유닛별 프로클럽 자막 적중" 줄 가운데 그 유닛의 핵심 행동을
  다루는 구간이 있는가 — 있으면 `REQUEST_CHANGES`다.

`APPROVE`/`COMMENT`면 `verify-refs`로 진행한다. `COMMENT`의 제안 중 자료가 실제로 말하는
것과 어긋난 내용(대상·행동·방향·버전·상황)을 고치는 것만 반영하고 다시 리뷰받는다. 다시 받은 리뷰에 사실 수정 제안이 없으면 끝낸다. 표현만
바꾸는 제안은 반영하지 않는다.
## 스크립트가 만들고 LLM은 읽기만 하는 파일

경로·파일명은 아래 필드 값을 그대로 읽는다 — 추측해 만들지 않는다.

| 파일 | 요지 |
|---|---|
| `session.json` | `fetch`가 씀. `videos[]`마다 `id`(VID), `part`(URL 순서 1..N), `title`, `channel`, `upload_date`(YYYYMMDD), `duration`, `embeddable`, `width`/`height`(높이 540 이하 최고 스트림 — 16:9는 480p), `files{audio,video,captions,captions_format,wav,comments}` — `comments`는 yt-dlp가 준 댓글 목록 파일(`{id,parent,author,text}[]`). |
| `lines.json` | `transcribe`가 씀. `[{i, video, start, end, text, source, author?}]` — `source`는 `speech`(음성·자막) 또는 `comment`(타임스탬프 댓글 한 항목, `author`=작성자 유튜브 handle, `start`=댓글 시각, `end`=그 뒤 15초 또는 영상 끝), `i`는 0부터 연속, video는 파트 순서로 그룹, 그룹 안에서 `start` 오름차순, `0 ≤ start < end ≤ duration+1`, `text` 비어있지 않음. **LLM은 `i`(줄 인덱스)만 고르고 초 단위 시간은 절대 직접 쓰지 않는다** — plan.json의 `start_line`/`end_line`이 이 `i`를 가리키면 스크립트가 초로 변환한다. |
| `candidates.json` | `scan`(+수동 `add-frame`, 구간 `scan-range`)이 씀. `[{id(c###), video, t, kind: comment\|silence\|scene\|interval\|manual\|range, dur?}]` — `range`는 `scan-range --video <VID> --from <sec> --to <sec> [--step 2]`가 구간을 step초마다 뽑은 후보(같은 video·t는 다시 만들지 않고, `sheets/<VID>-range-<from>-<to>.jpg` 컨택트시트 한 장도 만든다) — `comment`는 댓글 시각 그 자체, video별 그룹·`t` 오름차순. 미리보기는 `cand/<id>.jpg`. |
| `sheets.json` | `scan`이 씀. `{version, sheets:[{file, video, kind: hud\|grid, cols, rows, times[]}]}` — HUD 시트는 경기 시계/스코어 판독용, grid 시트는 장면 훑어보기용. |
| `similar-candidates.json` | `similar`이 씀. `{version, session_id, units:{u001:[{uid,score,title,date,topic_tags,position_tags}]}}` — Jaccard 기반 점수 desc, disabled/과거 세션 없음이면 `units: {}`. |
| `refs-review.md` | `refs-bundle`이 씀. 「참고자료 리뷰 번들」의 리뷰어 입력 — 자료×유닛마다 원문 줄·`relevance_ko`·`video_starts` 앞뒤 90초 자막(`refsubs/<영상 id>.*.vtt` 중 이름순 첫 파일), 반복 지적별 자료·`recurring_unfound`, 쓰지 않은 자막 목록. |
| `refs.verified.json` | `verify-refs`가 씀. `refs-draft.json` + `id(r-<sha256[0:10]>)`, 정규화된 `url`, `final_url`, `http_status`, `checked_at`, `reused`, `page`(ko면 null), `dropped[]`. |
| `data.json` (`sessions/<sid>/`) | `render`가 씀. 뷰어가 읽는 최종 데이터 — `units[].body`가 notes v2 `blocks`를 `{type:"text",text}` 또는 `{type:"frame",src,width,height,t,caption}`로 옮긴 것(구 `note`/`images.key` 필드는 v2에서 폐지). `units[].comment_author_names`는 유닛 범위 댓글 작성자를 roster 이름으로 바꾼 목록, `units[].refs[]`는 `format`·그 유닛의 `relevance_ko`·`source_name`(자료 출처 이름, 옛 데이터는 자료 제목)·`lesson_ko`(그 유닛에 대한 자료의 권고 한 문장, 없으면 `null`)·`start_seconds`(영상 시작 초, 지정이 없으면 `null`)·`version_badge`(eafc 자료의 버전 배지 글: 자료 버전, 경기 영상 제목의 버전보다 오래되면 "FC 25 · 이전 버전"; 버전을 밝히지 않은 자료(`game_version: null`)·tactics 자료·이 필드 이전에 검증된 자료는 `null` — 더 이상 "버전 미표기" 문구를 싣지 않는다)·`published_badge`(버전을 밝히지 않은 eafc 자료(`game_version: null`)의 업로드 연월 글 "2023년 1월"; `published`가 없거나 다른 자료는 `null`; 이 필드 이전에 쓴 `data.json`의 `version_badge` "2023년 1월 · 버전 미표기"는 이름 있는 변환 함수 `publishedBadgeFromLegacyData`가 날짜로, `versionBadgeFromLegacyData`가 `null`로 읽는다)·`pro_clubs`(없으면 `false`)를 담는다. `units[].unidentified_member_ids`는 notes 유닛의 같은 필드(없으면 `[]`)로, 카드에 "사진에서 위치를 확인하지 못한 사람"으로 보인다. `units[].look_at`은 notes 유닛의 `look_at`(없으면 `null`; 이 필드가 생기기 전에 쓴 `data.json`은 `null`로 읽는다)으로, 위치 미확인 줄 바로 아래 "사진에서 볼 곳: …" 한 줄로 보인다. `units[].direction_check_ko`는 notes 유닛의 `direction_check_ko`(없으면 `null`; 옛 `data.json`은 이름 있는 변환 함수 `directionCheckFromLegacyData`로 `null`로 읽는다)으로, 카드에 "장면 · …" 줄 다음 "방향 확인 필요 · …"으로 보인다. `units[].fault_scene`은 notes 유닛의 `fault_scene`(제목에 -ㅁ 조각이 없어 notes가 쓰지 않으면 `null`; 이 필드가 생기기 전에 쓴 `data.json`은 이름 있는 변환 함수 `faultSceneFromLegacyData`로 `null`로 읽는다)으로, 카드에 제목 아래(자료 교훈 줄이 있으면 그 다음) "장면 · …"으로 보인다. `units`는 유닛 id 순(= 시간 순)이다. `units[].named_member_ids`는 유닛 줄 텍스트에 이름·별칭·게이머태그가 나온 팀원(스크립트 계산, 댓글 `author`는 보지 않음). `units[].group_member_ids`는 그 유닛의 `group_positions`에 드는 포지션으로 그 경기 `lineup`에서 뛴 팀원 전부(`member_ids`에 있는 사람 포함, 스크립트 계산, 팀 단위 칩의 "내 포지션 대상" 판정용; 필드가 없는 옛 데이터는 이름 있는 변환 함수 `groupMemberIdsFromLegacyData`가 `position_target_ids`로 읽는다). `units[].position_target_ids`는 그 유닛의 `group_positions`에 드는 포지션으로 그 경기 `lineup`에서 뛴 팀원 중 `member_ids`에 없는 사람(스크립트 계산, "내 포지션 대상"). `units[].self_critique_member_ids`는 `member_ids` 중 그 유닛 댓글 작성자(`comment_authors` handle을 명단 이름·게이머태그·별칭으로 푼 멤버)인 id(스크립트 계산, 카드 "고칠 사람" 줄의 "(작성자 본인)" 표시; 필드가 없는 옛 데이터는 `[]`). 최상위 `recurring`은 검증된 plan의 `[{label, unit_ids, member_ids, refs_unfound}]` — `refs_unfound`(boolean)는 그 label이 refs-draft의 `recurring_unfound`에 있으면 `true`(필드가 없는 옛 데이터는 `false`). 최상위 `matches_without_feedback`은 검증된 plan의 같은 이름 문자열 배열(없는 옛 데이터는 `[]`). |

## 설정/명단(사람이 준비, 스크립트가 파싱)

| 파일 | 요지 |
|---|---|
| `manifest.yaml` (`~/.fc-feedback/<projectKey>/`) | `{version:1, project, mode: unconfigured\|disabled\|configured}` — configured면 `archive_repo_path`(절대경로, git toplevel)·`roster_path`·`pages_base_url`(https, `/`로 끝) 전부 필수. `fc config set/disable`로만 바뀜, 직접 편집 금지. |
| `roster.yaml` | `{members:[{id(멤버 id 패턴), name, gamertag(유일, 대소문자 무시), positions(≥1, 트리에 존재, 첫 값=주포지션; 옛 좌우 코드는 `positionFromLegacyCode`로 새 코드로 읽고 중복은 합친다), aliases?, role?:"coach"}]}`, member ≥1. |
| `taxonomy.yaml` | `{version:1, topics:[유일하고 유효한 태그]}`. `taxonomy add`만 추가하고 직접 편집하지 않는다. |
