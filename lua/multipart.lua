--[=[

	Multipart MIME encoding.
	Written by Cosmin Apreutesei. Public Domain.

	multipart.new(type, [write], [boundary]) -> m
	m:add_raw(s)
	m:add_base64(s)
	m:add_part(headers)
	m:add_field(name, val)
	m:add_file(filename, content_type, contents)
	m:add_inline_file(cid, filename, content_type, contents)
	m:add_multipart(type) -> m
	m:finish()

	multipart.email(msg) -> s
		msg.text
		msg.html                    '<img src="@foo">'
		msg.inlines                 {{id='@foo', contents=},...}
		msg.attachments             {{file},...}

]=]

local glue = require'glue'
local _ = string.format
local sortedpairs = glue.sortedpairs
local b64 = require'base64'.encode

local multipart = {utf8_headers = {subject=1}}

local function encode(s)
	return _('=?utf-8?B?%s?=', b64(s))
end

function multipart.new(multipart_type, write, boundary)

	local t
	if not write then
		t = {}
		function write(s)
			t[#t+1] = s
		end
	end

	local m = glue.object(multipart)
	boundary = boundary or glue.tohex(glue.random_string(19))
	m.content_type = _('multipart/%s; boundary=%s', multipart_type, boundary)

	local function cmp(a, b) return tostring(a) < tostring(b) end

	local first
	function m:add_part(headers)
		if first then
			write'\r\n'
		else
			first = true
		end
		write'--'; write(boundary); write'\r\n'
		local ht = {}
		for k,v in pairs(headers) do
			ht[k:gsub('_', '-'):lower()] = v
		end
		for k,v in sortedpairs(ht) do
			write(k); write': '
			if type(v) == 'table' then
				local v, opt = v[1], v
				if self.utf8_headers[k] then
					v = encode(v)
				end
				write(v)
				for k,v in sortedpairs(opt, cmp) do
					if k ~= 1 then
						write'; '
						write(k); write'="'; write(v); write'"'
					end
				end
			else
				if self.utf8_headers[k] then
					v = encode(v)
				end
				write(v)
			end
			write'\r\n'
		end
		write'\r\n'
	end

	function m:finish()
		write'\r\n--'; write(boundary); write'--\r\n'
		if t then
			return table.concat(t)
		end
	end

	function m:add_raw(s)
		write(s)
	end

	function m:add_base64(s)
		write(b64(s, nil, nil, nil, 76))
	end

	function m:add_multipart(type)
		local m = multipart.new(type, write)
		self:add_part{content_type = m.content_type}
		return m
	end

	function m:add_field(name, val)
		self:add_part{
			content_disposition = {'form-data', name = name},
			content_transfer_encoding = 'base64',
		}
		if val then self:add_base64(val) end
	end

	function m:add_file(filename, content_type, contents)
		self:add_part{
			content_disposition = {'attachment', filename = filename},
			content_transfer_encoding = 'base64',
			content_type = content_type,
		}
		self:add_base64(contents)
	end

	--NOTE: gmail will show these as attachments.
	function m:add_inline_file(cid, filename, content_type, contents)
		self:add_part{
			content_id = '<'..cid..'>',
			content_disposition = {'inline', filename = filename},
			content_transfer_encoding = 'base64',
			content_type = content_type,
		}
		self:add_base64(contents)
	end

	return m
end

--https://stackoverflow.com/questions/3902455/mail-multipart-alternative-vs-multipart-mixed
function multipart.mail(msg)
	local mix = multipart.new'mixed'
	local alt = mix:add_multipart'alternative'
   if msg.text then
		alt:add_part{
			content_type = {'text/plain', charset = 'utf-8'},
			content_transfer_encoding = 'base64',
		}
		alt:add_base64(msg.text)
	end
	local rel = alt:add_multipart'related'
	if msg.html then
		rel:add_part{
			content_type = {'text/html', charset = 'utf-8'},
			content_transfer_encoding = 'base64',
		}
		rel:add_base64(msg.html)
	end
	if msg.inlines then
		for _,file in ipairs(msg.inlines) do
			rel:add_inline_file(file.cid, file.filename, file.content_type, file.contents)
		end
	end
	rel:finish()
	alt:finish()
	if msg.attachments then
		for _,file in ipairs(msg.attachments) do
			mix:add_file(file.filename, file.content_type, file.contents)
		end
	end
	local req = {headers = {}}
	req.from = msg.from
	req.to   = msg.to
	req.headers.from    = msg.from
	req.headers.to      = msg.to
	req.headers.subject = msg.subject
	req.headers.content_type = mix.content_type
	req.message = mix:finish()
	return req
end

if not ... then

	local req = multipart.mail{
		from = 'thedude@dude.com',
		text = 'Hello Dude!',
		html = '<h1>Hello</h1><p>Hello Dude</p>',
		inlines = {
			{
				cid = 'img1',
				filename = 'progressive.jpg',
				contents = glue.readfile'../tests/jpeg_test/progressive.jpg',
			},
			{
				cid = 'img2',
				filename = 'birds.jpg',
				contents = glue.readfile'../tests/pillow_test/birds.jpg',
			},
		},
		attachments = {
			{
				filename = 'att1.txt',
				content_type = 'text/plain',
				contents = 'att1!',
			},
			{
				filename = 'att2.txt',
				content_type = 'text/plain',
				contents = 'att2!',
			},
		},
	}
	pr(req.headers)
	pr((req.message:gsub('\r', '')))

end

return multipart
