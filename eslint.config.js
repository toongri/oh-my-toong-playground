// ESLint flat config — AI 협업 1차 하네스
//
// 목적: AI가 쏟아내는 "그럴듯하게 틀린" 코드를 커밋 전에 결정적으로 차단한다.
// 채택 기준: 각 룰은 "이게 *잘못된* 코드를 잡는가? error로 강제할 가치가 있는가?"를 통과해야만 켠다.
// 순수 스타일(따옴표·줄바꿈 등 '모양')은 여기 넣지 않고 Prettier에 맡긴다(맨 끝 eslint-config-prettier).
//
// react-hooks v7 주의: v7의 recommended 프리셋은 React Compiler 기반 룰까지 통째로 묶는다.
// 디폴트를 통으로 펼치지 않고, 과제가 말하는 "좋은 코드 기준"에 매핑되는 룰만 골라 켠다.

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";

export default defineConfig(
  // 린트 대상 제외: 빌드 산출물·의존성·벤더 번들, 그리고 gitignore된 배포 타깃/생성 디렉터리.
  // flat config는 .gitignore를 자동으로 읽지 않으므로 생성물 경로를 여기 명시로 미러링한다
  // (안 하면 .codex/.gemini/.opencode 안의 synced 복사본까지 린트해 위반이 부풀려진다).
  {
    ignores: [
      "dist",
      "node_modules",
      "**/vendor/**",
      ".claude/**",
      ".codex/**",
      ".gemini/**",
      ".opencode/**",
      ".serena/**",
      ".codegraph/**",
      ".superset/**",
      ".playwright-mcp/**",
      ".omt/**",
      ".sync-backup/**",
      // 서드파티 벤더(picomatch)·런타임 주입 템플릿(playwright CJS 스크립트)은
      // TS 기준으로 저작한 소스가 아니다 — 린트 대상에서 제외(no-undef/require 오탐 방지).
      "hooks/rules-injector/picomatch/**",
      "skills/insane-browsing/engine/templates/**",
    ],
  },

  // 베이스라인: 객관적으로 깨진 JS/TS (no-undef, no-dupe-keys, no-unreachable, no-misused-new ...)
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      // OMT는 node/bun 런타임(process·Buffer·__dirname). React 스펙을 붙일 때를 대비해
      // browser 전역(window·document)도 함께 등록해 둔다 — 둘 다 인식.
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@eslint-community/eslint-comments": eslintComments,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error", // 더 이상 필요 없는 disable은 게이트가 차단(부채 청소)
    },
    rules: {
      // ── 게이트 차단: 타입 단언 금지 + disable은 룰명·사유 필수(죽은 disable도 차단) ──
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }], // `as Foo` 단언 금지(타입 에러 우회 통로). `as const`는 자동 예외.
      "@typescript-eslint/no-non-null-assertion": "error", // `x!` non-null 단언 금지(strictNullChecks 우회 통로). as와 같은 "믿어줘" 탈출구.
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }], // disable엔 `-- 사유` 필수(맹목적 비활성화 차단)
      "@eslint-community/eslint-comments/no-unlimited-disable": "error", // 룰명 없는 광역 disable 금지(반드시 룰 지정)

      // ── React: 훅/렌더 정확성 ──
      // (recommended를 통으로 켜지 않고, 과제 "좋은 코드 기준"에 직결되는 것만 선별)
      "react-hooks/rules-of-hooks": "error", // 훅 호출 순서 규칙 — 조건/반복 안에서 훅 호출 금지
      "react-hooks/exhaustive-deps": "error", // 의존성 배열 누락 = stale closure(그럴듯하게 틀린 버그). warn→error 승격
      "react-hooks/set-state-in-effect": "error", // useEffect로 상태 "동기화" 금지 = 과제 최중요 패턴("파생값은 계산한다")의 기계 강제
      "react-hooks/immutability": "error", // 렌더 중 props/state 직접 변조 금지
      "react-hooks/static-components": "error", // 컴포넌트 안에서 컴포넌트 정의 금지(매 렌더 새 타입 → 상태 날아감, AI 단골 실수)
      "react-hooks/refs": "error", // 렌더 도중 ref 읽기/쓰기 금지(렌더는 순수해야)
      // 보류: react-hooks/use-memo, preserve-manual-memoization, incompatible-library, globals
      //  → React Compiler 채택을 전제하는 룰. 컴파일러 없이 켜면 오탐/혼란. 컴파일러 도입 시 함께 켠다.

      // ── 타입 침묵 차단(AI가 타입체커를 끄고 지나가는 통로) ──
      "@typescript-eslint/no-explicit-any": "error", // any = 타입 안전망 우회 1순위 수단
      "@typescript-eslint/ban-ts-comment": "error", // ts-ignore 류 주석으로 타입에러 은폐 금지
      "no-unused-vars": "off", // base 룰은 끄고 TS 인지 버전으로 대체(타입 전용 import 오탐 방지)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }, // _ 접두사 = "일부러 안 쓴다"는 명시적 신호
      ],

      // ── 숨은 버그·잔재 차단 ──
      eqeqeq: ["error", "always"], // == 암묵 형변환 footgun → === 강제
      "no-empty": "error", // 빈 블록(특히 빈 catch) = 에러 삼킴
      "no-console": ["error", { allow: ["warn", "error"] }], // console.log 디버깅 잔재 차단(warn/error는 허용)
      curly: ["error", "all"], // 무중괄호 if에 줄 추가하다 생기는 제어흐름 버그 예방
      "prefer-const": "error", // 재할당 없는 let = 의도와 코드 불일치
    },
  },

  // 테스트 파일: fixture/mock은 알려진 형태의 stub을 만드는 곳이라 타입 단언이 가장 정당화된다.
  // 그래서 assertion 계열만 완화한다 — 프로덕션의 never 엄격은 그대로 유지(완화는 test 파일 국한).
  // 버그룰(eqeqeq·no-unused·prefer-const 등)은 테스트에서도 유지한다.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": "off",
    },
  },

  // 맨 마지막: Prettier와 충돌하는 "모양" 룰을 전부 끈다(포맷은 Prettier 전담, ESLint는 품질만)
  eslintConfigPrettier,
);
