require'rowset'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

--a rowset with a plain param p and a col param c that counts its loads.
local function params_rowset()
	local load_n = 0 -- number of load_rows() calls
	local rs = virtual_rowset(function(rs)
		rs.fields = {{name = 'id', type = 'number'}}
		rs.pk = 'id'
		rs.params = {
			p = {label = 'P', accept_many = false},
			c = {for_cols = 'id'},
		}
		function rs:load_rows(res, params)
			load_n = load_n + 1
			res.rows = {{1}}
		end
	end)
	return rs, function() return load_n end
end

function test.load_without_plain_param_has_no_rows()
	local rs, load_n = params_rowset()
	local res = rs:load{}
	assert(#res.rows == 0)
	assert(load_n() == 0)
	assert(res.params.p)
end

function test.load_with_plain_param_loads()
	local rs, load_n = params_rowset()
	local res = rs:load{p = 'v'}
	assert(#res.rows == 1)
	assert(load_n() == 1)
end

function test.load_with_empty_list_has_no_rows()
	local rs, load_n = params_rowset()
	local res = rs:load{p = 'v', c = {}}
	assert(#res.rows == 0)
	assert(load_n() == 0)
end

local ok_n, failed_n = 0, 0
for _, name in ipairs(test) do
	local ok, err = xpcall(test[name], debug.traceback)
	print(('test.%s ... %s'):format(name, ok and 'ok' or 'FAILED'))
	if ok then ok_n = ok_n + 1 else failed_n = failed_n + 1; print(err) end
end
print(('ok: %d, failed: %d'):format(ok_n, failed_n))
