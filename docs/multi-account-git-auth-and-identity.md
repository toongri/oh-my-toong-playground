# 한 머신에서 GitHub 계정 여러 개 — org별 인증·커밋신원 라우팅

> 개인 계정과 회사 계정처럼 GitHub 계정이 둘 이상인 머신에서, 저장소의 **org 경로**를 기준으로 push/fetch 인증 계정과 커밋 저자(author) 신원을 자동으로 갈라주는 설정 매뉴얼. 로컬 폴더 위치가 아니라 원격 URL로 매칭하므로, 저장소를 어디에 clone하든 동작한다.

---

## 0. 가장 중요한 한 가지 — 두 축은 별개다

혼동의 근원. 아래 둘은 **완전히 다른 메커니즘**이며 따로 설정한다.

| 축 | 무엇 | 설정 키 | 매칭 기준 |
|---|---|---|---|
| **인증(auth)** | 서버에 **누구로 로그인해** push/fetch 하는가 (토큰) | `credential.<url>.*` | 원격 URL(호스트+org 경로) |
| **커밋 신원(identity)** | 커밋 오브젝트에 박히는 **author** (`user.name`/`user.email`) | `user.*` + `includeIf` | 원격 URL 또는 디렉터리 |

- 인증 핀을 걸어도 커밋 저자는 안 바뀐다. 반대도 마찬가지.
- 잘못된 계정으로 **인증**하면 비공개 저장소는 `404 "Repository not found"` — GitHub는 권한 없음을 저장소 존재 여부로 노출하지 않으려 404를 준다. "없다"가 아니라 "네 토큰엔 안 보인다"는 뜻.
- 잘못된 **신원**으로 커밋하면 push는 되지만 커밋 저자가 엉뚱한 이메일로 남는다(회사 커밋이 개인 이메일로, 혹은 그 반대).

---

## 1. 인증 — `credential.<url>` (org-URL 기준)

git은 자격증명이 필요하면 등록된 credential helper를 **순서대로** 실행하고, `username`/`password`를 처음 내놓는 helper의 값을 쓴다. helper는 그저 그 두 줄을 stdout에 출력하는 프로그램일 뿐이다.

```
username=...
password=<토큰>
```

GitHub는 password 자리에 **OAuth 토큰/PAT**를 받고, **토큰 자체가 어느 계정인지 결정**한다. 원격 URL엔 계정 정보가 없다. 즉 *같은 URL, 다른 토큰 = 다른 계정*.

### 함정 — `gh auth git-credential`은 한 호스트에 한 계정만 준다

`gh`는 계정 개념이 둘로 갈린다:

- **일반 active** (`gh auth status`의 `Active account`) — `gh` CLI 명령의 기본 계정
- **git-active** — `gh auth git-credential`이 git에 내주는 계정

`gh auth git-credential get`은 **git-active 계정(또는 그와 일치하는 username)만** 내주고, 나머지 계정을 요청하면 `exit 1`로 **거부**한다. 그래서 `!gh auth git-credential` helper로는 **같은 github.com을 두 계정으로 가를 수 없다**. active를 바꾸면 반대쪽이 깨진다.

### 해법 — 계정명으로 토큰을 직접 뽑는 helper

`gh auth token --user <계정>`은 active와 무관하게 그 계정 토큰을 keyring에서 꺼낸다. 이걸 helper로 쓰면 계정별로 결정적이다.

```bash
# 기본(개인) → toongri
git config --global --add credential.https://github.com.helper ''
git config --global --add credential.https://github.com.helper \
  '!f() { test "$1" = get && printf "username=toongri\npassword=%s\n" "$(gh auth token --user toongri)"; }; f'
git config --global credential.https://github.com.username toongri

# 회사 org override → toong-algocare
git config --global --add credential.https://github.com/algo-care.helper ''
git config --global --add credential.https://github.com/algo-care.helper \
  '!f() { test "$1" = get && printf "username=toong-algocare\npassword=%s\n" "$(gh auth token --user toong-algocare)"; }; f'
git config --global credential.https://github.com/algo-care.username toong-algocare
```

### helper 목록 우선순위와 리셋 `""` — 이게 핵심

한 요청에 매칭되는 `credential.<url>` 섹션은 **여러 개가 파일 순서대로 전부** 적용되고, helper는 **누적(list)** 된다. `algo-care` 요청은 host 섹션과 algo-care 섹션에 **둘 다** 매칭된다.

- helper 값 `''`(빈 문자열)은 그 지점에서 **누적 목록을 리셋**한다.
- host 섹션이 파일에서 먼저 오므로, algo-care 섹션은 **반드시 맨 앞에 `''` 리셋**을 둬야 host의 toongri helper가 목록에 섞여 먼저 응답해버리는 것을 막는다.

```
algo-care 요청 처리:
  host 섹션:      list=[] → (리셋) → [toongri-helper]
  algo-care 섹션: [toongri-helper] → (리셋 '') → [] → [toong-algocare-helper]   ← 리셋 없으면 toongri가 먼저 이김
  결과: toong-algocare
```

기존에 다른 helper(osxkeychain, `gh auth setup-git`이 심은 `!gh auth git-credential`)가 먼저 응답하는 것을 오버라이드하려면, 일회성으로도 `-c credential.helper=`(빈값)으로 목록을 리셋한 뒤 원하는 helper를 넣는다:

```bash
git -c credential.helper= \
    -c credential.helper='!f() { echo username=toong-algocare; echo "password=$(gh auth token --user toong-algocare)"; }; f' \
    fetch origin
```

---

## 2. 커밋 신원 — `includeIf hasconfig` (org-URL 기준, git 2.36+)

커밋 저자는 URL이 아니라 `user.name`/`user.email`로 정해진다. 이걸 org별로 가르는 방법은 두 가지:

- `includeIf "gitdir:<경로>"` — **디렉터리 위치** 기준. 저장소들이 공통 부모 폴더 아래 있을 때.
- `includeIf "hasconfig:remote.*.url:<패턴>"` — **원격 URL** 기준(git 2.36+). 인증과 같은 org-URL 기준이라 일관적이고, 저장소가 흩어져 있어도 커버된다. **권장.**

```bash
# work 신원을 별도 파일로
mkdir -p ~/.config/git
cat > ~/.config/git/identity-algocare <<'EOF'
[user]
	name = toong-algocare
	email = <회사-이메일>          # 예: you@company.com
EOF

# 전역 기본 신원 → 개인
git config --global user.name toongri
git config --global user.email 37677423+toongri@users.noreply.github.com

# algo-care org 원격이면 work 신원 로드 (전역 [user]보다 파일에서 뒤에 와야 덮어씀)
git config --global \
  includeIf.'hasconfig:remote.*.url:https://github.com/algo-care/**'.path \
  ~/.config/git/identity-algocare
```

`**` 글롭은 org 아래 모든 저장소(`.../algo-care/algocare-home.git` 등)를 매칭한다. `git init` 직후 remote 추가 전에는 매칭되지 않으니 remote를 먼저 걸어야 한다. SSH(`git@`) 원격을 쓰면 그 패턴용 includeIf를 하나 더 추가한다.

---

## 3. gh active는 CLI 편의용으로만

인증을 위 명시 토큰 helper로 잡으면 git은 gh active와 무관해진다. 그러니 `gh auth switch`는 순수하게 `gh` CLI 명령(예: `gh pr`, `gh repo`)이 어느 계정으로 나갈지를 정하는 용도로만 쓴다.

```bash
gh auth switch --user toongri     # gh CLI 기본을 개인으로
```

---

## 4. 검증 레시피

인증과 신원을 각각 실측한다. 설정만 보고 넘어가지 말 것 — helper 순서·gh 계정 상태 때문에 조용히 어긋난다.

```bash
# (1) 인증: 이 org 경로에서 git이 어떤 계정 토큰을 꺼내는가
resolve () { printf 'protocol=https\nhost=github.com\npath=%s\n\n' "$1" \
  | git credential fill 2>/dev/null | sed -n 's/^password=//p'; }
# gh auth token --user <계정> 결과와 비교
[ "$(resolve algo-care/algocare-home.git)" = "$(gh auth token --user toong-algocare)" ] \
  && echo "auth OK: algo-care → toong-algocare"

# (2) 신원: 각 저장소의 실효 user.email
git -C ~/repos/algocare-home/stage config user.email    # → 회사 이메일
git -C ~/repos/oh-my-toong-playground/main config user.email  # → toongri noreply
```

---

## 5. 이 머신의 최종 상태 (참조)

| org / 저장소 | 인증 계정 | 커밋 이메일 |
|---|---|---|
| `github.com/algo-care/*` (home·backend·app-device·algocd) | `toong-algocare` | 회사 이메일 (`~/.config/git/identity-algocare`) |
| `github.com/toongri/*` (playground·loop-pack 등) | `toongri` | `37677423+toongri@users.noreply.github.com` |
| 그 외 github.com | `toongri`(기본) | `toongri`(기본) |

- 인증: `~/.gitconfig`의 `credential.https://github.com{,/algo-care}` 핀.
- 신원: 전역 `[user]` = toongri + `includeIf hasconfig …/algo-care/**` = work 파일.
- 둘 다 **org-URL 기준**이라 저장소가 `~/repos/` 어디에 있든, worktree든 상관없이 자동 적용된다.
