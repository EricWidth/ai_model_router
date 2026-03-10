import { configDir, defaultConfigPath } from '../utils/paths'

export function configCommand(): void {
  console.log(`配置目录: ${configDir()}`)
  console.log(`配置文件: ${defaultConfigPath()}`)
}
