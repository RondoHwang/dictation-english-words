# 听写助手（Dictation Words App）

一个基于 Node.js + Express + MySQL 的英语听写练习系统，支持学生端听写训练与管理员后台管理。

项目面向「按书本/单元管理词库」的学习场景，支持 Excel 批量导入、错题本追踪、听写历史回看和基础数据统计。

## 功能特性

### 学生端

- 手机号注册（短信验证码）
- 密码登录 + 验证码登录
- 书本/单元词库管理
- Excel 批量上传词汇（先解析预览，再确认入库）
- 听写练习（正常模式 / 错题模式）
- 听写计时、手动标错、提交结算
- 错题本自动维护（连续正确后自动移出）
- 听写历史列表与单次详情

### 管理员端

- 管理员账号登录
- 全局统计（用户数、词数、听写次数、总时长）
- 用户列表检索
- 用户详情查看（书本、单元、近期记录）
- 删除用户及其关联数据

## 技术栈

- 后端：Express 4
- 数据库：MySQL 8（`mysql2/promise`）
- 鉴权：JWT（用户与管理员分开签名）
- 密码加密：bcryptjs
- 文件上传：multer
- Excel 解析：xlsx
- 短信服务：腾讯云短信 SDK（开发模式下可跳过真实发送）
- 前端：原生 HTML + CSS + JavaScript

## 目录结构

```text
dictation-words-app/
├─ server.js                  # 后端入口（API、鉴权、业务逻辑）
├─ package.json
├─ backup_20260704.sql        # 数据库结构和示例数据
├─ uploads/                   # Excel 临时上传目录
└─ public/
	 ├─ index.html              # 前端页面（学生端 + 管理端）
	 ├─ css/
	 │  └─ style.css
	 └─ js/
			└─ app.js               # 前端业务逻辑
```

## 快速开始

### 1. 环境要求

- Node.js 18+
- MySQL 8+

### 2. 安装依赖

```bash
npm install
```

### 3. 准备数据库

在 MySQL 中创建数据库并导入备份：

```sql
CREATE DATABASE IF NOT EXISTS dictation_app DEFAULT CHARACTER SET utf8mb4;
```

```bash
mysql -u <用户名> -p dictation_app < backup_20260704.sql
```

说明：

- `backup_20260704.sql` 已包含核心表结构：`users`、`admins`、`words`、`errors`、`dictation_sessions`、`dictation_records`
- 如 `admins` 表为空，服务启动时会自动创建默认管理员账号

### 4. 修改后端配置

当前配置写在 `server.js` 顶部，请至少检查以下项：

- `PORT`：服务端口（默认 `3000`）
- `DEV_MODE`：开发模式（`true` 时验证码固定为 `123456`）
- `JWT_SECRET`：用户 JWT 密钥
- `ADMIN_SECRET`：管理员 JWT 密钥
- `SMS_CONFIG`：腾讯云短信参数
- MySQL 连接配置：`host`、`user`、`password`、`database`

### 5. 启动项目

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm start
```

启动后访问：

```text
http://localhost:3000
```

## 默认账号

当 `admins` 表无数据时，服务启动会自动创建：

- 用户名：`admin`
- 密码：`admin123`

## Excel 导入格式

上传文件仅支持 `.xlsx` / `.xls`。

第一张工作表应包含以下列（支持中文或英文字段名）：

- 中文列：`中文` 或 `chinese`
- 音标列：`音标` 或 `phonetic`（可为空）
- 英文列：`英文` 或 `english`

导入流程：

1. 调用解析接口上传文件
2. 前端展示有效词条与错误行
3. 输入书本与单元后确认导入
4. 后端按 `english + user_id + book` 去重：存在则更新，不存在则新增

## 核心业务规则

### 验证码规则

- 手机号校验：`^1[3-9]\d{9}$`
- 发送间隔：60 秒
- 有效期：5 分钟
- 最大错误次数：5 次
- 开发模式验证码固定：`123456`

### 听写抽词策略

- 正常模式：按 `dictation_count` 升序 + 随机，优先抽到练习次数少的词
- 错题模式：从激活错题中按 `error_count` 降序 + 随机抽取

### 错题本演进规则

- 本次听写错误：
	- 若错题记录已存在：`error_count + 1`，`consecutive_correct = 0`，`is_active = 1`
	- 若不存在：新建错题记录
- 本次听写正确：
	- 若该词在激活错题中：`consecutive_correct + 1`
	- 当连续正确达到 3 次：`is_active = 0`（从错题本移出）

## API 总览

> 统一前缀：`/api`
>
> 用户接口使用 `Authorization: Bearer <user_token>`
>
> 管理接口使用 `Authorization: Bearer <admin_token>`

### 公开接口

- `POST /api/auth/send-code` 发送验证码
- `POST /api/auth/register` 注册
- `POST /api/auth/login` 密码登录
- `POST /api/auth/login-code` 验证码登录
- `POST /api/admin/login` 管理员登录

### 用户接口（需用户登录）

- `GET /api/auth/me` 获取当前用户信息
- `GET /api/books` 获取书本列表
- `GET /api/units` 获取单元列表
- `POST /api/upload/parse` 解析上传的 Excel
- `POST /api/upload/confirm` 确认导入词汇
- `GET /api/words` 词库分页查询
- `POST /api/words` 新增单词
- `PUT /api/words/:id` 编辑单词
- `DELETE /api/words/:id` 删除单词
- `POST /api/dictation/select` 选择听写词
- `POST /api/dictation/submit` 提交听写结果
- `GET /api/error-books` 错题书本统计
- `GET /api/error-units` 错题单元统计
- `GET /api/errors` 错题列表
- `GET /api/history` 听写历史
- `GET /api/history/:id` 听写详情
- `GET /api/stats` 个人统计

### 管理员接口（需管理员登录）

- `GET /api/admin/me` 获取当前管理员
- `GET /api/admin/stats` 获取全局统计
- `GET /api/admin/users` 获取用户列表
- `GET /api/admin/users/:id` 获取用户详情
- `DELETE /api/admin/users/:id` 删除用户

## 数据库设计（简述）

- `users`：学生账户
- `admins`：管理员账户
- `words`：单词表（按用户隔离）
- `errors`：错题状态表（与 `word_id` 一一对应）
- `dictation_sessions`：听写会话汇总
- `dictation_records`：听写明细（每个词的正误）

## 开发说明

- 静态资源目录为 `public/`，由 Express 直接托管
- 上传目录 `uploads/` 会自动创建，文件解析后会删除临时文件
- 用户端和管理端共用同一前端应用，根据 token 状态切换视图

## 常见问题

### 1) 启动报数据库连接失败

请确认：

- MySQL 服务已启动
- `server.js` 中账号密码正确
- `dictation_app` 数据库存在并已导入 SQL

### 2) 收不到短信验证码

如果是本地开发，保持 `DEV_MODE = true`，验证码固定为 `123456`。

若需真实短信，请正确填写 `SMS_CONFIG` 并将 `DEV_MODE` 改为 `false`。

### 3) 管理员无法登录

检查 `admins` 表是否有数据；若为空，重启服务会自动创建默认管理员账号。

## 生产环境注意事项

当前代码为开发优先实现，生产部署前请务必处理：

- 将密钥、数据库密码、短信配置改为环境变量
- 关闭 `DEV_MODE`
- 更换默认管理员密码
- 增加请求限流、日志审计、错误告警
- 根据需要补充 CORS、HTTPS、反向代理和备份策略



