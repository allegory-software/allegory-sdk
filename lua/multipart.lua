--[=[

	Multipart MIME encoding.
	Written by Cosmin Apreutesei. Public Domain.

	multipart.new(type, write, [boundary]) -> m
	m:add(s)
	m:add_part(headers)
	m:add_field(name, val)
	m:add_file(name, filename, content_type)
	m:add_multipart(m)
	m:finish()

]=]

local glue = require'glue'
local _ = string.format
local sortedpairs = glue.sortedpairs

local multipart = {}

local seqno = 0
local function newboundary()
	 seqno = seqno + 1
	 return _('%s%05d_%05u', os.date('%d%m%Y%H%M%S'), math.random(0, 99999), seqno)
end

function multipart.new(multipart_type, write, boundary)

	local t
	if not write then
		t = {}
		function write(s)
			t[#t+1] = s
		end
	end

	local m = {}
	m.boundary = boundary or newboundary()
	m.content_type = _('multipart/%s; boundary=%s', multipart_type, m.boundary)

	local function cmp(a, b) return tostring(a) < tostring(b) end
	local first
	function m:add_part(headers)
		if first then
			write'\r\n'
		else
			first = true
		end
		write'--'; write(m.boundary); write'\r\n'
		for k,v in sortedpairs(headers) do
			write(k:gsub('_', '-')); write': '
			if type(v) == 'table' then
				write(v[1])
				for k,v in sortedpairs(v, cmp) do
					if k ~= 1 then
						write'; '
						write(k); write'="'; write(v); write'"'
					end
				end
			else
				write(v)
			end
			write'\r\n'
		end
		write'\r\n'
	end

	function m:finish()
		write'\r\n--'; write(m.boundary); write'--\r\n'
		if t then
			return table.concat(t)
		end
	end

	function m:add(s)
		write(s)
	end

	function m:add_field(name, val)
		m:add_part{Content_Disposition = {'form-data', name = name}}
		if val then m:add(val) end
	end

	function m:add_file(name, filename, content_type)
		m:add_part{
			Content_Disposition = {'form-data', name = name, filename = filename},
			Content_Type = content_type,
		}
	end

	function m:add_multipart(m)
		self:add_part{Content_Type = m.content_type}
	end

	return m
end

if not ... then

	local write = function(s) io.write((s:gsub('\r', ''))) end
	local m0 = multipart.new('form-data', write) --, '12345')
	local m1 = multipart.new('mixed', write) --, 'abcde')
	print('Content-Type: '..m0.content_type)
	m0:add_field('sometext', 'some text sent via post...')
	m0:add_multipart(m1)
	m1:add_file('images', 'picture.jpg', 'image/jpeg')
	m1:add'content of jpg...'
	m1:add_file('images', 'test.jpg', 'image/jpeg')
	m1:add'content of test.py file ....'
	m1:finish()
	m0:finish()

end

return multipart
