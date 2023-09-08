--go @ sdk\bin\windows\luajit.exe cui.lua run
require'daemon'
require'webb'
require'webb_action'

local app = daemon(...)

logging.verbose = config'verbose'

function app:run_server()
	app.server = webb_http_server()
	start(config('ignore_interrupts', true))
end

config('main_module', function()
	checkfound(action(unpack(args())))
end)

action['404.html'] = function()
	local s = load(indir(exedir(), '..', '..', 'canvas-ui', 'demo.html'))
	s = s:gsub('<base href="(.-)">', '/')
	out(s)
end

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
	local sid = format('%15d', random(10^14, 10^15-1))
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
		local signal = remove(signals, 1)
	while true do
		if signal then
			pr('->> signal')
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

exit(app:run(...))
