const fs = require('fs') // filesystem API
const vm = require('vm') // JavaScript execution contexts
const assert = require('assert/strict')
const ui_source = fs.readFileSync('www/ui.js', 'utf8')
const nav_source = fs.readFileSync('www/ui_nav.js', 'utf8')
function section(source_text, start, end) {
	const first_i = source_text.indexOf(start)
	const end_i = source_text.indexOf(end, first_i)
	assert(first_i >= 0 && end_i > first_i)
	return source_text.slice(first_i, end_i)
}
const noop = () => {}
const ui = new Proxy({}, {
	get(ui_methods, method_name) {
		return ui_methods[method_name] ?? noop
	},
}) // {UI method name -> function}
const state_map = new Map() // {widget id -> widget state}
const context = vm.createContext({
	ui, state_map, console,
	assert(value, message) {
		assert(value, message)
		return value
	},
	set: () => new Set(), obj: () => Object.create(null),
	is_building: true, render_state_map: null, build_no: 1,
	empty_array: [], rowset_navs: {},
	tab_strip_rec_i: null, tab_strip: noop, end_split: noop,
}) // UI functions and frame state
vm.runInContext([
	section(ui_source, 'function create_state_scope()', 'let state_scopes'),
	'let state_scopes = new Map(); let open_state_scopes = [];',
	section(ui_source, 'function state_update(', 'ui.set_state_of ='),
	section(ui_source, 'ui.begin_state_scope =',
		'function state_scope_stack_check'),
	section(ui_source, 'function is_state_scope_hidden(', '// free_state()'),
	section(ui_source, 'function find_dock_parent(', '// -> root after'),
	section(ui_source, 'function dock_tab_panes(', '// draw the drop marker'),
	section(nav_source, 'function find_master_nav(', 'ui.master_id ='),
	'globalThis.set_current_scope = scope => {'
		+ 'cur_state_scope = scope ?? root_state_scope};',
].join('\n'), context)
function tab(id, layout) { return {id, layout} }
function tablist(...tabs) {
	return {tabs, selected_tab_id: tabs[0].id}
}
function split(side1, side2) { return {split: 'h', side1, side2} }
function build(dock_id, dock_state, on_tab) {
	context.set_current_scope(null)
	context.dock_tab_panes(dock_id, dock_state, dock_state.root,
		null, on_tab, null, {})
}
function register_tab(dock_id, dock_tab) {
	ui.state(dock_id+'.'+dock_tab.id)
}
const plain_scope = ui.begin_state_scope('plain') // scope without a dock
assert(plain_scope)
assert(!Object.hasOwn(plain_scope, 'dock'))
assert(!Object.hasOwn(plain_scope, 'dock_tab'))
assert.equal(ui.state('plain.widget').state_scope, plain_scope)
ui.end_state_scope()
assert.equal(ui.begin_state_scope('plain'), plain_scope)
ui.end_state_scope()
const detail_tab = tab('detail_tab') // dock tab
const near_tab = tab('near_tab') // dock tab
const far_tab = tab('far_tab') // dock tab
const dock = {
	root: split(split(tablist(detail_tab), tablist(near_tab)),
		tablist(far_tab)),
} // dock state
build('dock', dock, dock_tab => register_tab('dock', dock_tab))
context.set_current_scope(state_map.get('dock.detail_tab').state_scope)
assert.equal(ui.get_dock_shared_parent_depth('dock.detail_tab'), 4)
assert.equal(ui.get_dock_shared_parent_depth('dock.near_tab'), 2)
assert.equal(ui.get_dock_shared_parent_depth('dock.far_tab'), 1)
context.rowset_navs.tables = [{id: 'dock.near_tab'}, {id: 'dock.far_tab'}]
assert.equal(context.find_master_nav('tables').id, 'dock.near_tab')
assert.equal(context.find_master_nav('tables', 'dock.far_tab').id,
	'dock.far_tab')
assert.equal(context.find_master_nav('tables', 'missing').id, 'dock.near_tab')
context.rowset_navs.tables.push({id: 'dock.near_tab.2'})
state_map.set('dock.near_tab.2', state_map.get('dock.near_tab'))
assert.equal(context.find_master_nav('tables').id, 'dock.near_tab.2')
const hidden_scope = state_map.get('dock.near_tab').state_scope
hidden_scope.kept_build_no = 2
assert.equal(context.find_master_nav('tables').id, 'dock.far_tab')
assert.equal(context.find_master_nav('tables', 'dock.near_tab').id,
	'dock.far_tab')
hidden_scope.kept_build_no = null
context.set_current_scope(null)
assert.equal(ui.get_dock_shared_parent_depth('dock.near_tab'), 0)
assert.equal(context.find_master_nav('tables').id, 'dock.near_tab.2')
assert.equal(context.find_master_nav('absent'), undefined)
let depth_queries = 0 // shared parent lookup count
const get_depth = ui.get_dock_shared_parent_depth
ui.get_dock_shared_parent_depth = id => {
	depth_queries++
	return get_depth(id)
}
context.rowset_navs.single = [{id: 'dock.near_tab'}]
assert.equal(context.find_master_nav('single').id, 'dock.near_tab')
assert.equal(depth_queries, 0)
assert.equal(context.find_master_nav('tables', 'dock.far_tab').id,
	'dock.far_tab')
assert.equal(depth_queries, 0)
ui.get_dock_shared_parent_depth = get_depth
const child_detail_tab = tab('child_detail_tab') // dock tab
const child_near_tab = tab('child_near_tab') // dock tab
const group_tab = tab('group_tab',
	split(tablist(child_detail_tab), tablist(child_near_tab))) // dock tab
const outer_far_tab = tab('outer_far_tab') // dock tab
const nested_dock = {root: split(tablist(group_tab), tablist(outer_far_tab))} // dock state
build('nested', nested_dock, dock_tab => register_tab('nested', dock_tab))
context.set_current_scope(state_map.get('nested.child_detail_tab').state_scope)
assert(ui.get_dock_shared_parent_depth('nested.child_near_tab')
	> ui.get_dock_shared_parent_depth('nested.outer_far_tab'))
const inner_detail_tab = tab('inner_detail_tab') // dock tab
const inner_near_tab = tab('inner_near_tab') // dock tab
const inner_dock = {
	root: split(tablist(inner_detail_tab), tablist(inner_near_tab)),
} // dock state
const host_tab = tab('host_tab') // dock tab
const outer_master_tab = tab('outer_master_tab') // dock tab
const host_dock = {root: split(tablist(host_tab), tablist(outer_master_tab))} // dock state
build('host_tab', host_dock, dock_tab => {
	register_tab('host_tab', dock_tab)
	if (dock_tab == host_tab)
		context.dock_tab_panes('inner', inner_dock, inner_dock.root,
			null, inner_tab => register_tab('inner', inner_tab), null, {})
})
context.set_current_scope(state_map.get('inner.inner_detail_tab').state_scope)
assert(ui.get_dock_shared_parent_depth('inner.inner_near_tab')
	> ui.get_dock_shared_parent_depth('host_tab.host_tab'))
assert(ui.get_dock_shared_parent_depth('host_tab.host_tab')
	> ui.get_dock_shared_parent_depth('host_tab.outer_master_tab'))
const parent_scope = state_map.get('inner.inner_detail_tab').state_scope
context.set_current_scope({parent: parent_scope})
assert(ui.get_dock_shared_parent_depth('inner.inner_near_tab')
	> ui.get_dock_shared_parent_depth('host_tab.outer_master_tab'))
context.set_current_scope(state_map.get('dock.detail_tab').state_scope)
assert.equal(ui.get_dock_shared_parent_depth('host_tab.outer_master_tab'), 0)
dock.root = split(tablist(detail_tab),
	split(tablist(near_tab), tablist(far_tab)))
assert.equal(ui.get_dock_shared_parent_depth('dock.near_tab'),
	ui.get_dock_shared_parent_depth('dock.far_tab'))
assert.equal(context.find_master_nav('tables').id, 'dock.near_tab.2')
console.log('Dock ancestry and master selection checks passed.')

// live tabs and focus restoration

const selected_tab = tab('selected')
const live_tab = tab('live')
live_tab.live = true
const kept_tab = tab('kept')
const live_dock = {root: tablist(selected_tab, live_tab, kept_tab)}
const built_tabs = []
const hidden_stacks = []
const focus_calls = []
const stack0 = ui.stack
const focus0 = ui.focus
ui.stack = function(id, fr, align, valign, hidden) {
	if (hidden !== undefined)
		hidden_stacks.push(hidden)
}
ui.focus = id => focus_calls.push(id)
function build_live_tab(dock_tab) {
	built_tabs.push(dock_tab.id)
	register_tab('live', dock_tab)
}
live_dock.root.selected_tab_id = 'kept'
context.build_no++
build('live', live_dock, build_live_tab)
live_dock.root.selected_tab_id = 'selected'
context.build_no++
built_tabs.length = 0
hidden_stacks.length = 0
build('live', live_dock, build_live_tab)
assert.deepEqual(built_tabs, ['selected', 'live'])
assert.deepEqual(hidden_stacks, [false, true])
assert.equal(ui.is_state_hidden('live.selected'), false)
assert.equal(ui.is_state_hidden('live.live'), true)
assert.equal(ui.is_state_hidden('live.kept'), true)
context.rowset_navs.live_masters = [
	{id: 'live.selected'}, {id: 'live.live'},
]
assert.equal(context.find_master_nav('live_masters', 'live.live').id,
	'live.selected')
const live_scope = state_map.get('live.live').state_scope
live_scope.focused_id = 'live.live'
context.build_no++
build('live', live_dock, build_live_tab)
assert.deepEqual(focus_calls, [])
assert.equal(live_scope.focused_id, 'live.live')
live_dock.root.selected_tab_id = 'live'
context.build_no++
build('live', live_dock, build_live_tab)
assert.deepEqual(focus_calls, ['live.live'])
assert.equal(live_scope.focused_id, null)
assert.equal(ui.is_state_hidden('live.live'), false)
assert.equal(context.find_master_nav('live_masters', 'live.selected').id,
	'live.live')

const nested_live_tab = tab('parent', tablist(tab('child')))
nested_live_tab.live = true
const nested_live_dock = {root: tablist(tab('visible'), nested_live_tab)}
context.build_no++
build('nested_live', nested_live_dock, dock_tab =>
	register_tab('nested_live', dock_tab))
assert.equal(ui.is_state_hidden('nested_live.child'), true)
const child_scope = state_map.get('nested_live.child').state_scope
child_scope.focused_id = 'nested_live.child'
focus_calls.length = 0
context.build_no++
build('nested_live', nested_live_dock, dock_tab =>
	register_tab('nested_live', dock_tab))
assert.deepEqual(focus_calls, [])
nested_live_dock.root.selected_tab_id = 'parent'
context.build_no++
build('nested_live', nested_live_dock, dock_tab =>
	register_tab('nested_live', dock_tab))
assert.deepEqual(focus_calls, ['nested_live.child'])
assert.equal(ui.is_state_hidden('nested_live.child'), false)
ui.stack = stack0
ui.focus = focus0
console.log('Live tab builds, hidden scopes and focus checks passed.')

// dock layout persistence

Object.assign(context, {
	assign: Object.assign, empty: {}, capture_match: () => null,
	update_dock_tabs: noop,
})
vm.runInContext([
	section(ui_source, 'function free_state(', 'ui.begin_state_scope ='),
	section(ui_source, 'function create_dock_layout(',
		'function new_dock_tab_id('),
	section(ui_source, 'function serialize_dock_layout(',
		'function find_dock_parent('),
	section(ui_source, 'ui.dock =', 'ui.set_dock_tab ='),
	section(ui_source, 'ui.select_dock_tab =', 'ui.remove_dock_tab ='),
].join('\n'), context)
const saves = []
ui.saved_state = {}
ui.save_state = function(id, key, value) {
	saves.push([id, key])
	ui.saved_state[id] ??= {}
	ui.saved_state[id][key] = JSON.parse(JSON.stringify(value))
}
const form_layout = {tabs: [
	{id: 'first', live: true}, {id: 'second', live: true},
]}
const old_form_layout = {key: 7, tabs: [{id: 'old'}], selected_tab_id: 'old'}
ui.saved_state.form = {root: old_form_layout, next_key: 8}
context.set_current_scope(null)
ui.dock('form', form_layout, noop, {save_layout: false})
assert.equal(ui.state_of('form').save_layout, false)
assert.equal(ui.state_of('form').root.selected_tab_id, 'first')
assert.equal(ui.state_of('form').root.tabs[0].live, true)
ui.select_dock_tab('form', 'second')
assert.equal(ui.state_of('form').root.selected_tab_id, 'second')
assert.deepEqual(saves, [])
assert.equal(ui.saved_state.form.root, old_form_layout)
ui.free_state('form')
ui.dock('form', form_layout, noop, {save_layout: false})
assert.equal(ui.state_of('form').root.selected_tab_id, 'first')
assert.deepEqual(saves, [])

const saved_layout = {
	key: 3, tabs: [{id: 'saved', live: true}, {id: 'other', live: false}],
	selected_tab_id: 'saved',
}
ui.saved_state.persistent = {root: saved_layout, next_key: 4}
ui.dock('persistent', form_layout, noop)
assert.equal(ui.state_of('persistent').save_layout, true)
assert.equal(ui.state_of('persistent').root, saved_layout)
ui.select_dock_tab('persistent', 'other')
assert.deepEqual(saves, [['persistent', 'root'], ['persistent', 'next_key']])
assert.equal(ui.saved_state.persistent.root.tabs[0].live, true)
assert.equal(ui.saved_state.persistent.root.tabs[1].live, false)
ui.free_state('persistent')
ui.dock('persistent', form_layout, noop)
assert.equal(ui.state_of('persistent').root.selected_tab_id, 'other')
assert.equal(ui.state_of('persistent').root.tabs[0].live, true)
console.log('Transient layouts and saved live flags checks passed.')

// hidden stack layout and registration

const layout_context = vm.createContext({
	ui: {}, max: Math.max, min: Math.min, round: Math.round,
	obj: () => Object.create(null),
	isnum: value => typeof value == 'number',
	assert(value, ...message) {
		assert(value, message.join(' '))
		return value
	},
	tui_snap_paddings: noop, font_size_normal: 16,
})
vm.runInContext([
	'let ct_stack = []; let cur_theme = "light"; let theme_stack = [];',
	'let registered = []; let painted = []; let hit_n = 0;',
	'function is_main_axis() { return false }',
	'function hit_rect() { return true }',
	'function hit_ct() { hit_n++; return true }',
	section(ui_source, 'let measure       =', '/// measuring phase'),
	section(ui_source, 'let a // current recording', '//// LAYERS'),
	section(ui_source, 'const PX1 ', 'ui.box_widget ='),
	section(ui_source, 'function cmd_next_sibling_i(', 'ui.box_ct_widget ='),
	section(ui_source, 'const CMD_END =', '// position phase utils'),
	section(ui_source, 'function position_children_stacked(',
		'// hit phase utils'),
	section(ui_source, 'const STACK_ID ', '//// ASPECT BOX'),
	section(ui_source, 'function measure_rec(', '/// drawing phase'),
	section(ui_source, 'function draw_cmd(', 'function draw_popups('),
	`const MARK = cmd('marker')
	register[MARK] = (a, i) => { registered.push(a[i]) }
	draw[MARK] = (a, i) => { painted.push(a[i]) }
	globalThis.build_layout = function(hidden) {
		a = []; n = 0; ct_stack = []; a.ct_stack = ct_stack
		let root_i = ui.stack('root')
		ui.min_wh(30, 200)
		ui.stack('selected')
		ui.cmd(MARK, 'selected')
		ui.end_stack()
		ui.min_wh(200, 30)
		let hidden_i = ui.stack('live', 1, 's', 's', hidden)
		ui.cmd(MARK, 'live')
		ui.stack('nested')
		ui.cmd(MARK, 'nested')
		ui.end_stack()
		ui.end_stack()
		ui.end_stack()
		a.n = n
		measure_rec(a, 0)
		position_rec(a, 0, 200)
		measure_rec(a, 1)
		position_rec(a, 1, 200)
		registered = []; painted = []; hit_n = 0
		register_rec(a, 0)
		draw_cmd(a, root_i, [a])
		hittest[CMD_STACK](a, hidden_i, [a])
		return {
			w: a[root_i+2], h: a[root_i+3], registered, painted, hit_n,
		}
	}`,
].join('\n'), layout_context)
const hidden_layout = layout_context.build_layout(true)
assert.equal(hidden_layout.w, 200)
assert.equal(hidden_layout.h, 200)
assert.deepEqual(Array.from(hidden_layout.registered), ['selected'])
assert.deepEqual(Array.from(hidden_layout.painted), ['selected'])
assert.equal(hidden_layout.hit_n, 0)
const visible_layout = layout_context.build_layout(false)
assert.deepEqual(Array.from(visible_layout.registered),
	['selected', 'live', 'nested'])
assert.deepEqual(Array.from(visible_layout.painted),
	['selected', 'live', 'nested'])
assert.equal(visible_layout.hit_n, 1)
console.log('Hidden stack sizing, registration, drawing and hit checks passed.')
