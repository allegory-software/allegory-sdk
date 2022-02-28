--[==[

	Multi-level caching.
	Written by Cosmin Apreutesei. Public Domain.

	cache(opt)
		storage() -> t

NOTE ON VARARG MEMOIZATION

	For a function f(x, y, ...), calling f(1) is considered to be the same as
	calling f(1, nil), but calling f(1, nil) is not the same as calling
	f(1, nil, nil). The optional `narg` fixates the function to always take
	exactly narg args regardless of how the function was defined.

	The optional `weak` arg makes the cache of returned values weak and is
	useful for caching objects that are pinned elsewere without leaking memory.
	Using this flag requires that the function to be memoized returns heap
	objects only and always!

]==]

local cache = {}

local weakvals_meta = {__mode = 'v'}

function cache.new(opt)

	local storage = opt.storage

	local function storage()
		return
	end

	--memoize for 0, 1, 2-arg and vararg and 1 retval functions.
	local function weakvals(weak)
		return weak and setmetatable({}, weakvals_meta) or {}
	end
	local function memoize0(fn) --for strict no-arg functions
		local v, stored
		return function()
			if not stored then
				v = fn(); stored = true
			end
			return v
		end
	end
	local nilkey = {}
	local nankey = {}
	local function memoize1(fn, weak) --for strict single-arg functions
		local cache = weakvals(weak)
		return function(arg)
			local k = arg == nil and nilkey or arg ~= arg and nankey or arg
			local v = cache[k]
			if v == nil then
				v = fn(arg)
				cache[k] = v == nil and nilkey or v
			else
				if v == nilkey then v = nil end
			end
			return v
		end
	end
	local function memoize2(fn, weak) --for strict two-arg functions
		local cache = weakvals(weak)
		local pins = weak and weakvals(weak)
		return function(a1, a2)
			local k1 = a1 ~= a1 and nankey or a1 == nil and nilkey or a1
			local cache2 = cache[k1]
			if cache2 == nil then
				cache2 = weakvals(weak)
				cache[k1] = cache2
			end
			local k2 = a2 ~= a2 and nankey or a2 == nil and nilkey or a2
			local v = cache2[k2]
			if v == nil then
				v = fn(a1, a2)
				cache2[k2] = v == nil and nilkey or v
				if weak then --pin weak chained table to the return value.
					assert(type(v) == 'table')
					pins[cache2] = v
				end
			else
				if v == nilkey then v = nil end
			end
			return v
		end
	end
	local function memoize_vararg(fn, weak, minarg, maxarg)
		local cache = weakvals(weak)
		local values = weakvals(weak)
		local pins = weak and weakvals(weak)
		local pinstack = {}
		local inside
		return function(...)
			assert(not inside) --recursion not supported because of the pinstack.
			local inside = true
			local key = cache
			local narg = min(max(select('#',...), minarg), maxarg)
			for i = 1, narg do
				local a = select(i,...)
				local k = a ~= a and nankey or a == nil and nilkey or a
				local t = key[k]
				if not t then
					t = weakvals(weak)
					key[k] = t
				end
				if weak and i < narg then --collect to-be-pinned weak chained tables.
					pinstack[i] = t
				end
				key = t
			end
			local v = values[key]
			if v == nil then
				v = fn(...)
				values[key] = v == nil and nilkey or v
				if weak then --pin weak chained tables to the return value.
					for i = narg-1, 1, -1 do
						assert(type(v) == 'table')
						pins[pinstack[i]] = v
						pinstack[i] = nil
					end
				end
			end
			if v == nilkey then v = nil end
			inside = false
			return v
		end
	end
	local memoize_narg = {[0] = memoize0, memoize1, memoize2}
	local function choose_memoize_func(func, narg, weak)
		if type(narg) == 'function' then
			return choose_memoize_func(narg, nil, weak)
		elseif narg then
			local memoize_narg = (not (narg == 0 and weak)) and memoize_narg[narg]
			if memoize_narg then
				return memoize_narg
			else
				return memoize_vararg, narg, narg
			end
		else
			local info = debug.getinfo(func, 'u')
			if info.isvararg then
				return memoize_vararg, info.nparams, 1/0
			else
				return choose_memoize_func(func, info.nparams, weak)
			end
		end
	end
	function glue.memoize(func, narg, weak)
		local memoize, minarg, maxarg = choose_memoize_func(func, narg, weak)
		return memoize(func, weak, minarg, maxarg)
	end

	--memoize for functions with multiple return values.
	function glue.memoize_multiret(func, narg, weak)
		local memoize, minarg, maxarg = choose_memoize_func(func, narg, weak)
		local function wrapper(...)
			return glue.pack(func(...))
		end
		local func = memoize(wrapper, weak, minarg, maxarg)
		return function(...)
			return glue.unpack(func(...))
		end
	end

	--[[
	A tuple space is a function that generates tuples. Tuples are immutable lists
	that can be used as table keys because they have value semantics: the tuple
	space returns the same identity for the same list of input identities.

	A tuple can be expanded to get its input identities by calling it: t() -> ...

	IMPLEMENTATION: Tuple elements are indexed internally with a hash tree.
	Creating a tuple thus takes N hash lookups and M table creations, where N+M
	is the number of elements in the tuple. Lookup time depends on how dense the
	tree is on the search path, which depends on how many existing tuples share
	a first sequence of elements with the tuple being created. In particular,
	creating tuples out of all permutations of a certain set of values hits the
	worst case for lookup time, but creates the minimum amount of tables relative
	to the number of tuples.
	]]
	local tuple_mt = {__call = glue.unpack}
	function tuple_mt:__tostring()
		local t = {}
		for i=1,self.n do
			t[i] = tostring(self[i])
		end
		return string.format('(%s)', concat(t, ', '))
	end
	function tuple_mt:__pwrite(write, write_value) --integration with the pp module.
		write'tuple('; write_value(self[1])
		for i=2,self.n do
			write','; write_value(self[i])
		end
		write')'
	end
	function glue.tuples(...)
		return glue.memoize(function(...)
			return setmetatable(glue.pack(...), tuple_mt)
		end, ...)
	end
	function glue.weaktuples(narg)
		return glue.tuples(narg, true)
	end
	local tspace
	function glue.tuple(...)
		tspace = tspace or glue.weaktuples()
		return tspace(...)
	end

end

return cache
