--[==[

	webb | main module
	Written by Cosmin Apreutesei. Public Domain.

Webb is a procedural web framework for http_server.

FEATURES

  * implicit request context but single shared Lua state for all requests
  * filesystem decoupling with virtual files and actions (single-file webb apps)
  * standalone operation without a web server for debugging and offline scripts
  * output buffering stack
  * file serving with cache control
  * dynamic html with mustache templates, php-like templates and Lua scripts
  * multi-language html with server-side language filtering
  * online js and css bundling and minification

  * webb_action : action-based routing module with multi-language URLs
  * webb_spa    : SPA module with client-side action-based routing
  * webb_auth   : Session-based authentication module

REQUEST CONTEXT

	req.fake -> t|f                         context is fake (we're on cmdline)
	http_once_per_request(f, ...)           memoize for current request
	http_once_per_connection(f, ...)        memoize for current connection

REQUEST

	headers([name]) -> s|t                  get header or all
	cookie(name) -> s | nil                 get cookie value
	method([method]) -> s|b                 get/check http method
	post([name]) -> s | t | nil             get POST arg or all
	upload(file) -> true | nil              upload POST data to a file
	args([n|name]) -> s | t | nil           get path element or GET arg or all
	scheme([s]) -> s | t|f                  get/check request scheme
	host([s]) -> s | t|f                    get/check request host
	port([p]) -> p | t|f                    get/check server port
	email(user) -> s                        get email address of user
	client_ip() -> s                        get client's ip address
	isgooglebot() -> t|f                    check if UA is the google bot
	ismobile() -> t|F                       check if UA is a mobile browser

ARG PARSING

	id_arg(s) -> n | nil                    validate int arg with slug
	str_arg(s) -> s | nil                   validate/trim non-empty string arg
	json_str_arg(s) -> s | nil              validate string arg
	enum_arg(s, values...) -> s | nil       validate enum arg
	list_arg(s[, arg_f]) -> t               validate comma-separated list arg
	checkbox_arg(s) -> 'checked' | nil      validate checkbox value from html form
	url_arg(s) -> t                         decode url

OUTPUT

	setcontentsize(sz)                      set content size to avoid chunked encoding
	outall(s[, sz])                         output a single value
	out(s[, sz])                            output one more non-nil value
	push_out([f])                           push output function or buffer
	pop_out() -> s                          pop output function and flush it
	stringbuffer([t]) -> f(s1,...)/f()->s   create a string buffer
	record(f) -> s                          run f and collect out() calls
	out_buffering() -> t | f                check if we're buffering output
	setheader(name, val)                    set a header (unless we're buffering)
	setmime(ext)                            set content-type based on file extension
	setcompress(on)                         enable or disable compression
	outprint(...)                           like Lua's print but uses out()
	outfile(file, [parse])                  output a file's contents
	outfile_function(file) -> f()|nil       return an outfile function if the file exists

URL ENCODING

	absurl([path]) -> s                     get the absolute url for a local url
	slug(id, s) -> s                        encode id and s to `s-id`

RESPONSE

	checkfound(ret, err) -> ret             exit with "404 Not found"
	checkarg(ret, err) -> ret               exit with "400 Bad request"
	check500(ret, err) -> ret               exit with "500 Server error"
	allow(ret, err) -> ret                  exit with "403 Forbidden"
	check_etag(s)                           exit with "304 Not modified"
	setconnectionclose()                    close the connection after this request.

FILESYSTEM

	wwwdirs() -> {dir1,...}                 www dirs
	wwwpath(file, [type]) -> path           get www subpath (and check if exists)
	wwwfile(file, [default]) -> s           get www file contents
	wwwfile.filename <- s|f(filename)       set virtual www file contents
	wwwfiles([filter]) -> {name->true}      list www files
	tmppath([pattern], [t]) -> path         make a tmp file path

MUSTACHE TEMPLATES

	render_string(s, [env], [part]) -> s    render a template from a string
	render_file(file, [env], [part]) -> s   render a template from a file
	mustache_wrap(s, name) -> s             wrap a template in <script> tag
	template(name) -> s                     get template contents
	template.name <- s|f(name)              set template contents or handler
	render(name[, env]) -> s                render template

LUAPAGES TEMPLATES

	include_string(s, [env], [name], ...)   run LuaPages script
	include(file, [env], ...)               run LuaPages script

LUA SCRIPTS

	run_lua_string(s, [env], args...) -> ret    run Lua script from string
	run_lua_file(file, [env], args...) -> ret   run Lua script from file

HTML FILTERS

	html_filter_lang(s, lang) -> s          filter <t> tags and foo:lang attrs
	html_filter_comments(s) -> s            filter <!-- --> comments

FILE CONCATENATION LISTS

	catlist_files(s) -> {file1,...}         parse a .cat file
	outcatlist(file, args...)               output a .cat file

IMAGE PROCESSING

	base64_image_src(s)

]==]

require'glue'
require'url'
require'sock'
require'json'
require'base64'
require'fs'
require'path'
require'rect'
require'mustache'
require'xxhash'
require'http_server'
require'smtp'
require'resolver'

--http server wiring ---------------------------------------------------------

--http thread context for all context-free APIs below.
local req = http_request

local function respond(req)
	req.res = {headers = {}}
	http_log('', 'webb', 'request', '%s %s', req.method, url_unescape(req.uri))
	local main = config('main_module', scriptname)
	local main = isstr(main) and require(main) or main
	if istab(main) then
		main = main.respond
	end
	main()
end
function webb_http_server(opt)
	return http_server({
		respond = respond,
	}, opt)
end

--context-free utils ---------------------------------------------------------

--per-request memoization.
function http_once_per_request(f)
	return function(...)
		local req = req()
		local mf = req[f]
		if not mf then
			mf = memoize(f)
			req[f] = mf
		end
		return mf(...)
	end
end

--per-connection memoization.
function http_once_per_connection(f)
	return function(...)
		local req = req()
		local mf = req.http[f]
		if not mf then
			mf = memoize(f)
			req.http[f] = mf
		end
		return mf(...)
	end
end

--per-request shared environment. Inherits _G. Scripts run with `include()`
--and `run_lua*()` run in this environment by default. If the `t` argument
--is given, an inherited environment is created.
function http_request_env(t)
	local req = req()
	local env = req.env
	if not env then
		env = {__index = _G}
		setmetatable(env, env)
		req.env = env
	end
	if t then
		t.__index = env
		return setmetatable(t, t)
	else
		return env
	end
end

function http_log(...)
	req().http:log(...)
end

--request breakdown ----------------------------------------------------------

function method(which)
	local m = req().method:lower()
	if which then
		return m == which:lower()
	else
		return m
	end
end

function headers(h)
	local ht = req().headers
	if h then
		return ht[h]
	else
		return ht
	end
end

function cookie(name)
	local t = req().headers.cookie
	return t and t[name]
end

function args(v)
	local req = req()
	local args, argc = req.args, req.argc
	if not args then
		local u = url_parse(req.uri, nil, true)
		args = u.segments
		remove(args, 1) -- /a/b -> a/b
		argc = #args
		for i = 1, argc do  -- a//b -> 'a',nil,'b'
			if args[i] == '' then
				args[i] = nil
			end
		end
		if u.args then
			for i = 1, #u.args, 2 do
				local k,v = u.args[i], u.args[i+1]
				args[k] = v
			end
		end
		req.args = args
		req.argc = argc
	end
	if v then
		return args[v]
	else
		return args, 1, argc
	end
end

function post(v)
	if not method'post' then
		return
	end
	local req = req()
	local s = req.post
	if s == nil then
		s = req:read_body'string'
		if s == '' then
			s = nil
		else
			local ct = req.headers['content-type']
			if ct then
				if ct.media_type == 'application/x-www-form-urlencoded' then
					s = url_parse_args(s)
				elseif ct.media_type == 'application/json' then --prevent ENCTYPE CORS
					s = json_decode(s, null)
				end
			end
		end
		req.post = s
	end
	if v ~= nil and istab(s) then
		return s[v]
	else
		return s
	end
end

function upload(file)
	return fcall(function(finally, except)
		http_log('note', 'webb', 'upload', '%s', file)
		local write_protected = assert(file_saver(file))
		except(function() write_protected(ABORT) end)
		local function write(buf, sz)
			assert(write_protected(buf, sz))
		end
		req():read_body(write)
		return file
	end)
end

function scheme(s)
	if s then
		return scheme() == s
	end
	return headers'x-forwarded-proto'
		or (req().http.f.istlssocket and 'https' or 'http')
end

function host(s)
	if s then
		return host() == s
	end
	return headers'x-forwarded-host'
		or (headers'host' and headers'host'.host)
		or config'host'
		or req().http.f.local_addr
end

function port(p)
	if p then
		return port() == tonumber(p)
	end
	return headers'x-forwarded-port'
		or req().http.f.local_port
end

function email(user)
	return _('%s@%s', assert(user), host())
end

function client_ip()
	local xff = headers'x-forwarded-for'
	return xff and xff[1] or req().http.f.remote_addr
end

function isgooglebot()
	return headers'user-agent':find'googlebot' and true or false
end

function ismobile()
	return headers'user-agent':find'mobi' and true or false
end

--response API ---------------------------------------------------------------

--responding with a http status message by raising an error.
local function checkfunc(code, default_err)
	local action = 'ck'..code
	return function(ret, err, ...)
		if ret then return ret end
		err = err and format(err, ...) or default_err
		local req = req()
		if not req then --not in a request
			check('webb', action, ret, '%s', err)
		end
		local ct = req.res.content_type
		http_error{
			status = code,
			content_type = ct,
			headers = {
				--allow logout() to remove cookie while raising 403.
				['set-cookie'] = req.res.headers['set-cookie'],
			},
			content = ct == mime_types.json
				and json_encode{error = err} or tostring(err),
			message = err, --for tostring()
			status_message = err,
		}
	end
end
checkfound = checkfunc(404, 'not found')
checkarg   = checkfunc(400, 'invalid argument')
allow      = checkfunc(403, 'not allowed')
check500   = checkfunc(500, 'internal error')

function check_etag(s)
	if not method'get' then return s end
	if out_buffering() then return s end
	local etag = xxhash128(s):hex()
	local etags = headers'if-none-match'
	if etags and istab(etags) then
		for _,t in ipairs(etags) do
			if t.etag == etag then
				http_error(304)
			end
		end
	end
	--send etag to client as weak etag so that gzip filter still apply.
	setheader('etag', 'W/'..etag)
	return s
end

function setconnectionclose()
	req().res.close = true
end

mime_types = {
	html = 'text/html',
	txt  = 'text/plain',
	sh   = 'text/plain',
	css  = 'text/css',
	json = 'application/json',
	js   = 'application/javascript',
	jpg  = 'image/jpeg',
	jpeg = 'image/jpeg',
	png  = 'image/png',
	gif  = 'image/gif',
	ico  = 'image/x-icon',
	svg  = 'image/svg+xml',
	ttf  = 'font/ttf',
	woff = 'font/woff',
	woff2= 'font/woff2',
	pdf  = 'application/pdf',
	zip  = 'application/zip',
	gz   = 'application/x-gzip',
	tgz  = 'application/x-gzip',
	xz   = 'application/x-xz',
	bz2  = 'application/x-bz2',
	tar  = 'application/x-tar',
	mp3  = 'audio/mpeg',
	events = 'text/event-stream',
	xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function setmime(ext)
	req().res.content_type = checkfound(mime_types[ext])
end

function setcompress(on)
	req().res.compress = on
end

function setcontentsize(sz)
	req().res.content_size = sz
end

--output API -----------------------------------------------------------------

function base64_image_src(s)
	return s and 'data:image/png;base64, '..base64_encode(s)
end

function outall(s, sz)
	if req().http_out or out_buffering() then
		out(s, sz)
	else
		s = s == nil and '' or iscdata(s) and s or tostring(s)
		local req = req()
		req.res.content = s
		req.res.content_size = sz
		req.respond_called = true
		req:respond(req.res)
	end
end

function out_buffering()
	return req().outfunc ~= nil
end

local function default_outfunc(s, sz)
	if s == nil or s == '' or sz == 0 then
		return
	end
	local req = req()
	if not req.http_out then
		req.res.want_out_function = true
		req.respond_called = true
		req.http_out = req:respond(req.res)
	end
	s = not iscdata(s) and tostring(s) or s
	req.http_out(s, sz)
end

function stringbuffer(t)
	t = t or {}
	local geni --{i1,...}
	local genf --{f1,...}
	return function(...)
		local n = select('#',...)
		if n == 0 then --flush it
			if geni then
				for i,ti in ipairs(geni) do
					t[ti] = genf[i]()
				end
			end
			return concat(t)
		else
			local s, sz = ...
			if s == nil or s == '' or sz == 0 then
				return
			end
			if iscdata(s) then
				assert(sz)
				s = str(s, sz)
				add(t, s)
			elseif isfunc(s) then --content generator
				if not geni then
					geni = {}
					genf = {}
				end
				add(t, true) --placeholder
				add(geni, #t)
				add(genf, s)
			else
				assert(not sz)
				s = tostring(s)
				add(t, s)
			end
		end
	end
end

function push_out(f)
	local req = req()
	req.outfunc = f or stringbuffer()
	if not req.outfuncs then
		req.outfuncs = {}
	end
	add(req.outfuncs, req.outfunc)
end

function pop_out()
	local req = req()
	assert(req.outfunc, 'pop_out() with nothing to pop')
	local s = req.outfunc()
	local outfuncs = req.outfuncs
	remove(outfuncs)
	req.outfunc = outfuncs[#outfuncs]
	return s
end

function out(s, sz)
	local req = req()
	local outfunc = req.outfunc or default_outfunc
	outfunc(s, sz)
end

local function pass_record(...)
	return pop_out(), ...
end
function record(f, ...)
	push_out()
	return pass_record(f(...))
end

function outfile_function(path, offset, len)

	local mtime = mtime(path)
	check_etag(tostring(mtime))

	local f = open(path)
	if not f then
		return
	end

	offset = offset or 0
	len = len or f:attr'size' - offset
	if offset ~= 0 then
		f:seek('set', offset)
	end

	return function()
		setcontentsize(len)
		local filebuf_size = min(len, 64 * 1024)
		local filebuf = u8a(filebuf_size)
		while true do
			local len = f:read(filebuf, filebuf_size)
			if len == 0 then
				f:close()
				break
			else
				local ok, err = pcall(out, filebuf, len)
				if not ok then
					f:close()
					error(err)
				end
			end
		end
		assert(f:closed())
	end
end

function outfile(...)
	assert(outfile_function(...))()
end

function setheader(name, val)
	req().res.headers[name] = val
end

local _print = print_function(out)
function outprint(...)
	if req() then setmime'txt' end
	_print(...)
end

--url encoding ---------------------------------------------------------------

function absurl(path)
	path = path or ''
	local port = (scheme'https' and port(443) or scheme'http' and port(80))
		and '' or ':'..port()
	return (config'base_url' or scheme()..'://'..host()..port)..path
end

function slug(id, s)
	s = trim(s or '')
		:gsub('[%s_;:=&@/%?]', '-') --turn separators into dashes
		:gsub('%-+', '-')           --compress dashes
		:gsub('[^%w%-%.,~]', '')    --strip chars that would be url-encoded
		:lower()
	assert(id >= 0)
	return (s ~= '' and s..'-' or '')..tostring(id)
end

--filesystem API -------------------------------------------------------------

function wwwdirs()
	local t = {}
	local paths = config('www_dirs', 'www;sdk/www')
	if paths then
		for s in paths:gmatch'[^;]+' do
			if not path_isabs(s) then
				s = path_normalize(indir(scriptdir(), s))
			end
			add(t, s)
		end
	end
	if #t == 0 then
		add(t, indir(scriptdir(), 'www'))
	end
	return t
end
wwwdirs = memoize(wwwdirs)

function tmppath(patt, t)
	assert(not patt:find'[\\/]') --no subdirs
	mkdir(tmpdir(), true)
	t = t or {}
	t.request_id = req() and req().request_id or 0
	local file = subst(patt, t)
	return path_combine(tmpdir(), file)
end

function wwwpath(file, type)
	assert(file)
	for _,dir in ipairs(wwwdirs()) do
		local abs_path = indir(dir, file)
		if path_commonpath(dir, abs_path) then --prevent .. from escaping dir
			if file_is(abs_path, type) then
				return abs_path
			end
		end
	end
	return nil, file..' not found'
end

local function file_object(findfile) --{filename -> content | handler(filename)}
	return setmetatable({}, {
		__call = function(self, file, default)
			local f = call(self[file])
			if f then
				return f
			else
				local file, err = findfile(file)
				if file then
					return load(file, default)
				else
					assert(default ~= nil, err)
					return default
				end
			end
		end,
	})
end
wwwfile = file_object(wwwpath)
varfile = file_object(varpath)

function wwwfiles(filter)
	if isstr(filter) then
		local patt = filter
		filter = function(s) return s:find(patt) end
	end
	filter = filter or pass
	local t = {}
	for name in pairs(wwwfile) do
		if filter(name) then
			t[name] = true
		end
	end
	for _,dir in ipairs(wwwdirs()) do
		for name, d in ls(dir) do
			if not name then
				break
			end
			if not t[name] and d:is'file' and filter(name) then
				t[name] = true
			end
		end
	end
	return t
end

--arg validation & decoding --------------------------------------------------

function id_arg(s)
	if not s or isnum(s) then return s end
	local n = tonumber(s:match'(%d+)$') --strip any slug
	return n and n >= 0 and n or nil
end

function str_arg(s)
	s = trim(s or '')
	return s ~= '' and s or nil
end

function json_str_arg(s)
	return isstr(s) and s or nil
end

function enum_arg(s, ...)
	for i=1,select('#',...) do
		if s == select(i,...) then
			return s
		end
	end
	return nil
end

function list_arg(s, arg_f)
	local s = str_arg(s)
	if not s then return nil end
	arg_f = arg_f or str_arg
	local t = {}
	for s in split(s, ',', 1, true) do
		add(t, arg_f(s))
	end
	return t
end

function checkbox_arg(s)
	return s == 'on' and 'checked' or nil
end

function url_arg(s)
	return isstr(s) and url_parse(s) or s
end

--mustache html templates ----------------------------------------------------

local function underscores(name)
	return name:gsub('-', '_')
end

function render_string(s, data, partials)
	return (mustache_render(s, data, partials))
end

function render_file(file, data, partials)
	return render_string(wwwfile(file), data, partials)
end

function mustache_wrap(s, name)
	s = s:gsub('</script>', '<{{undefined}}/script>')
	return '<script type="text/x-mustache" id="'..name..
		'_template">\n'..s..'\n</script>\n'
end

local function check_template(name, file)
	assertf(not template[name], 'duplicate template "%s" in %s', name, file)
end

--TODO: make this parser more robust so we can have <script> tags in templates
--without the <{{undefined}}/script> hack (mustache also needs it though).
local function mustache_unwrap(s, t, file)
	t = t or {}
	local i = 0
	for name,s in s:gmatch('<script%s+type=?"text/x%-mustache?"%s+'..
		'id="?(.-)_template"?>(.-)</script>') do
		name = underscores(name)
		if t == template then
			check_template(name, file)
		end
		t[name] = s
		i = i + 1
	end
	return t, i
end

local template_names = {} --keep template names in insertion order

local function add_template(template, name, s)
	name = underscores(name)
	rawset(template, name, s)
	add(template_names, name)
end

--gather all the templates from the filesystem.
local load_templates = memoize(function()
	for i,file in ipairs(keys(wwwfiles'%.html%.mu$')) do
		local s = wwwfile(file)
		local _, i = mustache_unwrap(s, template, file)
		if i == 0 then --must be without the <script> tag
			local name = file:gsub('%.html%.mu$', '')
			name = underscores(name)
			check_template(name, file)
			template[name] = s
		end
	end
	--[[
	--TODO: static templates
	for i,file in ipairs(keys(wwwfiles'%.html')) do
		local s = wwwfile(file)
		local _, i = mustache_unwrap(s, template, file)
		if i == 0 then --must be without the <script> tag
			local name = file:gsub('%.html%.mu$', '')
			name = underscores(name)
			check_template(name, file)
			template[name] = s
		end
	end
	]]
end)

local function template_call(template, name)
	load_templates()
	if not name then
		return template_names
	else
		name = underscores(name)
		return call(assertf(template[name], 'template not found: %s', name))
	end
end

template = {} --{template = html | handler(name)}
setmetatable(template, {__call = template_call, __newindex = add_template})

local partials = {}
local function get_partial(partials, name)
	return template(name)
end
setmetatable(partials, {__index = get_partial})

function render(name, data)
	return render_string(template(name), data, partials)
end

--LuaPages templates ---------------------------------------------------------

local function lp_out(s, i, f)
	s = s:sub(i, f or -1)
	if s == '' then return s end
	-- we could use `%q' here, but this way we have better control
	s = s:gsub('([\\\n\'])', '\\%1')
	-- substitute '\r' by '\'+'r' and let `loadstring' reconstruct it
	s = s:gsub('\r', '\\r')
	return _(' out(\'%s\'); ', s)
end

local function lp_translate(s)
	s = s:gsub('^#![^\n]+\n', '')
	s = s:gsub('<%%(.-)%%>', '<?lua %1 ?>"')
	local res = {}
	local start = 1 --start of untranslated part in `s'
	while true do
		local ip, fp, target, exp, code = s:find('<%?(%w*)[ \t]*(=?)(.-)%?>', start)
		if not ip then
			ip, fp, target, exp, code = s:find('<%?(%w*)[ \t]*(=?)(.*)', start)
			if not ip then
				break
			end
		end
		add(res, lp_out(s, start, ip-1))
		if target ~= '' and target ~= 'lua' then
			--not for Lua; pass whole instruction to the output
			add(res, lp_out(s, ip, fp))
		else
			if exp == '=' then --expression?
				add(res, _(' out(%s);', code))
			else --command
				add(res, _(' %s ', code))
			end
		end
		start = fp + 1
	end
	add(res, lp_out(s, start))
	return concat(res)
end

local function lp_compile(s, chunkname, env)
	local s = lp_translate(s)
	return assert(load(s, chunkname, 'bt', env))
end

local function compile_string(s, chunkname)
	local f = lp_compile(s, chunkname)
	return function(_env, ...)
		setfenv(f, _env or http_request_env())
		f(...)
	end
end

local compile = memoize(function(file)
	return compile_string(wwwfile(file), '@'..file)
end)

function include_string(s, env, chunkname, ...)
	return compile_string(s, chunkname)(env, ...)
end

function include(file, env, ...)
	compile(file)(env, ...)
end

--Lua scripts ----------------------------------------------------------------

local function compile_lua_string(s, chunkname)
	local f = assert(loadstring(s, chunkname))
	return function(env_, ...)
		setfenv(f, env_ or http_request_env())
		return f(...)
	end
end

local compile_lua_file = memoize(function(file)
	return compile_lua_string(wwwfile(file), file)
end)

function run_lua_string(s, env, ...)
	return compile_lua_string(s)(env, ...)
end

function run_lua_file(file, env, ...)
	return compile_lua_file(file)(env, ...)
end

--lang integration -----------------------------------------------------------

function S_ids_add_js(file, s)
	for id, en_s in s:gmatch"[^%w_]Sf?%(%s*'([%w_]+)'%s*,%s*'(.-)'%s*[,%)]" do
		S_ids_add_id('js', file, id, en_s)
	end
end

function S_ids_add_html(file, s)

	local function add_id(id, en_s)
		S_ids_add_id('html', file, id, en_s)
	end

	--<t s=ID>EN_S</t>
	for id, en_s in s:gmatch'<t%s+s=([%w_%-]+).->(.-)</t>' do
		add_id(id, en_s)
	end

	--replace attr:s:ID="EN_S" and attr:s:ID=EN_S
	for id, en_s in s:gmatch'%s[%w_%-]+%:s%:([%w_%-]+)=(%b"")' do
		en_s = en_s:sub(2, -2)
		add_id(id, en_s)
	end
	for id, en_s in s:gmatch'%s[%w_%-]+%:s%:([%w_%-]+)=([^%s>]*)' do
		add_id(id, en_s)
	end
end

function html_filter_lang(s, lang)

	local lang0 = lang

	if config('lang_filter', false) == 'explicit' then

		local function remove_lang(lang)
			if lang ~= lang0 then return '' end
			return false
		end

		--remove `<t lang=LANG>` (can also be hidden via CSS with this syntax).
		s = s:gsub('<t%s+lang=(%w%w).->.-</t>', remove_lang)

		--remove `attr:LANG="TEXT"` and `attr:LANG=TEXT`.
		s = s:gsub('%s[%w_%:%-]+%:(%a%a)=%b""'   , remove_lang)
		s = s:gsub('%s[%w_%:%-]+%:(%a%a)=[^%s>]*', remove_lang)

	end

	--replace `<t s=ID>EN_S</t>`.
	s = s:gsub('<t%s+s=([%w_%-]+).->(.-)</t>', function(id, en_s)
		return S_for('html', id, en_s)
	end)

	--replace `attr:s:ID="EN_S"` and `attr:s:ID=EN_S`
	local function repl_quoted_attr(attr, id, en_s)
		return attr .. '="' .. S_for('html', id, en_s:sub(2, -2)) .. '"'
	end
	local function repl_attr(attr, id, en_s)
		return attr .. '="' .. S_for('html', id, en_s) .. '"'
	end
	s = s:gsub('(%s[%w_%-]+)%:s%:([%w_%-]+)=(%b"")', repl_quoted_attr)
	s = s:gsub('(%s[%w_%-]+)%:s%:([%w_%-]+)=([^%s>]*)', repl_attr)

	return s
end

function html_filter_comments(s)
	return (s:gsub('<!%-%-.-%-%->', ''))
end

--concatenated files preprocessor --------------------------------------------

--NOTE: duplicates are ignored to allow require()-like functionality
--when composing file lists from independent modules (see jsfile and cssfile).
function catlist_files(s)
	s = s:gsub('//[^\n\r]*', '') --strip out comments
	local already = {}
	local t = {}
	for file in s:gmatch'([^%s]+)' do
		if not already[file] then
			already[file] = true
			add(t, file)
		end
	end
	return t
end

--NOTE: can also concatenate actions if the actions module is loaded.
--NOTE: favors plain files over actions because it can generate etags without
--actually reading the files.
function outcatlist(listfile, ...)
	local js = listfile:find'%.js%.cat$'
	local sep = js and ';\n' or '\n'

	--generate and check etag
	local t = {} --etag seeds
	local c = {} --output generators

	for i,file in ipairs(catlist_files(wwwfile(listfile))) do
		if wwwfile[file] then --virtual file
			local s = wwwfile(file)
			add(t, s)
			add(c, function() out(s) end)
		else
			local path = wwwpath(file)
			if path then --plain file, get its mtime
				local mtime = ls(path, 'mtime')
				add(t, tostring(mtime))
				add(c, function() outfile(path) end)
			elseif action then --file not found, try an action
				local s, found = record(internal_action, file, ...)
				if found then
					add(t, s)
					add(c, function() out(s) end)
				else
					assertf(false, 'file not found: %s', file)
				end
			else
				assertf(false, 'file not found: %s', file)
			end
		end
	end
	check_etag(concat(t, '\0'))

	--output the content
	for i,f in ipairs(c) do
		f()
		out(sep)
	end
end
