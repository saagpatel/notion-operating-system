import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
	{
		ignores: ["node_modules/**", "dist/**", "coverage/**", "tmp/**", ".tmp/**"],
	},
	{
		files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs", "*.{ts,mjs}"],
		languageOptions: { globals: globals.node },
	},
	{
		...js.configs.recommended,
		files: ["scripts/**/*.mjs", "*.mjs"],
		rules: {
			...js.configs.recommended.rules,
			// Error provenance changes in the existing smoke helpers need separate review.
			"preserve-caught-error": "warn",
		},
	},
	...tseslint.configs.recommended.map((config) => ({
		...config,
		files: ["src/**/*.ts", "tests/**/*.ts", "*.ts"],
	})),
	{
		files: ["src/**/*.ts", "tests/**/*.ts", "*.ts"],
		rules: {
			// Existing findings need separate review; keep them visible without autofixes.
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": "warn",
		},
	},
];
