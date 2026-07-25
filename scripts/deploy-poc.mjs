// Builds and uploads POC application artifacts using the active AWS credential environment.
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile, readdir, rm, mkdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { UpdateFunctionCodeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArguments(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index]
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`)
    const key = name.slice(2)
    if (key === 'build-only') {
      result.buildOnly = true
      continue
    }
    const value = values[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    result[key] = value
    index += 1
  }
  return result
}

function requireArgument(args, name) {
  if (!args[name]) throw new Error(`Missing required argument --${name}`)
  return args[name]
}

function assertCredentialEnvironment() {
  const hasProfile = Boolean(process.env.AWS_PROFILE)
  const hasStaticCredentials = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
  )
  const hasWebIdentity = Boolean(
    process.env.AWS_ROLE_ARN && process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
  )
  const hasContainerCredentials = Boolean(
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
  )
  if (!hasProfile && !hasStaticCredentials && !hasWebIdentity && !hasContainerCredentials) {
    throw new Error(
      'No explicit AWS credential environment is configured. Set AWS_PROFILE or AWS credential variables.',
    )
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

async function createArchive(sourceFile, destinationFile) {
  await new Promise((resolveArchive, rejectArchive) => {
    const output = createWriteStream(destinationFile)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    output.on('close', resolveArchive)
    output.on('error', rejectArchive)
    archive.on('error', rejectArchive)
    archive.pipe(output)
    archive.file(sourceFile, { name: 'index.js' })
    archive.finalize()
  })
}

async function walkFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function contentType(path) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }
  return types[extname(path).toLowerCase()] || 'application/octet-stream'
}

async function syncFrontend(s3, bucket, directory) {
  const localFiles = await walkFiles(directory)
  const localKeys = new Set()

  for (const path of localFiles) {
    const key = relative(directory, path).replaceAll('\\', '/')
    localKeys.add(key)
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(path),
        ContentType: contentType(path),
        CacheControl:
          key === 'index.html'
            ? 'no-cache'
            : key.startsWith('assets/')
              ? 'public,max-age=31536000,immutable'
              : 'public,max-age=3600',
      }),
    )
  }

  const remoteKeys = []
  let continuationToken
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    )
    remoteKeys.push(...(page.Contents || []).map(item => item.Key).filter(Boolean))
    continuationToken = page.NextContinuationToken
  } while (continuationToken)

  const obsoleteKeys = remoteKeys.filter(key => !localKeys.has(key))
  for (let offset = 0; offset < obsoleteKeys.length; offset += 1000) {
    const batch = obsoleteKeys.slice(offset, offset + 1000)
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map(Key => ({ Key })),
          Quiet: true,
        },
      }),
    )
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const region = requireArgument(args, 'region')
  const lambdaFunction = requireArgument(args, 'lambda-function')
  const frontendBucket = requireArgument(args, 'frontend-bucket')
  const distributionId = requireArgument(args, 'distribution-id')
  const userPoolId = requireArgument(args, 'user-pool-id')
  const userPoolClientId = requireArgument(args, 'user-pool-client-id')
  const pocUrl = requireArgument(args, 'poc-url')
  if (!args.buildOnly) assertCredentialEnvironment()

  const artifactsRoot = join(repositoryRoot, '.artifacts', 'poc')
  if (!artifactsRoot.startsWith(repositoryRoot)) {
    throw new Error('Refusing to manage artifacts outside the repository.')
  }
  await rm(artifactsRoot, { recursive: true, force: true })
  await mkdir(artifactsRoot, { recursive: true })

  const apiBundle = join(artifactsRoot, 'index.js')
  const apiArchive = join(artifactsRoot, 'api.zip')
  run('npx', [
    '--no-install',
    'esbuild',
    'apps/api/src/lambda.js',
    '--bundle',
    '--platform=node',
    '--target=node20',
    `--outfile=${apiBundle}`,
  ])
  await createArchive(apiBundle, apiArchive)

  run('npm', ['run', 'build', '--workspace', '@kesahomma26/frontend'], {
    env: {
      VITE_API_URL: '',
      VITE_USER_POOL_ID: userPoolId,
      VITE_USER_POOL_CLIENT_ID: userPoolClientId,
    },
  })

  if (args.buildOnly) {
    console.log(JSON.stringify({ event: 'poc_artifacts_built', artifactsRoot }))
    return
  }

  const lambda = new LambdaClient({ region })
  const s3 = new S3Client({ region })
  const cloudFront = new CloudFrontClient({ region: 'us-east-1' })
  await lambda.send(
    new UpdateFunctionCodeCommand({
      FunctionName: lambdaFunction,
      ZipFile: await readFile(apiArchive),
    }),
  )
  await syncFrontend(s3, frontendBucket, join(repositoryRoot, 'apps', 'frontend', 'dist'))
  await cloudFront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `poc-${Date.now()}`,
        Paths: {
          Quantity: 1,
          Items: ['/*'],
        },
      },
    }),
  )

  const bundleStats = await stat(apiArchive)
  console.log(
    JSON.stringify({
      event: 'poc_deployment_completed',
      pocUrl,
      lambdaArchiveBytes: bundleStats.size,
      frontendFiles: (await walkFiles(join(repositoryRoot, 'apps', 'frontend', 'dist'))).length,
    }),
  )
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
