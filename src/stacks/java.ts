/**
 * Java 技术栈模板表（F05）。
 *
 * 约束：本文件不内联任何版本号或演示账号字面量；版本一律来自
 * src/types.ts 的建议默认值表，运行时由渲染器用 ctx.versions 注入。
 * 模板中的 {{...}} 占位符由后续功能点的渲染引擎统一替换。
 */
import type { StackTemplate } from '../types';
import {
  ENV_CHECK_ITEMS,
  MYSQL_CAPABILITY_TABLE,
  SQL_DISABLED_SYNTAXES,
  SUGGESTED_DEFAULTS,
} from '../types';

/** Maven 依赖配置骨架：XML 标签配对，版本均以占位符注入。 */
const POM_TEMPLATE = `<project>
  <modelVersion>{{deps.mavenModelVersion}}</modelVersion>
  <groupId>{{project.groupId}}</groupId>
  <artifactId>{{project.artifactId}}</artifactId>
  <version>{{project.version}}</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>{{deps.frameworkPin}}</version>
    </dependency>
    <dependency>
      <groupId>com.mysql</groupId>
      <artifactId>mysql-connector-j</artifactId>
      <version>{{deps.dbPin}}</version>
    </dependency>
  </dependencies>
</project>
`;

/** 前端包配置骨架：与后端共用同一套版本占位符。 */
const FRONTEND_PACKAGE_TEMPLATE = `{
  "name": "{{project.artifactId}}",
  "private": true,
  "scripts": { "dev": "{{deps.frontendDevCommand}}" },
  "dependencies": { "react": "{{versions.frontend}}" }
}
`;

/** Java 栈模板表。 */
export const javaTemplate: StackTemplate = {
  stackId: 'java',
  label: 'Java 后端栈',
  dirTree: {
    root: SUGGESTED_DEFAULTS.dirTree.root,
    entries: [
      'backend/',
      'backend/src/main/java/',
      'backend/src/main/resources/',
      'frontend/',
      'sql/',
      'docs/',
    ],
  },
  depsConfig: {
    file: 'pom.xml',
    template: POM_TEMPLATE,
    lineFormat: 'XML 标签配对',
  },
  frontendCommon: {
    root: 'frontend',
    files: ['package.json', 'index.html', 'src/main.tsx', 'src/api.ts'],
    packageTemplate: FRONTEND_PACKAGE_TEMPLATE,
  },
  backendFragments: {
    entry: 'backend/src/main/java/Application.java',
    layers: ['controller', 'service', 'mapper'],
    snippets: {
      application: '/** 做什么：启动后端服务；为什么：集中装配分层与配置 */\npublic class {{project.entryClass}} {\n  public static void main(String[] args) {\n    {{deps.startupBody}}\n  }\n}',
      controller: '/** 做什么：接收请求并返回统一结果；为什么：隔离传输层与业务层 */\npublic class {{project.controllerClass}} {\n  {{deps.controllerBody}}\n}',
      service: '/** 做什么：编排业务规则；为什么：核心逻辑集中、便于中文注释与讲解 */\npublic class {{project.serviceClass}} {\n  {{deps.serviceBody}}\n}',
      mapper: '/** 做什么：读写数据库；为什么：字段名与 schema 同源派生 */\npublic interface {{project.mapperClass}} {\n  {{deps.mapperBody}}\n}',
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
      { step: '安装依赖', command: 'mvn -q -DskipTests package', expected: '依赖下载完成且构建产物生成' },
      { step: '建库并导入结构', command: 'mysql -u root -p < sql/schema.sql', expected: '建表与字段注释写入成功' },
      { step: '导入初始数据', command: 'mysql -u root -p < sql/seed.sql', expected: '演示账号可用' },
      { step: '启动后端', command: 'mvn spring-boot:run', expected: '服务在基准端口监听' },
      { step: '启动前端', command: 'npm run dev', expected: '浏览器可访问登录页' },
    ],
    boundaryStatement: '本系统不验证你的本机环境；按基准环境准备即可按上述步骤运行',
  },
  envCheckItems: ENV_CHECK_ITEMS,
  commentPolicy: SUGGESTED_DEFAULTS.commentPolicy,
  explainerAnchors: SUGGESTED_DEFAULTS.explainerAnchors,
  suggestedVersions: SUGGESTED_DEFAULTS.versions,
};
