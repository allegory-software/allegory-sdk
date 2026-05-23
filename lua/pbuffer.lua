--[[

	Protocol Buffers for structured I/O of binary files and network protocols.
	Written by Cosmin Apreutesei. Public Domain.

	Based on LuaJIT 2.1's string.buffer, see:

		https://luajit.org/ext_buffer.html

CREATE
	pbuffer(pb) -> pb
		pb.f                             file or socket for readahead and flush
		pb.readahead                     min. read ahead size (64K)
		pb.linesize                      max. line size for haveline() (8K)
		pb.lineterm                      line terminator (nil)
		pb.dict, pb.metatable            see string.buffer doc
ALLOC/FREE
	pb:set(str)                          use a string as the underlying buffer
	pb:set(cdata, size)                  use a cdata as the underlying buffer
	pb:reserve(size) -> p, size          allocate memory for writing
	pb:free()                            free buffer memory now (not on gc)
PUSH
	pb:commit(size)                      commit written memory got with reserve()
	pb:put([str|num|obj], ...)           push values to buffer
	pb:putf(format, ...)                 push printf message
	pb:putcdata(cdata, size)             push cdata value
	pb:putdata(s | cdata,size)           push string or cdata value
	pb:put_{u8,i8,...}(x)                push (u)int8/16/32/64 LE/BE, float32/64
	pb:encode(o)                         push Lua value (binary serialization)
	pb:fill(n, [c])                      push repeat bytes
DIRECT ACCESS
	#pb                                  buffer written (commited) size
	pb:ref() -> p, size                  get buffer and written (commited) size
	pb:get_{u8,i8,...}_at(x, offset)     read binary integer at offset
	pb:set_{u8,i8,...}_at(x, offset)     write binary integer at offset
	pb:tostring() -> s                   convert buffer to string
PULL
	pb:get([n]) -> s                     pull n bytes (or all) to string
	pb:get_{u8,i8,...}(x)                pull binary integer
	pb:decode() -> t                     pull Lua value (pushed with encode())
	pb:getto(term, [i], [j]) -> s|nil    pull terminated string (term between i,j)
	pb:reset()                           pb:skip(#pb)
READAHEAD
	pb:have(n) -> true | false           fill buffer to n bytes or more, up to eof
	pb:load(n) -> pb                     fill buffer to n bytes or more, up to eof
	pb:need(n) -> pb                     fill buffer to n bytes or more, raise on eof
	pb:readall([maxlen]) -> pb           read until EOF, raise if maxlen exceeded
READAHEAD & PULL
	pb:skip(size)                        skip bytes (read more as needed)
	pb:haveline([i]) -> s|nil            fill buffer until a line is found and pull it
	pb:needline([i]) -> s                like haveline() but raise on eof
	pb:reader() -> read                  get a buffered read function
		read(buf, size) -> read_size | 0     size must be > 0
WRITE
	pb:flush()                           write buffer and reset it.

NOTE: string.buffer semantics altered for :get(), :skip(),

NOTE: readall() maxlen defaults to 16 MB.

NOTE: raised I/O errors leave the buffer in a partially read/written state.

]]

if not ... then require'pbuffer_test'; return end

require'glue'

local
	assert, cast, bswap, bswap16, bor, band, shl, shr =
	assert, cast, bswap, bswap16, bor, band, shl, shr

local pb = {type = 'pbuffer', debug_prefix = 'b'}

function pbuffer(self)
	local pb = object(pb, self)
	pb.__len = pb.__len --object() doesn't copy this like it does __call.
	if pb.tracebacks == nil and pb.f then
		pb.tracebacks = pb.f.tracebacks
	end
	local sb_opt = self and (self.dict or self.metatable)
		and {dict = self.dict, metatable = self.metatable}
	pb.b = string_buffer(sb_opt)
	return pb
end

function pb:try_close() --for self:check*()
	if not self.f then return true end
	self:free()
	return self.f:try_close()
end
function pb:close()
	if not self.f then return end
	self:free()
	self.f:close()
end

--string.buffer method forwarding
function pb:put      (...) self.b:put      (...); return self end
function pb:putf     (...) self.b:putf     (...); return self end
function pb:putcdata (...) self.b:putcdata (...); return self end
function pb:set      (...) self.b:set      (...); return self end
function pb:reset    ()    self.b:reset    ()   ; return self end
function pb:encode   (o)   self.b:encode   (o)  ; return self end
function pb:free     ()    self.b:free     ()   ; return self end
function pb:commit   (n)   self.b:commit   (n)  ; return self end
function pb:tostring ()    return self.b:tostring () end
function pb:__len    ()    return #self.b end
function pb:reserve  (n)   return self.b:reserve(n) end
function pb:ref      ()    return self.b:ref() end

function pb:putdata(data, len)
	if isstr(data) then
		assert(len == nil or len == #data)
		self.b:put(data)
	else
		self.b:putcdata(data, len)
	end
	return self
end

function pb:checkp(...)
	return checkp(self.f or self, ...)
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
	'u16'   , u16p, 2, false,
	'i16'   , i16p, 2, false,
	'u32'   , u32p, 4, false,
	'i32'   , i32p, 4, false,
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
	pb['set_'..k..'_at'] = function(self, offset, x)
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
		self.b:skip(n)
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
	self:checkp(#self.b >= n, 'eof')
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

function findterm(self, s, i, j)
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
	local i = findterm(self, term, i, j)
	if not i then return nil end
	local s = self:get(i)
	self.b:skip(#term)
	return s
end

--buffered I/O

pb.readahead = 64 * 1024
function pb:have(ask)
	local have = #self.b
	ask = ask - have
	if ask <= 0 then return true end
	local space = max(ask, self.readahead - have)
	local p, space = self:reserve(space) --could reserve even more space
	while ask > 0 do
		local read = self.f:read(p, space)
		if read == 0 then return false end
		self:commit(read)
		space = space - read
		ask = ask - read
		p = p + read
	end
	return true
end
function pb:load(n)
	self:have(n)
	return self
end
function pb:need(n)
	self:checkp(self:have(n), 'eof')
	return self
end

function pb:readall(maxlen)
	maxlen = (maxlen or 16 * 1024^2) + 1 --16 MB
	local have = #self.b
	while maxlen > have do
		if not self:have(have + min(maxlen - have, self.readahead)) then
			return self
		end
		have = #self.b
	end
	self:checkp(false, 'file_too_big')
end

function pb:skip(n)
	local k = min(n, #self.b)
	self.b:skip(k)
	n = n - k
	if n == 0 then return end
	if self.f.seek then
		local file_size = self.f:size()
		local file_pos  = self.f:seek()
		self:checkp(file_pos + n <= file_size, 'eof')
		self.f:seek(n)
	else
		while n > 0 do
			self:need(1)
			local k = min(n, #self.b)
			self.b:skip(k)
			n = n - k
		end
	end
end

pb.linesize = 8192
pb.lineterm = nil
function pb:haveline(i) --for line-based protocols like http.
	local lineterm = assert(self.lineterm, 'lineterm not set')
	i = i or 0
	while true do
		local s = self:getto(lineterm, i, self.linesize)
		if s then return s end
		i = #self.b
		self:checkp(i < self.linesize, 'line too long')
		if i > 0 then --line already started, need to end it
			self:need(i + 1)
		elseif not self:have(1) then
			return false
		end
	end
end
function pb:needline(i)
	return self:checkp(self:haveline(i), 'eof')
end

--Returns a read function which reads ahead from file in order to lower the
--number of syscalls: read(buf, size) -> read_size | 0
function pb:reader()
	return function(dst, dsz)
		assert(dsz and dsz > 0, 'read size must be > 0')
		if not self:have(1) then
			return 0
		end
		local src, ssz = self:ref()
		local sz = min(dsz, ssz)
		copy(dst, src, sz)
		self.b:skip(sz)
		return sz
	end
end

function pb:flush()
	local p, len = self:ref()
	self.f:write(p, len)
	self:reset()
end
