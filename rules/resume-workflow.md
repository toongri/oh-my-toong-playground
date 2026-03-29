# Resume Workflow

## 이력서 확인 요청 시

사용자가 이력서를 보여달라고 하면:
1. `docker compose up -d`으로 Jekyll 서버를 실행한다
2. 브라우저에서 http://localhost:4000 을 열어 보여준다
3. 확인이 끝나면 `docker compose down`으로 종료한다

## PDF 생성 요청 시

사용자가 PDF를 달라고 하면:
1. `bun run pdf`를 실행한다
2. 생성된 `resume.pdf`를 전달한다
3. 특정 브랜치 기준이면 `bun run pdf {branch-name}`을 실행한다

## _config.yml 수정 시

`_config.yml`을 수정하기 전에 반드시 `docs/config-guide.md`를 읽고 필드 스펙을 확인한다.
