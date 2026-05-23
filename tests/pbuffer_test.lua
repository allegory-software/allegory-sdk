require'glue'
require'fs'
require'sock'
require'pbuffer'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local PORT = 21800
local function nextport() PORT = PORT + 1; return PORT end

local _terr

local function sthread(f, name)
	local t = thread(f, name)
	t:onfinish(function(th, ok, err)
		if not ok then
			_terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err)
		end
	end)
	return t
end

local function checked_run(f)
	_terr = nil
	run(function(...)
		local ok, err = pcall(f, ...)
		if not ok then
			_terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err)
		end
	end)
	if _terr then error(_terr, 2) end
end

local testfile = 'pbuffer_testfile'

local function mkfile(content)
	save(testfile, content)
end

-- == SEEKABLE (file-backed) tests ==========================================

-- have: already buffered (ask <= have branch)
function test.file_have_already_buffered()
	mkfile('hello world')
	local f = open(testfile)
	local b = pbuffer{f = f}
	assert(b:have(5))
	assert(b:have(3))  --ask <= have, no read
	assert(#b >= 5)
	b:free(); f:close(); rmfile(testfile)
end

-- have: read fills buffer exactly
function test.file_have_exact()
	mkfile('abcdef')
	local f = open(testfile)
	local b = pbuffer{f = f}
	assert(b:have(6))
	assert(b:get(6) == 'abcdef')
	b:free(); f:close(); rmfile(testfile)
end

-- have: ask more than file size -> partial data then false
function test.file_have_partial_eof()
	mkfile('abc')
	local f = open(testfile)
	local b = pbuffer{f = f}
	assert(b:have(10) == false)
	assert(#b == 3) --partial data kept
	assert(b:get(3) == 'abc')
	b:free(); f:close(); rmfile(testfile)
end

-- have: false on eof (no error raised)
function test.file_have_eof_false()
	mkfile('')
	local f = open(testfile)
	local b = pbuffer{f = f}
	assert(b:have(1) == false)
	b:free(); f:close(); rmfile(testfile)
end

-- need: raises on eof
function test.file_need_eof_raises()
	mkfile('ab')
	local f = open(testfile)
	local b = pbuffer{f = f}
	local ok, err = pcall(function() b:need(10) end)
	assert(not ok)
	assert(tostring(err):find('eof'))
	b:free(); f:close(); rmfile(testfile)
end

-- need: returns self on success
function test.file_need_returns_self()
	mkfile('hello')
	local f = open(testfile)
	local b = pbuffer{f = f}
	assert(b:need(5) == b)
	b:free(); f:close(); rmfile(testfile)
end

-- readall: reads to EOF across multiple chunks
function test.file_readall()
	local content = string.rep('abcdef0123456789', 16)
	mkfile(content)
	local f = open(testfile)
	local b = pbuffer{f = f, readahead = 17}
	assert(b:readall() == b)
	local p, len = b:ref()
	assert(len == #content)
	assert(str(p, len) == content)
	b:free(); f:close(); rmfile(testfile)
end

-- flush: write buffer to file
function test.file_flush()
	local f = open(testfile, 'w')
	local b = pbuffer{f = f}
	b:put('hello'):put(' world')
	assert(#b == 11)
	b:flush()
	assert(#b == 0)
	b:free(); f:close()
	assert(load(testfile) == 'hello world')
	rmfile(testfile)
end

-- skip: within buffer only
function test.file_skip_in_buffer()
	mkfile('abcdefgh')
	local f = open(testfile)
	local b = pbuffer{f = f}
	b:need(8)
	b:skip(3)
	assert(#b == 5)
	assert(b:get(5) == 'defgh')
	b:free(); f:close(); rmfile(testfile)
end

-- skip: past buffer via file seek
function test.file_skip_seekable()
	mkfile(string.rep('A', 500) .. string.rep('B', 500))
	local f = open(testfile)
	local b = pbuffer{f = f}
	b:need(10) --buffer first 10 bytes
	b:skip(500, true) --10 from buffer + 490 via seek
	b:need(1)
	assert(b:get(1) == 'B') --should be at position 500
	b:free(); f:close(); rmfile(testfile)
end

-- skip: past file eof -> error
function test.file_skip_past_eof()
	mkfile('short')
	local f = open(testfile)
	local b = pbuffer{f = f}
	b:need(5)
	local ok, err = pcall(function() b:skip(100, true) end)
	assert(not ok and tostring(err):find('eof'))
	b:free(); f:close(); rmfile(testfile)
end

-- skip: without past_buffer when n > buffer -> error
function test.file_skip_no_past_buffer()
	mkfile('abcdef')
	local f = open(testfile)
	local b = pbuffer{f = f}
	b:need(3)
	local ok, err = pcall(function() b:skip(10) end)
	assert(not ok and tostring(err):find('eof'))
	b:free(); f:close(); rmfile(testfile)
end

-- reader: buffered read function
function test.file_reader()
	mkfile('hello world 12345')
	local f = open(testfile)
	local b = pbuffer{f = f}
	local read = b:reader()
	local buf = new'char[64]'
	local parts = {}
	while true do
		local n, err = read(buf, 64)
		if not n or n == 0 then break end
		parts[#parts+1] = str(buf, n)
	end
	assert(table.concat(parts) == 'hello world 12345')
	b:free(); f:close(); rmfile(testfile)
end

-- reader: empty file returns 0 immediately
function test.file_reader_eof()
	mkfile('')
	local f = open(testfile)
	local b = pbuffer{f = f}
	local read = b:reader()
	local buf = new'char[16]'
	local n, err = read(buf, 16)
	assert(n == 0)
	assert(err == nil)
	b:free(); f:close(); rmfile(testfile)
end

-- readahead: buffers more than asked
function test.file_readahead()
	mkfile(string.rep('x', 1024))
	local f = open(testfile)
	local b = pbuffer{f = f, readahead = 512}
	b:need(1) --ask for 1 byte
	assert(#b >= 512) --readahead should have buffered more
	b:free(); f:close(); rmfile(testfile)
end

-- round-trip: flush then read back
function test.file_round_trip()
	local f = open(testfile, 'w')
	local wb = pbuffer{f = f}
	wb:put_u32_le(0xDEADBEEF)
	wb:put_u16_be(0x1234)
	wb:put('hello')
	wb:flush()
	wb:free(); f:close()

	local f = open(testfile)
	local rb = pbuffer{f = f}
	rb:need(4 + 2 + 5)
	assert(rb:get_u32_le() == 0xDEADBEEF)
	assert(rb:get_u16_be() == 0x1234)
	assert(rb:get(5) == 'hello')
	rb:free(); f:close(); rmfile(testfile)
end

-- == NON-SEEKABLE (socket-backed) tests ====================================

-- have over socket
function test.sock_have()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send'hello'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		assert(b:have(5))
		assert(b:get(5) == 'hello')
		b:free(); cs:close(); server:close()
	end)
end

-- have: false on socket eof
function test.sock_have_eof()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		assert(b:have(1) == false)
		b:free(); cs:close(); server:close()
	end)
end

-- need over socket: success
function test.sock_need()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send'abcdef'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		assert(b:need(6) == b)
		assert(b:get(6) == 'abcdef')
		b:free(); cs:close(); server:close()
	end)
end

-- need over socket: eof raises
function test.sock_need_eof()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send'ab'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		local ok, err = pcall(function() b:need(10) end)
		assert(not ok and tostring(err):find('eof'))
		b:free(); cs:close(); server:close()
	end)
end

-- skip past buffer, non-seekable (read-and-discard loop)
function test.sock_skip_non_seekable()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send'AAABBBCCC'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		--buffer empty, entire skip goes through read-and-discard
		b:skip(6, true)
		b:need(3)
		assert(b:get(3) == 'CCC')
		b:free(); cs:close(); server:close()
	end)
end

-- flush over socket
function test.sock_flush()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		local got_buf, got_len
		resume(sthread(function()
			local cs = server:accept()
			got_buf, got_len = cs:recvall()
			cs:close()
			server:close()
		end, 'server'))
		local s = connect('127.0.0.1:'..port)
		local b = pbuffer{f = s}
		b:put('hello'):put(' world')
		b:flush()
		assert(#b == 0)
		b:free(); s:close()
		wait(0.05)
		assert(got_buf and str(got_buf, got_len) == 'hello world')
	end)
end

-- haveline: line found immediately
function test.sock_haveline()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send'hello\r\nworld\r\n'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs, lineterm = '\r\n'}
		assert(b:haveline() == 'hello')
		assert(b:haveline() == 'world')
		b:free(); cs:close(); server:close()
	end)
end

-- haveline: eof with no data
function test.sock_haveline_eof()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs, lineterm = '\r\n'}
		local s = b:haveline()
		assert(s == false)
		b:free(); cs:close(); server:close()
	end)
end

-- haveline: line too long
function test.sock_haveline_too_long()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send(string.rep('x', 200)) --no terminator
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs, lineterm = '\r\n', linesize = 50}
		local ok, err = pcall(function() b:haveline() end)
		assert(not ok and tostring(err):find('line too long'))
		b:free(); cs:close(); server:close()
	end)
end

-- needline: success
function test.sock_needline()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send'greeting\r\n'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs, lineterm = '\r\n'}
		assert(b:needline() == 'greeting')
		b:free(); cs:close(); server:close()
	end)
end

-- needline: eof raises
function test.sock_needline_eof()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs, lineterm = '\r\n'}
		local ok, err = pcall(function() b:needline() end)
		assert(not ok)
		b:free(); cs:close(); server:close()
	end)
end

-- reader over socket
function test.sock_reader()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		local content = 'hello world 12345'
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:send(content)
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		local read = b:reader()
		local buf = new'char[64]'
		local parts = {}
		while true do
			local n, err = read(buf, 64)
			if not n or n == 0 then break end
			parts[#parts+1] = str(buf, n)
		end
		assert(table.concat(parts) == content)
		b:free(); cs:close(); server:close()
	end)
end

-- reader over socket: eof returns 0
function test.sock_reader_eof()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		resume(sthread(function()
			local s = connect('127.0.0.1:'..port)
			s:close()
		end, 'client'))
		local cs = server:accept()
		local b = pbuffer{f = cs}
		local read = b:reader()
		local buf = new'char[16]'
		assert(read(buf, 16) == 0)
		b:free(); cs:close(); server:close()
	end)
end

-- close/try_close
function test.sock_close()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1:'..port)
		local ts = threadset()
		local client = ts:thread(function()
			local s = connect('127.0.0.1:'..port)
			s:close()
		end, 'client')
		resume(client)
		local cs = server:accept()
		assert(ts:join())
		local b = pbuffer{f = cs}
		b:close()
		--close again: should be no-op (f is closed, but close checks self.f)
		server:close()
	end)
end

-- == runner =================================================================

chdir(os.getenv'HOME')
mkdir'pbuffer_test'
chdir'pbuffer_test'

local name = ...
if name == 'pbuffer_test' then name = nil end
local tests_to_run = name and {name} or test
local n_ok, n_fail = 0, 0
for _, k in ipairs(tests_to_run) do
	if type(k) == 'string' then
		io.write('test.'..k..' ... ')
		io.flush()
		local ok, err = xpcall(test[k], debug.traceback)
		if ok then
			print'ok'
			n_ok = n_ok + 1
		else
			pr('FAILED: ', k)
			pr(err)
			n_fail = n_fail + 1
		end
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))

assert(basename(cwd()) == 'pbuffer_test')
chdir'..'
rm_rf'pbuffer_test'
