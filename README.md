# AI Model Router

统一 AI 模型接口网关，支持文本、语音、图像请求的自动故障切换。

## 快速开始

```bash
npm install
cp .env.example .env
# 在 .env 中填写你的 API Key
npm run build
AMR_CONFIG=examples/config.yaml npm start
```

访问 Web UI: `http://localhost:8080`

## 核心行为

- 调用方统一请求 `/v1/*`
- 调用方可以固定传 `model: custom-model`
- Router 内部会根据可用模型池自动选择真实模型并切换
- 对外返回的 `model` 默认为 `custom-model`（可配置）
- Chat 返回会被标准化为 OpenAI Chat Completions 兼容格式（适配 OpenClaw / ClaudeCode / OpenCode 等）

## 鉴权

- 业务调用鉴权：`server.accessApiKey`
  - 作用范围：`/v1/chat/*`、`/v1/audio/*`、`/v1/images/*`
  - 支持请求头：`Authorization: Bearer <key>` 或 `x-api-key: <key>`
- 管理接口鉴权：`server.adminApiKey`
  - 作用范围：`/_internal/*`
  - 请求头：`x-amr-admin-key: <key>`

## 端口与主机配置

支持三种方式（优先级由高到低）：
1. 环境变量 `AMR_PORT` / `AMR_HOST`
2. 环境变量 `PORT` / `HOST`
3. `config.yaml` 中 `server.port` / `server.host`

## 配置说明

- `server.accessApiKey` 建议直接配置在 `config.yaml`，由用户自行管理
- `examples/config.yaml` 中模型密钥可用 `${OPENAI_API_KEY}` / `${ALIYUN_API_KEY}`
- 服务会自动读取项目根目录 `.env`
- 也支持 `AMR_ENV_FILE=/path/to/your.env` 指定自定义 env 文件
- Web UI 支持新增模型、删除模型、更新模型 API Key（Key 在列表中脱敏显示）
- Web UI 提供独立“网关设置”页面，可配置/更新 `accessApiKey`、网关端口 `port`、对外模型名 `publicModelName`
- 模型 `usedTokens` 会持久化到 `<config>.state.json`，重启后继续累计

## OpenClaw 示例配置

- Base URL: `http://127.0.0.1:8080/v1`
- API Key: `server.accessApiKey` 的值（在 `config.yaml` 中配置）
- Model: `custom-model`

## API

- `GET /v1/models`
- `GET /v1/models/:id`
- `POST /v1/chat/completions`
- `POST /v1/multimodal/completions`
- `POST /v1/semantic` (按语义自动路由到 llm/visual/multimodal/voice/vector)
- `POST /v1/embeddings`
- `POST /v1/audio/speech`
- `POST /v1/images/generations`
- `GET /_internal/models`
- `GET /_internal/stats`
- `GET /_internal/health`

### 生成图片文件清理

- 对于上游返回 `b64_json` 的图片结果，网关会落盘并返回本地可访问 URL（`/_generated/images/*`）
- `/_generated/images/*` 使用与 `/v1/*` 相同的 `server.accessApiKey` 鉴权规则
  - 若配置了 `accessApiKey`，网关会返回短时效签名 URL（默认 10 分钟）
  - 也支持携带 `Authorization: Bearer <key>` 或 `x-api-key: <key>` 访问图片
  - 若未配置 `accessApiKey`，则不做鉴权
- 可通过环境变量 `AMR_SIGNED_IMAGE_URL_TTL_SECONDS` 调整签名 URL 有效期（秒）
  - 默认 `600`（10 分钟）
- 可选配置 `server.publicBaseUrl`（如 `https://img.example.com`）
  - 配置后，网关返回的图片 URL 会固定使用该域名（便于反向代理/CDN）
  - 未配置时，仍按请求头自动推断 `http(s)://host`
- 默认自动清理 `data/generated-images` 中超过 24 小时的旧文件
- 可通过环境变量 `AMR_GENERATED_IMAGE_RETENTION_HOURS` 调整保留时长（小时）
  - 例如：`AMR_GENERATED_IMAGE_RETENTION_HOURS=72`
  - 设置为 `0` 或负数可关闭自动清理

## CLI

```bash
npm run build
node dist/cli/index.js init
node dist/cli/index.js start --daemon
node dist/cli/index.js status
```

- CLI 默认配置路径：`~/.amr/config.yaml`
- 若该文件不存在，`start/validate` 会回退到项目内 `examples/config.yaml`

## 可执行文件（Windows/macOS）

```bash
npm run pkg
```

输出目录：`dist/executable`

- 会生成 Windows / macOS(x64/arm64) 对应的可执行文件（文件名由 `pkg` 按 target 生成）

使用方式与 CLI 一致：

```bash
./ai-model-router init
./ai-model-router start
./ai-model-router status
```
