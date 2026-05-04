// eslint.config.js
import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  // 1. قسم التجاهل (يجب أن يكون في البداية)
  {
    ignores: [
      "uploads/**",       // تجاهل مجلد الرفع بالكامل
      "node_modules/**",  // تجاهل المكتبات
      "backup.js",        // أي ملفات أخرى لا تريد فحصها
      "*.sql"             // تجاهل ملفات الداتابيز إن وجدت
    ]
  },
  
  // 2. إعدادات اللغة والبيئة
  {
    languageOptions: { 
      globals: globals.node, 
      ecmaVersion: "latest",
      sourceType: "module" 
    } 
  },
  
  // 3. القواعد العامة
  pluginJs.configs.recommended,
  
  // 4. قواعدك الخاصة بمشروع Smart School
  {
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",      // هذا سيصيد لك الدالات المفقودة فوراً
      "no-console": "off",
    }
  }
];