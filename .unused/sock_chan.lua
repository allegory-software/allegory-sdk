function chan() --golang-like unbuffered channels (untested)
	local c = {}
	local get_thread
	local put_thread
	local function reset(...)
		get_thread = nil
		return ...
	end
	function c:get()
		assert(not get_thread)
		get_thread = currentthread()
		if put_thread then
			return reset(transfer(put_thread))
		end
		return reset(suspend()) --wait for :put() to resume() us
	end
	function c:put(...)
		assert(not put_thread)
		if not get_thread then
			put_thread = currentthread()
			suspend() --wait for :get() to transfer() to us
			put_thread = nil
			assert(get_thread)
		end
		resume(get_thread, ...)
	end
	return c
end
