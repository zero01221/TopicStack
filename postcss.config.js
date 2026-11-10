/**
 * PostCSS 管线：Tailwind 生成原子类，autoprefixer 补齐浏览器前缀。
 * package.json 声明 type=module，因此这里使用 ESM 默认导出。
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
