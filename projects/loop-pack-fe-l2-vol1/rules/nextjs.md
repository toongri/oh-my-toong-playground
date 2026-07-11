---
paths: ["**/*.tsx", "app/**"]
---

# Next.js App Router 판단 규칙

App Router에서 렌더링 경계·라우팅·데이터·자산을 다루는 규칙이다. 문서를 열어 판단 기준·Before/After를 확인한다.

- `docs/nextjs/app-router.md` — **App Router 구조·렌더링 경계**: 라이브러리 vs 프레임워크(IoC), 파일 라우팅(폴더=라우트), 중첩 layout/loading/error, Server/Client 경계('use client' 전파), hydrate 모델(프리렌더·hydrate)
- `docs/nextjs/data-and-assets.md` — **Next 표준 제공 데이터·자산**: 데이터 페칭 위치(async Server Component), fetch 캐싱·재검증(revalidate), 이미지 최적화(next/image), 폰트 최적화(next/font)

**관련 규칙**: 컴포넌트 경계·유연한 컴포넌트 패턴(Headless·Compound)은 `component-design.md` rule에, 상태 구조·위치·분류는 `react.md` rule에, CSR 직접 fetch의 race·의존성은 `docs/react/hook-design.md` §8에, Next.js 테스트 레이어는 `docs/testing/nextjs.md`에 있다.
