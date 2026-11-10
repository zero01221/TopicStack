# TopicStack（题栈）· 计算机毕设辅助生成系统

> 个人自用、非商用。**纯前端单页应用（SPA）**：无后端、无数据库、无外部接口、无 API Key。
> 本仓库是**系统本身**；系统生成的毕设源码与文档以 ZIP 压缩包形式交付，不写入本仓库。

---

## 1. 基准环境

| 项目 | 版本 / 说明 |
| --- | --- |
| 操作系统 | Windows 10 / Windows 11（Linux、macOS 命令一致） |
| Node.js | **20 LTS**（`package.json` 的 `engines.node` 声明为 `>=20`） |
| npm | 10.x（随 Node 20 LTS 分发，亦可使用更高版本 npm） |
| 浏览器 | Chrome / Edge 最新稳定版 |
| 网络 | **仅首次安装依赖需要联网**；应用运行、生成、打包全程不发起任何外部请求 |

> 说明：本仓库在 Node 22 上同样完成过构建与测试；20 LTS 是声明的基准环境，版本下限不做强制拦截。
> 判据与证据：本系统按 README 可启动属于**声明式保证**（模板确定性 + 同源派生 + 精确基准环境），系统不在运行期实跑生成代码。

---

## 2. 快速开始（逐步命令与预期结果）

以下命令均在仓库根目录执行。

### 步骤 1 · 安装依赖

```bash
npm ci
```

预期结果：终端输出 `added N packages ...`，生成 `node_modules/` 与 `node_modules/.package-lock.json`，退出码 0。
`npm ci` 严格按 `package-lock.json` 安装，保证依赖树与提交时完全一致。

### 步骤 2 · 启动应用

```bash
npm run dev
```

预期结果：Vite 输出 `Local: http://localhost:5173/`；浏览器打开该地址可看到 TopicStack 骨架页面（步骤导航与当前步骤说明）。按 `Ctrl + C` 结束进程。

> 若锁文件与 `package.json` 不一致，可先执行 `npm install` 刷新锁文件，再回到步骤 1。

---

## 3. 构建与自检

### 步骤 3 · 类型检查与生产构建

```bash
npm run build
```

预期结果：TypeScript 类型检查无报错；随后 Vite 输出构建清单，生成 `dist/index.html` 与 `dist/assets/` 下的 JS 资源；判据入口写入构建运行证据；退出码 0。

### 步骤 4 · 运行测试

```bash
npm run test
```

预期结果：vitest 输出 `tests/F01.test.ts` 全部断言 PASS，退出码 0。

### 步骤 5 · 静态检查

```bash
npm run lint
```

预期结果：逐条输出 L1~L8 规则 PASS，末行 `PASS`，退出码 0；写入静态检查运行证据。

### 步骤 6 · 执行本功能点的判据入口

```bash
npm run check -- F01
```

预期结果：逐条输出六条判据的 PASS/FAIL；统计行为 `declaredChecks=6 evaluatedChecks=6 unknownCount=0`；末行 `PASS`；同时写出 `checks/CHK-F01-01` 与 `checks/records.json` 两份验收记录。

> 步骤 6 依赖步骤 3 的构建产物与步骤 5 的运行证据，请按顺序执行。任一判据 FAIL 时输出 `BLOCKED` 且退出码非 0，禁止提交。

---

## 4. 目录说明

| 路径 | 说明 |
| --- | --- |
| `.gitignore` | 忽略依赖目录、构建产物与本地环境文件 |
| `package.json` / `package-lock.json` | 依赖、五个脚本、`engines` 声明 / 确定性锁文件 |
| `index.html` | SPA 挂载页，含 `id="root"` 根容器 |
| `vite.config.ts` | Vite 构建与 vitest 测试配置 |
| `tsconfig.json` | 本系统 TypeScript 编译选项（严格模式、只做类型检查） |
| `tailwind.config.js` / `postcss.config.js` | Tailwind 扫描路径与样式管线 |
| `src/main.tsx` | 应用入口与极简步骤编排（状态枚举不含任何人工把关环节） |
| `src/index.css` | Tailwind 指令与少量全局样式 |
| `tests/invariants.ts` | 固有属性断言集：期望值全部为硬编码字面常量，不读取派生配置 |
| `tests/F01.test.ts` | F01 的纯函数断言测试 |
| `scripts/check.mjs` | 统一判据入口：只读文件 + 通用解析器判定 + 生成验收记录 |
| `checks/CHK-F01-01` | F01 单次验收记录（AcceptanceRecord） |
| `checks/records.json` | 累积验收记录台账 |
| `checks/runs.json` | 由构建 / 静态检查命令写入的机器运行证据 |
| `dist/` | 生产构建产物（已被忽略，不属于提交内容） |
| `node_modules/` | 依赖目录（已被忽略） |

---

## 5. 常见问题（FAQ）

**Q1：`npm ci` 提示锁文件不一致？**
A：执行 `npm install` 重新生成锁文件，再执行 `npm ci`。

**Q2：5173 端口被占用？**
A：Vite 会自动顺延端口，以终端实际输出的地址为准，无需改动配置。

**Q3：本机 Node 版本不是 20 LTS？**
A：建议切换到 20 LTS。`engines.node` 只声明下限，不做强制拦截，因此不会阻断安装。

**Q4：构建产物在哪？**
A：`dist/` 目录，由 `npm run build` 生成，已被 `.gitignore` 忽略。

**Q5：判据返回 `BLOCKED` 怎么办？**
A：查看逐条输出中的 FAIL 项与 `checks/CHK-F01-01` 里的证据字段，修复后重跑 `npm run check -- F01`。**不要修改期望值、不要删除断言、不要放宽阈值**。

**Q6：需要联网或 API Key 吗？**
A：只有首次安装依赖需要联网。应用运行、内容生成、ZIP 打包全部在本地完成，不需要账号、密钥或任何外部服务。

---

## 6. 边界声明

- 本系统**不验证你的本机环境；按基准环境准备即可按上述步骤运行**。
- 本系统不自动配置环境、不提供一键运行、不打包运行时；命令需你在本机手动执行。
- 生成物中的 Java / Python / SQL / README 均为**文本产物**，系统不编译、不启动、不连接数据库、不执行任何生成代码。
- 仅限本地演示、个人自用、非商用；无登录、无多用户、无权限、无计费、无配额。
- 可选部署包（jar / exe / Docker，编号 A12）本期标记为**「待做（下次实现）」**，不产出文件。
- 本仓库只做本地提交，**不擅自执行 `git push`**。
