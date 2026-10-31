// Drives www/ui-demo.html in headless Chrome and reads widget state to check
// stored inputs and invalid-value handling. Run: node js/tests/test_ui_stored_inputs.mjs

import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import {spawn} from 'child_process'
import path from 'path'
import {fileURLToPath} from 'url'

const www = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'www')
const port = Number(process.env.PORT ?? 8392)

let failed = 0
function check(what, got, want) {
	let ok = JSON.stringify(got) === JSON.stringify(want)
	if (!ok)
		failed++
	console.log((ok ? 'ok   ' : 'FAIL ') + what
		+ (ok ? '' : ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)))
}

const srv = spawn('python3',
	['-m', 'http.server', String(port), '-d', www, '-b', '127.0.0.1'],
	{stdio: 'ignore'})
await new Promise(r => setTimeout(r, 800))

const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
	const pg = await browser.newPage()
	await pg.addInitScript(() => localStorage.clear())
	const errors = []
	pg.on('pageerror', e => errors.push(e.message))
	pg.on('console', m => { if (m.type() == 'error') errors.push(m.text()) })

	async function frame() {
		await pg.evaluate(() => ui.animate())
		await pg.waitForTimeout(80)
	}

	await pg.goto(`http://127.0.0.1:${port}/ui-demo.html`, {waitUntil: 'load'})
	await pg.waitForTimeout(500)
	check('1. startup has no errors', errors, [])

	// build the probe inputs in place of the demo's own main.
	await pg.evaluate(() => {
		window.probe = {build: null}
		ui.main = function() {
			probe.build?.()
		}
	})

	// 2. a stored value written from outside shows in the text box.
	await pg.evaluate(() => {
		ui.saved_value_def('p2', 'a', ui.create_field())
		probe.build = () => {
			ui.input('p2')
		}
	})
	check('2. model is readable before the input builds',
		await pg.evaluate(() => ui.saved_value('p2')), 'a')
	check('2. default is not written to storage',
		await pg.evaluate(() => ui.saved_state.p2?.value), undefined)
	await frame()
	check('2. text box shows the stored value',
		await pg.evaluate(() => ui._state_map.get('p2').text), 'a')
	await pg.evaluate(() => ui.set_saved_value('p2', 'b'))
	await frame()
	check('2. text box shows the value from set_saved_value()',
		await pg.evaluate(() => ui._state_map.get('p2').text), 'b')
	await pg.evaluate(() => ui.load_saved_state(
		Object.assign({}, ui.saved_state, {p2: {value: 'c'}})))
	await frame()
	check('2. text box shows the value from load_saved_state()',
		await pg.evaluate(() => ui._state_map.get('p2').text), 'c')

	// 3. loading the saved state between frames keeps the next key.
	await pg.evaluate(() => {
		ui.saved_value_def('p3', false,
			ui.create_field({type: 'bool', not_null: true}))
		probe.build = () => {
			ui.toggle('p3')
		}
	})
	await frame()
	await pg.evaluate(() => ui.focus('p3'))
	await frame()
	await pg.evaluate(() => ui.load_saved_state(ui.saved_state))
	await pg.keyboard.press(' ')
	await frame()
	check('3. Space after load_saved_state() toggles',
		await pg.evaluate(() => ui.value('p3')), true)

	// 4. reads after the inputs' state is freed.
	await pg.evaluate(() => {
		ui.load_saved_state(Object.assign({}, ui.saved_state, {
			p4n: {value: 'bad'},
			p4m: {value: 2},
		}))
		ui.saved_value_def('p4n', null,
			ui.create_field({type: 'number', max: 10}))
		ui.saved_value_def('p4m', null, ui.create_field({
			type: 'enum_list', enum_values: ['a', 'b', 'c'],
		}))
		probe.build = () => {
			ui.input('p4n')
			ui.enum_toggle('p4m')
		}
	})
	await frame()
	let reads = () => pg.evaluate(
		() => [String(ui.saved_value('p4n')), ui.saved_value('p4m')])
	check('4. reads while built', await reads(), ['undefined', 2])
	check('4. invalid loaded value remains in storage',
		await pg.evaluate(() => ui.saved_state.p4n.value), 'bad')
	await pg.evaluate(() => probe.build = null)
	await frame()
	await frame()
	check('4. state freed', await pg.evaluate(
		() => [!!ui._state_map.get('p4n'), !!ui._state_map.get('p4m')]),
		[false, false])
	check('4. reads after the state is freed', await reads(), ['undefined', 2])
	check('4. ui.value() does not read the model after the input is freed',
		await pg.evaluate(() => ui.value('p4m')), undefined)

	// 5. an invalid color component stays in its box.
	await pg.evaluate(() => {
		probe.build = () => {
			ui.color_picker('p5', '#ff0000')
			ui.focus('p5.sat.input')
			ui.select_text('p5.sat.input', 0, 1/0)
			probe.build = () => { ui.color_picker('p5', '#ff0000') }
		}
	})
	await frame()
	await pg.keyboard.type('2')
	await frame()
	await frame()
	check('5. saturation box keeps the typed 2',
		await pg.evaluate(() => ui._state_map.get('p5.sat.input').text), '2')

	await pg.evaluate(() => {
		ui.saved_value_def('p6', 5,
			ui.create_field({type: 'number', max: 10}))
		probe.build = () => { ui.input('p6') }
		ui.focus('p6')
	})
	await frame()
	async function edit_preference(text) {
		await pg.evaluate(text => {
			let input = Array.from(document.querySelectorAll('input'))
				.find(input => input._ui_id == 'p6')
			input.value = text
			input.dispatchEvent(new Event('input', {bubbles: true}))
		}, text)
	}
	await edit_preference('20')
	check('6. invalid edit preserves the accepted preference',
		await pg.evaluate(() => [ui.value('p6'), ui.saved_value('p6'),
			ui.saved_state.p6?.value, ui.saved_value_validation('p6').failed]),
		[undefined, 5, undefined, true])
	await frame()
	await pg.evaluate(() => ui.set_saved_value('p6', 7))
	await frame()
	check('6. external write preserves the invalid input and its errors',
		await pg.evaluate(() => [ui._state_map.get('p6').text,
			ui._state_map.get('p6').validation.failed,
			ui.saved_value('p6'), ui.saved_value_validation('p6').failed]),
		['20', true, 7, false])
	check('6. invalid app write is rejected',
		await pg.evaluate(() => ui.set_saved_value('p6', 30)), false)
	check('6. rejected app write preserves accepted and stored values',
		await pg.evaluate(() => [ui.saved_value('p6'),
			ui.saved_state.p6.value, ui.saved_value_validation('p6').failed]),
		[7, 7, true])
	await edit_preference('8')
	check('6. valid edit updates and saves the preference immediately',
		await pg.evaluate(() => [ui.value('p6'), ui.saved_value('p6'),
			ui.saved_state.p6.value]), [8, 8, 8])
	check('6. a second declaration asserts', await pg.evaluate(() => {
		try {
			ui.saved_value_def('p6', 5, ui._state_map.get('p6').field)
			return false
		} catch {
			return true
		}
	}), true)

	check('no errors after the probes', errors, [])
} finally {
	await browser.close()
	srv.kill()
}
console.log(failed ? failed + ' failed' : 'all passed')
process.exit(failed ? 1 : 0)
