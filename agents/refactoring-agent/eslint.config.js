// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
    // Base: recommended + strict + stylistic type-checked rules
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    {
        languageOptions: {
            parserOptions: {
                project: "tsconfig.eslint.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // ── Correctness ───────────────────────────────────────────────
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            "@typescript-eslint/no-floating-promises": "error",

            // Allow _-prefixed params (required by AgentTool interface signature)
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],

            // ── Clarity ───────────────────────────────────────────────────
            "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/no-import-type-side-effects": "error",

            // ── Safety ────────────────────────────────────────────────────
            "@typescript-eslint/no-non-null-assertion": "error",
            "no-console": "off", // console logging is intentional in CLI tools
            "eqeqeq": ["error", "always"],
        },
    },

    // Relax rules for test files
    {
        files: ["**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    // Ignore compiled output and the eslint config itself
    { ignores: ["dist/**", "eslint.config.js"] },
);
