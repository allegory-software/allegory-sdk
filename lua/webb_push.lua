
--WIP don't use!
--push-notifications action

require'webb_action'
require'webb_auth'

function push_notifications_action(action_name, serialize_event, event_belongs_to)

	serialize_event = serialize_event or tostring

	local waiting_events_threads = {}
	local queues = {} --{req->queue}

	local function push_event(ev, push_to_clients)
		for req, queue in pairs(queues) do
			if event_belongs_to(ev, req) then
				add(queue, ev)
			end
		end
		if push_to_clients ~= false then
			for thread in pairs(waiting_events_threads) do
				resume(thread)
			end
		end
	end

	action[action_name] = function()
		setheader('cache-control', 'no-cache')
		setconnectionclose()
		setcompress(false)
		local waiting_thread
		local queue = {} --{event1, ...}
		local req = req()
		queues[req] = queue
		local function resume_waiting_thread()
			queues[req] = nil
			if waiting_thread then
				return resume(waiting_thread, 'closed')
			end
		end
		--when client closes the socket...
		req:onfinish(resume_waiting_thread)
		--when we close the socket from another thread...
		req.http.f:onclose(resume_waiting_thread)
		while true do
			if isempty(events) then
				local thread = currentthread()
				waiting_events_threads[thread] = true
				waiting_thread = thread
				local action = suspend()
				waiting_events_threads[thread] = nil
				waiting_thread = nil
				if action == 'closed' then
					break
				end
			end
			local t = {}
			for i, event in ipairs(queue) do
				local s = serialize_event(event)
				assert(not s:find'\n\n', [[event can't contain the sequence \n\n]])
				t[#t+1] = 'data: '..s..'\n\n'
			end
			for i = #queue, 1, -1 do
				queue[i] = nil
			end
			local events = concat(t)
			assert(not out_buffering())
			out(events)
		end
	end
end
