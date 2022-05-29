
require'glue'
require'linebuffer'

--make a `read(sz) -> buf, sz` that is reading from a string.
local function memreader(s)
	local buf, len = cast('char*', s), #s
	local i = 0
	return function(n)
		assert(n > 0)
		if i == len then
			return nil, 'eof'
		else
			n = min(n, len - i)
			i = i + n
			return buf + i - n, n
		end
	end
end

--convert `read(maxsz) -> buf, sz` into `read(buf, maxsz) -> sz`.
local function readtobuffer(read)
	return function(ownbuf, maxsz)
		local buf, sz = read(maxsz)
		if not buf then return nil, sz end
		ffi.copy(ownbuf, buf, sz)
		return sz
	end
end

local function linebuffer_fuzz_test()
	local seed = floor(clock() * 10)
	print('randomseed', seed)
	randomseed(seed)

	local max_line_size = 1024 + random(1024 * 8)
	local total_size = random(max_line_size * PI * 100)
	local max_read_size = random(total_size)
	local term_r = random() > .5
	local term_n = random() > .5
	if not (term_r or term_n) then term_n = true end
	local term =
		(term_r and '\r' or '') ..
		(term_n and '\n' or '')

	--generate random buffer
	local t = {}
	for i = 1, total_size do
		local c = char(random(0, 255))
		if c ~= '\r' and c ~= '\n' then
			t[#t+1] = c
		end
	end

	--generate line breaks at random positions in the buffer.
	local i = 1
	local n = #t
	while true do
		i = i + random(max_line_size)
		if i+1 >= n then break end
		if term_r and term_n then
			t[i] = '\r'
			t[i+1] = '\n'
		else
			t[i] = term_r and '\r' or '\n'
		end
	end
	local s = table.concat(t, nil) .. term

	--analyze line sizes.
	local n1, n2, sum, count = 0, 1/0, 0, 0
	for i1, i2 in s:gmatch('().-()'..term) do
		local n = i2 - i1
		n1 = max(n1, n)
		n2 = min(n2, n)
		sum = sum + n
		count = count + 1
	end
	local avg = floor(sum / count + .5)
	print(format('line %d..%d, avg %d, count %d, max %d, term=%s',
			n2, n1, avg, count, max_line_size, pp(term)))
	print(format('total %d, max read %d', total_size, max_read_size))

	local read = memreader(s)
	local read = readtobuffer(read)
	local lb = linebuffer(read, term, max_line_size)

	local t = {}
	while true do
		local s, err
		if random() > random() then
			s, err = lb.readline()
			if not s then break end
			s = s .. term
		else
			local maxsize = random(max_read_size)
			local buf, sz = lb.read(maxsize)
			if not buf then break end
			s = str(buf, sz)
		end
		t[#t+1] = s
	end
	local s2 = table.concat(t)

	print(#s2, #s)
	assert(s2 == s)
end

for i = 1, os.getenv'AUTO' and 20 or 1000 do
	print(i)
	linebuffer_fuzz_test()
end
