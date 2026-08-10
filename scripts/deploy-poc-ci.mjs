// Installs dependencies and runs the POC deployer with the selected Node runtime.
import { spawnSync } from 'node:child_process'

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`Node command failed with exit code ${result.status ?? 'unknown'}`)
  }
}

const npmCli = process.env.npm_execpath
if (!npmCli) {
  throw new Error('npm_execpath is required to install deployment dependencies.')
}

runNode([npmCli, 'ci'])
runNode(['scripts/deploy-poc.mjs', ...process.argv.slice(2)])
