import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/probe.html') {
			res.setHeader('Content-Type', 'text/html')
			res.end('<!doctype html><script src="glue.js" global></script>'
				+ '<script src="ui.js"></script>'
				+ '<script src="ui_field.js"></script>'
				+ '<script src="ui_nav.js"></script>'
				+ '<script>ui.main = function() {}</script>')
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(new URL('../www'+req.url, import.meta.url)))
		}
	} catch {
		res.writeHead(404).end()
	}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
	const page = await browser.newPage()
	const errors = [] // browser error messages
	page.on('pageerror', error => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
	await page.waitForFunction(() => ui._frame_drawn)
	const results = await page.evaluate(() => new Promise((resolve, reject) => {
		ui.main = function() {
			try {
				const results = {} // case name -> observed nav state
				function make_nav(id, is_tree, start_expanded) {
					let nav = ui.nav(id, {start_expanded: start_expanded})
					let rowset = { // rowset for a collapsed or filtered edit
						fields: [
							{name: 'id', type: 'number', not_null: true,
								readonly: true},
							{name: 'parent_id', type: 'number'},
							{name: 'category'},
							{name: 'text'},
						],
						pk: 'id',
						can_add_rows: false,
						can_change_rows: true,
						rows: [
							[1, null, 'A', 'root'],
							[2, 1, 'A', 'child'],
							[3, 2, 'A', 'leaf'],
							[4, 1, 'B', 'sibling'],
							[5, null, 'B', 'second root'],
						],
					}
					if (is_tree) {
						rowset.id_col = 'id'
						rowset.parent_col = 'parent_id'
					}
					nav.load(rowset)
					return {nav, rowset}
				}
				function visible_ids(nav) {
					return Array.from(nav.visible_ris.slice(0, nav.visible_n),
						ri => nav.cell_input_val(ri, nav.all_fields_map.id.fi))
				}
				{
					let {nav} = make_nav('tree', true, false)
					let root_ri = nav.lookup('id', [1])
					let child_ri = nav.lookup('id', [2])
					let leaf_ri = nav.lookup('id', [3])
					let text_fi = nav.all_fields_map.text.fi
					let before_ids = visible_ids(nav)
					nav.set_cell_val(leaf_ri, text_fi, 'edited')
					let after_ids = visible_ids(nav)
					let visible_ris0 = nav.visible_ris
					nav.set_cell_val(leaf_ri, text_fi, 'edited again')
					let kept_visible_ris = visible_ris0 == nav.visible_ris
					nav.set_collapsed(root_ri, true)
					results.tree = {
						before_ids, after_ids, kept_visible_ris,
						root_collapsed: nav.is_collapsed(root_ri),
						child_collapsed: nav.is_collapsed(child_ri),
						after_collapse_ids: visible_ids(nav),
					}
				}
				for (let is_tree of [false, true]) {
					let {nav} = make_nav('filtered'+is_tree, is_tree, false)
					nav.set_filter(() => false)
					let before_ids = visible_ids(nav)
					let leaf_ri = nav.lookup('id', [3])
					nav.set_cell_val(leaf_ri, nav.all_fields_map.text.fi, 'edited')
					results['filtered'+is_tree] = {
						before_ids, after_ids: visible_ids(nav),
					}
				}
				{
					let {nav} = make_nav('reveal', true, false)
					nav.set_filter(() => false)
					let leaf_ri = nav.lookup('id', [3])
					nav.expand_to_view_row(leaf_ri)
					results.reveal = {
						visible_ids: visible_ids(nav), modified_n: nav.modified_n,
					}
				}
				for (let start_expanded of [false, true]) {
					let {nav, rowset} = make_nav('grouped'+start_expanded,
						false, start_expanded)
					nav.set_group_by('category')
					let leaf_ri = nav.lookup('id', [3])
					let group_ri = nav.parent_ri[leaf_ri]
					if (start_expanded)
						nav.set_collapsed(group_ri, true)
					let hidden_before = nav.visible_i[leaf_ri] == 0xffffffff
					nav.set_cell_val(leaf_ri, nav.all_fields_map.text.fi, 'edited')
					let visible_after = nav.visible_i[leaf_ri] != 0xffffffff
					let expanded_after = !nav.is_collapsed(group_ri)
					nav.reload_rowset(rowset)
					leaf_ri = nav.lookup('id', [3])
					group_ri = nav.parent_ri[leaf_ri]
					results['grouped'+start_expanded] = {
						hidden_before, visible_after, expanded_after,
						visible_after_reload: nav.visible_i[leaf_ri] != 0xffffffff,
						expanded_after_reload: !nav.is_collapsed(group_ri),
					}
				}
				resolve(results)
			} catch (error) {
				reject(error)
			}
			ui.main = function() {}
		}
		ui.animate()
	}))
	assert.deepEqual(results.tree, {
		before_ids: [1, 5], after_ids: [1, 2, 3, 4, 5],
		kept_visible_ris: true,
		root_collapsed: false, child_collapsed: false,
		after_collapse_ids: [1, 2, 3, 4, 5],
	})
	assert.deepEqual(results.filteredfalse, {before_ids: [], after_ids: [3]})
	assert.deepEqual(results.filteredtrue,
		{before_ids: [], after_ids: [1, 2, 3]})
	assert.deepEqual(results.reveal, {visible_ids: [1, 2, 3], modified_n: 0})
	for (let start_expanded of [false, true])
		assert.deepEqual(results['grouped'+start_expanded], {
			hidden_before: true, visible_after: true, expanded_after: true,
			visible_after_reload: true, expanded_after_reload: true,
		})
	assert.deepEqual(errors, [])
	console.log('Edited-row visibility: nested collapse, filters, groups, '
		+ 'reload, collapse refusal, and visible-row edits passed.')
} finally {
	await browser.close()
	await new Promise(resolve => server.close(resolve))
}
