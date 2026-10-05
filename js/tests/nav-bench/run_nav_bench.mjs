// usage: node js/tests/nav-bench/run_nav_bench.mjs nav|nav2 [rows=1000000]
//   [repeats=3]
// times the ops of ui_nav.js (nav) or ui_nav2.js (nav2) in headless Chrome
// and prints min and median ms per op.

import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {extname, join, normalize} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const bench_dir = fileURLToPath(new URL('.', import.meta.url))
const project_dir = normalize(join(bench_dir, '..', '..', '..'))
const page = process.argv[2]
const row_n = +(process.argv[3] || 1000000)
const rep_n = +(process.argv[4] || 3)
const timeout_ms = 60 * 60 * 1000

// a wrong page name would 404 and leave the runner waiting for the timeout.
if (page != 'nav' && page != 'nav2') {
	process.stderr.write(
		'usage: run_nav_bench.mjs nav|nav2 [rows] [repeats]\n')
	process.exit(1)
}

function content_type(path) {
	return {
		'.html': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.woff2': 'font/woff2',
		'.svg': 'image/svg+xml',
	}[extname(path)] || 'application/octet-stream'
}

async function read_json(request) {
	let chunks = []
	for await (let chunk of request)
		chunks.push(chunk)
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function print_line(name, min_s, median_s) {
	process.stdout.write(name.padEnd(44) + min_s.padStart(12)
		+ median_s.padStart(12) + '\n')
}

let finish_run
let run_done = new Promise(resolve => finish_run = resolve)

const server = createServer(async (request, response) => {
	try {
		let url = new URL(request.url, 'http://127.0.0.1')
		let path = normalize(join(project_dir,
			decodeURIComponent(url.pathname)))
		if (url.pathname == '/bench-log') {
			let r = await read_json(request)
			print_line(r.name, r.min.toFixed(3), r.median.toFixed(3))
			response.writeHead(204)
		} else if (url.pathname == '/bench-done') {
			finish_run(await read_json(request))
			response.writeHead(204)
		} else if (!path.startsWith(project_dir)) {
			response.writeHead(403)
		} else {
			let data = await readFile(path)
			response.writeHead(200, {'content-type': content_type(path)})
			response.write(data)
		}
		response.end()
	} catch (error) {
		response.writeHead(error.code == 'ENOENT' ? 404 : 500)
		response.end(String(error))
	}
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const profile = await mkdtemp(join(tmpdir(), 'nav-bench-'))
const url = new URL(
	`http://127.0.0.1:${port}/js/tests/nav-bench/${page}_bench.html`)
url.searchParams.set('rows', row_n)
url.searchParams.set('repeats', rep_n)

const chrome = spawn('/usr/bin/google-chrome', [
	'--headless=new', '--no-sandbox', `--user-data-dir=${profile}`,
	'--disable-background-networking', '--disable-component-update',
	'--disable-default-apps', '--disable-sync', '--no-first-run',
	'--js-flags=--expose-gc', url.href,
], {stdio: ['ignore', 'ignore', 'pipe'], detached: true})
let chrome_stderr = ''
chrome.stderr.on('data', data => chrome_stderr += data)

// chrome's child processes keep writing into the profile after the main
// process exits, so the runner stops chrome's whole process group and waits
// until no process is left in it before removing the profile.
function signal_chrome_group(signal) { // -> false when the group is empty
	try {
		process.kill(-chrome.pid, signal)
		return true
	} catch (error) {
		if (error.code != 'ESRCH')
			throw error
		return false
	}
}

async function stop_chrome() {
	signal_chrome_group('SIGTERM')
	for (let t = 0; signal_chrome_group(0); t += 50) {
		if (t == 2000)
			signal_chrome_group('SIGKILL')
		await new Promise(resolve => setTimeout(resolve, 50))
	}
}

process.stdout.write(`${page}: ${row_n} rows, ${rep_n} repeats\n\n`)
print_line('op', 'min ms', 'median ms')

const timeout_id = setTimeout(() => finish_run({error: 'timed out'}),
	timeout_ms)
const result = await run_done
clearTimeout(timeout_id)

await stop_chrome()
server.close()
await rm(profile, {recursive: true, force: true})

if (result.error) {
	process.stderr.write(`error: ${result.error}\n`)
	if (chrome_stderr)
		process.stderr.write(chrome_stderr.slice(-2000))
	process.exit(1)
}
