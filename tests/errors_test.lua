require'glue'

local function raises(f)
	local ok, e = pcall(f)
	assert(not ok)
	return e
end

local function raises_same(e, f)
	assert(raises(f) == e)
end

local function assert_contains(s, p)
	assert(tostring(s):find(p, 1, true))
end

-- Structured errors keep machine-readable type/message/target fields while
-- tostring() gives enough context for logs and uncaught errors.
do
	local target = {type = 'conn', debug_prefix = 'C'}
	local e = error_for(target, 'io', '%s:%d', 'host', 80)

	assert(iserror(e, 'io', 'host:80'))
	assert(not iserror(e, 'protocol'))
	assert(not iserror({type = 'io', message = 'host:80'}))
	assert(e.target == target)

	local s = tostring(e)
	assert_contains(s, 'host:80')
	assert_contains(s, 'conn')
	assert_contains(s, ':')

	local e = newerror{type = 'content', message = 'bad', traceback = 'trace'}
	assert(tostring(e) == 'trace')
end

-- catch()/try() are protocol boundaries: they catch selected structured
-- errors, and they must not swallow bugs, unrelated error types or CANCEL.
do
	local io_err = newerror{type = 'io', message = 'down'}

	local ok, e = catch('io protocol', function()
		error(io_err)
	end)
	assert(ok == false)
	assert(e == io_err)

	local ok, e = try(function()
		error(newerror{type = 'content', message = 'invalid'})
	end)
	assert(ok == false)
	assert(iserror(e, 'content', 'invalid'))

	raises_same(io_err, function()
		catch('protocol', function()
			error(io_err)
		end)
	end)

	raises_same(CANCEL, function()
		catch(nil, function()
			error(CANCEL)
		end)
	end)

	local e = raises(function()
		catch(nil, function()
			error'plain bug'
		end)
	end)
	assert_contains(e, 'plain bug')
end

-- Raising adapters and check helpers attach the right error type/target, keep
-- successful return values untouched, and pass structured errors through.
do
	local target = {type = 'file', debug_prefix = 'f'}

	local f = make_raising('io', function(self, x)
		assert(self == target)
		return true, 'kept', x
	end)
	local ok, a, b = f(target, 'arg')
	assert(ok == true)
	assert(a == 'kept')
	assert(b == 'arg')

	local e = raises(function()
		make_raising('io', function()
			return nil, 'boom'
		end)(target)
	end)
	assert(iserror(e, 'io', 'boom'))
	assert(e.target == target)

	local orig = newerror{type = 'protocol', message = 'bad frame'}
	raises_same(orig, function()
		make_raising('io', function()
			return nil, orig
		end)(target)
	end)
	raises_same(orig, function()
		check_io(target, false, orig)
	end)
	raises_same(orig, function()
		raise(target, 'io', orig)
	end)

	local checks = {
		{check_io, 'io'},
		{checkp, 'protocol'},
		{checknp, 'content'},
	}
	for _, t in ipairs(checks) do
		local check, errtype = t[1], t[2]
		local e = raises(function()
			check(target, false, 'bad %s', 'input')
		end)
		assert(iserror(e, errtype, 'bad input'))
		assert(e.target == target)
	end
end

-- errno handling separates recoverable/user-facing errno strings from fatal
-- usage/kernel-contract errors that should crash immediately.
do
	local v, err = try_errno(nil, 'custom')
	assert(v == nil)
	assert(err == 'custom')

	local v, err = try_errno(nil, 2) --ENOENT
	assert(v == nil)
	assert(err == 'not_found')

	assert(try_errno(true, 22) == true) --successful ret wins over errno arg.

	local e = raises(function()
		try_errno(nil, 22) --EINVAL
	end)
	assert_contains(e, 'invalid_argument')

	local e = raises(function()
		check_errno(nil, 2)
	end)
	assert_contains(e, 'not_found')
end

print'errors ok'
