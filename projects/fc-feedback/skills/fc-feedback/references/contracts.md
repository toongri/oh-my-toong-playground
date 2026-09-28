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
    "topics": [{
      "title": "string(≤80자)", "summary": "string",
      "units": [{
        "start_line": 0, "end_line": 0, "title": "string(≤80자)",
        "position_tags": ["CM"], "topic_tags": ["빌드업"],
        "member_ids": ["gerrard"], "key_frame_candidate_ids": ["c001"]
      }]
    }]
  }],
  "proposed_tags": [{ "tag": "string", "reason": "string" }]
}
```

- `session_title`/각 `title`: 비어 있지 않음, `title`은 80자 이하.
- `matches` ≥1, `topics` ≥1, `units` ≥1.
- `start_line`/`end_line`: 0 이상 정수, `end_line < lines.length`, `start_line ≤ end_line`,
  같은 unit 안에서 같은 video, 같은 video 내에서 unit끼리 겹치지 않고 오름차순.
- `position_tags`: 포지션 트리(GK/DF/MF/FW와 그 자손)에 있는 값만.
- `topic_tags` ≥1개, 각 태그는 taxonomy에 있거나 `proposed_tags`(유효하고 taxonomy에 아직
  없는 것)에 있어야 함 — proposed 태그를 하나라도 쓰면 `pending`.
- `member_ids`: roster가 있으면 그 id만 허용, **roster가 없는(disabled) 모드에서는 반드시
  빈 배열**이어야 함(비어 있지 않으면 에러).
- `key_frame_candidate_ids`: `candidates.json`에 실제 있는 id, 같은 video,
  `t ∈ [unit.start-5, unit.end+5]`.
- `proposed_tags[].tag`: 유효한 태그이고 taxonomy에 아직 없어야 함.

**exit 0**: 유효 + `proposed_tags` 미사용 → `plan.validated.json` 생성(`m1`, `m1-t1`,
`u001`… id를 문서 순서로 부여하고 `start`/`end`(초)·`video`를 채움) + 게이트 표
(`tableMd`, 경기/시간/제목/포지션/주제/팀원) + `proposed` 배열을 stdout에 JSON으로 출력.
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
    ] }
  }
}
```

- `units`의 키 집합은 검증된 plan의 unit id 집합과 **정확히 일치**(부족·초과 모두 에러).
- `blocks`: 1–20개, `type:"text"` 블록 ≥1개.
- `text` 블록: trim 후 1–800자, 개행 문자(`\r`/`\n`) 금지(블록 = 문단 하나),
  `**...**`는 짝이 맞아야 하고 안쪽이 비어있지 않아야 함(중첩은 구조상 불가능).
- `frame` 블록: unit당 최대 6개, `candidate_id`가 `candidates.json`에 실재하고 unit과 같은
  video, `t ∈ [unit.start-5, unit.end+5]`, unit 안에서 `candidate_id` 중복 금지,
  블록 등장 순서대로 `t`가 비감소(내림차순 금지). `caption`은 trim 후 1–120자, 개행 금지·필수.

exit 0/1만 있다(pending 없음).

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
실제 받은 URL만** 넣는다 — 다른 출처의 URL이나 기억에 의존한 URL은 금지.

```json
{
  "refs": [{
    "url": "https://...", "title": "string", "source_name": "string",
    "lang": "en", "kind": "eafc",
    "summary_ko": "lang≠ko면 필수", "key_points_ko": ["lang≠ko면 ≥1개"],
    "translations": [{ "orig": "string", "ko": "string" }],
    "unit_ids": ["u001"]
  }]
}
```

- `url`: http(s)이고 정규화 가능(자세한 정규화 규칙은 `verify-refs` 단계, `javascript:`
  등은 거부).
- `lang`: 소문자 2글자. `kind`: `"eafc"` 또는 `"tactics"`만.
- `lang !== "ko"`면 `summary_ko`(비어있지 않음) + `key_points_ko`(≥1개) 필수.
- `translations`: 최대 5개, 각 `{orig, ko}` 문자열 쌍.
- `unit_ids`: ≥1개, 전부 검증된 plan의 unit id. **unit 하나당 참고자료 최대 3개**(전체
  draft를 통틀어 계산).

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
   줄이지 않고, 측면→중앙을 중앙→측면으로 뒤집지 않는다.
2. **화자를 먼저 확정한다.** 작성 전에 전사의 1인칭("저/제")이 누구인지 roster의
   `role: coach` 항목·이름·별칭과 HUD 이름표를 대조해 정한다. 확정되면 문서에서 처음
   나올 때 명단 이름으로 밝히고, 이후 "코치"를 그 이름과 다른 사람처럼 읽히게 쓰지
   않는다.
3. **ASR 토큰을 새 인물로 만들지 않는다.** roster의 `name`/`gamertag`/`aliases`에
   없고 "~님" 호칭 없이 전술 용어처럼 쓰인 단어는 사람으로 취급하지 않는다(임의로
   "님"을 붙이지 않는다). 누구인지 불확실하면 "공을 가진 선수"처럼 쓴다.
4. **원문에 없는 지시·인과 설명을 지어내지 않는다.** 전사가 손상됐거나 구체적 지시가
   없으면 확인된 관찰만 쓴다. "그래야 공간이 열린다" 류의 전술 원리를 원문 근거
   없이 보태지 않는다.
5. **유닛 경계를 넘어 내용을 가져오지 않는다.** 제목·요약·문장은 그 유닛의
   `start_line..end_line` 안 원문만 근거로 삼는다. 인접 줄은 생략된 주어·대명사를
   확인할 때만 참고한다.
6. **캡션은 프레임을 다시 열어 확인한다.** 인물·위치·표식 개수·화면 위/아래·좌/우를
   그 프레임에서 확인한다. 화살표는 코치가 그린 경로 표시이지 실제 이동의 증거가
   아니며, 정지 사진만으로 패스 완료·추격·결과를 단정하지 않는다.

## 스크립트가 만들고 LLM은 읽기만 하는 파일

| 파일 | 요지 |
|---|---|
| `session.json` | `fetch`가 씀. `videos[]`마다 `id`(VID), `part`(URL 순서 1..N), `title`, `channel`, `upload_date`(YYYYMMDD), `duration`, `embeddable`, `width`/`height`(480p 스트림), `files{audio,video,captions,captions_format,wav}`. |
| `lines.json` | `transcribe`가 씀. `[{i, video, start, end, text}]` — `i`는 0부터 연속, video는 파트 순서로 그룹, 그룹 안에서 `start` 오름차순, `0 ≤ start < end ≤ duration+1`, `text` 비어있지 않음. **LLM은 `i`(줄 인덱스)만 고르고 초 단위 시간은 절대 직접 쓰지 않는다** — plan.json의 `start_line`/`end_line`이 이 `i`를 가리키면 스크립트가 초로 변환한다. |
| `candidates.json` | `scan`(+수동 `add-frame`)이 씀. `[{id(c###), video, t, kind: silence\|scene\|interval\|manual, dur?}]`, video별 그룹·`t` 오름차순. 미리보기는 `cand/<id>.jpg`. |
| `sheets.json` | `scan`이 씀. `{version, sheets:[{file, video, kind: hud\|grid, cols, rows, times[]}]}` — HUD 시트는 경기 시계/스코어 판독용, grid 시트는 장면 훑어보기용. |
| `similar-candidates.json` | `similar`이 씀. `{version, session_id, units:{u001:[{uid,score,title,date,topic_tags,position_tags}]}}` — Jaccard 기반 점수 desc, disabled/과거 세션 없음이면 `units: {}`. |
| `refs.verified.json` | `verify-refs`가 씀. `refs-draft.json` + `id(r-<sha256[0:10]>)`, 정규화된 `url`, `final_url`, `http_status`, `checked_at`, `reused`, `page`(ko면 null), `dropped[]`. |
| `data.json` (`sessions/<sid>/`) | `render`가 씀. 뷰어가 읽는 최종 데이터 — `units[].body`가 notes v2 `blocks`를 `{type:"text",text}` 또는 `{type:"frame",src,width,height,t,caption}`로 옮긴 것(구 `note`/`images.key` 필드는 v2에서 폐지). |

## 설정/명단(사람이 준비, 스크립트가 파싱)

| 파일 | 요지 |
|---|---|
| `manifest.yaml` (`~/.fc-feedback/<projectKey>/`) | `{version:1, project, mode: unconfigured\|disabled\|configured}` — configured면 `archive_repo_path`(절대경로, git toplevel)·`roster_path`·`pages_base_url`(https, `/`로 끝) 전부 필수. `fc config set/disable`로만 바뀜, 직접 편집 금지. |
| `roster.yaml` | `{members:[{id(멤버 id 패턴), name, gamertag(유일, 대소문자 무시), positions(≥1, 트리에 존재, 첫 값=주포지션), aliases?, role?:"coach"}]}`, member ≥1. |
| `taxonomy.yaml` | `{version:1, topics:[유일하고 유효한 태그]}`. `taxonomy add`만 추가하고 직접 편집하지 않는다. |
