import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "**/route-old.ts",
      "**/route-memory.ts",
      "**/page_broken.tsx",
      "**/*_broken.*",
      "**/*-old.*",
      "**/*.js",
      ".next/**",
      "node_modules/**",
      "**/*.d.ts",
      "prisma/dev.db",
      "uploads/**"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn", // 將 any 類型錯誤降級為警告
      "@typescript-eslint/no-unused-vars": "warn", // 將未使用變數錯誤降級為警告
      "@typescript-eslint/no-empty-object-type": "warn", // 將空對象類型錯誤降級為警告
      "prefer-const": "warn", // 將 prefer-const 錯誤降級為警告
      "react-hooks/exhaustive-deps": "warn", // 將 React Hook 依賴錯誤降級為警告
    }
  }
];

export default eslintConfig;
