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
	local e = newerror{target = target, type = 'net', event = 'connect',
		message = _('%s:%d', 'host', 80)}

	assert(iserror(e, 'net', 'host:80'))
	assert(not iserror(e, 'io'))
	assert(not iserror(e, 'protocol'))
	assert(not iserror({type = 'net', message = 'host:80'}))
	assert(e.target == target)

	local s = tostring(e)
	assert_contains(s, 'host:80')
	assert_contains(s, 'connect')
	assert_contains(s, 'conn')
	assert_contains(s, ':')

	local e = newerror{type = 'data', message = 'bad', traceback = 'trace'}
	assert(tostring(e) == 'trace')
end

-- catch()/try() are protocol boundaries: they catch selected structured
-- errors, and they must not swallow bugs, unrelated error types or CANCEL.
do
	local net_err = newerror{type = 'net', message = 'down'}

	local ok, e = catch('net fs protocol data', function()
		error(net_err)
	end)
	assert(ok == false)
	assert(e == net_err)

	local ok, e = try(function()
		error(newerror{type = 'data', message = 'invalid'})
	end)
	assert(ok == false)
	assert(iserror(e, 'data', 'invalid'))

	raises_same(net_err, function()
		catch('fs protocol data', function()
			error(net_err)
		end)
	end)

	raises_same(net_err, function()
		catch('io', function()
			error(net_err)
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
	local target = {type = 'file', error_type = 'fs', debug_prefix = 'f'}

	local f = make_raising('read', function(self, x)
		assert(self == target)
		return true, 'kept', x
	end)
	local ok, a, b = f(target, 'arg')
	assert(ok == true)
	assert(a == 'kept')
	assert(b == 'arg')

	local e = raises(function()
		make_raising('read', function()
			return nil, 'boom'
		end)(target)
	end)
	assert(iserror(e, 'fs', 'boom'))
	assert(e.target == target)
	assert(e.event == 'read')

	local orig = newerror{type = 'protocol', message = 'bad frame'}
	raises_same(orig, function()
		make_raising('net', 'read', function()
			return nil, orig
		end)(target)
	end)
	raises_same(orig, function()
		check_fs(target, 'read', false, orig)
	end)
	raises_same(orig, function()
		check_for('net', target, 'read', false, orig)
	end)

	raises_same(CLOSED, function()
		make_raising('net', 'read', function()
			return nil, 'closed'
		end)(target)
	end)

	local op_checks = {
		{check_fs, 'fs'},
		{check_net, 'net'},
	}
	for _, t in ipairs(op_checks) do
		local check, errtype = t[1], t[2]
		local e = raises(function()
			check(target, 'read', false, 'bad %s', 'input')
		end)
		assert(iserror(e, errtype, 'bad input'))
		assert(e.target == target)
		assert(e.event == 'read')
	end

	local checks = {
		{checkp, 'protocol'},
		{checknp, 'data'},
	}
	for _, t in ipairs(checks) do
		local check, errtype = t[1], t[2]
		local e = raises(function()
			check(target, false, 'bad %s', 'input')
		end)
		assert(iserror(e, errtype, 'bad input'))
		assert(e.target == target)
		assert(e.event == nil)
	end
end

-- errno handling maps errno to string errors; check_errno() raises.
do
	local v, err = try_errno(nil, 2) --ENOENT
	assert(v == nil)
	assert(err == 'not_found')

	assert(try_errno(true, 22) == true) --successful ret wins over errno arg.

	local v, err = try_errno(nil, 22) --EINVAL
	assert(v == nil)
	assert(err == 'invalid_argument')

	local e = raises(function()
		check_errno(nil, 2)
	end)
	assert_contains(e, 'not_found')
end

print'errors ok'
