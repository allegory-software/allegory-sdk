// usage: node demo/run_nav_save_test.mjs
// runs www/nav_save_test.js in headless Chrome against a demo server started
// on its own ports and var dir, and prints one line per test.

import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const app_dir = fileURLToPath(new URL('.', import.meta.url))
const http_port = +(process.env.HTTP_PORT || 8889)
const https_port = +(process.env.HTTPS_PORT || 4444)
const timeout_ms = 5 * 60 * 1000

async function read_json(request) {
	let chunks = []
	for await (let chunk of request)
		chunks.push(chunk)
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

let finish_run
let run_done = new Promise(resolve => finish_run = resolve)

// the page posts each test's result to /log and the totals to /done.
const report_server = createServer(async (request, response) => {
	try {
		let path = new URL(request.url, 'http://127.0.0.1').pathname
		if (path == '/log') {
			let r = await read_json(request)
			process.stdout.write(r.error
				? `FAIL ${r.name}\n${r.error}\n` : `ok   ${r.name}\n`)
		} else if (path == '/done') {
			finish_run(await read_json(request))
		}
		response.writeHead(204)
		response.end()
	} catch (error) {
		response.writeHead(500)
		response.end(String(error))
	}
})
await new Promise(resolve => report_server.listen(0, '127.0.0.1', resolve))
const report_port = report_server.address().port

// a child started detached leads its own process group, so that the runner
// can stop the child's whole tree.
function spawn_group(cmd, args, env) {
	let child = spawn(cmd, args, {
		stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: env,
	})
	child.stderr_text = ''
	child.stderr.on('data', data => child.stderr_text += data)
	return child
}

function signal_group(child, signal) { // -> false when the group is empty
	try {
		process.kill(-child.pid, signal)
		return true
	} catch (error) {
		if (error.code != 'ESRCH')
			throw error
		return false
	}
}

async function stop_group(child) {
	signal_group(child, 'SIGTERM')
	for (let t = 0; signal_group(child, 0); t += 50) {
		if (t == 2000)
			signal_group(child, 'SIGKILL')
		await new Promise(resolve => setTimeout(resolve, 50))
	}
}

const vardir = await mkdtemp(join(tmpdir(), 'nav-save-var-'))
const demo = spawn_group(join(app_dir, 'demo'), [], {
	...process.env,
	VARDIR: vardir,
	HTTP_PORT: String(http_port),
	HTTPS_PORT: String(https_port),
})
let demo_exit_code
demo.on('exit', code => {
	demo_exit_code = code
	finish_run({error: `demo exited with code ${code}`})
})

// wait until demo serves the test page.
const page_url = `http://localhost:${http_port}/nav_save_test.html`
for (let t = 0; ; t += 100) {
	if (demo_exit_code !== undefined)
		break
	try {
		if ((await fetch(page_url)).ok)
			break
	} catch (error) {
		if (t >= 10000) {
			finish_run({error: 'demo did not start'})
			break
		}
	}
	await new Promise(resolve => setTimeout(resolve, 100))
}

const profile = await mkdtemp(join(tmpdir(), 'nav-save-chrome-'))
const url = new URL(page_url)
url.searchParams.set('report', `http://127.0.0.1:${report_port}`)
const chrome = spawn_group('/usr/bin/google-chrome', [
	'--headless=new', '--no-sandbox', `--user-data-dir=${profile}`,
	'--disable-background-networking', '--disable-component-update',
	'--disable-default-apps', '--disable-sync', '--no-first-run',
	url.href,
], process.env)

const timeout_id = setTimeout(() => finish_run({error: 'timed out'}),
	timeout_ms)
const result = await run_done
clearTimeout(timeout_id)

await stop_group(chrome)
demo.removeAllListeners('exit')
await stop_group(demo)
report_server.close()
await rm(profile, {recursive: true, force: true})
await rm(vardir, {recursive: true, force: true})

if (result.error) {
	process.stderr.write(`error: ${result.error}\n`)
	process.stderr.write(demo.stderr_text.slice(-4000))
	process.exit(1)
}
process.stdout.write(`\n${result.test_n - result.failed_n} of `
	+ `${result.test_n} tests passed\n`)
if (result.failed_n) {
	process.stderr.write(demo.stderr_text.slice(-4000))
	process.exit(1)
}
