// `mirror fetch` snapshots each configured upstream item into the repo;
// `mirror build` converts the snapshots and updates registry.json. Build reads
// only snapshots, so a conversion change is reviewable without upstream
// moving underneath it.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildComponent, type RegistryItem, type UpstreamItem } from './component.ts'
import { type MirrorConfig, parseConfig, upstreamUrl } from './config.ts'
import { type Registry, upsertItems } from './registry.ts'

export type Io = {
  root: string
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
  log: (message: string) => void
  format: (path: string, content: string) => string
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function writeFormatted(io: Io, path: string, content: string): Promise<void> {
  await writeText(join(io.root, path), io.format(path, content))
}

function snapshotPath(io: Io, config: MirrorConfig, name: string): string {
  return join(io.root, config.snapshotDir, config.upstream.style, `${name}.json`)
}

async function fetchAll(io: Io, config: MirrorConfig): Promise<void> {
  for (const name of config.components) {
    const url = upstreamUrl(config, name)
    const response = await io.fetch(url)
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
    await writeText(
      snapshotPath(io, config, name),
      `${JSON.stringify(await response.json(), null, 2)}\n`,
    )
    io.log(`fetched ${config.upstream.style}/${name}`)
  }
}

async function buildAll(io: Io, config: MirrorConfig): Promise<void> {
  const items: RegistryItem[] = []
  for (const name of config.components) {
    const upstream = (await readJson(snapshotPath(io, config, name)).catch(() => {
      throw new Error(`no snapshot for ${config.upstream.style}/${name}; run mirror fetch first`)
    })) as UpstreamItem
    const component = await buildComponent(upstream, config)
    for (const file of component.files) await writeFormatted(io, file.path, file.content)
    items.push(component.item)
    io.log(`built ${name}: ${component.files.map((file) => file.path).join(', ')}`)
    for (const [slot, classes] of Object.entries(component.unresolved)) {
      io.log(`  ${slot}: no CSS for ${classes.join(' ')}`)
    }
  }
  const registry = upsertItems((await readJson(join(io.root, 'registry.json'))) as Registry, items)
  await writeFormatted(io, 'registry.json', `${JSON.stringify(registry, null, 2)}\n`)
}

export async function run(args: string[], io: Io): Promise<void> {
  const [command, ...rest] = args
  if ((command !== 'fetch' && command !== 'build') || rest.length > 0) {
    throw new Error('usage: mirror <fetch|build>')
  }
  const config = parseConfig(await readJson(join(io.root, 'mirror.config.json')))
  if (command === 'fetch') await fetchAll(io, config)
  else await buildAll(io, config)
}
