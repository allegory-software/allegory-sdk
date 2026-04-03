require'glue'
require'errors_io'

--mock target with try_close tracking
local function mock_target(close_ok, close_err)
	return {
		closed = false,
		tracebacks = false,
		try_close = function(self)
			self.closed = true
			if close_ok == false then return false, close_err or 'close_err' end
			return true
		end,
	}
end

--check_io: raises io_error, closes target
do
	local t = mock_target()
	local ok, e = pcall(check_io, t, nil, 'disk full')
	assert(not ok)
	assert(iserror(e, 'io'))
	assert(e.message == 'disk full')
	assert(t.closed, 'check_io must close target')
end

--check_io: passes through on truthy value
do
	local v, extra = check_io(nil, 42, 'extra')
	assert(v == 42)
	assert(extra == 'extra')
end

--check_io: passes through structured errors unchanged
do
	local orig = protocol_error(nil, 'bad frame')
	local ok, e = pcall(check_io, mock_target(), nil, orig)
	assert(not ok)
	assert(e == orig, 'check_io must pass through structured errors')
	assert(iserror(e, 'protocol'), 'original error type must be preserved')
end

--check_io: appends close error to message
do
	local t = mock_target(false, 'broken pipe')
	local ok, e = pcall(check_io, t, nil, 'write failed')
	assert(not ok)
	assert(t.closed)
	assert(e.message:find('close.*also failed.*broken pipe'),
		'close error must be appended: '..e.message)
end

--check_io_noclose: raises io_error but does NOT close target
do
	local t = mock_target()
	local ok, e = pcall(check_io_noclose, t, nil, 'disk full')
	assert(not ok)
	assert(iserror(e, 'io'))
	assert(not t.closed, 'check_io_noclose must not close target')
end

--checkp: raises protocol_error, closes target
do
	local t = mock_target()
	local ok, e = pcall(checkp, t, nil, 'bad handshake')
	assert(not ok)
	assert(iserror(e, 'protocol'))
	assert(t.closed, 'checkp must close target')
end

--checknp: raises content_error, does NOT close target
do
	local t = mock_target()
	local ok, e = pcall(checknp, t, nil, 'invalid input')
	assert(not ok)
	assert(iserror(e, 'content'))
	assert(e.message == 'invalid input')
	assert(not t.closed, 'checknp must not close target')
end

--checknp: passes through structured errors unchanged
do
	local orig = io_error(nil, 'timeout')
	local ok, e = pcall(checknp, mock_target(), nil, orig)
	assert(not ok)
	assert(e == orig)
end

--protect_io: catches io, protocol, content errors
do
	for _, fn_err in ipairs{
		{function(self) check_io(self, nil, 'io fail') end, 'io'},
		{function(self) checkp(self, nil, 'proto fail') end, 'protocol'},
		{function(self) checknp(self, nil, 'content fail') end, 'content'},
	} do
		local fn, expected_type = fn_err[1], fn_err[2]
		local try_fn = protect_io(fn)
		local t = mock_target()
		local v, e = try_fn(t)
		assert(v == nil, 'protect_io must return nil on error')
		assert(iserror(e, expected_type),
			'expected '..expected_type..' error, got: '..tostring(e))
	end
end

--protect_io: lets Lua bugs through (not caught)
do
	local try_fn = protect_io(function()
		local x = nil
		return x.field --"attempt to index nil value"
	end)
	local ok = pcall(try_fn)
	assert(not ok, 'protect_io must let Lua bugs raise')
end

--protect_io: returns values on success
do
	local try_fn = protect_io(function() return 42, 'hello' end)
	local a, b = try_fn()
	assert(a == 42)
	assert(b == 'hello')
end

--unprotect_io: converts nil,string to raising io_error, closes target
do
	local raising = unprotect_io(function(self)
		return nil, 'conn refused'
	end)
	local t = mock_target()
	local ok, e = pcall(raising, t)
	assert(not ok)
	assert(iserror(e, 'io'), 'string errors must become io_error')
	assert(e.message == 'conn refused')
	assert(t.closed, 'unprotect_io must close target via check_io')
end

--unprotect_io: passes through structured errors from try_* functions
do
	local pe = protocol_error(nil, 'bad mac')
	local raising = unprotect_io(function(self)
		return nil, pe
	end)
	local t = mock_target()
	local ok, e = pcall(raising, t)
	assert(not ok)
	assert(e == pe, 'structured errors must pass through')
	assert(iserror(e, 'protocol'), 'error type must be preserved')
end

--unprotect_io: returns values on success
do
	local raising = unprotect_io(function(self) return 42, 'ok' end)
	local a, b = raising({})
	assert(a == 42)
	assert(b == 'ok')
end

--round-trip: try -> unprotect_io -> raising -> protect_io -> try
--error type preserved through full cycle
do
	local function try_inner(self)
		return nil, protocol_error(nil, 'bad frame')
	end
	local raising = unprotect_io(try_inner)
	local try_outer = protect_io(raising)
	local t = mock_target()
	local v, e = try_outer(t)
	assert(v == nil)
	assert(iserror(e, 'protocol'),
		'protocol error must survive try->raise->try round-trip')
end

--error without target (self=nil): no close, still raises
do
	local ok, e = pcall(check_io, nil, nil, 'no target')
	assert(not ok)
	assert(iserror(e, 'io'))
	assert(e.message == 'no target')
end

--format args work
do
	local ok, e = pcall(check_io, nil, nil, '%s:%d', 'host', 80)
	assert(not ok)
	assert(e.message == 'host:80')
end

print'errors_io ok'
