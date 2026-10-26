require'webb'
require'proc'

config{auth_store = 'mdbx'}
--config{root_action = 'ui-demo.html'}
config{http_host = '*'}

--config from env vars for automated tests
config{http_port  = tonumber(env'HTTP_PORT' ) or 8888}
config{https_port = tonumber(env'HTTPS_PORT') or 4443}
config{vardir = env'VARDIR'} --can't put vardir in conf since conf is in vardir.
--config{https_addr = false}

require'cui_app'(...)

--logging.debug = config('debug', true)
--logging.verbose = config('verbose', true)
--logging.filter.log = true
--logging.filter.open = true
--errortype'http_response'.addtraceback = true
--config{http_server_debug = 'requests'}

app.main_file = 'demo.js'
wwwdir'../www'

require'rowset_mdbx'
require'ui_db_explorer'
require'webb_call'

do
	local test_actions = {
		'normal', 'slow save', 'slow response',
		'disconnect before save', 'disconnect after save',
		'reject row', 'delete existing row', 'hold save',
	}
	--slow or drop a save as asked by the test_action of a saved row. 'delete
	--existing row' deletes the row other_key in another transaction first.
	--'hold save' waits for exec_release, or passes at once if exec_release
	--came first.
	local function add_test_actions(rs, tbl, key_col, other_key)
		local held_threads = {} --saves waiting for exec_release
		local has_release --exec_release came with no save waiting
		function rs:exec_release()
			if #held_threads > 0 then
				for _, thread in ipairs(held_threads) do resume(thread) end
				held_threads = {}
			else
				has_release = true
			end
			return {}
		end
		local exec_save = rs.exec_save
		function rs:exec_save(params, post)
			local has_slow_save, has_slow_response, has_hold_save
			local has_disconnect_before, has_disconnect_after
			for _, row in ipairs(post.changes.rows) do
				local action = row.values.test_action
				has_hold_save = has_hold_save or action == 'hold save'
				has_slow_save = has_slow_save or action == 'slow save'
				has_slow_response = has_slow_response
					or action == 'slow response'
				has_disconnect_before = has_disconnect_before
					or action == 'disconnect before save'
				has_disconnect_after = has_disconnect_after
					or action == 'disconnect after save'
				if action == 'delete existing row' then
					db():atomic('w', function()
						db():del(tbl, other_key)
					end)
				end
				pr(tbl..' save', row.type,
					row.values[key_col] or row.values[key_col..':old'], action)
			end
			if has_slow_save then wait(5) end
			if has_hold_save then
				if has_release then
					has_release = false
				else
					add(held_threads, currentthread())
					suspend()
				end
			end
			if has_disconnect_before then
				http_request().tcp:close()
				http_error(503)
			end
			local res = exec_save(self, params, post)
			if has_slow_response then wait(5) end
			if has_disconnect_after then
				http_request().tcp:close()
				http_error(503)
			end
			return res
		end
	end

	local grid_rows = {
		{1, null, 1, 'Edited parent', 10, 'normal',
			'Edit this parent and its child in the same save.'},
		{2, 1, 1, 'Edited child', 20, 'normal',
			'Edit this child; insert a sibling under its saved parent.'},
		{3, null, 2, 'Deleted parent', 30, 'normal',
			'Delete this parent, child and grandchild in the same save.'},
		{4, 3, 1, 'Deleted child', 40, 'normal',
			'This child must be deleted before its parent.'},
		{5, 4, 1, 'Deleted grandchild', 50, 'normal',
			'This grandchild must be deleted before its parent.'},
		{6, null, 3, 'Other user deletes this row', 60, 'normal',
			'Update or delete a row already deleted on the server.'},
		{7, null, 4, 'Rejected row', 70, 'normal',
			'Reject this row while accepting the other changed rows.'},
		{8, null, 5, 'Response control', 80, 'normal',
			'Choose a delay or disconnect here; clear it before retrying.'},
	}
	local grid_typed_rows = {
		{'A1', 'Edited row', 10, 'normal', 'Edit this row.'},
		{'A2', 'Deleted row', 20, 'normal', 'Delete this row.'},
		{'A3', 'Other user deletes this row', 30, 'normal',
			'Update or delete a row already deleted on the server.'},
		{'A4', 'Rejected row', 40, 'normal',
			'Reject this row while accepting the other changed rows.'},
		{'A5', 'Response control', 50, 'normal',
			'Choose a delay or disconnect here; clear it before retrying.'},
	}
	db_schema:import(function()
		import'schema_mdbx'
		tables.grid_save = {
			row_check("row.test_action ~= 'reject row'", 'Test row rejected'),
			id               , idpk,
			parent_id        , id, fk'grid_save',
			pos              , pos,
			text             , str,
			num              , f64, default(nil, '42'),
			test_action      , enum(test_actions), not_null,
				default('normal', "'normal'"),
			test_description , text,
		}
		tables.grid_save.rows = grid_rows
		tables.grid_typed = {
			row_check("row.test_action ~= 'reject row'", 'Test row rejected'),
			code             , str, pk,
			text             , str,
			num              , f64, default(nil, '42'),
			test_action      , enum(test_actions), not_null,
				default('normal', "'normal'"),
			test_description , text,
		}
		tables.grid_typed.rows = grid_typed_rows
	end)
	app:after('install', function()
		local domain = assert(config'domain', -- configured host
			'domain not configured')
		local st = auth_store() -- authentication store
		st.with_lock('w', function()
			if not st.tenant_exists(1) then
				db():insert('tenant', '{}', {tenant = 1})
			end
			if not st.try_tenant_by_host(domain) then
				st.add_host(domain, 1)
			end
		end)
	end)
	app:before('run_server', function()
		local grid_db = db() -- application database
		auth_init()
		local st = auth_store() -- authentication store
		st.with_lock('w', function()
			st.repair()
			webb_call_repair()
		end)
		local demo_call = {call = 1} -- demo call id and invite token
		grid_db:atomic('w', function()
			demo_call.invite_token = grid_db:find('call',
				'invite_token', demo_call.call)
			if not demo_call.invite_token then
				grid_db:insert('call', '{}', {
					call = demo_call.call,
					name = 'Demo call',
				})
				demo_call.invite_token = grid_db:must_find('call',
					'invite_token', demo_call.call)
			end
		end)
		action['call_demo.json'] = function()
			return demo_call
		end
		rowset.grid_save = grid_db:atomic('r', function()
			return table_rowset('grid_save', {
				name = 'grid_save',
				parent_col = 'parent_id',
				pos_col = 'pos',
				tree_col = 'text',
				cols = 'id text num test_action test_description',
				field_attrs = {
					text = {w = 16},
					test_action = {w = 18},
					test_description = {w = 45},
				},
			})
		end)
		local rs = rowset.grid_save
		add_test_actions(rs, 'grid_save', 'id', 6)
		function rs:exec_reset()
			db():atomic('w', function()
				local children = {}
				local roots = {}
				for _, row in ipairs(db():scan('grid_save', '')
					:select('id, parent_id'):rows_array('{}')) do
					if row.parent_id then
						add(attr(children, row.parent_id), row.id)
					else
						add(roots, row.id)
					end
				end
				local function delete_tree(id)
					for _, child_id in ipairs(children[id] or empty) do
						delete_tree(child_id)
					end
					db():del('grid_save', id)
				end
				for _, id in ipairs(roots) do delete_tree(id) end
				for _, row in ipairs(grid_rows) do
					db():insert('grid_save', '[]', row)
				end
			end)
			return self:exec_load({})
		end

		rowset.grid_typed = grid_db:atomic('r', function()
			return table_rowset('grid_typed', {
				name = 'grid_typed',
				cols = 'code text num test_action test_description',
				field_attrs = {
					text = {w = 16},
					test_action = {w = 18},
					test_description = {w = 45},
				},
			})
		end)
		rs = rowset.grid_typed
		add_test_actions(rs, 'grid_typed', 'code', 'A3')
		function rs:exec_reset()
			db():atomic('w', function()
				for _, row in ipairs(db():scan('grid_typed', '')
					:select('code'):rows_array('{}')) do
					db():del('grid_typed', row.code)
				end
				for _, row in ipairs(grid_typed_rows) do
					db():insert('grid_typed', '[]', row)
				end
			end)
			return self:exec_load({})
		end

		prepare_rowsets()
	end)
end

fontfile('mono'         , 'fonts/jetbrains-mono-nl-regular.woff2')
fontfile('opensans'     , 'fonts/opensans.var.woff2')
fontfile('tabler'       , 'icons/tabler-icons.woff2')
fontfile('tabler_filled', 'icons/tabler-icons.woff2')

action.error = error

--NOTE: a session is a browser tab.
local session_state = {} --{sid->{signals=, waiting_thread=}}

action.rtc_signal = function()
	local post = post()
	local sid = checkarg(str_arg(post.sid), 'sid required')
	local state = checkarg(session_state[sid], 'invalid session id')
	local to_sid = checkarg(str_arg(post.to_sid), 'to_sid required')
	local to_state = checkfound(session_state[to_sid], 'user left')
	add(to_state.signals, {k = post.k, v = post.v})
	pr('-> signal', sid, '->', to_sid, post.k, post.v)
	if to_state.waiting_thread then
		resume(to_state.waiting_thread)
	end
end

action['rtc_signal.events'] = function()
	setheader('cache-control', 'no-cache')
	setconnectionclose()
	setcompress(false)
	local digits = 4
	local sid = tostring(random(10^(digits-1), 10^digits-1))
	local signals = {}
	local state = {signals = signals}
	session_state[sid] = state
	local function close()
		session_state[sid] = nil
		if state.waiting_thread then
			return resume(state.waiting_thread, 'closed')
		end
	end
	--when client closes the socket...
	http_request():onfinish(close)
	--when we close the socket from another thread...
	http_request().tcp:onclose(close)
	assert(not out_buffering())
	out('data: '..json_encode{sid = sid}..'\n\n')
	while true do
		local signal = remove(signals, 1)
		if signal then
			pr('->> signal', signal)
			out('data: '..json_encode(signal)..'\n\n')
		else
			state.waiting_thread = currentthread()
			local action = suspend()
			state.waiting_thread = nil
			if action == 'closed' then
				break
			end
		end
	end
end

exit(app:run())
