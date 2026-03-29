do
	local debug_getinfo = debug.getinfo
	local string_format = string.format
	local function trace_line(level, t)
		local info = debug_getinfo(level + 1, 'nS')
		local line = string_format('%s: %d',
			info.source:match('[^\\/]-$'), info.linedefined)
		t[line] = (t[line] or 0) + 1
		return line
	end

	local coro_create0   = coro_create
	local coro_safewrap0 = coro_safewrap
	local counts --{line->count}
	local threads --{line->{thread->true}}
	local weak_keys
	local function trace_coro_at(line, th)
		local t = threads[line]
		if not t then
			t = setmetatable({}, weak_keys)
			threads[line] = t
		end
		t[th] = true
	end
	function trace_coro()
		counts = {}
		threads = {}
		weak_keys = {__mode = 'k'}
		function coro_create(...)
			local line = trace_line(3, counts)
			local th = coro_create0(...)
			trace_coro_at(line, th)
			return th
		end
		function coro_safewrap(...)
			local line = trace_line(3, counts)
			local f, th = coro_safewrap0(...)
			trace_coro_at(line, th)
			return f, th
		end
	end

	function coro_counts()
		local all = cat(imap(sort(keys(counts), function(k1, k2)
			if counts[k1] == counts[k2] then
				return k1 < k2
			end
			return counts[k1] < counts[k2]
		end), function(k)
			return format('%5d %s', counts[k], k)
		end), '\n')
		local live = cat(imap(sort(keys(threads), function(k1, k2)
			local n1 = count(threads[k1])
			local n2 = count(threads[k2])
			if n1 == n2 then
				return k1 < k2
			end
			return n1 < n2
		end), function(k)
			return format('%5d %s', count(threads[k]), k)
		end), '\n')
		return all, live
	end
end
