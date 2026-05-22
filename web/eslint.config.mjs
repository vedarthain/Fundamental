import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // React Compiler purity / effect rules. Excellent guidelines but they
    // flag legitimate SSR patterns as errors:
    //
    //   - `react-hooks/purity` trips on `Date.now()` inside server
    //     components rendering "X years ago" / "1.2 years ago" labels.
    //     Those calls genuinely need fresh time at render — there's no
    //     pure alternative without breaking the feature.
    //
    //   - `react-hooks/set-state-in-effect` flags the standard "subscribe
    //     to external state / sync state on prop change" pattern, often at
    //     callsites that are already correct (e.g. closing a popover when
    //     the route changes). The rule errs on the side of caution.
    //
    // Demoted to warnings so they still appear in `npm run lint` (developer
    // feedback) but don't block CI. Fix them progressively when refactoring
    // the relevant code.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
