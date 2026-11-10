/** @type {import('tailwindcss').Config} */
export default {
  // 只扫描本系统自身的模板与源码，避免把生成产物目录卷进构建。
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
