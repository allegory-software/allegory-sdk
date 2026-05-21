require'glue'

--newerror / iserror
do
	local e = newerror{type = 'io', message = 'test'}
	assert(iserror(e))
	assert(iserror(e, 'io'))
	assert(iserror(e, 'io', 'test'))
	assert(not iserror(e, 'protocol'))
	assert(not iserror(e, 'io', 'wrong'))
	assert(not iserror('string'))
	assert(not iserror(nil))
end

--catch: matched type returns false,e
do
	local ok, e = catch('io', function()
		error(newerror{type = 'io', message = 'fail'})
	end)
	assert(ok == false)
	assert(iserror(e, 'io', 'fail'))
end

--catch: multiple types in errtypes
do
	local ok, e = catch('io protocol', function()
		error(newerror{type = 'protocol', message = 'bad'})
	end)
	assert(ok == false)
	assert(iserror(e, 'protocol'))
end

--catch: unmatched type re-raises
do
	local ok = pcall(function()
		catch('protocol', function()
			error(newerror{type = 'io', message = 'x'})
		end)
	end)
	assert(not ok)
end

--catch: string errors cannot be caught
do
	local ok = pcall(function()
		catch(nil, function() error'plain' end)
	end)
	assert(not ok)
end

--catch: CANCEL cannot be caught
do
	local ok, e = pcall(function()
		catch(nil, function() error(CANCEL) end)
	end)
	assert(not ok)
	assert(e == CANCEL)
end

--make_raising: nil,err becomes a raised error
do
	local target = {}
	local raising = make_raising('io', function(self)
		assert(self == target)
		return nil, 'boom'
	end)
	local ok, e = pcall(raising, target)
	assert(not ok)
	assert(iserror(e, 'io', 'boom'))
	assert(e.target == target)
end

--make_raising: structured errors are re-raised verbatim
do
	local orig = newerror{type = 'protocol', message = 'bad frame', ctx = {}}
	local raising = make_raising('io', function()
		return nil, orig
	end)
	local ok, e = pcall(raising)
	assert(not ok)
	assert(e == orig)
end

--raise: typed error with formatted message
do
	local ok, e = pcall(raise, nil, 'io', '%s:%d', 'host', 80)
	assert(not ok)
	assert(iserror(e, 'io', 'host:80'))
end

--io_error / perror / nperror: typed error constructors
do
	local t = {}
	local e = io_error(t, '%s:%d', 'host', 80)
	assert(iserror(e, 'io', 'host:80'))
	assert(e.target == t)
	assert(iserror(perror(nil, 'bad'), 'protocol', 'bad'))
	assert(iserror(nperror(nil, 'invalid'), 'content', 'invalid'))
end

--check_io: raises 'io' typed error with formatted message
do
	local ok, e = pcall(check_io, nil, nil, '%s:%d', 'host', 80)
	assert(not ok)
	assert(iserror(e, 'io', 'host:80'))
end

--check_io: target attached to error
do
	local t = {}
	local ok, e = pcall(check_io, t, nil, 'fail')
	assert(not ok)
	assert(e.target == t)
end

--check_io: structured error passes through unchanged
do
	local orig = newerror{type = 'protocol', message = 'bad frame'}
	local ok, e = pcall(check_io, nil, nil, orig)
	assert(not ok)
	assert(e == orig)
	assert(iserror(e, 'protocol'))
end

--checkp: raises 'protocol' typed error
do
	local ok, e = pcall(checkp, nil, nil, 'bad handshake')
	assert(not ok)
	assert(iserror(e, 'protocol', 'bad handshake'))
end

--checknp: raises 'content' typed error
do
	local ok, e = pcall(checknp, nil, nil, 'invalid input')
	assert(not ok)
	assert(iserror(e, 'content', 'invalid input'))
end

--try_errno: string err passes through unchanged
do
	local v, e = try_errno(nil, 'oops')
	assert(v == nil)
	assert(e == 'oops')
end

--try_errno: known errno mapped to string error
do
	local v, e = try_errno(nil, 2) --ENOENT
	assert(v == nil)
	assert(e == 'not_found')
end

--try_errno: old-form calls raise instead of silently discarding args
do
	local ok = pcall(try_errno, nil, 'io', nil, 2)
	assert(not ok)
end

--check_errno: known errno raises a string error
do
	local ok, e = pcall(check_errno, nil, 2)
	assert(not ok)
	assert(e == 'not_found')
end

print'errors ok'
