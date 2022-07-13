--[[

	Buffer object for encoding & decoding of binary files and network protocols.
	Written by Cosmin Apreutesei. Public Domain.

	Based on LuaJIT 2.1's string.buffer, see:
		https://htmlpreview.github.io/?https://github.com/LuaJIT/LuaJIT/blob/v2.1/doc/ext_buffer.html

	pbuffer(pb) -> pb
		pb.f                              opened file or socket
		pb.minsize                        read-ahead size (64K)
		pb.linesize                       max. line size for haveline() (8K)
		pb.lineterm                       line terminator ('\r\n')
		pb.dict, pb.metatable             see string.buffer doc

	pb:put_{u8,i8,...}(x)                push binary integer
	pb:get_{u8,i8,...}(x)                pull binary integer
	pb:put_{u8,i8,...}_at(x, offset)     write binary integer at offset
	pb:get_{u8,i8,...}_at(x, offset)     read binary integer at offset

	pb:get([n]) -> s                     get string of length n
	pb:decode() -> t                     deserialize Lua value
	pb:fill(n, [c])                      push repeat bytes
	pb:find(s, [i], [j]) -> i            find string (of 1 or 2 chars max.)
	pb:getto(term, [i], [j]) -> s        pull terminated string

	pb:[try_]connect(host, port, [timeout])  TCP-connect
	pb:[try_]open(file)                      open file

	pb:[try_]read(buf, size) -> read_n   read once to external buffer
	pb:[try_]readn(buf, n) -> buf, n     read n bytes to external buffer
	pb:[try_]write(p, n)                 write n bytes from external buffer
	pb.offset                            length read or written
	pb:pos()                             current position in file

	pb:have(n) -> true|false             read n bytes up-to eof
	pb:need(n) -> pb                     read n bytes, break on eof

	pb:flush()                           write buffer and reset it
	pb:skip(n, [past_buffer])            skip n bytes
	pb:seek(offset)                      seek to offset

	pb:needline() -> s                   read line
	pb:haveline() -> s                   read line if there is one
	pb:readn_to(n, write)                read n bytes calling write on each read
	pb:readall_to(write)                 read to eof calling write on each read

]]

require'glue'

local
	assert, cast, swap, swap16, bor, band, shl, shr =
	assert, cast, swap, swap16, bor, band, shl, shr

local pb = {}

local function cond_bswap16(x, self)
	return self.be and bswap16(x) or x
end
local function cond_bswap(x, self)
	return self.be and bswap(x) or x
end

local t = {
	 'u8'   ,  u8p, 1, false,
	 'i8'   ,  i8p, 1, false,
	'u16_le', u16p, 2, false,
	'i16_le', i16p, 2, false,
	'u16_be', u16p, 2, bswap16,
	'i16_be', i16p, 2, bswap16,
	'u32_le', u32p, 4, false,
	'i32_le', i32p, 4, false,
	'u32_be', u32p, 4, bswap,
	'i32_be', i32p, 4, bswap,
	'u64_le', u64p, 8, false,
	'i64_le', i64p, 8, false,
	'u16'   , u16p, 2, cond_bswap16,
	'i16'   , i16p, 2, cond_bswap16,
	'u32'   , u32p, 4, cond_bswap,
	'i32'   , i32p, 4, cond_bswap,
	'f32'   , f32p, 4, false,
	'f64'   , f64p, 8, false,
}
for i=1,#t,4 do
	local k, pt, n, swap = unpack(t, i, i+3)
	pb['put_'..k] = function(self, x)
		local p = self:reserve(n)
		cast(pt, p)[0] = swap and swap(x, self) or x
		return self:commit(n)
	end
	pb['put_'..k..'_at'] = function(self, offset, x)
		local p, len = self:ref()
		assert(len >= offset + n, 'eof')
		cast(pt, p + offset)[0] = swap and swap(x, self) or x
		return self
	end
	pb['get_'..k] = function(self)
		local p, len = self:ref()
		self:checkp(len >= n, 'eof')
		local x = cast(pt, p)[0]
		if swap then x = swap(x, self) end
		self:_skip(n)
		return x
	end
	pb['get_'..k..'_at'] = function(self, offset)
		local p, len = self:ref()
		self:checkp(len >= offset + n, 'eof')
		local x = cast(pt, p + offset)[0]
		if swap then x = swap(x, self) end
		return x
	end
end

function pb:get(n)
	if not n then
		return self.b:get()
	end
	self:checkp(#self >= n, 'eof')
	return self.b:get(n)
end

function pb:decode()
	local ok, v = lua_pcall(self.b.decode, self.b)
	self:checkp(ok, v)
	return v
end

function pb:fill(n, c)
	local p = self:reserve(n)
	fill(p, n, c)
	return self:commit(n)
end

function pb:find(s, i, j)
	assert(#s >= 1 and #s <= 2)
	local b1, b2 = byte(s, 1, 2)
	local p, len = self:ref()
	i = i or 0
	j = min(len, j or 1/0)
	if b2 then
		for i = i, j-2 do
			if p[i] == b1 and p[i+1] == b2 then
				return i
			end
		end
	else
		for i = i, j-1 do
			if p[i] == b1 then
				return i
			end
		end
	end
	return nil
end

function pb:getto(term, i, j)
	local i = self:find(term, i, j)
	if not i then return nil end
	local s = self:get(i)
	self:_skip(#term)
	return s
end

--I/O

pb.f = {}
function pb.f:read() return 0 end
function pb.f:seek(whence, offset)
	assert(whence == 'set')
	assert(offset == 0)
	return 0
end
pb.f.try_close = noop

function pb:try_open(...)
	local f, err = try_open(...)
	if not f then return nil, err end
	self.f = f
	return true
end

function pb:open(...)
	self.f = open(...)
	return self
end

function pb:try_connect(...)
	local f = try_connect(...)
	if not f then return nil, err end
	self.f = f
	return true
end

function pb:connect(...)
	self.f = connect(...)
	return self
end

function pb:try_close() --for self:check*()
	if not self.f then return end
	return self.f:try_close()
end

function pb:close()
	if not self.f then return end
	self.f:close()
end

function pb:try_read(buf, size)
	local n, err = self.f:try_read(buf, size)
	if not n then return nil, err end
	self.offset = self.offset + n
	return n
end

function pb:read(buf, size)
	local n = self.f:read(buf, size)
	self.offset = self.offset + n
	return n
end

function pb:try_readn(buf, n)
	local buf, err, read_n = self.f:try_readn(buf, n)
	self.offset = self.offset + (read_n or n)
	return buf, err, read_n
end

function pb:readn(buf, n)
	self.f:readn(buf, n)
	self.offset = self.offset + n
	return buf, n
end

function pb:try_write(p, n)
	local p, err, wr_n = self.f:try_write(p, n)
	self.offset = self.offset + (wr_n or n)
	return p, err, wr_n
end

function pb:write(p, n)
	self.f:write(p, n)
	self.offset = self.offset + n
end

function pb:pos()
	return self.offset - #self
end

pb.minsize = 65536 --set this to 0 to disable read-ahead.
function pb:have(n)
	local have = #self
	if n <= have then return true end
	n = n - have
	local max_n = max(n, self.minsize - have)
	local p = self:reserve(max_n)
	--NOTE: ignoring actually reserved size because we can't exceed self.minsize
	--because self.minsize = 0 is meant to disable read-ahead completely.
	while n > 0 do
		local read_n = self:read(p, max_n)
		if read_n == 0 then return false, 'eof' end
		self:commit(read_n)
		n = n - read_n
		p = p + read_n
		max_n = max_n - read_n
	end
	return true
end

function pb:need(n)
	self:check_io(self:have(n))
	return self
end

function pb:flush()
	local p, len = self:ref()
	self:write(p, len)
	self:reset()
end

function pb:skip(n, past_buffer)
	local buf_n = min(n, #self)
	self:_skip(buf_n)
	n = n - buf_n
	if n > 0 then
		self:checkp(past_buffer, 'eof')
		if self.f.seek then
			local file_size = self.f:size()
			local file_pos  = self.f:seek()
			self:checkp(file_pos <= file_size, 'eof')
			local file_pos1 = self.f:seek(n)
			self:checkp(file_pos1 == file_pos + n, 'eof')
			self.offset = self.offset + n
		else
			local n1 = min(n, max(self.minsize, 4096))
			while n > 0 do
				self:need(min(n, n1))
				self:reset()
				n = n - n1
			end
		end
	end
end

function pb:seek(offset)
	assert(self.f.seek, 'not seekable')
	assert(#self == 0, 'read buffer not empty')
	self.f:seek('set', offset)
	self.offset = offset
end

pb.linesize = 8192
pb.lineterm = '\r\n'
function pb:haveline() --for line-based protocols like http.
	local i = 0
	::again::
	local s = self:getto(self.lineterm, i, self.linesize)
	if s then return s end
	i = #self
	self:checkp(i < self.linesize, 'line too long')
	if i > 0 then --line already started, need to end it
		self:need(i + 1)
	elseif not self:have(1) then
		return nil, 'eof'
	end
	goto again
end

function pb:needline()
	return self:check_io(self:haveline())
end

function pb:readn_to(n, write)
	while n > 0 do
		self:need(1)
		local p, n1 = self:ref()
		n1 = min(n1, n)
		write(p, n1)
		self:_skip(n1)
		n = n - n1
	end
end

function pb:readall_to(write)
	while self:have(1) do
		local p, n = self:ref()
		write(p, n)
		self:reset()
	end
end

--string.buffer method forwarding

function pb:put      (...) return self.b:put      (...) end
function pb:putf     (...) return self.b:putf     (...) end
function pb:putcdata (...) return self.b:putcdata (...) end
function pb:set      (...) return self.b:set      (...) end
function pb:reset    ()    return self.b:reset    ()    end
function pb:encode   (o)   return self.b:encode   (o)   end
function pb:tostring ()    return self.b:tostring ()    end
function pb:free     ()    return self.b:free     ()    end

function pbuffer(self)
	local pb = object(pb, self)
	pb.check_io   = check_io
	pb.checkp     = checkp
	if pb.tracebacks == nil and pb.f then
		pb.tracebacks = pb.f.tracebacks
	end
	pb.offset = 0
	local sb_opt = self and (self.dict or self.metatable)
		and {dict = self.dict, metatable = self.metatable}
	local b = string_buffer(sb_opt)
	pb.b = b
	--inline these to make them a tad faster (scrape 1 lookup and 1 __index access).
	function pb:__len   ()  return #b              end
	function pb:ref     ()  return b:ref     ()    end
	function pb:reserve (n) return b:reserve (n)   end
	function pb:commit  (n) return b:commit  (n)   end
	function pb:_skip   (n) return b:skip    (n)   end
	return pb
end
