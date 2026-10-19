import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'http'
import fs from 'fs'
import path from 'path'
import assert from 'assert/strict'

let root = path.join(import.meta.dirname, '..', '..')
let types = { // {ext -> mime type}
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
}
let srv = http.createServer(function(req, res) {
	let file = path.join(root, decodeURIComponent(req.url.split('?')[0]))
	fs.readFile(file, function(err, buf) {
		if (err) { res.writeHead(404); res.end(); return }
		res.writeHead(200, {'content-type': types[path.extname(file)] ?? ''})
		res.end(buf)
	})
}).listen(0, '127.0.0.1')
await new Promise(resolve => srv.on('listening', resolve))
let port = srv.address().port

let browser = await chromium.launch({channel: 'chrome'})
let pg = await browser.newPage({deviceScaleFactor: 1})
let errors = [] // [message, ...]
pg.on('pageerror', e => errors.push(e.stack ?? e.message))
pg.on('console', function(m) {
	if (m.type() != 'error' || m.text() == 'rebuild'
			|| /favicon\.ico/.test(m.location().url))
		return
	errors.push(m.text())
})

await pg.goto(`http://127.0.0.1:${port}/www/ui-demo.html?demo=dock`)
await pg.waitForTimeout(500)

function read_tree() {
	return pg.evaluate(function() {
		function dump(node) {
			if (node.split)
				return {
					split: node.split,
					side1: dump(node.side1),
					side2: dump(node.side2),
				}
			return {
				tabs: node.tabs.map(tab => tab.id+':'+tab.kind).join(' '),
				selected: node.selected_tab_id,
			}
		}
		return dump(ui._state_map.get('dock1').root)
	})
}

function tab_box(tab_id) {
	return pg.evaluate(function(tab_id) {
		let s = ui._state_map.get('dock1.tabbox.'+tab_id)
		return {x: s.x, y: s.y, w: s.w, h: s.h}
	}, tab_id)
}

// press and release on separate frames: the dock assumes one input event per
// frame, and mouse.click() sends both on the same frame.
async function click(x, y) {
	await pg.mouse.move(x, y)
	await pg.mouse.down()
	await pg.waitForTimeout(50)
	await pg.mouse.up()
	await pg.waitForTimeout(100)
}

function center(box) {
	return [box.x + box.w / 2, box.y + box.h / 2]
}

assert.deepEqual(await read_tree(), {
	split: 'h',
	side1: {tabs: 'tab2:notes tab3:notes tab4:clock', selected: 'tab2'},
	side2: {
		split: 'v',
		side1: {tabs: 'tab1:clock', selected: 'tab1'},
		side2: {tabs: 'tab5:notes', selected: 'tab5'},
	},
})

// type into tab2's notes input: the demo stores the text, so it stays.
let input_box = await pg.evaluate(function() { // {x, y, w, h} in css px
	let r = [...document.querySelectorAll('.ui-input')]
		.find(input => input._ui_id == 'dock1.tab.tab2.text')
		.getBoundingClientRect()
	return {x: r.x, y: r.y, w: r.width, h: r.height}
})
await click(...center(input_box))
await pg.keyboard.type('abc')
await pg.waitForTimeout(200)
assert.equal(await pg.evaluate(() => ui.value('dock1.tab.tab2.text')), 'abc')

// click tab3: tab2's content is no longer built, but the dock keeps its
// state alive, while the draw removes the DOM element of tab2's input.
await pg.evaluate(() => ui._state_map.get('dock1.tab.tab2.text').probe = 1)
await click(...center(await tab_box('tab3')))
assert.equal(await pg.evaluate(
	() => ui._state_map.get('dock1.tab.tab2.text')?.probe), 1)
let input_ids = await pg.evaluate(() => // [input widget id, ...]
	[...document.querySelectorAll('.ui-input')].map(input => input._ui_id))
assert(!input_ids.includes('dock1.tab.tab2.text'))
assert(input_ids.includes('dock1.tab.tab3.text'))

// click tab2 again: its input shows the text typed before.
await click(...center(await tab_box('tab2')))
assert.equal(await pg.evaluate(() => ui.value('dock1.tab.tab2.text')), 'abc')

// click tab4 in the first tablist: it becomes selected.
await click(...center(await tab_box('tab4')))
assert.equal((await read_tree()).side1.selected, 'tab4')

// drag tab2 past tab3: the first tablist's order changes.
let tab2 = await tab_box('tab2')
let tab3 = await tab_box('tab3')
let y = tab2.y + tab2.h / 2
await pg.mouse.move(tab2.x + 5, y)
await pg.mouse.down()
for (let dx = 0; dx <= tab3.w; dx += 10) {
	await pg.mouse.move(tab2.x + 5 + dx, y)
	await pg.waitForTimeout(20)
}
await pg.mouse.up()
await pg.waitForTimeout(100)
assert.equal((await read_tree()).side1.tabs,
	'tab3:notes tab2:notes tab4:clock')

// click the plus button at the right end of the first tablist's strip: a tab
// with no kind is added and selected. tab1..tab5 are taken, so its id is tab6.
let strip1 = await rect('dock1.tablist1.strip')
await click(strip1.x + strip1.w - 8, strip1.y + strip1.h / 2)
assert.deepEqual((await read_tree()).side1, {
	tabs: 'tab3:notes tab2:notes tab4:clock tab6:undefined',
	selected: 'tab6',
})

// pick a kind for the new tab.
await pg.evaluate(function() {
	ui.set_dock_tab('dock1', 'tab6', {kind: 'clock', label: 'clock'})
	ui.animate()
})
await pg.waitForTimeout(100)
let tree1 = await read_tree()
assert.equal(tree1.side1.tabs,
	'tab3:notes tab2:notes tab4:clock tab6:clock')

// the dock saved the tree, so a reload restores it.
await pg.reload()
await pg.waitForTimeout(500)
assert.deepEqual(await read_tree(), tree1)

function rect(id) {
	return pg.evaluate(function(id) {
		let s = ui._state_map.get(id)
		return {x: s.x, y: s.y, w: s.w, h: s.h}
	}, id)
}

// grab the tab at its center, away from the splitter's hit area at the left
// edge of a split's side 2, and move the pointer in steps to (x, y).
async function drag_tab(tab, x, y) {
	let x0 = tab.x + tab.w / 2 // pointer x at the grab
	let y0 = tab.y + tab.h / 2 // pointer y at the grab
	await pg.mouse.move(x0, y0)
	await pg.mouse.down()
	await pg.waitForTimeout(20)
	for (let i = 1; i <= 10; i++) {
		await pg.mouse.move(x0 + (x - x0) * i / 10, y0 + (y - y0) * i / 10)
		await pg.waitForTimeout(20)
	}
	await pg.mouse.up()
	await pg.waitForTimeout(100)
}

// drag tab5, the only tab of tablist4, into the strip of tablist3 after
// tab1: tablist4 is removed, so its parent split is replaced by tablist3,
// and the split's saved state is deleted.
await pg.evaluate(function() {
	ui.save_state('dock1.split2', 'size', .3)
	ui.animate()
})
await pg.waitForTimeout(100)
let tab5 = await tab_box('tab5')
let tab1 = await tab_box('tab1')
let strip3 = await rect('dock1.tablist3.strip')
await drag_tab(tab5, tab1.x + tab1.w + 20, strip3.y + tab5.h / 2)
assert.deepEqual(await read_tree(), {
	split: 'h',
	side1: tree1.side1,
	side2: {tabs: 'tab1:clock tab5:notes', selected: 'tab5'},
})
assert.equal(await pg.evaluate(() => 'dock1.split2' in ui.saved_state),
	false)

// drag tab2 to the right edge of tablist3's pane: tablist3 is replaced by a
// split with tablist3 on side 1 and a new tablist with tab2 on side 2.
// pressing on tab2 selected it, so tablist1 selects tab2's neighbor, tab4.
let pane3 = await rect('dock1.tablist3.pane')
await drag_tab(await tab_box('tab2'),
	pane3.x + pane3.w * .95, pane3.y + pane3.h / 2)
assert.deepEqual(await read_tree(), {
	split: 'h',
	side1: {tabs: 'tab3:notes tab4:clock tab6:clock', selected: 'tab4'},
	side2: {
		split: 'h',
		side1: {tabs: 'tab1:clock tab5:notes', selected: 'tab5'},
		side2: {tabs: 'tab2:notes', selected: 'tab2'},
	},
})

// drag tab2 to the middle of tablist1's pane: tab2 goes to the end of
// tablist1, and the split created above is replaced by tablist3.
let pane1 = await rect('dock1.tablist1.pane')
await drag_tab(await tab_box('tab2'),
	pane1.x + pane1.w / 2, pane1.y + pane1.h / 2)
assert.deepEqual(await read_tree(), {
	split: 'h',
	side1: {
		tabs: 'tab3:notes tab4:clock tab6:clock tab2:notes',
		selected: 'tab2',
	},
	side2: {tabs: 'tab1:clock tab5:notes', selected: 'tab5'},
})

assert.deepEqual(errors, [])
console.log('ok')

await browser.close()
srv.close()
