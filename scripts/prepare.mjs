import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const folders = [
	resolve(__dirname, '../intermediate'),
	resolve(__dirname, '../intermediate/bundled'),
	resolve(__dirname, '../intermediate/jsm'),
	resolve(__dirname, '../intermediate/minified'),
	resolve(__dirname, '../build'),
]

for (let i = 0; i < folders.length; i++) {
	const folder = folders[i]
	if (existsSync(folder)) continue
	await mkdir(folder)
}
