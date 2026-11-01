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
	section(ui_source, 'ui.is_state_hidden =', '// free_state()'),
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
