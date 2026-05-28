require'webb'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function req(t)
	t = update({
		method = 'GET',
		headers = {},
		response_headers = {},
		log = noop,
	}, t)
	return t
end

local function with_req(r, f, ...)
	local env = currentthread():ownenv()
	local old_req = env.http_request
	env.http_request = r
	local function pass(ok, ...)
		env.http_request = old_req
		assert(ok, ...)
		return ...
	end
	return pass(pcall(f, ...))
end

local function out_req(t)
	local chunks = {}
	local r = req(t)
	r.outfunc = function(s, sz)
		chunks[#chunks+1] = iscdata(s) and str(s, sz) or tostring(s)
	end
	function r:body()
		return concat(chunks)
	end
	return r
end

function test.http_error_is_http_response()
	local ok, err = pcall(http_error, 304)
	assert(not ok)
	assert(err.type == 'http_response')
	assert(err.status == 304)

	local ok, err = pcall(http_error, {status = 405, headers = {allow = 'GET'}})
	assert(not ok)
	assert(err.type == 'http_response')
	assert(err.status == 405)
	assert(err.headers.allow == 'GET')
end

function test.check_etag_sets_and_matches()
	local s = 'etag payload'
	local etag = xxhash128(s):hex()

	local r = req()
	with_req(r, function()
		assert(check_etag(s) == s)
	end)
	assert(r.response_headers.etag == 'W/'..etag)

	local r = req{headers = {['if-none-match'] = 'W/'..etag}}
	local ok, err = pcall(function()
		with_req(r, function()
			check_etag(s)
		end)
	end)
	assert(not ok)
	assert(err.type == 'http_response')
	assert(err.status == 304)
end

function test.outfile_offset_len()
	local file = '/tmp/webb_test_outfile_offset_len'
	save(file, '0123456789')
	local r = out_req()
	with_req(r, function()
		local f = assert(outfile_function(file, 2, 3))
		f()
	end)
	rmfile(file)
	assert(r.response_headers['content-length'] == '3')
	assert(r:body() == '234')
end

function test.outfile_empty()
	local file = '/tmp/webb_test_outfile_empty'
	save(file, '')
	local r = out_req()
	with_req(r, function()
		local f = assert(outfile_function(file))
		f()
	end)
	rmfile(file)
	assert(r.response_headers['content-length'] == '0')
	assert(r:body() == '')
end

function test.record_resolves_content_generators()
	local r = req()
	with_req(r, function()
		local s = record(function()
			out'pre'
			out(function()
				return 'mid'
			end)
			out'post'
		end)
		assert(s == 'premidpost')
		assert(not out_buffering())
	end)
end

local name = ...
if name == 'webb_test' then name = nil end

if name then
	assert(test[name], 'unknown test: '..name)
	test[name]()
else
	local n_ok, n_fail = 0, 0
	for _, k in ipairs(test) do
		io.write('test.'..k..' ... ')
		io.flush()
		local ok, err = xpcall(test[k], debug.traceback)
		if ok then
			print'ok'
			n_ok = n_ok + 1
		else
			print'FAILED'
			print(err)
			n_fail = n_fail + 1
		end
	end
	print(('ok: %d, failed: %d'):format(n_ok, n_fail))
	assert(n_fail == 0)
end
print'webb ok'
