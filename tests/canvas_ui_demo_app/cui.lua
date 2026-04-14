--go @ sdk\bin\windows\luajit.exe cui.lua run

require'webb_auth'

logging.verbose = 1
--logging.debug = 1
config('http_server_debug', 'protocol')
require'cui_app'('run')--(...)

app.main_file = 'cui_demo.js'
wwwdir'../../canvas-ui/www'

logging.verbose = config'verbose'

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
