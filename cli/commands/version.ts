export function versionCommand(): void {
  console.log(process.env.npm_package_version || '1.0.0')
}
