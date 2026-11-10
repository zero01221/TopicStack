/**
 * Python 技术栈模板表（F05）。
 *
 * 约束：本文件不内联任何版本号或演示账号字面量；版本一律来自
 * src/types.ts 的建议默认值表，运行时由渲染器用 ctx.versions 注入。
 * 多栈 = 多张表，生成器按 stackId 查表，与执行引擎无关。
 */
import type { EnvCheckItem, StackTemplate } from '../types';
import {
  MYSQL_CAPABILITY_TABLE,
  SQL_DISABLED_SYNTAXES,
  SUGGESTED_DEFAULTS,
} from '../types';

/** Python 依赖清单骨架：每行符合「名称==版本」格式，版本以占位符注入。 */
const REQUIREMENTS_TEMPLATE = `# 依赖清单：版本由建议默认值表统一注入
fastapi=={{deps.frameworkPin}}
uvicorn=={{deps.uvicorn}}
mysql-connector-python=={{deps.mysqlDriver}}
pydantic=={{deps.pydantic}}
`;

/** 前端包配置骨架：与 Java 栈共用同一套 React 前端模板。 */
const FRONTEND_PACKAGE_TEMPLATE = `{
  "name": "{{project.artifactId}}",
  "private": true,
  "scripts": { "dev": "{{deps.frontendDevCommand}}" },
  "dependencies": { "react": "{{versions.frontend}}" }
}
`;

/** Python 栈的只读环境检查项：只检查版本，不安装、不请回填。 */
const PYTHON_ENV_CHECK_ITEMS: readonly EnvCheckItem[] = [
  { name: '语言运行时', command: 'python --version', expectedFrom: 'language' },
  { name: '数据库', command: 'mysql --version', expectedFrom: 'db' },
  { name: '前端运行时', command: 'node -v', expectedFrom: 'node' },
];

/** Python 栈模板表。 */
export const pythonTemplate: StackTemplate = {
  stackId: 'python',
  label: 'Python 后端栈',
  dirTree: {
    root: SUGGESTED_DEFAULTS.dirTree.root,
    entries: [
      'backend/',
      'backend/app/',
      'backend/app/routers/',
      'frontend/',
      'sql/',
      'docs/',
    ],
  },
  depsConfig: {
    file: 'requirements.txt',
    template: REQUIREMENTS_TEMPLATE,
    lineFormat: '名称==版本',
  },
  frontendCommon: {
    root: 'frontend',
    files: ['package.json', 'index.html', 'src/main.tsx', 'src/api.ts'],
    packageTemplate: FRONTEND_PACKAGE_TEMPLATE,
  },
  backendFragments: {
    entry: 'backend/app/main.py',
    layers: ['routers', 'services', 'repositories'],
    snippets: {
      application: '# 做什么：创建应用实例；为什么：集中注册路由与中间件\napp = {{deps.appFactory}}',
      router: '# 做什么：接收请求并返回统一结果；为什么：隔离传输层与业务层\n{{deps.routerBody}}',
      service: '# 做什么：编排业务规则；为什么：核心逻辑集中、便于中文注释与讲解\n{{deps.serviceBody}}',
      repository: '# 做什么：读写数据库；为什么：字段名与 schema 同源派生\n{{deps.repositoryBody}}',
    },
  },
  sqlDialect: {
    commentClauseTemplate: "COMMENT '{{comment}}'",
    identifierQuote: '`',
    tableOptions: 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    disabledSyntaxes: SQL_DISABLED_SYNTAXES,
    capabilityTable: MYSQL_CAPABILITY_TABLE,
    selectedDbVersion: SUGGESTED_DEFAULTS.versions.db,
  },
  readmeBaseline: {
    versionLabels: ['language', 'framework', 'db', 'frontend', 'node'],
    commands: [
      { step: '安装依赖', command: 'pip install -r requirements.txt', expected: '依赖安装完成且无报错' },
      { step: '建库并导入结构', command: 'mysql -u root -p < sql/schema.sql', expected: '建表与字段注释写入成功' },
      { step: '导入初始数据', command: 'mysql -u root -p < sql/seed.sql', expected: '演示账号可用' },
      { step: '启动后端', command: 'uvicorn app.main:app --reload', expected: '服务在基准端口监听' },
      { step: '启动前端', command: 'npm run dev', expected: '浏览器可访问登录页' },
      { step: '访问登录页', command: '浏览器打开 http://localhost:5173', expected: '登录表单正常显示' },
      { step: '演示账号登录', command: '在登录页输入演示账号', expected: '登录成功并进入主界面' },
    ],
    boundaryStatement: '本系统不验证你的本机环境；按基准环境准备即可按上述步骤运行',
  },
  envCheckItems: PYTHON_ENV_CHECK_ITEMS,
  commentPolicy: SUGGESTED_DEFAULTS.commentPolicy,
  explainerAnchors: SUGGESTED_DEFAULTS.explainerAnchors,
  suggestedVersions: SUGGESTED_DEFAULTS.versions,
};
