// End-to-end save tests: navs without grids, loaded from the test rowsets
// grid_save and grid_typed of cui.lua. run_nav_save_test.mjs opens this
// page with ?report=URL and prints the results posted to that URL.
{

ui.main = noop

let report_url = new URL(location.href).searchParams.get('report')

// the runner listens on another origin: post plain text, read no reply.
function report(path, data) {
	return fetch(report_url+'/'+path, {
		method: 'POST',
		mode: 'no-cors',
		body: JSON.stringify(data),
	})
}

// errors outside a test end the run instead of leaving it to time out.
addEventListener('error', ev => report('done',
	{error: `${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno}`}))
addEventListener('unhandledrejection', ev => report('done',
	{error: String(ev.reason?.stack ?? ev.reason)}))

/// helpers ------------------------------------------------------------------

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function wait_for(is_done, what, timeout_ms = 10000) {
	for (let t = 0; !is_done(); t += 10) {
		if (t >= timeout_ms)
			throw new Error('timed out waiting for '+what)
		await sleep(10)
	}
}

async function post_rowset(rowset_name, data) {
	let res = await fetch('/rowset.json/'+rowset_name, {
		method: 'POST',
		headers: {'content-type': 'application/json'},
		body: JSON.stringify(data),
	})
	assert(res.ok, rowset_name, ' ', data.exec, ' failed: ', res.status)
	return res.json()
}

function is_idle(nav) {
	let ds = nav.get_debug_state()
	return nav.ready && !ds.is_saving && !ds.is_loading
}

let navs = [] // navs of the running test, freed after it
let nav_n = 0 // navs created, for unique ids

async function open_nav(rowset_name) {
	let nav = ui.nav('nav_save_test_'+(++nav_n), {rowset_name: rowset_name})
	navs.push(nav)
	await wait_for(() => is_idle(nav), rowset_name+' load')
	return nav
}

async function save(nav) {
	nav.save()
	await wait_for(() => is_idle(nav), nav.rowset_name+' save')
}

function fi_of(nav, col) {
	return nav.all_fields_map[col].fi
}

function val(nav, ri, col) {
	return nav.cell_input_val(ri, fi_of(nav, col))
}

function set_val(nav, ri, col, v) {
	nav.set_cell_val(ri, fi_of(nav, col), v)
}

function ri_of(nav, col, v) {
	return nav.lookup(col, [v])
}

// -> the new row's ri.
function insert(nav, vals, at_ri) {
	let row = [] // the new row's values, by fi
	for (let col in vals)
		row[fi_of(nav, col)] = vals[col]
	return nav.insert_rows([row], at_ri)[0]
}

// -> the ris of the rows whose col holds v.
function find_ris(nav, col, v) {
	let ris = []
	for (let i = 0; i < nav.row_n; i++)
		if (val(nav, nav.base_ris[i], col) === v)
			ris.push(nav.base_ris[i])
	return ris
}

/// tests --------------------------------------------------------------------

let tests = [] // [[name, rowset_name, fn], ...]
function test(name, rowset_name, fn) {
	tests.push([name, rowset_name, fn])
}

test('first save reserves ids', 'grid_save', async function(nav) {
	let root_ri = insert(nav, {text: 'New root'})
	let child_ri = insert(nav, {text: 'New child'}, ri_of(nav, 'id', 2))
	assert(val(nav, root_ri, 'id') == null, 'new row has an id before save')
	await save(nav)
	let root_id = val(nav, root_ri, 'id')
	let child_id = val(nav, child_ri, 'id')
	assert(root_id != null && child_id != null, 'no ids after save')
	assert(!nav.is_new(root_ri) && !nav.is_new(child_ri), 'rows still new')
	let sv = await open_nav('grid_save')
	let sv_root_ris = find_ris(sv, 'text', 'New root')
	assert(sv_root_ris.length == 1
		&& val(sv, sv_root_ris[0], 'id') == root_id, 'root not saved once')
	let sv_child_ri = ri_of(sv, 'id', child_id)
	assert(sv_child_ri != null && val(sv, sv_child_ri, 'parent_id') == 1,
		'child not saved under parent 1')
})

test('save deletes children before parents', 'grid_save',
	async function(nav) {
		set_val(nav, ri_of(nav, 'id', 1), 'num', 101)
		nav.remove_rows([ri_of(nav, 'id', 3)])
		await save(nav)
		assert(!nav.modified_n, 'changes left after save')
		let sv = await open_nav('grid_save')
		for (let id of [3, 4, 5])
			assert(ri_of(sv, 'id', id) == null, 'row not deleted: ', id)
		assert(val(sv, ri_of(sv, 'id', 1), 'num') == 101, 'edit not saved')
	})

test('rejected row keeps its changes', 'grid_save', async function(nav) {
	set_val(nav, ri_of(nav, 'id', 1), 'num', 101)
	let ri7 = ri_of(nav, 'id', 7)
	set_val(nav, ri7, 'test_action', 'reject row')
	await save(nav)
	assert(nav.is_row_edited(ri7) && nav.row_errors[ri7],
		'rejected row lost its edit or has no error')
	let sv = await open_nav('grid_save')
	assert(val(sv, ri_of(sv, 'id', 1), 'num') == 101, 'other row not saved')
	assert(val(sv, ri_of(sv, 'id', 7), 'test_action') == 'normal',
		'rejected row saved')
})

test('update of a row deleted by another user', 'grid_save',
	async function(nav) {
		set_val(nav, ri_of(nav, 'id', 6), 'num', 606)
		set_val(nav, ri_of(nav, 'id', 8), 'test_action', 'delete existing row')
		await save(nav)
		assert(ri_of(nav, 'id', 6) == null, 'deleted row still shown')
		assert(!nav.modified_n, 'changes left after save')
	})

test('delete of a row deleted by another user', 'grid_save',
	async function(nav) {
		nav.remove_rows([ri_of(nav, 'id', 6)])
		set_val(nav, ri_of(nav, 'id', 8), 'test_action', 'delete existing row')
		await save(nav)
		assert(ri_of(nav, 'id', 6) == null, 'deleted row still shown')
		assert(!nav.modified_n, 'changes left after save')
	})

test('lost save response: no second insert', 'grid_save',
	async function(nav) {
		insert(nav, {text: 'New root'})
		set_val(nav, ri_of(nav, 'id', 8), 'test_action',
			'disconnect after save')
		await save(nav)
		assert(nav.get_debug_state().saving_ris.size,
			'failed save left no rows to settle')
		await save(nav)
		assert(!nav.modified_n, 'changes left after the second save')
		assert(find_ris(nav, 'text', 'New root').length == 1,
			'new row not kept once')
		let sv = await open_nav('grid_save')
		assert(find_ris(sv, 'text', 'New root').length == 1,
			'new row not saved once')
	})

test('failed save: sent again once', 'grid_save', async function(nav) {
	insert(nav, {text: 'New root'})
	let ri8 = ri_of(nav, 'id', 8)
	set_val(nav, ri8, 'test_action', 'disconnect before save')
	await save(nav)
	set_val(nav, ri8, 'test_action', 'normal')
	await save(nav)
	assert(!nav.modified_n, 'changes left after the second save')
	let sv = await open_nav('grid_save')
	assert(find_ris(sv, 'text', 'New root').length == 1,
		'new row not saved once')
})

// R4: the server inserts the row, so the nav keeps it, marked for deletion.
test('delete a new row while its save is underway', 'grid_save',
	async function(nav) {
		let new_ri = insert(nav, {text: 'New root'})
		set_val(nav, ri_of(nav, 'id', 8), 'test_action', 'hold save')
		nav.save()
		await wait_for(() => nav.get_debug_state().saving_ris.has(new_ri),
			'save sent')
		nav.remove_rows([new_ri])
		assert(nav.is_removed(new_ri), 'row not marked for deletion')
		await post_rowset('grid_save', {exec: 'release'})
		await wait_for(() => is_idle(nav), 'save')
		assert(nav.is_removed(new_ri) && !nav.is_new(new_ri),
			'saved row not kept marked for deletion')
		await save(nav)
		assert(!find_ris(nav, 'text', 'New root').length, 'row still shown')
		let sv = await open_nav('grid_save')
		assert(!find_ris(sv, 'text', 'New root').length, 'row not deleted')
	})

// R4: the server rejects the insert, so the nav drops the row.
test('delete a new row while its failing save is underway', 'grid_save',
	async function(nav) {
		let new_ri = insert(nav, {text: 'New root', test_action: 'reject row'})
		set_val(nav, ri_of(nav, 'id', 8), 'test_action', 'hold save')
		nav.save()
		await wait_for(() => nav.get_debug_state().saving_ris.has(new_ri),
			'save sent')
		nav.remove_rows([new_ri])
		await post_rowset('grid_save', {exec: 'release'})
		await wait_for(() => is_idle(nav), 'save')
		assert(!find_ris(nav, 'text', 'New root').length, 'row not dropped')
	})

test('pk can be set only on a new row', 'grid_typed', async function(nav) {
	let saved_ri = ri_of(nav, 'code', 'A1')
	set_val(nav, saved_ri, 'code', 'X1')
	assert(val(nav, saved_ri, 'code') == 'A1', 'pk of a saved row changed')
	let new_ri = insert(nav, {code: 'N1'})
	set_val(nav, new_ri, 'code', 'N2')
	assert(val(nav, new_ri, 'code') == 'N2', 'pk of a new row not set')
})

// R1, R4: the second nav sees the first save before saving, so its new row
// becomes the saved row, with its own values as edits.
test('same typed key, seen before saving', 'grid_typed',
	async function(nav1) {
		let nav2 = await open_nav('grid_typed')
		insert(nav1, {code: 'SAME', text: 'Nav 1'})
		let ri2 = insert(nav2, {code: 'SAME', text: 'Nav 2'})
		await save(nav1)
		nav2.reload()
		await wait_for(() => is_idle(nav2), 'reload')
		ri2 = ri_of(nav2, 'code', 'SAME')
		assert(ri2 != null && !nav2.is_new(ri2), 'rows not made one')
		assert(val(nav2, ri2, 'text') == 'Nav 2', 'own value not kept as edit')
		await save(nav2)
		let sv = await open_nav('grid_typed')
		let sv_ris = find_ris(sv, 'code', 'SAME')
		assert(sv_ris.length == 1 && val(sv, sv_ris[0], 'text') == 'Nav 2',
			'second save not applied to the one row')
	})

// R1: both navs save before seeing the other's save. The server refuses the
// second insert, and the first save stays.
test('same typed key, saved at the same time', 'grid_typed',
	async function(nav1) {
		let nav2 = await open_nav('grid_typed')
		let ri1 = insert(nav1,
			{code: 'SAME', text: 'Nav 1', test_action: 'hold save'})
		insert(nav2, {code: 'SAME', text: 'Nav 2'})
		nav1.save()
		await wait_for(() => nav1.get_debug_state().saving_ris.has(ri1),
			'save sent')
		await save(nav2)
		await post_rowset('grid_typed', {exec: 'release'})
		await wait_for(() => is_idle(nav1), 'save')
		let sv = await open_nav('grid_typed')
		let sv_ris = find_ris(sv, 'code', 'SAME')
		assert(sv_ris.length == 1 && val(sv, sv_ris[0], 'text') == 'Nav 2',
			'second insert not refused')
	})

/// run ----------------------------------------------------------------------

async function run() {
	let failed_n = 0
	for (let [name, rowset_name, fn] of tests) {
		let error
		try {
			await post_rowset(rowset_name, {exec: 'reset'})
			await fn(await open_nav(rowset_name))
		} catch (e) {
			error = String(e.stack ?? e)
			failed_n++
		}
		for (let nav of navs)
			nav.free()
		navs = []
		await report('log', {name: name, error: error})
	}
	await report('done', {test_n: tests.length, failed_n: failed_n})
}

addEventListener('load', run)

}
