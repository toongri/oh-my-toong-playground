# Changelog

모든 주요 변경 사항을 이 파일에 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)를 따릅니다.

---

## [Unreleased]

### Changed

- **Claude 설정 목적지 이전**: `claude.ts`의 모든 설정 기록 위치를 `.claude/settings.json` → `.claude/settings.local.json`으로 변경
  - 대상 writer 세 곳 모두 이전: `syncConfig`, `statusLine` writer, `updateSettings` (hooks writer)
  - 이 변경은 커밋 `88e43b3`의 역방향 이전 (`settings.local.json` → `settings.json`) 을 완성합니다
  - **이전 이유**: Claude Code는 `settings.json`을 팀 공유 설정으로 관리합니다. oh-my-toong이 같은 파일에 기록하면 팀 관리 항목과 충돌할 수 있습니다. `settings.local.json`은 Claude Code가 자동으로 병합하고 자동으로 `.gitignore`에 추가하는 기기 로컬 파일입니다
  - **런타임 영향 없음**: Claude Code는 두 파일을 type-aware하게 병합하므로 동작은 동일합니다
  - **선택적 수동 정리**: 이전에 oh-my-toong이 기록한 항목이 `.claude/settings.json`에 남아 있을 수 있습니다. 런타임에는 영향이 없지만, 필요하다면 수동으로 제거할 수 있습니다 — Claude Code는 두 파일을 type-aware하게 병합하므로 중복 항목이 있어도 동작은 동일합니다

### Added

- **`*.yaml + *.local.yaml` overlay 패턴**: 모든 sync 시스템 YAML 파일에 기기 로컬 오버라이드 지원 추가
  - `deepMergeOverlay` 함수로 type-aware 병합: scalar=replace, object=deep merge, array=concat+dedup
  - 지원 범위: `sync.yaml`, `config.yaml`, `claude.yaml`, `gemini.yaml`, `codex.yaml`, `opencode.yaml`, `projects/*/sync.yaml`, `projects/*/{platform}.yaml`
  - 모든 `*.local.yaml` 파일은 `.gitignore`에 자동으로 제외
  - `make validate`가 `*.local.yaml`의 스키마 오류를 배포 전에 검출
