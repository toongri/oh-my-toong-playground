한국어 | [English](PRIVATE-FORK-MANAGEMENT.en.md)

# 프라이빗 포크 관리 가이드

> 공개 OSS 업스트림을 미러링하고 upstream/main을 지속적으로 동기화하는 프라이빗 GitHub 저장소 설정 및 유지 관리를 위한 운영 매뉴얼. 이 가이드는 이미 프라이빗 포크 운영을 결정한 독자를 대상으로 하며, 운영 방법을 다룬다 — 운영 여부 판단은 다루지 않는다.

---

## 1. 부트스트랩 (최초 1회)

### 사전 확인

```bash
git lfs ls-files                   # LFS 오브젝트 탐지
cat .gitmodules 2>/dev/null        # 서브모듈 탐지
find . -size +100M                 # 대용량 파일 스캔
```

### 표준 미러 푸시

**전제 조건 (보안상 필수)**: `git push --mirror` 실행 전, 새 프라이빗 저장소의 Actions를 모두 비활성화한다 (Settings → Actions → "Disable Actions"). 미러 푸시 시 `.github/workflows/`가 업로드되고, 푸시 자체가 `on: push` 워크플로를 트리거하여 기존 시크릿 이름이 일치할 경우 npm/Docker/Slack 등으로 외부 배포가 발생할 수 있다. 섹션 5 감사 완료 후 선택적으로 재활성화한다.

```bash
git clone --bare https://github.com/<upstream-org>/<repo>.git
cd <repo>.git
git push --mirror https://github.com/<your-org>/<private-repo>.git
cd .. && rm -rf <repo>.git
```

### LFS 마이그레이션 (해당 시)

`git push --mirror`는 LFS 오브젝트를 전송하지 않는다. 별도로 수행해야 한다:

```bash
git clone --mirror https://github.com/<upstream-org>/<repo>.git
cd <repo>.git
git lfs fetch --all
git remote set-url origin https://github.com/<your-org>/<private-repo>.git
git lfs push --all origin
```

### 서브모듈 마이그레이션 (해당 시)

`--bare`/`--mirror`는 서브모듈을 재귀적으로 처리하지 않는다. 서브모듈별로 다음을 수행한다:

1. 해당 서브모듈도 자체 프라이빗 저장소로 미러링한다 (베어 클론 + 미러 푸시 반복).
2. 워킹 클론 이후 `.gitmodules` URL을 직접 수정하거나 다음 명령을 활용한다:
   ```bash
   git config --global url.<private-base>.insteadOf <public-base>
   ```

### 대용량 저장소 우회

단일 푸시가 GitHub의 2 GB 한도를 초과하는 경우 브랜치 단위로 분할한다.

베어 클론 이후 `origin`은 여전히 업스트림을 가리킨다 — 이 상태에서 `origin`에 푸시하면 공개 저장소로 의도치 않게 푸시된다 (섹션 8.2에서 방지하려는 바로 그 상황이다). 명시적인 프라이빗 URL을 사용하거나 `origin`을 미리 재설정한다 (`git remote set-url origin <private-url>`).

```bash
PRIVATE_URL=https://github.com/<your-org>/<private-repo>.git
for ref in $(git for-each-ref --format='%(refname)' refs/heads/); do
  git push "$PRIVATE_URL" "$ref"
done
git push "$PRIVATE_URL" --tags
```

### 미러 완료 후 즉시 처리

1. **Actions 비활성화 상태 확인** (섹션 1 전제 조건에서 설정). 섹션 5 감사 완료 후 선택적으로 재활성화한다.
2. `CODEOWNERS` 정리 — 업스트림 사용자 이름은 현재 조직에서 유효하지 않다.
3. Dependabot/Renovate 정책 결정: 업스트림 설정 유지, 비활성화, 또는 내부 대응책으로 교체.

---

## 2. 워킹 클론 및 리모트 설정

```bash
git clone https://github.com/<your-org>/<private-repo>.git
cd <private-repo>
git remote add upstream https://github.com/<upstream-org>/<repo>.git
git remote set-url --push upstream DISABLED_DO_NOT_PUSH_TO_UPSTREAM
git config remote.pushDefault origin
```

### pre-push 훅 (실질적 안전망)

`--push DISABLED` 설정은 URL을 명시적으로 지정하거나 새 리모트를 추가하면 우회된다. 실질적인 안전망으로 훅을 설치한다.

`.git/hooks/pre-push`에 다음을 추가한다 (또는 `scripts/setup-repo.sh`를 통해 배포):

```bash
#!/usr/bin/env bash
remote_url="$2"
if [[ "$remote_url" == *"<upstream-org>/<repo>"* ]]; then
  echo "ERROR: Pushing to upstream blocked by hook." >&2
  exit 1
fi
```

```bash
chmod +x .git/hooks/pre-push
```

---

## 3. 브랜치 토폴로지 — 이중 브랜치 분리

```
upstream/main (읽기 전용 ref)
       |
       v  (fast-forward만 허용, 자동화)
upstream-main  --->  (PR 머지 대상)  ---> main
                                           |
                                           v
                                       feature/*
```

| 브랜치 | 역할 | 푸시 정책 |
|--------|------|-----------|
| `upstream-main` | upstream/main 미러 | fast-forward만 허용, 자동화 전용, 브랜치 보호 |
| `main` | 내부 통합 브랜치 (내부 패치 상주) | PR만 허용, 리뷰 필수 |
| `feature/*` | 내부 기능 개발 | `main`에서 브랜치 |

브랜치 보호 (비대칭 설정 — 동기화 작동에 필수):

- **`main`**: PR 필수, 상태 체크 필수, 강제 푸시 금지, 직접 푸시 금지 (어드민 포함).
- **`upstream-main`**: 상태 체크 필수, 강제 푸시 금지, 사람의 수동 직접 푸시 금지. 직접 푸시는 *동기화 자동화 액터*만 허용 (섹션 4 동기화 워크플로에서 사용하는 SYNC_TOKEN 소유자 / GitHub Actions 봇 ID). 자동화가 `upstream/main`의 fast-forward 커밋을 푸시하며, 사람은 반드시 PR을 통해야 한다.

비대칭 설정의 이유: 동기화(섹션 4)는 업스트림으로부터의 fast-forward 푸시이며 자동화가 담당하고, 사람이 직접 수행하지 않는다. 두 브랜치를 동일하게 설정하면 동기화 루프가 첫 실행부터 차단된다.

**대안:** 팀이 선형 히스토리를 선호하고 강제 푸시를 허용한다면, `--force-with-lease`로 upstream/main 위에 리베이스된 단일 `company/main`을 사용할 수 있다. 트레이드오프: 히스토리는 깔끔해지지만, 이를 기반으로 브랜치를 생성한 팀원의 작업이 깨진다.

---

## 4. 동기화 워크플로

### 수동 절차

```bash
git fetch upstream
git checkout upstream-main
git merge --ff-only upstream/main
git push origin upstream-main
# 이후 PR 생성: upstream-main -> main
gh pr create --base main --head upstream-main --title "Sync upstream $(date +%Y-%m-%d)"
```

### 자동화 (GitHub Actions 크론)

`.github/workflows/sync-upstream.yml`에 다음을 추가한다:

```yaml
name: Sync upstream
on:
  schedule:
    - cron: '0 9 * * 1'  # 매주 월요일 09:00 UTC
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-commit-sha>  # Actions는 SHA로 고정
        with:
          ref: upstream-main
          fetch-depth: 0
          token: ${{ secrets.SYNC_TOKEN }}
      - run: |
          git remote add upstream https://github.com/<upstream-org>/<repo>.git
          git fetch upstream main
          git merge --ff-only upstream/main
          git push origin upstream-main
      - uses: peter-evans/create-pull-request@<full-commit-sha>
        with:
          base: main
          branch: upstream-main
          title: 'Sync upstream'
          body: 'Auto-generated weekly sync.'
```

서드파티 Actions는 공급망 위험 감소를 위해 전체 커밋 SHA로 고정한다.

스케줄 워크플로는 기본 브랜치에서만 실행된다 — `main`을 기본 브랜치로 유지한다.

---

## 5. 워크플로 및 시크릿 감사 (첫 동기화 후)

업스트림 `.github/workflows/`에서 상속된 워크플로 (섹션 1 전제 조건에서 비활성화됨). Actions 재활성화 전 다음을 확인한다:

| 확인 항목 | 이유 |
|-----------|------|
| 외부 배포 스텝 (`npm publish`, `docker push`, `pypi-publish`) | 동일한 시크릿 이름이 이미 존재할 경우 프라이빗 포크 코드가 외부로 배포될 수 있음 |
| 크론 트리거 잡 | 설정한 스케줄에 따라 즉시 실행 시작 |
| 알림 스텝 (Slack/Discord/이메일 웹훅) | URL이 하드코딩된 경우 업스트림 채널로 알림이 전송될 수 있음 |
| 셀프호스티드 러너 레이블 | 현재 조직에 해당 러너가 없을 수 있음 |
| 워크플로가 요구하는 시크릿 | 존재하는 시크릿과 생성이 필요한 시크릿을 문서화 |

불필요한 워크플로는 비활성화한다. 필요한 워크플로는 내부 시크릿과 러너를 사용하여 재구현한다.

---

## 6. 내부 패치 — 충돌 최소화

- 내부 패치는 가능한 한 전용 디렉터리(`internal/`, `company/`)에 격리한다. 동기화 시 충돌 범위가 줄어든다.
- `main`에서 `upstream-main`으로 체리픽하지 않는다 — 업스트림이 스쿼시 머지를 사용할 경우 계보가 끊어진다.
- 패치 수가 약 30개를 초과하면 감사를 수행한다: 업스트림에 기여할 수 있는 것은 기여하고, 불필요한 것은 제거하거나 별도 컴포넌트로 분리한다.

---

## 7. 업스트림 PR 기여

프라이빗 저장소에서 공개 업스트림으로 직접 PR을 열 수 없다. 기여하려면 다음 절차를 따른다:

1. GitHub에 별도의 **공개** 개인 포크를 생성한다.
2. 프라이빗 `main`의 관련 커밋을 체리픽하거나 `git format-patch`로 추출한다.
3. 내부 전용 참조(티켓 번호, 내부 URL, 시크릿 형태의 문자열)를 제거하여 정리한다.
4. 공개 포크에 푸시한 후 업스트림으로 PR을 연다.

---

## 8. 복구 플레이북

### 8.1 동기화 실패 롤백

자동 또는 수동 동기화가 잘못 머지된 경우:

1. `gh pr list --base main --head upstream-main --state merged`로 잘못 머지된 PR을 식별한다.
2. 리버트 PR을 연다 — `gh pr revert <PR#>` (PR 자동 생성), 또는 `git revert -m 1 <merge-commit>` 후 수동으로 PR을 연다.
3. 리버트 PR을 `main`에 머지한다 (강제 푸시 금지 — main 보호 정책 유지).
4. 다음 동기화 시 충돌이 발생할 수 있다 — 해결은 섹션 4를 참고한다.

### 8.2 업스트림 실수 푸시 감지

공개 업스트림 저장소에 커밋이 실수로 푸시된 경우:

1. 즉시 업스트림에서 해당 브랜치를 삭제한다: `git push upstream --delete <branch>` 또는 GitHub UI에서 강제 삭제.
2. 노출 가능성이 있는 시크릿을 즉시 교체한다 (아래 8.3 참고).
3. GitHub Support에 캐시 퍼지를 요청한다 — 이미 포크하거나 클론한 사람이 해당 내용을 갖고 있을 수 있다.
4. 사후 감사: pre-push 훅이 작동했는지 (또는 작동하지 않은 이유)를 확인하고, `git remote -v` 출력을 재검증한다.

### 8.3 SYNC_TOKEN 교체

토큰 노출 또는 정기 갱신 시:

1. 새 세분화 PAT 발급 — 권한 범위: `contents:write`, `pull-requests:write` (그 외 불필요); 만료 기간 ≤ 90일.
2. 프라이빗 저장소 Settings → Secrets에서 `SYNC_TOKEN`을 업데이트한 후 기존 토큰을 폐기한다.
3. 다음 스케줄 크론 실행이 오류 없이 완료되는지 확인한다.

### 8.4 유출된 프라이빗 콘텐츠 제거

프라이빗 포크 콘텐츠가 외부에 푸시된 경우:

1. 히스토리를 재작성하여 유출된 경로를 제거한다: `git filter-repo --invert-paths --path <leaked-path>` (인라인 시크릿은 `--replace-text` 사용).
2. 강제 푸시한다 (`--force-with-lease` 권장 — 일회성 예외; 브랜치 보호를 즉시 복원).
3. GitHub Support에 캐시 퍼지를 요청한다 — 외부 클론에 잔존 데이터가 있을 수 있다.
4. 노출된 시크릿을 병렬로 교체한다 (8.3 참고).
5. 재발 방지: pre-push 훅 강화, 브랜치 보호 정책 강화, 유출 경로에 대한 철저한 감사 수행.

---

> 마지막 검증: 2026-04
