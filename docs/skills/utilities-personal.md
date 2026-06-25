한국어 | [English](utilities-personal.en.md)

---

# 유틸리티 및 개인 워크플로우 스킬

이 페이지는 두 가지 유형의 스킬을 다룹니다. **유틸리티 스킬**은 개발 환경과 테스트 인프라를 지원하며 일반 사용을 염두에 두고 설계되었습니다. **개인 워크플로우 스킬**은 오너의 구직 활동 파이프라인을 위한 것으로, 이 저장소에 함께 관리되지만 범용 배포 대상은 아닙니다.

---

## 유틸리티

### hud

HUD는 Claude Code의 statusLine에 Oh-My-Toong 운영 상태를 실시간으로 표시합니다. `/hud setup`을 실행하면 Bun과 jq의 설치 여부를 확인한 뒤 `settings.local.json`의 `statusLine` 키를 HUD 스크립트 경로로 업데이트합니다. 표시 항목은 컨텍스트 창 사용량, 실행 중인 서브에이전트 수, Todo 완료 상태, 현재 활성 스킬 이름입니다. `/hud restore`는 첫 설정 시 백업해 둔 원래 statusLine 설정을 복원합니다. `${CLAUDE_SKILL_DIR}` 기반의 자기 위치 참조(self-location) 덕분에 사용자 전역 또는 프로젝트 로컬 배포 모두 동일하게 동작합니다.

---

## 개인 워크플로우 스킬

아래 스킬은 오너의 구직 활동 파이프라인을 구성합니다. 각 항목은 요약 수준으로만 기재합니다.

| 스킬 | 설명 |
|------|------|
| `resume-apply` | JD 기반 이력서 지원 전체 워크플로우 — JD 취득 → 브랜치 생성 → 이력서 맞춤화 → 커밋 → PDF 생성 |
| `resume-forge` | 이력서 문제 해결 소재 제작 — 복합 시나리오 구성, 문제 정의 및 해결 전략 작성, 항목 반복 개선 |
| `review-resume` | 이력서 리뷰 및 피드백 — 섹션별 평가, JD 적합도 분석, AI 문체 감사, 면접 준비 진단 |
| `collect-jd` | JD 수집 및 큐레이션 — 프로필 기반 JD 적합도 평가, `$OMT_DIR/collect-jd/` 스코프 상태 관리 |
| `mock-interview` | 이력서 기반 면접관 측 예상 질문 생성 — 꼬리질문 포함 다단계 깊이 |
| `tech-claim-rubric` | 기술 주장 5축 평가 프레임워크 — A1 신뢰성, A2 인과 정직성, A3 결과 명확성, A4 기여 범위, A5 가독성 + 2개 진위 규칙(R-Phys, R-Cross) |

---

## 참고

- [README](../../README.md) — 프로젝트 개요
- [핵심 파이프라인 스킬](./core-pipeline.md) — prometheus, sisyphus, argus
- [리뷰 품질 스킬](./review-quality.md) — code-review, orchestrate-review, qa
- [저작 스킬](./authoring.md) — 문서·콘텐츠 저작 + 공용 유틸
- [지식 그래프 & Pins](./knowledge-graph-pins.md) — pin 스킬 시리즈
