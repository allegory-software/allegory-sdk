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
	pb:[try_]have(n) -> true | false,err fill buffer to n bytes or more, up-to eof
	pb:need(n) -> pb                     fill buffer to n bytes or more, break on eof
READAHEAD & PULL
	pb:[try_]skip(size)                  skip bytes (read more as needed)
	pb:[try_]haveline([i]) -> s          fill buffer until a line is found and pull it
	pb:needline([i]) -> s                like haveline() but break on error/not found
	pb:reader() -> read                  get a buffered read function
		read(buf, size) -> read_size | 0,'eof' | nil,err
WRITE
	pb:[try_]flush()                     write buffer and reset it.

NOTE: string.buffer semantics altered for :get(), :skip(),

NOTE: raised I/O errors leave the buffer in a partially read/written state.

]]

if not ... then require'pbuffer_test'; return end

require'glue'

local
	assert, cast, bswap, bswap16, bor, band, shl, shr =
	assert, cast, bswap, bswap16, bor, band, shl, shr

local pb = {}

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

pb.checkp = checkp
pb.check_io = check_io

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
function pb:try_have(ask)
	local have = #self.b
	ask = ask - have
	if ask <= 0 then return true end
	local space = max(ask, self.readahead - have)
	local p, space = self:reserve(space) --could reserve even more space
	while ask > 0 do
		local read, err = self.f:try_read(p, space)
		if not read or err == 'eof' then return false, err end
		self:commit(read)
		space = space - read
		ask = ask - read
		p = p + read
	end
	return true
end
function pb:have(ask)
	local have, err = self:try_have(ask)
	if not have and err == 'eof' then return false end --eof is not an error
	return self:check_io(have, err)
end
function pb:need(n)
	local have, err = self:try_have(n)
	if not have then
		if err == 'eof' then
			self:checkp(false, err) --eof is a protocol error, not an i/o error
		else
			self:check_io(false, err)
		end
	end
	return self
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
pb.try_skip = protect_io(pb.skip)

pb.linesize = 8192
pb.lineterm = nil
function pb:try_haveline(i) --for line-based protocols like http.
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
			return false, 'eof'
		end
	end
end
function pb:haveline(i)
	local s, err = self:try_haveline(i)
	if not s and err == 'eof' then return false end --eof is not an error
	return self:checkp(s, err)
end
function pb:needline(i)
	local s, err = self:try_haveline(i)
	if not s then
		if err == 'eof' then
			self:checkp(false, err) --eof is a protocol error, not an i/o error
		else
			self:check_io(false, err)
		end
	end
	return s
end

--Returns a read function which reads ahead from file in order to lower the
--number of syscalls: read(buf, size) -> read_size | 0,'eof' | nil,err
function pb:reader()
	return function(dst, dsz)
		local have, err = self:try_have(1)
		if not have then return err == 'eof' and 0 or nil, err end
		local src, ssz = self:ref()
		local sz = min(dsz, ssz)
		copy(dst, src, sz)
		self.b:skip(sz)
		return sz
	end
end

function pb:try_flush()
	local p, len = self:ref()
	local ok, err, wr_n = self.f:try_write(p, len)
	if not ok then
		self.b:skip(wr_n or 0)
		return nil, err, wr_n
	else
		self:reset()
		return true
	end
end
function pb:flush()
	local p, len = self:ref()
	self.f:write(p, len)
	self:reset()
end
