#!/usr/bin/env node
import 'dotenv/config'
import { Command } from 'commander'
import { initCommand } from './commands/init'
import { startCommand } from './commands/start'
import { stopCommand } from './commands/stop'
import { restartCommand } from './commands/restart'
import { statusCommand } from './commands/status'
import { logsCommand } from './commands/logs'
import { configCommand } from './commands/config'
import { uiCommand } from './commands/ui'
import { versionCommand } from './commands/version'
import { validateCommand } from './commands/validate'
import { exportCommand } from './commands/export'
import { importCommand } from './commands/import'
import { desktopCommand } from './commands/desktop'
import { startServer } from '../src/index'

const finderLaunchArgPattern = /^-psn_/i

function normalizeCliArgv(argv: string[]): string[] {
  if (argv.length <= 2) return argv
  const [nodePath, entryPath, ...rest] = argv
  const filtered = rest.filter((arg) => !finderLaunchArgPattern.test(arg))
  return [nodePath, entryPath, ...filtered]
}

function shouldAutoLaunchDesktop(argv: string[]): boolean {
  return argv.length <= 2
}

if (process.env.AMR_INTERNAL_MODE === 'server') {
  startServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
} else {
  const normalizedArgv = normalizeCliArgv(process.argv)

  if (shouldAutoLaunchDesktop(normalizedArgv)) {
    desktopCommand({ open: true, foreground: process.platform === 'win32' }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
  } else {
    const program = new Command()

    program.name('amr').description('AI Model Router CLI').version('1.0.0')

    program.command('init').description('Initialize configuration').action(initCommand)
    program
      .command('start')
      .description('Start service')
      .option('-c, --config <path>', 'Config path', '')
      .option('-p, --port <number>', 'Port')
      .option('--host <host>', 'Host')
      .option('-d, --daemon', 'Run as daemon', false)
      .action(startCommand)
    program.command('stop').description('Stop service').action(stopCommand)
    program
      .command('restart')
      .description('Restart service')
      .option('-c, --config <path>', 'Config path', '')
      .option('-p, --port <number>', 'Port')
      .option('--host <host>', 'Host')
      .option('-d, --daemon', 'Run as daemon', false)
      .action(restartCommand)
    program.command('status').description('Service status').action(statusCommand)
    program
      .command('logs')
      .description('Show logs')
      .option('-f, --follow', 'Follow', false)
      .option('--tail <n>', 'Tail lines', '100')
      .action(logsCommand)
    program.command('config').description('Show config path').action(configCommand)
    program.command('ui').description('Open Web UI').option('-p, --port <n>', 'Port', '8080').option('--open', 'Open browser', true).action(uiCommand)
    program
      .command('desktop')
      .description('Start daemon and open GUI')
      .option('-c, --config <path>', 'Config path', '')
      .option('-p, --port <number>', 'Port')
      .option('--host <host>', 'Host')
      .option('--no-open', 'Do not open browser')
      .option('--foreground', 'Run service in foreground', false)
      .action((opts) => desktopCommand(opts))
    program.command('version').description('Show version').action(versionCommand)
    program.command('validate').description('Validate config').option('-c, --config <path>', 'Config path', '').action((opts) => validateCommand(opts.config))
    program.command('export').description('Export config').option('-o, --output <path>', 'Output path', '').action((opts) => exportCommand(opts.output))
    program.command('import').description('Import config').argument('<source>', 'Source file').action(importCommand)

    program.parse(normalizedArgv)
  }
}
