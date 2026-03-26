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

### OpenClaw Task API

OpenClaw 风格请求可以直接发送到以下入口：

- `POST /v1/tasks/openclaw/resolve`
- `POST /v1/tasks/openclaw/execute`
- `GET /v1/tasks/openclaw/ws`（WebSocket upgrade）

鉴权方式与其他 `/v1/*` 接口一致：

- `Authorization: Bearer <server.accessApiKey>`
- 或 `x-api-key: <server.accessApiKey>`

`openclaw-adapter` 会自动做这些归一化：

- `session.key` / `sessionKey` 映射为内部 `sessionKey`
- `action` 映射为 `chat` / `embed` / `speech` / `generate`
- `input.text` 自动折算为内部 `input`
- `input.attachments` 中的图片会自动折算为 multimodal chat messages
- `hints.operation` / `hints.modality` 会参与任务类型推断

#### 文本 Chat（SSE 流式）

`chat` 在未显式设置 `stream: false` 时默认走流式返回：

```bash
curl -N http://127.0.0.1:8080/v1/tasks/openclaw/execute \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "session": { "key": "agent:main:main" },
    "action": "chat",
    "input": {
      "text": "给我一句很短的自我介绍",
      "stream": true
    }
  }'
```

#### 多模态 Chat（文本 + 图片）

图片附件会被自动折算成内部 multimodal message：

```bash
curl http://127.0.0.1:8080/v1/tasks/openclaw/execute \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionKey": "agent:vision:demo",
    "action": "chat",
    "input": {
      "text": "描述这张图片里有什么",
      "attachments": [
        {
          "type": "image_url",
          "url": "https://example.com/cat.png"
        }
      ],
      "stream": false
    }
  }'
```

#### Embeddings

```bash
curl http://127.0.0.1:8080/v1/tasks/openclaw/execute \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionKey": "agent:embed:demo",
    "action": "embed",
    "input": {
      "text": "AI Model Router"
    }
  }'
```

也可以通过 hints 显式指定向量任务：

```bash
curl http://127.0.0.1:8080/v1/tasks/openclaw/execute \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "generate",
    "input": {
      "text": "embed this text"
    },
    "hints": {
      "modality": "vector",
      "operation": "embeddings"
    }
  }'
```

#### Speech

```bash
curl http://127.0.0.1:8080/v1/tasks/openclaw/execute \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  --output speech.mp3 \
  -d '{
    "sessionKey": "agent:tts:demo",
    "action": "generate",
    "input": {
      "text": "你好，这是网关语音测试",
      "voice": "alloy",
      "response_format": "mp3"
    },
    "hints": {
      "modality": "audio",
      "operation": "speech"
    }
  }'
```

#### Image Generation

```bash
curl http://127.0.0.1:8080/v1/tasks/openclaw/execute \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionKey": "agent:image:demo",
    "action": "generate",
    "input": {
      "prompt": "A clean product illustration of a robot gateway",
      "size": "1024x1024",
      "n": 1
    },
    "hints": {
      "modality": "image",
      "operation": "image_generation"
    }
  }'
```

如果上游返回 `b64_json`，网关会自动标准化为可访问图片 URL。

#### Resolve 调试

联调时如果想先看 OpenClaw payload 被映射成什么内部任务，可以先调用：

```bash
curl http://127.0.0.1:8080/v1/tasks/openclaw/resolve \
  -H "Authorization: Bearer <ACCESS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionKey": "agent:debug:demo",
    "action": "chat",
    "input": {
      "text": "hello",
      "attachments": [
        {
          "type": "image_url",
          "url": "https://example.com/cat.png"
        }
      ]
    }
  }'
```

返回中会包含：

- `sessionKey`
- `gatewayTask`
- `task`

#### WebSocket

如果你希望用单条长连接发送 OpenClaw 任务，可以连接：

```text
ws://127.0.0.1:8080/v1/tasks/openclaw/ws
```

鉴权支持：

- 请求头 `Authorization: Bearer <ACCESS_API_KEY>`
- 请求头 `x-api-key: <ACCESS_API_KEY>`
- 或 query string `?api_key=<ACCESS_API_KEY>`

客户端发送消息时，`data` 直接复用 `openclaw/execute` 的请求体：

```json
{
  "id": "req_001",
  "type": "task.execute",
  "data": {
    "session": { "key": "agent:main:main" },
    "action": "chat",
    "input": {
      "text": "hello",
      "stream": true
    }
  }
}
```

也支持：

- `type: "task.resolve"`
- `type: "task.cancel"`
- `type: "ping"`

服务端返回消息类型：

- `task.resolved`
- `task.result`
- `task.chunk`
- `task.cancelled`
- `task.completed`
- `task.error`
- `pong`

其中：

- 非流式结果通过 `task.result` 返回
- 流式 chat 会把 SSE 事件拆成多条 `task.chunk`，结束时发送 `task.completed`
- 二进制语音结果会通过 `task.result.data.base64` 返回
- 第一版 `task.cancel` 只支持取消正在进行中的流式 chat，请求格式如下：

```json
{
  "id": "req_cancel",
  "type": "task.cancel",
  "data": {
    "requestId": "req_stream"
  }
}
```

- 取消成功后会返回 `task.cancelled`
- 如果 WebSocket 连接关闭，正在进行中的流式 chat 也会被自动清理

项目里也提供了一个最小联调脚本：

```bash
npm run build
node scripts/openclaw_ws_client.js \
  --url ws://127.0.0.1:8080/v1/tasks/openclaw/ws \
  --api-key <ACCESS_API_KEY> \
  --payload examples/openclaw-ws-chat.json
```

也可以直接传内联 JSON：

```bash
node scripts/openclaw_ws_client.js \
  --url ws://127.0.0.1:8080/v1/tasks/openclaw/ws \
  --api-key <ACCESS_API_KEY> \
  --payload '{"action":"chat","input":{"text":"hello","stream":true}}'
```

如果你想验证整条链路是否可用，也可以直接跑端到端 smoke test：

```bash
npm run smoke:openclaw-ws
```

这条测试会：

- 启动一个本地 mock OpenAI 兼容服务
- 启动 AMR
- 通过 `/v1/tasks/openclaw/ws` 发送真实 WebSocket 请求
- 校验流式 chat 的 `task.chunk` / `task.completed`
- 校验 embeddings 的非流式 `task.result`
- 校验 speech 的 base64 二进制返回
- 校验 image generation 的 `b64_json -> hosted URL` 标准化
- 校验 `task.resolve` 的任务映射结果
- 校验 `ping -> pong` 的协议保活行为

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
