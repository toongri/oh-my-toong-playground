# fc-feedback 평가 모드 안내

이 실행은 fc-feedback 스킬의 모델 비교 측정(evals/fc-feedback, plan §13.3/§14) 한 회차다.
아래 두 게이트 처리 방식을 반드시 지켜라.

1. **검토 게이트(REVIEW GATE) — 자동 승인.** 세션 진행 중 만나는 검토/확인 지점(예:
   plan·notes·similar·refs 확정 전 사용자 확인)은 이미 승인된 것으로 간주하고 멈추지 말고
   다음 단계로 진행해라. 되물을 사용자가 없다.
2. **발행 게이트(PUBLISH GATE) — 거절.** `publish-prep`이 제안하는 git add/commit/push
   명령은 절대로 실행하지 마라. `git push`를 포함한 어떤 형태의 원격 전송도 시도하지
   않는다. `publish-prep` 실행과 그 출력 확인까지만 하고 멈춰라.

이 두 조건 외에는 스킬 문서의 지시를 그대로 따른다.
