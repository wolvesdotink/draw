// Flat-config ESLint for React + TypeScript. Flat config is the default in
// ESLint 9 and is what `eslint .` picks up automatically.
//
// Keep this list tight. We want failures to be actionable, not aesthetic —
// type errors are owned by `tsc --noEmit` (the `typecheck` script), so we
// don't double-report them here.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default [
  // Files ESLint should ignore (flat-config replacement for .eslintignore).
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "**/*.config.ts",
      "**/*.config.js",
      "eslint.config.js",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React + TS source files.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Hooks correctness. Pinned to the canonical two rules so this config
      // is robust across eslint-plugin-react-hooks major versions (the
      // shape of its exported `configs` has churned between v4/v5/v6).
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Vite HMR boundary hint — warn (not error) so files that legitimately
      // export both a component and helpers (hooks returning JSX, dialog
      // factories, etc.) don't fail the lint gate.
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Disable any rule that conflicts with Prettier. Keep this last.
  prettier,
];
