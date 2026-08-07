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

  // The two rules from docs/ui-standards.md that a machine can check. Everything
  // else there is reviewed; these two fail the build instead, because both are
  // easy to reintroduce without noticing.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // S4.1 — native dialogs are unstyleable, break the theme, and behave
      // inconsistently. Use ConfirmDialog / useConfirm instead.
      "no-restricted-globals": [
        "error",
        {
          name: "confirm",
          message: "S4.1: use useConfirm() from components/ui/ConfirmDialog instead.",
        },
        {
          name: "prompt",
          message: "S4.1: use an inline form or a dialog, never window.prompt.",
        },
        {
          name: "alert",
          message: "S4.1: surface errors in the UI, never window.alert.",
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "S4.1: use useConfirm()." },
        { object: "window", property: "prompt", message: "S4.1: use an inline form or dialog." },
        { object: "window", property: "alert", message: "S4.1: surface errors in the UI." },
      ],
      // S1.2 — colour comes from design tokens, so themes stay swappable.
      // Values that identify a *thing* rather than a theme (the per-person
      // avatar palette, the decorative column dots) are the documented
      // exception and disable this rule with a comment saying why.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/]",
          message:
            "S1.2: use a design token (bg-surface, text-text-muted, …) rather than a raw hex colour. If this value identifies a thing rather than a theme, disable this rule with a comment explaining why.",
        },
      ],
    },
  },
]);

export default eslintConfig;
