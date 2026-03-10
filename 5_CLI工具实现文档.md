# CLI 工具实现文档

## 一、功能概述

CLI 工具是 AI Model Router 的命令行接口，提供服务的启动、停止、监控和管理功能，让用户通过简单的命令完成所有操作。

## 二、核心功能

1. **服务管理**
   - 启动/停止/重启服务
   - 查看服务状态
   - 查看服务日志

2. **配置管理**
   - 初始化配置
   - 验证配置
   - 导出/导入配置

3. **UI 管理**
   - 打开 Web 管理界面
   - 自动浏览器启动

4. **其他功能**
   - 版本信息
   - 帮助文档
   - 守护进程管理

## 三、命令设计

### 3.1 命令列表

```bash
amr init           # 初始化配置
amr start          # 启动服务
amr stop           # 停止服务
amr restart        # 重启服务
amr status         # 查看状态
amr logs           # 查看日志
amr config         # 打开配置目录
amr ui             # 打开 Web UI
amr version        # 查看版本
amr validate       # 验证配置
amr export         # 导出配置
amr import         # 导入配置
amr help           # 帮助信息
```

### 3.2 命令选项

```bash
amr start [options]
  --config, -c <path>    # 配置文件路径
  --port, -p <number>    # 端口号
  --host <address>       # 主机地址
  --daemon, -d           # 后台运行
  --verbose, -v          # 详细输出

amr stop [options]
  --force, -f            # 强制停止

amr logs [options]
  --follow, -f           # 持续查看日志
  --tail <number>        # 显示最后 N 行
  --output <file>        # 导出日志

amr ui [options]
  --port <number>        # Web UI 端口
  --open                 # 自动打开浏览器
```

## 四、模块设计

### 4.1 目录结构

```
cli/
├── index.ts              # CLI 主入口
├── commands/
│   ├── init.ts           # 初始化命令
│   ├── start.ts          # 启动命令
│   ├── stop.ts           # 停止命令
│   ├── restart.ts        # 重启命令
│   ├── status.ts         # 状态命令
│   ├── logs.ts           # 日志命令
│   ├── config.ts         # 配置命令
│   ├── ui.ts             # UI 命令
│   ├── validate.ts       # 验证命令
│   ├── export.ts         # 导出命令
│   ├── import.ts         # 导入命令
│   └── version.ts        # 版本命令
└── utils/
    ├── daemon.ts         # 守护进程管理
    ├── pidfile.ts        # PID 文件管理
    └── paths.ts          # 路径管理

bin/
└── cli.js                # CLI 可执行入口
```

## 五、实现细节

### 5.1 CLI 主入口

```typescript
// cli/index.ts
#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { initCommand } from './commands/init'
import { startCommand } from './commands/start'
import { stopCommand } from './commands/stop'
import { restartCommand } from './commands/restart'
import { statusCommand } from './commands/status'
import { logsCommand } from './commands/logs'
import { configCommand } from './commands/config'
import { uiCommand } from './commands/ui'
import { versionCommand } from './commands/version'

const program = new Command()

program
  .name('amr')
  .description('AI Model Router CLI')
  .version('1.0.0')

program
  .command('init')
  .description('Initialize configuration')
  .action(initCommand)

program
  .command('start')
  .description('Start the service')
  .option('-c, --config <path>', 'Configuration file path', '~/.amr/config.yaml')
  .option('-p, --port <number>', 'Port number', '8080')
  .option('--host <address>', 'Host address', '0.0.0.0')
  .option('-d, --daemon', 'Run as daemon', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(startCommand)

program
  .command('stop')
  .description('Stop the service')
  .option('-f, --force', 'Force stop', false)
  .action(stopCommand)

program
  .command('restart')
  .description('Restart the service')
  .option('-c, --config <path>', 'Configuration file path', '~/.amr/config.yaml')
  .option('-p, --port <number>', 'Port number', '8080')
  .option('--host <address>', 'Host address', '0.0.0.0')
  .option('-d, --daemon', 'Run as daemon', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(restartCommand)

program
  .command('status')
  .description('Show service status')
  .action(statusCommand)

program
  .command('logs')
  .description('Show service logs')
  .option('-f, --follow', 'Follow log output', false)
  .option('--tail <number>', 'Show last N lines', '100')
  .option('--output <file>', 'Output to file')
  .action(logsCommand)

program
  .command('config')
  .description('Open configuration directory')
  .action(configCommand)

program
  .command('ui')
  .description('Open Web UI in browser')
  .option('-p, --port <number>', 'Web UI port', '8080')
  .option('--open', 'Open browser automatically', true)
  .action(uiCommand)

program
  .command('version')
  .description('Show version information')
  .action(versionCommand)

program.parse()
```

### 5.2 初始化命令

```typescript
// cli/commands/init.ts
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import chalk from 'chalk'
import { homedir } from '../utils/paths'

export async function initCommand() {
  const configDir = path.join(homedir(), '.amr')
  const configPath = path.join(configDir, 'config.yaml')

  try {
    await fs.mkdir(configDir, { recursive: true })

    const existingConfig = await fs.readFile(configPath, 'utf-8').catch(() => null)

    if (existingConfig) {
      console.log(chalk.yellow('Configuration already exists.'))
      console.log(chalk.gray(`Location: ${configPath}`))

      return
    }

    const defaultConfig = `server:
  port: 8080
  host: 0.0.0.0
  cors: true

models:
  text:
    - name: gpt-4o
      provider: openai
      apiKey: \${OPENAI_API_KEY}
      baseUrl: https://api.openai.com/v1
      quota: 1000
      priority: 1
      timeout: 30000

  voice:
    - name: tts-1
      provider: openai
      apiKey: \${OPENAI_API_KEY}
      priority: 1

  image:
    - name: dall-e-3
      provider: openai
      apiKey: \${OPENAI_API_KEY}
      priority: 1

switch:
  maxRetries: 3
  cooldown: 60000
  healthCheckInterval: 300000
`

    await fs.writeFile(configPath, defaultConfig, 'utf-8')

    console.log(chalk.green('Configuration initialized successfully!'))
    console.log(chalk.gray(`Location: ${configPath}`))
    console.log(chalk.yellow('Please edit the configuration file to add your API keys.'))

  } catch (error) {
    console.error(chalk.red('Failed to initialize configuration:'), error)
    process.exit(1)
  }
}
```

### 5.3 启动命令

```typescript
// cli/commands/start.ts
import { readFileSync } from 'fs'
import path from 'path'
import chalk from 'chalk'
import { spawn, ChildProcess } from 'child_process'
import { getConfigPath } from '../utils/paths'
import { writePidFile, readPidFile } from '../utils/pidfile'

export interface StartOptions {
  config: string
  port: string
  host: string
  daemon: boolean
  verbose: boolean
}

export async function startCommand(options: StartOptions) {
  const pidPath = path.join(path.dirname(getConfigPath(options.config)), 'amr.pid')
  const existingPid = await readPidFile(pidPath)

  if (existingPid) {
    try {
      process.kill(existingPid, 0)
      console.log(chalk.red(`Service is already running (PID: ${existingPid})`))
      return
    } catch {
      await writePidFile(pidPath, 0)
    }
  }

  const args = ['dist/index.js']

  if (options.verbose) {
    args.push('--verbose')
  }

  const env = {
    ...process.env,
    AMR_CONFIG: getConfigPath(options.config),
    AMR_PORT: options.port,
    AMR_HOST: options.host
  }

  let child: ChildProcess

  if (options.daemon) {
    child = spawn('node', args, {
      detached: true,
      env,
      stdio: 'ignore'
    })

    child.unref()

    await writePidFile(pidPath, child.pid!)

    console.log(chalk.green(`Service started successfully (PID: ${child.pid})`))
    console.log(chalk.gray(`Port: ${options.port}`))
    console.log(chalk.gray(`Config: ${getConfigPath(options.config)}`))

  } else {
    child = spawn('node', args, {
      env,
      stdio: 'inherit'
    })

    await writePidFile(pidPath, child.pid!)

    child.on('exit', (code) => {
      process.exit(code || 0)
    })
  }
}
```

### 5.4 停止命令

```typescript
// cli/commands/stop.ts
import path from 'path'
import chalk from 'chalk'
import { getConfigPath } from '../utils/paths'
import { readPidFile, deletePidFile } from '../utils/pidfile'

export interface StopOptions {
  force: boolean
}

export async function stopCommand(options: StopOptions) {
  const pidPath = path.join(path.dirname(getConfigPath()), 'amr.pid')
  const pid = await readPidFile(pidPath)

  if (!pid) {
    console.log(chalk.yellow('Service is not running.'))
    return
  }

  try {
    process.kill(pid, options.force ? 'SIGKILL' : 'SIGTERM')

    if (!options.force) {
      await new Promise(resolve => setTimeout(resolve, 5000))

      try {
        process.kill(pid, 0)
        console.log(chalk.yellow('Service did not stop gracefully, forcing...'))
        process.kill(pid, 'SIGKILL')
      } catch {
      }
    }

    await deletePidFile(pidPath)
    console.log(chalk.green('Service stopped successfully.'))

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      await deletePidFile(pidPath)
      console.log(chalk.yellow('Service was not running (cleaning up PID file).'))
    } else {
      console.error(chalk.red('Failed to stop service:'), error)
      process.exit(1)
    }
  }
}
```

### 5.5 状态命令

```typescript
// cli/commands/status.ts
import chalk from 'chalk'
import axios from 'axios'
import { getConfigPath } from '../utils/paths'
import { readPidFile } from '../utils/pidfile'
import path from 'path'

export async function statusCommand() {
  const pidPath = path.join(path.dirname(getConfigPath()), 'amr.pid')
  const pid = await readPidFile(pidPath)

  if (!pid) {
    console.log(chalk.yellow('Service is not running.'))
    return
  }

  try {
    process.kill(pid, 0)

    console.log(chalk.green(`Service is running (PID: ${pid})`))

    try {
      const response = await axios.get('http://localhost:8080/_internal/health', {
        timeout: 2000
      })

      console.log(chalk.gray('Health:'), chalk.green('Healthy'))
      console.log(chalk.gray('Available Models:'), response.data.availableModels)
      console.log(chalk.gray('Total Models:'), response.data.totalModels)

    } catch (error) {
      console.log(chalk.gray('Health:'), chalk.yellow('Checking...'))
    }

  } catch (error) {
    console.log(chalk.yellow('Service is not running.'))
  }
}
```

### 5.6 日志命令

```typescript
// cli/commands/logs.ts
import chalk from 'chalk'
import { spawn } from 'child_process'
import path from 'path'
import { getConfigPath } from '../utils/paths'

export interface LogsOptions {
  follow: boolean
  tail: string
  output?: string
}

export async function logsCommand(options: LogsOptions) {
  const logPath = path.join(path.dirname(getConfigPath()), 'logs', 'app.log')

  const args = ['-n', options.tail]

  if (options.follow) {
    args.push('-f')
  }

  if (options.output) {
    console.log(chalk.gray(`Exporting logs to ${options.output}...`))
    args.push('>', options.output)
  }

  const tail = spawn('tail', args.join === undefined ? args : args.join(' '))

  tail.stdout!.pipe(process.stdout)
  tail.stderr!.pipe(process.stderr)
}
```

### 5.7 UI 命令

```typescript
// cli/commands/ui.ts
import chalk from 'chalk'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface UiOptions {
  port: string
  open: boolean
}

export async function uiCommand(options: UiOptions) {
  const url = `http://localhost:${options.port}`

  if (options.open) {
    const platform = process.platform
    let command: string

    switch (platform) {
      case 'darwin':
        command = `open "${url}"`
        break
      case 'win32':
        command = `start "" "${url}"`
        break
      default:
        command = `xdg-open "${url}"`
        break
    }

    try {
      await execAsync(command)
      console.log(chalk.green(`Opening ${url} in your browser...`))
    } catch (error) {
      console.log(chalk.yellow(`Please open ${url} in your browser`))
    }
  } else {
    console.log(chalk.gray(`Web UI is available at ${url}`))
  }
}
```

### 5.8 工具函数

```typescript
// cli/utils/paths.ts
import * as os from 'os'
import * as path from 'path'

export function homedir(): string {
  return os.homedir()
}

export function getConfigPath(configPath?: string): string {
  if (configPath) {
    if (configPath.startsWith('~')) {
      return path.join(homedir(), configPath.slice(1))
    }
    return configPath
  }
  return path.join(homedir(), '.amr', 'config.yaml')
}

export function getPidPath(configPath?: string): string {
  const configDir = path.dirname(getConfigPath(configPath))
  return path.join(configDir, 'amr.pid')
}

export function getLogPath(configPath?: string): string {
  const configDir = path.dirname(getConfigPath(configPath))
  return path.join(configDir, 'logs', 'app.log')
}
```

```typescript
// cli/utils/pidfile.ts
import * as fs from 'fs/promises'
import path from 'path'

export async function writePidFile(filePath: string, pid: number): Promise<void> {
  await fs.writeFile(filePath, pid.toString(), 'utf-8')
}

export async function readPidFile(filePath: string): Promise<number | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return parseInt(content, 10)
  } catch {
    return null
  }
}

export async function deletePidFile(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {})
}
```

### 5.9 可执行入口

```javascript
#!/usr/bin/env node
require('../dist/cli/index.js')
```

## 六、使用示例

### 6.1 初始化配置

```bash
$ amr init
Configuration initialized successfully!
Location: /Users/username/.amr/config.yaml
```

### 6.2 启动服务

```bash
$ amr start
Service started successfully (PID: 12345)
Port: 8080
Config: /Users/username/.amr/config.yaml
```

### 6.3 查看状态

```bash
$ amr status
Service is running (PID: 12345)
Health: Healthy
Available Models: 3
Total Models: 5
```

### 6.4 停止服务

```bash
$ amr stop
Service stopped successfully.
```

### 6.5 查看日志

```bash
$ amr logs -f
```

### 6.6 打开 UI

```bash
$ amr ui
Opening http://localhost:8080 in your browser...
```

## 七、测试用例

### 7.1 初始化测试

```typescript
describe('init command', () => {
  it('should create config directory', async () => {
    await initCommand()
    const configDir = path.join(homedir(), '.amr')
    await expect(fs.access(configDir)).resolves.toBeDefined()
  })
})
```

### 7.2 启动测试

```typescript
describe('start command', () => {
  it('should start service in daemon mode', async () => {
    await startCommand({ daemon: true })
    const pid = await readPidFile(pidPath)
    expect(pid).toBeGreaterThan(0)
  })
})
```

## 八、扩展点

1. **子命令**: 支持插件式子命令扩展
2. **Tab 补全**: 支持 bash/zsh 自动补全
3. **配置模板**: 预设常用配置模板
4. **批量操作**: 支持批量模型管理
5. **远程管理**: 支持远程服务器管理
