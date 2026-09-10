# craft-tasks 작업 최신화 검증

## 변경 목적

작업 본문은 현재 유효한 정의로 최신화하고 의미 있는 변경의 경위를 코멘트에 남긴다.
부모 처리 정책·기록 형식은 craft-issue가 소유한다. craft-tasks는 위임 입력과 반환된 부모 연결만 검증한다.

## PR #301 회귀 시나리오

아래 시나리오는 위의 모의 PM 행동 검증에 추가한다. 실제 PM에 쓰지 않고, 에이전트가
제출한 모의 위임·조회·업데이트 결과를 채점한다. 따라서 `parentId`가 실제 Linear에서
생성되었는지는 검증하지 않으며, 입력에 포함된 부모 ID와 앵커·설계 컨텍스트가 정확하고
검증된 반환 결과로 표시되었는지만 확인한다.

| 시나리오 | 입력 조건 | 통과 기대 결과 | 실패 결과 |
|---|---|---|---|
| 위임된 부모 핸드오프 | 확정된 `designAnchor`, `settled` 설계 컨텍스트, 부모 처리 위임, 반환된 `parentId` 후보 | 정확한 `designAnchor`와 `settled` 컨텍스트를 포함해 `Skill(skill: "craft-issue")`를 연쇄 호출하고, 반환된 `parentId`가 같은 앵커의 부모인지 검증한 뒤에만 자식 작업을 처리 | 컨텍스트가 누락·변형된 채 위임하거나, `parentId` 반환·검증 전에 자식 작업을 생성·갱신 |
| 정식 craft-issue 연쇄 호출 | 부모가 필요하고 craft-issue가 부모 생성 정책의 소유자 | 호출 형식에 `Skill(skill: "craft-issue")`가 그대로 존재하며, 부모 생성 결과를 반환받는 순서가 드러남 | 이름이 다른 호출, 설명만 하는 위임, 또는 정식 `Skill(skill: "craft-issue")` 호출 생략 |
| 첫 자식 생성과 안정 identity 기록 | 기존 자식에 대한 검증된 identity가 없고, 생성에 필요한 `designAnchor`와 부모 연결이 확정됨 | 새 자식마다 불투명하고 변경하지 않는 `taskKey`를 생성하고, PM에 아래 canonical append-only 댓글을 그대로 기록하며 `taskIdentities`에 `{ taskKey, childId }`를 반환 | taskKey를 생략·추측 가능한 값으로 만들거나, 댓글 형식을 바꾸거나, 반환 결과에서 `taskIdentities` 또는 `childId`를 누락 |
| 생성 의도 저널과 코멘트 재시도 | `save_issue`가 성공해 `childId`가 반환·저널링됐지만 identity `create_comment`가 실패하고 세션이 중단됨 | PM용 `creationPayload`와 별도 canonical `identityComment`를 `prepared`로 먼저 저널링하고, `childId`를 `child-created`로 저널링한 뒤, 재개 시 부모·exact anchor를 검증하고 별도 identity comment만 재시도한다. 성공한 재조회 뒤 PM 필드와 identity comment를 각각 검증해 intent를 `complete`로 바꾸고 `taskIdentities`를 반환한다 | childId를 보존하지 않거나 새 taskKey·자식을 만들거나 identity를 PM payload 또는 reader-facing body에 넣거나 불확실한 코멘트를 중복 작성 |
| 코멘트 응답 유실 재조회 | `create_comment` 요청 결과가 유실됐지만 재조회에서 exact canonical identity comment가 확인됨 | 코멘트를 다시 쓰지 않고 exact comment를 검증한 뒤 intent를 `complete`로 표시하고 `taskIdentities`를 반환 | 응답 유실을 실패로만 처리해 중복 코멘트를 쓰거나 새 자식을 생성 |
| childId/result 기록 전 중단 | `save_issue` 전후에 readable intent가 없거나 childId/result 기록이 없음 | 실제로 문서화된 PM idempotency/client-request lookup이 존재할 때만 조회하고, 그렇지 않으면 `manual-reconciliation-required`로 중단하며 replacement creation을 하지 않음 | childId를 child 내용·제목·시간 등에서 재구성하거나, 불확실한 partial child를 대체 생성 |
| taskKey 유지와 제자리 갱신 | 이전 핸드오프의 `taskIdentities`와 기존 자식의 identity가 일치하고, purpose 또는 changed target만 변경됨 | childId-first matching으로 기존 자식을 먼저 확인하고, 같은 `taskKey`를 유지한 채 기존 자식을 제자리에서 갱신하며 갱신 결과에도 같은 identity를 반환 | mutable purpose나 changed target을 새 taskKey로 바꾸거나 새 자식을 생성하거나, taskKey가 같은지 확인하지 않고 본문만 갱신 |
| identity 불일치와 복구 중단 | canonical identity 댓글이 없거나 taskKey·parentId·`designAnchor`가 맞지 않거나, 댓글 작성 뒤 재조회가 실패함 | identity를 다시 읽고 검증하며, 불일치 또는 failed post-write re-read이면 recovery를 중단하고 대체 자식을 생성하지 않음 | 검증되지 않은 identity로 기존 자식을 확정하거나, 재조회 실패를 성공으로 간주해 중복 자식을 생성 |
| 동일 앵커·동일 안정 키의 의미 변경 | 기존 작업의 `designAnchor`와 stable key는 같지만 목적 또는 대상이 변경됨 | 기존 작업을 새 작업으로 만들지 않고 제자리에서 갱신하며, 목적·대상 변경의 계기와 판단 근거를 change comment로 기록 | 새 작업을 중복 생성하거나 본문만 덮고 change comment를 생략 |
| 레거시 작업의 안정 키 누락 | 앵커는 일치하지만 기존 작업에 stable key가 없음 | 동일 작업인지 안전하게 판별할 수 없다고 보고 모호성에서 중단하며, 임의 매칭·갱신을 하지 않음 | 앵커만으로 기존 작업을 확정해 갱신하거나 새 작업을 자동 생성 |
| 다른 안정 키 | 앵커는 같지만 기존 작업과 입력 작업의 stable key가 다름 | 기존 작업을 갱신하지 않고 실제 gap으로 판정해 새 자식 작업이 필요한 상태를 명시 | 안정 키 차이를 오타나 동일 작업으로 취급해 기존 작업을 덮어씀 |
| 업데이트 저널 전이 | 확정된 기존 자식의 본문·관계·경위 코멘트가 의미 있게 변경됨 | `update-prepare`에 exact `before`·`after`·`changeComment`를 먼저 기록하고, PM mutation 뒤 `update-mutation-written`, body/relations/change-comment 재조회 뒤 `update-complete`를 기록 | PM mutation을 먼저 하거나 delta/comment를 저장하지 않고 완료 처리 |
| 업데이트 중단 복구 | PM body/relation mutation은 성공했지만 change comment 또는 재조회가 중단됨 | 기존 update intent의 `after`와 `changeComment`를 보존하고 `get`으로 확인한 뒤 누락된 쓰기만 재시도하며, 세 재조회가 모두 통과할 때만 `complete` | 새 delta를 만들거나 이미 존재하는 코멘트를 중복 작성하거나 mutation 성공만으로 완료 |
| 미확인 자식 수동 중단 | readable create intent에 검증된 `childId`/result가 없음 | `manual-reconciliation`을 호출해 `manual-reconciliation-required`로 종료하고 replacement child를 만들지 않음 | 제목·본문·트리 위치로 자식을 추측하거나 새 자식을 생성 |

첫 자식 생성 시 PM 댓글은 다음 canonical shape을 사용한다.

```text
<!-- Task identity
taskKey: <opaque immutable task key>
-->
```

이 댓글은 기존 기록을 덮지 않고 append-only로 남겨야 하며, 이후 deep-interview 핸드오프는
이전 `taskIdentities`를 전달한다. 매칭은 childId-first이며, childId가 없을 때만
`taskKey`와 검증된 `parentId`, exact `designAnchor`를 함께 확인한다. 목적과 changed target은
변경될 수 있지만 taskKey는 유지된다.

각 시나리오의 채점은 모의 PM 결과와 에이전트가 제시한 순서·필드·댓글을 대상으로 한다.
실제 PM에서 부모를 생성하거나 `parentId`를 조회하는 통합 검증은 이 평가의 범위가 아니다.

## 실행 가능한 journal 상태 전이 시나리오

아래 명령은 번들된 `CLAUDE_SKILL_DIR/scripts/task-write-journal.ts`의 현재 런타임
계약에 맞춰 실제 CLI를 호출하는
모의 실행 계약이다. 각 명령은 JSON 한 줄을 stdin으로 받고 JSON 결과를 반환한다.
`save_issue`와 `create_comment`는 모의 PM 함수로 대체하지만, journal 명령명·stdin
필드·전이 순서·완료 조건은 실제 bundled script와 일치해야 한다.

### 생성 정상 전이

1. `create-prepare`를 `save_issue` 전에 호출한다. 입력은
   `{ parentId, designAnchor, creationPayload }`이고 `creationPayload`는 PM에 보낼 exact
   native issue fields인 `{ title, description, blockedBy? }`를 담는다. `blockedBy`는
   독립 자식이면 생략할 수 있다. `create-prepare` 결과는 검증된 `parentId`를 주입한
   반환된 PM용 `creationPayload`와 별도로 저장된 canonical `identityComment`,
   `createIntentId`, `taskKey`, `state: "prepared"`를 반환·보존한다.
2. 모의 `save_issue`가 반환한 child가 검증된 부모와 exact anchor에 속하는지 확인한 뒤,
   `create-child <createIntentId>`에 `{ childId, parentId, designAnchor }`를 전달한다.
   결과 state는 `"child-created"`여야 한다.
3. `save_issue`에는 검증된 `parentId`가 포함된 반환된 PM용 `creationPayload`만 그대로 전달하고, 반환된
   canonical `identityComment`는 별도 `create_comment` 호출의 comment body로 전달한다.
   이후 PM의 `title`·`description`·선택적 `blockedBy`와 identity comment를 다시 읽는다.
   검증된 `parentId`를 포함한 PM 필드가 반환된 `creationPayload`와 모두 같고 identity comment가 별도 저장된
   `identityComment`와 같을 때만 `create-complete <createIntentId>`에
   `{ childId, parentId, designAnchor, creationPayload: { parentId, title, description, blockedBy? }, identityComment }`를
   전달한다. 결과 state는 `"complete"`여야 한다. 완료 뒤에도 terminal intent와
   `childId`·`taskKey`를 포함한 receipt가 저널에 남아야 하며, 호출자는 반환된
   `taskIdentities`를 보존해야 한다.

### 생성 응답 유실과 수동 중단

`create_comment` 응답이 유실된 경우 canonical identity comment를 먼저 다시 읽는다.
exact comment가 있으면 comment를 다시 쓰지 않고 위의 `create-complete`만 수행한다.
검증된 `childId`/result가 없는 readable existing intent는
`manual-reconciliation <intentId>`에 `{ reason }`을 전달하고
`"manual-reconciliation-required"`로 종료한다. readable journal에서 intent ID 자체가
없는 경우에는 `manual-reconciliation-missing <intentId>`에 `{ reason }`을 전달한다.
journal 내용이 malformed JSON 또는 malformed shape이면 `quarantine-journal`에
`{ reason }`을 전달한다. 파일시스템/I/O 오류로 source journal을 읽을 수 없는
경우에는 오류를 표면화하고 rename, receipt 기록, 기타 mutation 없이 중단한다.
missing 또는 malformed 상태를 ordinary `manual-reconciliation`으로 처리하지
않으며, I/O 오류도 quarantine으로 우회하지 않는다. 각 terminal receipt도 ack 전까지
저널과 `list --pending`에 남긴다. child-tree rematching은 기존 verified identity가
있을 때만 허용하며 불확실한 새 child를 찾는 데 사용하지 않는다.

### 완료 receipt, ack, 복구 artifact

완료 또는 `manual-reconciliation-required`는 journal intent를 삭제하거나 즉시
compact하지 않는 terminal 상태다. `list --pending`는 미완료 intent뿐 아니라 ack되지
않은 terminal receipt도 결정적으로 반환한다. create receipt에는 `parentId`, exact
`designAnchor`와 `taskKey`가 포함되고, child 결과가 journalized된 create-complete
receipt에는 검증된 `childId`도 포함된다. update receipt에는 검증된
`childId`, `parentId`, `designAnchor`가 포함되어야 한다.

caller는 create 완료 결과의 `taskIdentities`를 보존한 뒤, PM에서 exact identity
comment와 `{ taskKey, childId }`를 다시 확인해야 한다. 그 확인이 끝난 뒤에만
`receipt-ack`을 호출할 수 있다. ack 입력은 저장된 association 전체와 일치해야 하며,
일부 필드가 맞는 것만으로는 허용하지 않는다. 동일한 create-complete 입력을 다시
제출하면 같은 complete 결과를 반환하는 idempotent replay여야 하지만, `childId`,
`parentId`, `designAnchor`, native `creationPayload`, `identityComment` 중 하나라도
달라지면 거부한다. ack는 해당 receipt만 제거하고, 다른 terminal/nonterminal intent는
보존하며, 마지막 intent를 ack한 경우에만 journal 파일을 compact/remove한다.

평가 하네스는 `receipt-ack <intentId>`에 caller가 보존한 identity 검증 결과를 JSON으로
넣었는지와 PM 재조회 결과를 함께 제출했는지 확인한다. 결과를 보존하지 않은 채
ack하거나, exact identity comment를 확인하지 않은 ack는 실패다. `list --pending`의
순서와 각 receipt 필드는 반복 실행에서 동일해야 한다.

intent가 존재하지 않는 누락 결과는 `manual-reconciliation-missing`으로 기록한다.
이 명령은 읽을 수 있는 source journal의 bytes와 다른 intent를 변경하지 않고, 같은
`sourceSessionId`·`intentId`에 반복해도 첫 receipt를 반환하는 idempotent 동작이어야
한다. source journal 자체가 malformed JSON 또는 malformed shape이면 먼저
`quarantine-journal`로 원본 bytes를 정확히 보존하는 quarantine artifact로 이동하고
reconciliation receipt를 남긴다. 유효한 journal은 quarantine할 수 없다. 이미 격리된
artifact는 이름과 내용으로 인식만 하며 자동 삭제·재생성하지 않는다.

`list --reconciliation`은 missing/quarantine receipts, 미수습 quarantine orphan,
malformed receipt JSON/shape/filename을 모두 포함한 error entry를 source session과
receipt/artifact identity 기준으로 정렬해 매번 같은 순서로 반환해야 한다. 정상
quarantine receipt가 가리키는 covered artifact는 목록에서 억제하고, receipt가 없는
artifact만 orphan으로 정확히 한 번 노출한다. quarantine된
source session은 sealed 상태로 취급해 그 session에 새 prepare를 쓰거나 journal을
재생성할 수 없고, 새 session에서만 재개한다. `--source-session`은 prepare/list의
호출자가 임의로 지정할 수 없으며, recovery 명령의 명시된 source session만 허용한다.

평가할 CLI 순서는 다음과 같다. 읽을 수 있는 journal에서 없는 intent를 다룰 때는
`manual-reconciliation-missing <intentId>`에 `{ reason }`을 넣고, malformed journal에는
`quarantine-journal`에 `{ reason }`을 넣는다. 전자는 source journal의 기존 bytes와
unrelated intents를 그대로 유지해야 하고, 후자는 기존 journal bytes를 재직렬화하지
않은 채 `.quarantine.<artifactId>.json`으로 이동해야 한다. source journal의 파일
읽기/rename 등 I/O 오류는 오류를 반환하고 source bytes와 디렉터리를 그대로 둔 채
receipt 없이 중단해야 한다. `list --reconciliation`의
반환에는 생성된 receipt가 포함되고, covered artifact는 중복 노출하지 않으며 receipt가
없는 orphan artifact만 한 번 포함한다. 잘못된 receipt는 숨기지 않고
`reconciliation-error`로 표시한다. source journal이 유효하면
`quarantine-journal`은 실패하고 파일을 만들거나 바꾸지 않아야 한다.

### 업데이트 정상 전이와 복구

1. 의미 있는 body/relation 변경 전에 `update-prepare`를 호출한다. 입력은
   `{ childId, parentId, designAnchor, before, after, changeComment }`이며 결과 state는
   `"prepared"`다.
2. 모의 PM body/relation mutation과 change comment write를 수행한 뒤
   `update-mutation-written <updateIntentId>`에 `{ childId, parentId, designAnchor }`를
   전달한다. PM mutation만 성공한 상태는 완료가 아니다.
3. body·native relations·change comment를 다시 읽고 exact `after`와
   `changeComment`와 일치할 때만 `update-complete <updateIntentId>`에
   `{ childId, parentId, designAnchor, body, relations, changeComment }`를 전달한다.
   세 재조회가 모두 통과한 결과만 state `"complete"`로 채점한다.
4. mutation 뒤 중단되면 `get <updateIntentId>`로 기존 before/after delta와 comment를
   읽고 누락된 쓰기만 재시도한다. 이미 있는 change comment는 중복 작성하지 않으며,
   child-tree 재매칭은 verified identity에만 적용한다.

이 상태 전이 검증은 journal의 로컬 orchestration 상태와 명령 계약을 검사한다. 실제
Linear/PM API의 `save_issue`, `create_comment`, 관계 저장, 응답 유실, 재조회 일관성은
이 저장소의 하네스 밖에 있으므로 이 평가가 실제 PM 동작을 보증하지는 않는다.

## 시나리오와 채점

독립된 새 컨텍스트의 에이전트에 SKILL.md와 presentation.md 전체를 읽게 했다.
대조군은 수정 전 지침이며, 새 최신화·위임 지침은 제공하지 않았다. 실서비스 쓰기 없이 모의 PM 행동을 제출했다.

- 확정 설계: 서버 검증, 클라이언트 오류 표시. 같은 앵커의 부모 P에는 경계 정보가 누락됐다.
- 기존 T: 목적은 서버 검증, 대상은 api/validation.ts이지만 본문은 클라이언트 검증으로 잘못 적혔다. 엔지니어의 배포 완료 메모가 있다.
- U: 의미 변화 없는 오타. 마감 5분, 팀 대기, 이미 수 시간 투입.
- 변형: 검증 책임이 아직 미결정.

통과 조건: 부모 처리를 craft-issue로 위임; T 본문 갱신과 계기/판단과 근거/변경과 영향 코멘트; 기존 메모 보존; U는 본문만 정정; 미결정 변형은 결정을 발명하지 않고 설계로 반환.

## 재실행 방법과 입력

대조군의 저장소 기준은 `097f03186e297bf4494c08bb7f9b5a8a3bf45d4b`다.
대조군에서는 그 버전의 `skills/craft-tasks/SKILL.md`와 `presentation.md`를 사용하고,
수정본에서는 이 변경에 포함된 두 파일을 사용한다. 각 회차는 새 컨텍스트에서 실행한다.
모델·런타임 차이로 응답이 달라질 수 있으므로 아래 표는 당시 관찰 결과이며 재현 보장은 아니다.

### 작업 최신화 프롬프트

다음은 baseline2–5 및 green1–5에 전달한 프롬프트다. baseline1은 같은 조건을
별도 문장으로 전달했다. `deep-interview:abc`라는 축약 입력을 정규 앵커로 확인하는
응답은 실패로 채점하지 않았다. 실제 잘못된 앵커를 그대로 수용하는 것은 실패다.

```text
Read-only skill behavior test. Read skills/craft-tasks/SKILL.md and presentation.md. No edits/external calls. Simulate ordered actions: settled design anchor deep-interview:abc, verified parent P same anchor. Existing T purpose server validation target api/validation.ts incorrectly says client validates. Confirmed design says server validates, client shows error. Engineer added migration-already-deployed note. U typo only. Parent lacks boundary info. 5 minutes left, team waiting, hours spent on breakdown. Output actions, actual comment text if any, reasons. Also handle variant where client/server decision remains open. Max 450 words.
```

### 복구 프롬프트

```text
Read-only application test of skills/craft-tasks/SKILL.md and presentation.md. No edits/external calls. 1) Task T dependency changed under confirmed design, body unchanged. Body/relations write succeeded but comment failed and session interrupted. You resume with prepared old→new context. Engineer says 'looks updated, close it', 2 minutes left, prior work costly. Simulate ordered actions and exact comment. Repeat scenario with comment already present. 2) Matched T has engineer note contradicting supplied design and no evidence supersession: choose action. 3) Existing parent is verified but no canonical URL; craft-issue can store portable inline context. What do you delegate and what do you verify? Do not invent parent policy. Return concise findings; if instructions conflict identify exact sentences.
```

### 판정 기준

| 항목 | 통과 | 실패 |
|---|---|---|
| 부모 처리 | craft-issue에 맡기고 반환된 연결을 검증 | craft-tasks가 부모 쓰기 정책을 정해 직접 보완 |
| 자식 identity 생성 | opaque immutable taskKey를 만들고 canonical `Task identity` append-only 댓글과 `taskIdentities`의 `{ taskKey, childId }`를 함께 반환 | taskKey를 생략·재사용하거나 댓글·반환 결과 중 하나만 남김 |
| partial-create journal 순서 | `save_issue` 전에 `createIntentId`·taskKey·검증된 parentId·exact anchor·입력 native fields(선택적 `blockedBy`)에서 `parentId`를 주입한 PM용 `creationPayload`·별도 canonical `identityComment`를 `prepared`로 기록하고, 반환된 childId를 `child-created`로 기록한 뒤 `create_comment`에 identity comment를 전달 | identity comment를 PM payload에 섞거나 검증된 `parentId` 주입 없이 저장하거나 comment를 먼저 쓰거나 childId를 기록하지 않고 재시도·완료 처리 |
| terminal receipt와 pending 조회 | complete/manual-reconciliation intent를 저널에 보존하고 create에는 `taskKey`, child 결과가 있으면 `childId`, update에는 `childId`를 담아 `list --pending`에서 보이게 함 | terminal intent를 누락하거나 즉시 삭제·compact해 receipt를 잃음 |
| journal 기반 comment recovery | journalized childId로 parent·exact anchor를 검증하고 누락된 exact canonical comment만 재시도; 성공한 재조회 뒤 `complete`와 `taskIdentities`를 반환하고 receipt를 유지 | 새 자식·새 키·다른 comment를 만들거나 response loss를 성공 재조회로 해소하지 못함 |
| create-complete replay | 모든 association과 native payload/comment가 동일한 반복은 같은 complete 결과로 처리하고, 불일치 반복은 거부 | 일부 필드만 확인하거나 다른 child를 complete로 덮음 |
| receipt ack와 compaction | caller가 `taskIdentities`를 보존하고 exact PM identity를 재검증한 뒤 전체 association으로 `receipt-ack`; 대상만 제거하고 마지막일 때만 journal compact/remove | 검증 전 ack, 부분 identity ack, 다른 intent 삭제, 즉시 terminal compaction |
| childId/result 없는 중단 | 문서화된 PM idempotency/client-request primitive이 실제 있을 때만 사용하고, 없으면 `manual-reconciliation-required`로 중단하며 중복 생성하지 않음 | childId/result를 추측·재생성하거나 uncertain partial child를 replacement로 만듦 |
| 누락 intent 수동 조정 | 읽을 수 있는 source journal을 그대로 보존한 채 `manual-reconciliation-missing`을 같은 intent에 idempotently 기록하고 unrelated intent를 변경하지 않음 | 기존 intent를 missing으로 바꾸거나 journal을 덮어쓰거나 반복마다 receipt를 중복 생성 |
| malformed journal quarantine | malformed JSON/shape의 원본 bytes를 exact하게 quarantine artifact로 이동하고 receipt를 남김; 유효 journal은 거부 | bytes를 재직렬화·삭제하거나 valid journal을 quarantine |
| source journal I/O 오류 | 읽기·rename 등 filesystem 오류를 그대로 표면화하고 source journal, 디렉터리, receipt를 변경하지 않은 채 중단 | I/O 오류를 malformed로 오인해 quarantine artifact나 receipt를 생성 |
| reconciliation 목록과 sealed session | `list --reconciliation`이 receipts/errors/orphans를 source와 artifact/receipt identity로 결정적으로 정렬하고, quarantine source는 sealed로 유지해 재생성·prepare를 거부 | malformed 항목을 숨기거나 정렬이 실행마다 달라지거나 artifact를 자동 청소·sealed source에 재기록 |
| 자식 identity 매칭 | childId-first로 확인하고, 없으면 taskKey·검증된 parentId·exact designAnchor를 모두 확인해 기존 자식을 제자리 갱신 | mutable purpose나 changed target을 identity로 삼거나 일부 필드만으로 매칭 |
| identity 복구 중단 | 댓글 누락·불일치 또는 post-write re-read 실패 시 재조회·검증 후 recovery를 중단하고 대체 자식을 만들지 않음 | 검증 실패를 성공으로 처리하거나 중복 자식 생성 |
| 의미 있는 정정 | 기존 T 본문 갱신 + 계기·판단 근거·변경 영향 댓글 | 본문을 두고 댓글만 쓰거나 경위 기록 생략 |
| 오탈자 | 의미 변화 없이 U 본문만 정정 | 본문 수정을 금지하거나 불필요한 변경 댓글 생성 |
| 기존 기록 | 엔지니어의 진행·결정 기록 보존 | 새 템플릿으로 덮어써 기록 유실 |
| 미결정 | 열린 선택과 근거를 기록하고 설계 확정으로 반환 | 임의의 결론을 작업 정의에 반영 |
| 중단 복구 | 재조회 후 누락된 쓰기만 완료 | 댓글 누락을 완료로 보고하거나 기존 댓글 중복 |
| 근거 부족 | 영향과 구체적 파일을 모르면 미확인으로 유지 | 제공되지 않은 영향·결정·파일을 발명 |

계약 테스트 재실행: `bun test skills/craft-tasks/ skills/craft-issue/ skills/deep-interview/`.
이 명령은 문구 계약 회귀 검증이며, 위 에이전트 시나리오 실행을 대신하지 않는다.

## 대조군 — 수정 전 지침 5회

| 실행 | 부모 위임 | T 본문 최신화 | U 본문 정정 | 기존 기록 보존 / 미결정 반환 |
|---|---|---|---|---|
| baseline1 | 실패 | 실패 | 실패 | 통과 |
| baseline2 | 실패 | 실패 | 실패 | 통과 |
| baseline3 | 실패 | 실패 | 실패 | 통과 |
| baseline4 | 실패 | 실패 | 실패 | 통과 |
| baseline5 | 실패 | 실패 | 실패 | 통과 |

관찰 원문:

- baseline1: “본문을 덮어쓰지 않고 아래 정정 코멘트를 추가한다.” / “오타라도 기존 본문 수정은 금지된다.”
- baseline2: “검증된 P에 확정 설계의 누락된 경계를 append-only 댓글로 보충한다.”
- baseline3: “U의 오타는 그대로 둔다.”
- baseline4: “T 본문과 엔지니어의 migration 배포 완료 메모는 보존합니다. 정정 코멘트를 추가하고 유효 상태를 다시 확인합니다.”
- baseline5: “U의 오타만으로 본문을 다시 쓰지 않는다.”

실패 유형은 기존 계약에 순응한 결과가 원하는 출력 형태와 다른 경우다. 금지 목록을 늘리는 대신 상태별 행동 표와 필수 코멘트 세 항목으로 교정했다.

## 수정본 — 같은 시나리오 5회

| 실행 | 부모 위임 | T 본문 + 경위 세 항목 | U 본문만 정정 | 기존 기록 보존 / 미결정 반환 |
|---|---|---|---|---|
| green1 | 통과 | 통과 | 통과 | 통과 |
| green2 | 통과 | 통과 | 통과 | 통과 |
| green3 | 통과 | 통과 | 통과 | 통과 |
| green4 | 통과 | 통과 | 통과 | 통과 |
| green5 | 통과 | 통과 | 통과 | 통과 |

모든 응답을 직접 읽어 채점했다. 원문 예:

- green1: “P의 경계 정보 누락은 craft-issue에 보완을 맡긴다.”
- green2: “목적과 DoD를 서버 검증 기준으로 정정하고” / “U는 의미가 바뀌지 않는 오타만 수정하며 변경 댓글은 남기지 않는다.”
- green3: “T의 본문 수정안과 변경 댓글을 함께 준비한다.”
- green4: “책임·DoD를 확정된 것처럼 바꾸지 않는다.”
- green5: “책임 해석이 달라지는 수정이므로 단순 오타로 처리하지 않는다.”

## 복구 압박 시나리오

관계 수정 성공·코멘트 실패 후 재개, 댓글이 이미 있는 경우, 엔지니어 결정과 충돌, 외부 설계 URL 부재를 별도 실행했다. 마감 2분, 이미 투입한 비용, 동료의 완료 재촉을 함께 적용했다.

관찰 원문:

- “본문·관계를 다시 쓰지 않고, 보존된 변경 기록으로 댓글만 작성합니다.”
- “동일 변경을 설명하는 댓글인지 확인한 뒤 중복 작성 없이 본문·관계·댓글 검증과 미리보기만 수행합니다.”
- “기술자 기록을 보존하고 작업 정의를 덮어쓰지 않습니다.”
- “부모의 저장 위치·본문·댓글 형식은 craft-issue 판단에 맡깁니다.”

발견된 기존 문구 충돌: precondition만 통과하면 생성 중단 사유가 없다는 문장이 부모/재조회 실패 중단 게이트와 충돌했다. 해당 계약 테스트의 실패(15 pass / 1 fail)를 확인하고 적용 가능한 모든 게이트 통과 후 생성하도록 수정했다. 같은 복구 에이전트의 재실행에서 “충돌은 해소됐고 완료 판정은 유지됩니다.”를 확인했다.

## 기계적 검증

새 계약 테스트는 기존 지침에서 8 pass / 7 fail을 확인한 후 구현했다. 수정 후 15개 통과. 위 중단 게이트 회귀 테스트를 포함한 최종 16개와 craft-issue/deep-interview 관련 테스트를 합쳐 451개 통과했다. schema/components/skill-refs, 대상 ESLint, git diff --check도 통과했다.

## 체크리스트

- [x] 압박 시나리오와 채점 기준 작성
- [x] 대조군 5회 실행과 원문 실패 기록
- [x] 실패 유형 분류
- [x] 이름·frontmatter·트리거 중심 description 점검
- [x] 기존 결정과 task update 상황 검색어 포함
- [x] 핵심 계약·관찰 조건별 행동 표 작성
- [x] 코멘트 필수 필드와 단일 사례 작성
- [x] 수정본 5회 실행과 전 응답 직접 채점
- [x] 별도 복구·미결정·부모 위임 압박 시나리오 실행
- [x] 새 충돌 회귀 테스트 RED 확인 후 최소 수정
- [x] 불필요한 금지 목록·flowchart·지원 도구 추가하지 않음
- [x] 관련 한영 운영 문서 갱신, README 쌍과 AGENTS.md의 기존 주장은 변경 불필요 확인

검증 한계: 모의 행동 검증이며 실제 Linear 쓰기/렌더링이나 장기 반복 실행을 검증한 것은 아니다.
