// Run with: node tests/run_ui_call_e2ee_browser.mjs

import {createServer} from 'node:http'
import {spawn, execFile} from 'node:child_process'
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const files = new Map([ // permitted test modules and their source files
	['/tests/ui_call_e2ee_browser.js', './ui_call_e2ee_browser.js'],
	['/tests/ui_call_e2ee_worker.js', './ui_call_e2ee_worker.js'],
	['/www/ui_call_e2ee.js', '../www/ui_call_e2ee.js'],
])
const want_sfu = process.argv.includes('--sfu') // real provider checks
let sfu_url = null // configured app API URL
let sfu_token = null // provider secret, retained in this Node process
let sfu_sessions = new Map() // {session_id -> Set of allocated mids}
if (want_sfu) {
	let config = await readFile(new URL( // existing demo configuration
		'./canvas_ui_demo_app/var/cui.conf', import.meta.url), 'utf8')
	let app_id = config.match( // configured provider app id
		/^cloudflare_sfu_app_id\s*=\s*'([^']+)'/m)[1]
	sfu_token = config.match(
		/^cloudflare_sfu_api_token\s*=\s*'([^']+)'/m)[1]
	sfu_url = 'https://rtc.live.cloudflare.com/v1/apps/' + app_id
}

async function request_sfu(method, path, body) {
	let response = await fetch(sfu_url + path, { // provider control reply
		method, signal: AbortSignal.timeout(10000),
		headers: {
			Authorization: 'Bearer ' + sfu_token,
			'Content-Type': 'application/json',
		},
		body: body == null ? undefined : JSON.stringify(body),
	})
	let result = await response.json() // provider result and track allocations
	if (!response.ok || result.errorCode)
		throw new Error(JSON.stringify(result))
	if (path == '/sessions/new') sfu_sessions.set(result.sessionId, new Set())
	if (path.endsWith('/tracks/new')) {
		let session_id = path.split('/')[2] // allocated track owner
		for (let track of result.tracks || [])
			if (!track.errorCode) sfu_sessions.get(session_id).add(track.mid)
	}
	return result
}

async function close_sfu_sessions() {
	for (let [session_id, mids] of sfu_sessions) {
		if (mids.size) {
			let response = await request_sfu('PUT', // forced track closures
				'/sessions/' + session_id + '/tracks/close', {
					force: true, tracks: [...mids].map(mid => ({mid})),
				})
			for (let track of response.tracks)
				if (track.errorCode && track.errorCode != 'close_track_error')
					throw new Error(JSON.stringify(track))
		}
		sfu_sessions.delete(session_id)
	}
}

let finish_run = null // resolver for the current browser result
let failed = false // whether any browser failed
const server = createServer(async (request, response) => {
	try {
		let path = new URL(request.url, 'http://127.0.0.1').pathname // route
		if (path == '/sfu' && request.method == 'POST' && want_sfu) {
			let chunks = [] // provider control request chunks
			for await (let chunk of request) chunks.push(chunk)
			let args = JSON.parse(Buffer.concat(chunks).toString()) // operation
			let result = null // provider control result
			if (args.method == 'cleanup') await close_sfu_sessions()
			else result = await request_sfu(args.method, args.path, args.body)
			response.setHeader('Content-Type', 'application/json')
			response.end(JSON.stringify(result))
		} else if (path == '/progress' && request.method == 'POST') {
			let chunks = [] // progress report chunks
			for await (let chunk of request) chunks.push(chunk)
			console.log(Buffer.concat(chunks).toString())
			response.end()
		} else if (request.url == '/probe-mdns' && request.method == 'POST') {
			let chunks = [] // candidate hostname request chunks
			for await (let chunk of request) chunks.push(chunk)
			let hostname = Buffer.concat(chunks).toString() // candidate hostname
			let result = await new Promise(resolve => { // Avahi lookup outcome
				execFile('/usr/bin/avahi-resolve-host-name', ['-4', hostname],
					{timeout: 5000}, (error, stdout, stderr) => resolve({
						error: error ? String(error) : null, stdout, stderr,
					}))
			})
			response.setHeader('Content-Type', 'application/json')
			response.end(JSON.stringify(result))
		} else if (request.url == '/report' && request.method == 'POST') {
			let chunks = [] // received JSON report chunks
			for await (let chunk of request) chunks.push(chunk)
			finish_run(JSON.parse(Buffer.concat(chunks).toString()))
			response.end()
		} else if (path == '/') {
			response.setHeader('Content-Type', 'text/html')
			response.end('<!doctype html><body><script type="module" '
				+ 'src="/tests/ui_call_e2ee_browser.js"></script>')
		} else if (files.has(request.url)) {
			response.setHeader('Content-Type', 'text/javascript')
			response.end(await readFile(
				new URL(files.get(request.url), import.meta.url)))
		} else {
			response.writeHead(404)
			response.end()
		}
	} catch (error) {
		response.writeHead(500)
		response.end(String(error))
	}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const page_url = `http://127.0.0.1:${server.address().port}/` // test origin

try {
	for (let [browser, capture_permission] of [
		['chrome', false], ['chrome', true],
		['firefox', false], ['firefox', true],
	]) {
		if (!capture_permission
			&& !process.argv.includes('--compare-permissions')) continue
		let profile = await mkdtemp( // isolated browser profile directory
			join(tmpdir(), 'e2ee-' + browser + '-'))
		if (browser == 'firefox') {
			let capture_prefs = capture_permission // fake capture configuration
				? 'user_pref("media.navigator.streams.fake", true);\n'
					+ 'user_pref("media.navigator.permission.fake", true);\n'
					+ 'user_pref("media.navigator.permission.disabled", true);\n'
				: ''
			await writeFile(join(profile, 'user.js'),
				'user_pref("media.autoplay.default", 0);\n'
				+ 'user_pref("media.autoplay.block-webaudio", false);\n'
				+ capture_prefs)
		}
		let url = page_url + (capture_permission // selected permission case
			? '?capture_permission=1' : '')
		if (want_sfu) url += (capture_permission ? '&' : '?') + 'sfu=1'
		let args = browser == 'chrome' ? [ // headless browser arguments
			'--headless=new', '--no-sandbox', `--user-data-dir=${profile}`,
			'--autoplay-policy=no-user-gesture-required', '--no-first-run',
			'--disable-background-networking', url,
			'--enable-logging=stderr', '--vmodule=*mdns*=2',
		] : ['--headless', '--no-remote', '--profile', profile, url]
		if (browser == 'chrome' && capture_permission)
			args.push('--use-fake-device-for-media-stream',
				'--use-fake-ui-for-media-stream')
		let result = new Promise(resolve => finish_run = resolve) // report
		let child = spawn( // owned browser process and its descendants
			browser == 'chrome' ? '/usr/bin/google-chrome' : '/usr/bin/firefox',
			args, {detached: true, stdio: ['ignore', 'ignore', 'pipe']})
		let stderr = '' // recent browser diagnostics
		child.stderr.on('data', data => {
			stderr = (stderr + data).slice(-4000)
			for (let line of data.toString().split('\n'))
				if (/mdns/i.test(line)) console.log(browser, line)
		})
		child.on('error', error => finish_run({error: String(error)}))
		child.on('exit', code => finish_run({error: 'Browser exited: ' + code}))
		let timeout = setTimeout( // maximum time for this browser
			() => finish_run({error: 'Browser test timed out'}), 240000)
		try {
			let report = await result // capabilities, decoded media and failures
			console.log(browser, {capture_permission}, JSON.stringify(report))
			if (report.error) {
				failed = true
				console.log(stderr)
			}
		} finally {
			clearTimeout(timeout)
			await close_sfu_sessions()
			child.removeAllListeners('exit')
			let exited = new Promise(resolve => child.once('exit', resolve))
			if (child.exitCode == null && child.signalCode == null) {
				process.kill(-child.pid, 'SIGKILL')
				await exited
			}
			await rm(profile, {recursive: true, force: true})
		}
	}
} finally {
	server.closeAllConnections()
	server.close()
}
process.exitCode = failed ? 1 : 0
