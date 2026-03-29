require'glue'
local headers = require'http_headers'

local function assert_eq(a, b, msg)
	assert(a == b, msg or string.format('expected %s, got %s', tostring(b), tostring(a)))
end

local function test_parse_headers()
	local raw = {
		['Content-Length'] = '123',
		['Accept'] = 'text/html;q=0.8, text/plain',
	}
	local parsed = headers.parse_headers(raw)
	assert_eq(parsed['Content-Length'], 123)
	assert(parsed['Accept']['text/html'].q == 0.8)
	assert(parsed['Accept']['text/plain'])
end

local function test_parsed_headers_lazy()
	local raw = {['Content-Length'] = '5'}
	local parsed = headers.parsed_headers(raw)
	assert(rawget(parsed, 'Content-Length') == nil)
	assert_eq(parsed['Content-Length'], 5)
	assert_eq(rawget(parsed, 'Content-Length'), 5)
end

local function test_format_header()
	local k, v = headers.format_header('Content-Length', 10)
	assert_eq(k, 'content-length')
	assert_eq(v, 10)

	local k2, v2 = headers.format_header('Set-Cookie', {session = {value = 'abc'}})
	assert_eq(k2, 'set-cookie')
	assert(type(v2) == 'table' and v2[1] == 'session=abc')
end

local function test_set_cookie_parse()
	local cookies = headers.parse.set_cookie({'id=abc; HttpOnly; Path=/', 'lang=en'})
	assert_eq(#cookies, 2)
	local function byname(name)
		for _, c in ipairs(cookies) do
			if c.name == name then return c end
		end
	end
	local id = byname('id')
	assert(id and id.value == 'abc' and id.httponly == true and id.path == '/')
	local lang = byname('lang')
	assert(lang and lang.value == 'en')
end

local function test_unknown_header_passthrough()
	assert_eq(headers.parse_header('X-Whatever', 'abc'), 'abc')
end

local function run(name, fn)
	fn()
end

run('parse_headers', test_parse_headers)
run('parsed_headers_lazy', test_parsed_headers_lazy)
run('format_header', test_format_header)
run('set_cookie_parse', test_set_cookie_parse)
run('unknown_header_passthrough', test_unknown_header_passthrough)
print'http_headers ok'
