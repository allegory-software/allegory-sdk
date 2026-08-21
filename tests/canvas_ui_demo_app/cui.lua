require'webb_auth'

config{http_host = '*'}
config{http_port = 8888}
config{https_port = 4443}
--config{https_addr = false}
config{project_dir = homedir()}

--dev mode: gen_auth_code.json returns the code to the browser; without a
--mailer there would be no other way to get it.
config{env = 'dev'}

config{http_server_debug = 'requests'}
require'cui_app'(...)

auth_init()
local st = auth_store()
st.with_lock('w', function()
	if not st.tenant_exists(1) then
		assert(st.add_tenant() == 1)
		st.add_host('localhost:8888', 1)
		st.add_host('localhost:4443', 1)
	end
end)

logging.debug = true
logging.verbose = config('verbose', true)
logging.filter.log = true
logging.filter.open = true
--errortype'http_response'.addtraceback = true

app.main_file = 'cui_demo.js'
wwwdir'../../canvas-ui/www'

fontfile('mono'    , 'fonts/jetbrains-mono-nl-regular.woff2')
fontfile('inter'   , 'fonts/inter-roman.var.woff2')
fontfile('opensans', 'fonts/opensans.var.woff2')
fontfile('las'     , 'icons/la-solid-900.woff2')
fontfile('fas'     , 'icons/fa-solid-900.woff2')

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
	http_request().http.f:onclose(close)
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
