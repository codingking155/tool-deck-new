import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

/* Lint gate for the Vite SPA and the shared pure modules (Vercel runs `npm run lint` as a deployment check).
   Edge functions (Deno) and shopify-detector (own Next.js project) are linted elsewhere. */
export default [
  { ignores: ["dist/**", "dist-csp/**", "public/**", "supabase/**", "shopify-detector/**", "node_modules/**"] },
  {
    files: ["src/**/*.{js,jsx}", "shared/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      /* JSX use of a capitalised import isn't seen without eslint-plugin-react; same convention as the Vite template */
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^[A-Z_]", caughtErrors: "none" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
