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
  * http error responses via exceptions
  * rendering with mustache templates, php-like templates and Lua scripts
  * multi-language html with server-side language filtering
  * online js and css bundling and minification
  * multipart email sending via SMTP

  * webb_action : action-based routing module with multi-language URLs
  * webb_query  : SQL query module with implicit connection pool
  * webb_spa    : SPA module with client-side action-based routing
  * webb_auth   : Session-based authentication module

EXPORTS

	glue pp

CONFIG API

	config(name[, default_val]) -> val      get/set config value
	config{name->val}                       set multiple config values
	with_config(conf, f, ...) -> ...        run f with custom config table

MULTI-LANGUAGE & MULTI-COUNTRY SUPPORT

	lang([k])                               get lang or lang property for current request
	setlang(lang)                           set lang of current request
	default_lang()                          get the default lang
	webb.langinfo[lang] -> {k->v}           static language property table

	country([k])                            get country or country property for current request
	setcountry(country, [if_not_set])       set country of current request
	default_country()                       get the default country
	webb.countryinfo[country] -> {k->v}     static country property table

MULTI-LANGUAGE STRINGS IN SOURCE CODE

	S(id, en_s, ...) -> s                   get Lua string in current language
	Sf(id, en_s) -> f(...) -> s             create a getter for a string in current language
	S_for(ext, id, en_s, ...) -> s          get Lua/JS/HTML string in current language
	S_texts(lang, ext) -> s                 get stored translated strings
	update_S_texts(lang, ext, {id->s})      update stored translated strings
	Sfile'file1 ...'                        register source code file
	Sfile_ids() -> {id->{file=,n=,en_s=}    parse source code files for S() calls

REQUEST CONTEXT

	once(f, ...)                            memoize for current request
	cx() -> t                               get per-request shared context
	cx().fake -> t|f                        context is fake (we're on cmdline)
	cx().request_id                         unique request id (for naming temp files)
	webb.setcx(thread, t)                   set per-request shared context
	webb.env([t]) -> t                      per-request shared environment

THREADING

	newthread(f) -> thread                  create thread
	thread(f, ...) -> thread                create and resume thread
	currentthread() -> thread               get currently running thread
	resume(thread, ...) -> ...              resume thread
	suspend() -> ...                        suspend thread
	transfer(thread, ...) -> ...            transfer to thread
	threadenv[thread]                       thread environment table
	onthreadfinish(thread, f)               add a thread finalizer

ITERATORS

	cowrap(f, ...) -> f                     create iterator
	yield(...) -> ...                       yield from iterator

TIMERS

	sleep(n)                                sleep n seconds
	sleep_until(t)                          sleep until time
	sleep_job() -> sj                       make a sleep job
	runat(ts, f)                            run f at time
	runafter(s, f)                          run f after s seconds
	runevery(s, f)                          run f every s seconds

LOGGING

	webb.dbg      (module, event, fmt, ...)
	webb.note     (module, event, fmt, ...)
	webb.warnif   (module, event, fmt, ...)
	webb.logerror (module, event, fmt, ...)

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
	googlebot() -> t|f                      check if UA is the google bot
	mobile() -> t|F                         check if UA is a mobile browser

ARG PARSING

	id_arg(s) -> n | nil                    validate int arg with slug
	str_arg(s) -> s | nil                   validate/trim non-empty string arg
	enum_arg(s, values...) -> s | nil       validate enum arg
	list_arg(s[, arg_f]) -> t               validate comma-separated list arg
	checkbox_arg(s) -> 'checked' | nil      validate checkbox value from html form
	url_arg(s) -> t                         decode url

OUTPUT

	set_content_size(sz)                    set content size to avoid chunked encoding
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

HTML ENCODING

	html(s) -> s                            escape html

URL ENCODING

	url{...} -> t | s                       encode url
	absurl([path]) -> s                     get the absolute url for a local url
	slug(id, s) -> s                        encode id and s to `s-id`

RESPONSE

	http_error(res)                         raise a http error
	redirect(url[, status])                 exit with "302 Moved temporarily"
	checkfound(ret, err) -> ret             exit with "404 Not found"
	checkarg(ret, err) -> ret               exit with "400 Bad request"
	check500(ret, err) -> ret               exit with "500 Server error"
	allow(ret, err) -> ret                  exit with "403 Forbidden"
	check_etag(s)                           exit with "304 Not modified"
	onrequestfinish(f)                      add a request finalizer
	setconnectionclose()                    close the connection after this request.

SOCKETS

	connect(ip, port) -> sock               connect to a server
	resolve(host) -> ip4                    resolve a hostname

HTTP REQUESTS

	getpage(url,post_data | opt) -> req     make a HTTP request

JSON ENCODING/DECODING

	json_arg(s) -> t                        decode JSON
	json(t) -> s                            encode JSON
	null                                    value to encode json `null`

FILESYSTEM

	wwwpath(file, [type]) -> path           get www subpath (and check if exists)
	wwwfile[_cached](file[,parse]) -> s     get www file contents
	wwwfile.filename <- s|f(filename)       set virtual www file contents
	wwwfiles([filter]) -> {name->true}      list www files
	out[www]file[_cached](file[,parse])     buffered output of www file
	varpath(file) -> path                   get var subpath (no check that it exists)
	varfile.filename <- s|f(filename)       set virtual file contents
	varfile[_cached](file[,parse]) -> s     get var file contents
	readfile[_cached](file[,parse]) -> s    (cached) readfile for small static files
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

	run_string(s, [env], args...) -> ret    run Lua script
	run(file, [env], args...) -> ret        run Lua script

HTML FILTERS

	filter_lang(s, lang) -> s               filter <t> tags and foo:lang attrs
	filter_comments(s) -> s                 filter <!-- --> comments

FILE CONCATENATION LISTS

	catlist_files(s) -> {file1,...}         parse a .cat file
	outcatlist(file, args...)               output a .cat file

MAIL SENDING

	sendmail{from=, to=, subject=, text=, html=, attachments=, inlines=}

IMAGE PROCESSING

	resize_image(src_path, dst_path, max_w, max_h)
	base64_image_src(s)

HTTP SERVER INTEGRATION

	webb.respond(req)                       webb.server response handler
	webb.request_finish()
	webb.server([opt]) -> server

STANDALONE OPERATION

	webb.run(f, ...)                        run a function in a webb context.
	webb.request(req | arg1,...)            make a request without a http server.

CONFIG

	app_name         <required>            app name
	app_dir          <required>            app dir
	main_module      app_name              main module / respond function
	www_dir          APP_DIR/www           static files dir
	libwww_dir       APP_DIR/sdk/www       shared www dir
	var_dir          APP_DIR/var           persistent state dir
	http_addr        *                     HTTP listen IP address
	http_port        80                    HTTP listen port
	https_addr       *                     HTTPS listen addr
	https_port       443                   HTTPS listen port
	https_crt_file   VAR_DIR/HOST.crt      SSL crt file
	https_key_file   VAR_DIR/HOST.key      SSL key file
	base_url         SCHEME://HOST[:PORT]  fixed base URL for absurl()
	host             tcp.local_addr        when `Host` header missing
	ns               1.1.1.1 8.8.8.8       nameserver IPs
	ca_file          VAR_DIR/cacert.pem    CA file for HTTPS and SMTPS clients
	smtp_host        127.0.0.1             SMTP host
	smtp_port        587                   SMTP port
	smtp_user        <required>            SMTP auth user
	smtp_pass        <required>            SMTP auth password
	smtp_tls         false                 true to use TLS with SMTP
	noreply_email    noreply@HOST
	http_debug       nil                   'protocol stream errors tracebacks'
	smtp_debug       nil                   'protocol stream errors tracebacks'
	default_lang     'en'                  default language

]==]

local ffi = require'ffi'
local glue = require'glue'
local pp = require'pp'
local uri = require'uri'
local errors = require'errors'
local sock = require'sock'
local cjson = require'cjson'.new()
local b64 = require'base64'.encode
local fs = require'fs'
local path = require'path'
local mustache = require'mustache'
local xxhash = require'xxhash'
local prettycjson = require'prettycjson'
local box2d = require'box2d'

local concat = table.concat
local remove = table.remove
local add = table.insert
local update = glue.update
local assertf = glue.assert
local memoize = glue.memoize
local _ = string.format
local format = string.format
local indir = function(...) return assert(path.indir(...)) end
local index = glue.index
local names = glue.names

_G.glue = glue
_G.pp = pp

webb = {}

errors.errortype'http_response'.__tostring = function(self)
	local s = self.traceback or self.message or ''
	if self.status then
		s = self.status .. ' ' .. s
	end
	return s
end

--threads and webb context switching -----------------------------------------

--request context for current thread.
local cx do
	local thread_cx = setmetatable({}, {__mode = 'k'})
	function sock.save_thread_context(thread)
		thread_cx[thread] = cx
	end
	function sock.restore_thread_context(thread)
		cx = thread_cx[thread]
	end

	function _G.cx() return cx end
	function webb.setcx(thread, cx1)
		thread_cx[thread] = cx1
		cx = cx1
	end
end

--from $sock

threadenv      = sock.threadenv
newthread      = sock.newthread
thread         = sock.thread
currentthread  = sock.currentthread
resume         = sock.resume
suspend        = sock.suspend
transfer       = sock.transfer
onthreadfinish = sock.onthreadfinish

cowrap         = sock.cowrap
yield          = sock.yield

sleep_until    = sock.sleep_until
sleep          = sock.sleep
sleep_job      = sock.sleep_job
runat          = sock.runat
runafter       = sock.runafter
runevery       = sock.runevery

--config function ------------------------------------------------------------

do
	local conf = {}
	function config(k, default)
		if type(k) == 'table' then
			for k, v in pairs(v) do
				config(k, v)
			end
		else
			local v = conf[k]
			if v == nil then
				v = default
				conf[k] = v
			end
			return v
		end
	end

	function with_config(t, f, ...)
		local old_conf = conf
		local function pass(...)
			conf = old_conf
			return ...
		end
		conf = setmetatable(t, {__index = old_conf})
		return pass(f(...))
	end
end

--multi-language support with stubs ------------------------------------------

webb.langinfo = {
	en = {
		rtl = false,
		en_name = 'English',
		name = 'English',
		decimal_separator = ',',
		thousands_separator = '.',
	},
}

function default_lang()
	return config('default_lang', 'en')
end

function lang(k)
	local lang = cx.lang or default_lang()
	if not k then return lang end
	local t = assert(webb.langinfo[lang])
	local v = t[k]
	assert(v ~= nil)
	return v
end

function setlang(lang)
	if not lang or not webb.langinfo[lang] then return end --missing or invalid lang: ignore.
	cx.lang = lang
end

webb.countryinfo = {
	US = {
		lang = 'en',
		currency = 'USD',
		imperial_system = true,
		week_start_offset = 0,
		en_name = 'United States',
		date_format = 'mm-dd-yyyy',
	},
}

function default_country()
	return config('default_country', 'US')
end

function country(k)
	local country = cx.country or default_country()
	if not k then return country end
	local t = assert(webb.countryinfo[country])
	local v = t[k]
	assert(v ~= nil)
	return v
end

function setcountry(country, if_not_set)
	if if_not_set and cx.country then return end
	cx.country = country and countryinfo(country) and country or default_country()
end

--multi-language strings in source code files --------------------------------

do

local files = {}
local ids --{id->{files=,n=,en_s}}

function Sfile(filenames)
	update(files, index(names(filenames)))
	ids = nil
end

function Sfile_template(ids, file, s)

	local function add_id(id, en_s)
		local ext_id ='html:'..id
		local t = ids[ext_id]
		if not t then
			t = {files = file, n = 1, en_s = en_s}
			ids[ext_id] = t
		else
			t.files = t.files .. ' ' .. file
			t.n = t.n + 1
		end
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

function Sfile_ids()
	if not ids then
		ids = {}
		for file in pairs(files) do
			local ext = fileext(file)
			local s
			if ext == 'js' then
				s = assert(wwwfile(file))
			elseif ext == 'lua' then
				s = assertf(readfile(indir(config'app_dir', file))
						or readfile(indir(config'app_dir', 'sdk', 'lua', file)),
							'file not found: %s', file)
			end
			for id, en_s in s:gmatch"[^%w_]Sf?%(%s*'([%w_]+)'%s*,%s*'(.-)'%s*[,%)]" do
				local ext_id = ext..':'..id
				local t = ids[ext_id]
				if not t then
					t = {files = file, n = 1, en_s = en_s}
					ids[ext_id] = t
				else
					t.files = t.files .. ' ' .. file
					t.n = t.n + 1
				end
			end
		end
		for i,k in ipairs(template()) do
			local s = template(k)
			if type(s) == 'function' then --template getter/generator
				s = s()
			end
			Sfile_template(ids, k, s)
		end
	end
	return ids
end

--using a different file for js strings so that strings.js only sends
--js strings to the client for client-side translation.
local function s_file(lang, ext)
	return varpath(format('%s-s-%s%s.lua', config'app_name', lang,
		ext == 'lua' and '' or '-'..ext))
end

--TODO: invalidate this cache based on file's mtime but don't check too often.
S_texts = function(lang, ext)
	local f = loadfile(s_file(lang, ext))
	return f and f() or {}
end

local function save_S_texts(lang, ext, t)
	save(s_file(lang, ext), 'return '..pp.format(t, '\t'))
end

function update_S_texts(lang, ext, t)
	local texts = S_texts(lang, ext)
	for k,v in pairs(t) do
		texts[k] = v or nil
	end
	save_S_texts(lang, ext, texts)
end

function S_for(ext, id, en_s, ...)
	local lang = lang()
	local t = S_texts(lang, ext)
	local s = t[id]
	if not s then
		local dlang = default_lang()
		if dlang ~= 'en' and dlang ~= lang then
			s = S_texts(dlang, ext)
		end
	end
	s = s or en_s or ''
	if select('#', ...) > 0 then
		return glue.subst(s, ...)
	else
		return s
	end
end

function S(...)
	return S_for('lua', ...)
end

function Sf(id, en_s)
	return function(...)
		return S_for('lua', id, en_s, ...)
	end
end

end --do

--per-request environment ----------------------------------------------------

--per-request memoization.
function once(f)
	return function(...)
		local mf = cx[f]
		if not mf then
			mf = memoize(f)
			cx[f] = mf
		end
		return mf(...)
	end
end

--per-request shared environment to use in all app code.
--Inherits _G. Scripts run with `include()` and `run()` run in this environment
--by default. If the `t` argument is given, an inherited environment is created.
function webb.env(t)
	local env = cx.env
	if not env then
		env = {__index = _G}
		setmetatable(env, env)
		cx.env = env
	end
	if t then
		t.__index = env
		return setmetatable(t, t)
	else
		return env
	end
end

--logging --------------------------------------------------------------------

function webb.log      (...) cx.req.http:log(...) end
function webb.dbg      (...) webb.log(''     , ...) end
function webb.note     (...) webb.log('note' , ...) end
function webb.logerror (...) webb.log('ERROR', ...) end
function webb.warnif   (module, event, cond, ...)
	if not cond then return end
	webb.log('WARN', module, event, ...)
end

function trace(event, s, ...)
	if not event then
		print(debug.traceback())
		return
	end
	dbg(event, '%4.2f '..s, 0, ...)
	local t0 = time()
	return function(event, s, ...)
		local dt = time() - t0
		dbg(event, '%4.2f '..s, dt, ...)
	end
end

--request API ----------------------------------------------------------------

function method(which)
	if which then
		return cx.req.method:lower() == which:lower()
	else
		return cx.req.method:lower()
	end
end

function headers(h)
	if h then
		return cx.req.headers[h]
	else
		return cx.req.headers
	end
end

function cookie(name)
	local t = cx.req.headers.cookie
	return t and t[name]
end

function args(v)
	local args = cx.args
	if not args then
		local u = uri.parse(cx.req.uri)
		args = u.segments
		remove(args, 1)
		if u.args then
			for i = 1, #u.args, 2 do
				local k,v = u.args[i], u.args[i+1]
				args[k] = v
			end
		end
		cx.args = args
	end
	if v then
		return args[v]
	else
		return args
	end
end

function post(v)
	if not method'post' then
		return
	end
	local post = cx.post
	if not post then
		local s = cx.req:read_body'string'
		local ct = headers'content-type'
		if ct then
			if ct.media_type == 'application/x-www-form-urlencoded' then
				post = uri.parse_args(s)
			elseif ct.media_type == 'application/json' then --prevent ENCTYPE CORS
				post = json_arg(s)
			end
		else
			post = s
		end
		cx.post = post
	end
	if v then
		return post[v]
	else
		return post
	end
end

function upload(file)
	return glue.fcall(function(finally, except)
		webb.note('webb', 'upload', '%s', file)
		local write_protected = assert(fs.saver(file))
		except(function() write_protected(fs.abort) end)
		local function write(buf, sz)
			assert(write_protected(buf, sz))
		end
		cx.req:read_body(write)
		write()
		return file
	end)
end

function scheme(s)
	if s then
		return scheme() == s
	end
	return headers'x-forwarded-proto'
		or (cx.req.http.tcp.istlssocket and 'https' or 'http')
end

function host(s)
	if s then
		return host() == s
	end
	return headers'x-forwarded-host'
		or (headers'host' and headers'host'.host)
		or config'host'
		or cx.req.http.tcp.local_addr
end

function port(p)
	if p then
		return port() == tonumber(p)
	end
	return headers'x-forwarded-port'
		or cx.req.http.tcp.local_port
end

function email(user)
	return _('%s@%s', assert(user), host())
end

function client_ip()
	return headers'x-forwarded-for'
		or cx.req.http.tcp.remote_addr
end

function googlebot()
	return headers'user-agent':find'googlebot' and true or false
end

function mobile()
	return headers'user-agent':find'mobi' and true or false
end

--arg validation & decoding --------------------------------------------------

function id_arg(s)
	if not s or type(s) == 'number' then return s end
	local n = tonumber(s:match'(%d+)$') --strip any slug
	return n and n >= 0 and n or nil
end

function str_arg(s)
	s = glue.trim(s or '')
	return s ~= '' and s or nil
end

function json_str_arg(s)
	return type(s) == 'string' and s or nil
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
	for s in glue.gsplit(s, ',', 1, true) do
		add(t, arg_f(s))
	end
	return t
end

function checkbox_arg(s)
	return s == 'on' and 'checked' or nil
end

function url_arg(s)
	return type(s) == 'string' and uri.parse(s) or s
end

--output API -----------------------------------------------------------------

function set_content_size(sz)
	cx.res.content_size = sz
end

function outall(s, sz)
	if cx.http_out or out_buffering() then
		out(s, sz)
	else
		s = s == nil and '' or type(s) == 'cdata' and s or tostring(s)
		cx.res.content = s
		cx.res.content_size = sz
		cx.req:respond(cx.res)
	end
end

function out_buffering()
	return cx.outfunc ~= nil
end

local function default_outfunc(s, sz)
	if s == nil or s == '' or sz == 0 then
		return
	end
	if not cx.http_out then
		cx.res.want_out_function = true
		cx.http_out = cx.req:respond(cx.res)
	end
	s = type(s) ~= 'cdata' and tostring(s) or s
	cx.http_out(s, sz)
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
			if type(s) == 'cdata' then
				assert(sz)
				s = ffi.string(s, sz)
				add(t, s)
			elseif type(s) == 'function' then --content generator
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
	cx.outfunc = f or stringbuffer()
	if not cx.outfuncs then
		cx.outfuncs = {}
	end
	add(cx.outfuncs, cx.outfunc)
end

function pop_out()
	if not cx.outfunc then return end
	local s = cx.outfunc()
	local outfuncs = cx.outfuncs
	remove(outfuncs)
	cx.outfunc = outfuncs[#outfuncs]
	return s
end

function out(s, sz)
	local outfunc = cx.outfunc or default_outfunc
	outfunc(s, sz)
end

local function pass_record(...)
	return pop_out(), ...
end
function record(f, ...)
	push_out()
	return pass_record(f(...))
end

function outfile_function(path)

	local f = fs.open(path, 'r')
	if not f then
		return
	end

	local mtime, err = f:attr'mtime'
	if not mtime then
		f:close()
		error(err)
	end
	check_etag(tostring(mtime))

	local file_size, err = f:attr'size'
	if not file_size then
		f:close()
		error(err)
	end

	return function()
		set_content_size(file_size)
		local filebuf_size = math.min(file_size, 65536)
		local filebuf = glue.u8a(filebuf_size)
		while true do
			local len, err = f:read(filebuf, filebuf_size)
			if not len then
				f:close()
				error(err)
			elseif len == 0 then
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

local function _outfile(readfile, path, parse)
	if not parse then
		return assert(outfile_function(path))()
	end
	out(readfile(path, parse))
end
function outfile(path, parse) return _outfile(readfile, path, parse) end
function outfile_cached(path, parse) return _outfile(readfile_cached, path, parse) end

function setheader(name, val)
	cx.res.headers[name] = val
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
	cx.res.content_type = checkfound(mime_types[ext])
end

function setcompress(on)
	cx.res.compress = on
end

do
local function print_wrapper(print)
	return function(...)
		if cx.res then setmime'txt' end
		print(...)
	end
end
outprint = print_wrapper(glue.printer(out))
local metamethods = {
	__index = 1,
	__newindex = 1,
	__mode = 1,
}
local i64 = ffi.typeof'int64_t'
local u64 = ffi.typeof'uint64_t'
local function filter(v, k, t)
	return type(v) ~= 'function'
		and not (t and getmetatable(t) == t and metamethods[k])
		and (type(v) ~= 'cdata'
			or ffi.istype(v, i64)
			or ffi.istype(v, u64))
end
outpp = print_wrapper(glue.printer(out, function(v)
	return pp.format(v, '   ', {}, nil, nil, nil, true, filter)
end))
end

--sockets --------------------------------------------------------------------

function connect(host, port)
	local skt = sock.tcp()
	local ok, err = skt:connect(host, port)
	if not ok then return nil, err end
	return skt
end

--dns resolver ---------------------------------------------------------------

local resolver
function resolve(host)
	resolver = resolver or require'resolver'.new{
		servers = config('ns', {
			'1.1.1.1', --cloudflare
			'8.8.8.8', --google
		}),
	}
	local addrs, err = resolver:lookup(host)
	return addrs and addrs[1], err
end

--http requests --------------------------------------------------------------

local getpage_client

function getpage(arg1, post_data)
	local opt = type(arg1) == 'table' and arg1

	if not getpage_client then

		local http_client = require'http_client'

		getpage_client = http_client:new(update({
			libs = 'sock sock_libtls zlib',
			resolve = function(_, host) return resolve(host) end,
		}, opt))

	end

	local headers = {}
	if type(post_data) ~= 'string' then
		post_data = json(post_data)
		headers.content_type = mime_types.json
	end

	local u = type(arg1) == 'string' and uri.parse(arg1) or arg1.url and opt(arg1.url)

	local res, req, err_class = getpage_client:request(update({
		host = u and u.host,
		uri = u and u.path,
		https = (u and u.scheme and u.scheme or scheme()) == 'https',
		method = post_data and 'POST',
		headers = headers,
		content = post_data,
		receive_content = 'string',
		debug = {protocol = true, stream = false},
		--close = true,
	}, opt))

	if not res then
		return nil, req, err_class
	end

	local s = res.content
	local ct = res.headers['content-type']
	if ct and ct.media_type == mime_types.json then
		s = json_arg(s)
	end
	return s
end

--html encoding --------------------------------------------------------------

function html(s)
	if s == nil then return '' end
	return (tostring(s):gsub('[&"<>\\]', function(c)
		if c == '&' then return '&amp;'
		elseif c == '"' then return '\"'
		elseif c == '\\' then return '\\\\'
		elseif c == '<' then return '&lt;'
		elseif c == '>' then return '&gt;'
		else return c end
	end))
end

--url encoding ---------------------------------------------------------------

function url(t)
	return type(t) == 'table' and  uri.format(t) or t
end

function absurl(path)
	path = path or ''
	local port = (scheme'https' and port(443) or scheme'http' and port(80))
		and '' or ':'..port()
	return (config'base_url' or scheme()..'://'..host()..port)..path
end

function slug(id, s)
	s = glue.trim(s or '')
		:gsub('[%s_;:=&@/%?]', '-') --turn separators into dashes
		:gsub('%-+', '-')           --compress dashes
		:gsub('[^%w%-%.,~]', '')    --strip chars that would be url-encoded
		:lower()
	assert(id >= 0)
	return (s ~= '' and s..'-' or '')..tostring(id)
end

--response API ---------------------------------------------------------------

function http_error(...)
	cx.req:raise(...)
end

function redirect(uri)
	--TODO: make it work with relative paths
	http_error{status = 303, headers = {location = uri}}
end

local function checkfunc(code, default_err)
	return function(ret, err)
		if ret then return ret end
		http_error{
			status = code,
			headers = {['content-type'] = 'application/json'},
			content = json{error = tostring(err or default_err)},
		}
	end
end
checkfound = checkfunc(404, 'Not found')
checkarg   = checkfunc(400, 'Invalid argument')
allow      = checkfunc(403, 'Not allowed')
check500   = checkfunc(500, 'Server error')

function check_etag(s)
	if not method'get' then return s end
	if out_buffering() then return s end
	local etag = xxhash.hash128(s):hex()
	local etags = headers'if-none-match'
	if etags and type(etags) == 'table' then
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
	cx.res.close = true
end

--json API -------------------------------------------------------------------

cjson.encode_sparse_array(false, 0, 0) --encode all sparse arrays.
cjson.encode_empty_table_as_object(false) --encode empty tables as arrays.

null = cjson.null

--TODO: add option to cjson to avoid this crap.
local function repl_nulls(t, null_val)
	if type(t) == 'table' then
		for k,v in pairs(t) do
			if v == null then
				v = null_val
			elseif type(v) == 'table' then
				repl_nulls(v, null_val)
			end
		end
	end
	return t
end

function json_arg(v, null_val)
	if type(v) ~= 'string' then return v end
	return repl_nulls(cjson.decode(v), null_val)
end

function json(v, indent)
	if v == nil then return nil end
	if indent and indent ~= '' then
		return prettycjson(v, nil, indent)
	else
		return cjson.encode(v)
	end
end

function out_json(v)
	setmime'json'
	outall(json(v))
end

--filesystem API -------------------------------------------------------------

function readfile(file, parse)
	parse = parse or glue.pass
	local s, err = glue.readfile(file)
	if not s then return nil, err end
	return parse(s)
end

do
local cache = {} --{file -> {mtime=, contents=}}
function readfile_cached(file, parse)
	local cached = cache[file]
	local mtime = fs.attr(file, 'mtime')
	if not mtime then --file was removed
		cache[file] = nil
		return nil, 'not_found'
	end
	local s
	if not cached or cached.mtime < mtime then
		s = readfile(file, parse)
		cache[file] = {mtime = mtime, contents = s}
	else
		s = cached.contents
	end
	return s
end
end

local function wwwdir()
	return config'www_dir'
		or config('www_dir', indir(config'app_dir', 'www'))
end

local function libwwwdir()
	return config'libwww_dir'
		or config('libwww_dir', indir(config'app_dir', 'sdk', 'www'))
end

local function vardir()
	return config'var_dir'
		or config('var_dir', indir(config'app_dir', 'var'))
end

local function tmpdir()
	return config'tmp_dir'
		or config('tmp_dir', indir(config'app_dir', 'tmp'))
end

function tmppath(patt, t)
	assert(not patt:find'[\\/]') --no subdirs
	mkdir(tmpdir(), true)
	t = t or {}
	t.request_id = cx.request_id
	local file = glue.subst(patt, t)
	return path.abs(tmpdir(), file)
end

function wwwpath(file, type)
	assert(file)
	if file:find('..', 1, true) then return end --TODO: use path module for this
	--look into www dir
	local abs_path = indir(wwwdir(), file)
	if fs.is(abs_path, type) then return abs_path end
	--look into the "lib" www dir
	local abs_path = libwwwdir() and indir(libwwwdir(), file)
	if abs_path and fs.is(abs_path, type) then return abs_path end
	return nil, file..' not found'
end

function varpath(file) return indir(vardir(), file) end

local function file_object(findfile, readfile) --{filename -> content | handler(filename)}
	return setmetatable({}, {
		__call = function(self, file, parse)
			local f = self[file]
			if type(f) == 'function' then
				return f()
			elseif f then
				return f
			else
				local file = findfile(file)
				return file and readfile(file, parse)
			end
		end,
	})
end
wwwfile        = file_object(wwwpath, readfile)
wwwfile_cached = file_object(wwwpath, readfile_cached)
varfile        = file_object(varpath, readfile)
varfile_cached = file_object(varpath, readfile_cached)

function wwwfiles(filter)
	if type(filter) == 'string' then
		local patt = filter
		filter = function(s) return s:find(patt) end
	end
	filter = filter or glue.pass
	local t = {}
	for name in pairs(wwwfile) do
		if filter(name) then
			t[name] = true
		end
	end
	for name, d in fs.dir(wwwdir()) do
		if not name then
			break
		end
		if not t[name] and d:is'file' and filter(name) then
			t[name] = true
		end
	end
	for name, d in fs.dir(libwwwdir()) do
		if not name then
			break
		end
		if not t[name] and d:is'file' and filter(name) then
			t[name] = true
		end
	end
	return t
end

--mustache html templates ----------------------------------------------------

local function underscores(name)
	return name:gsub('-', '_')
end

function render_string(s, data, partials)
	return (mustache.render(s, data, partials))
end

function render_file(file, data, partials)
	return render_string(wwwfile(file), data, partials)
end

function mustache_wrap(s, name)
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
	for i,file in ipairs(glue.keys(wwwfiles'%.html%.mu$')) do
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
	for i,file in ipairs(glue.keys(wwwfiles'%.html')) do
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
		local s = assertf(template[name], 'template not found: %s', name)
		if type(s) == 'function' then --template getter/generator
			s = s()
		end
		return s
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
		setfenv(f, _env or webb.env())
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
		setfenv(f, env_ or webb.env())
		return f(...)
	end
end

local compile_lua = memoize(function(file)
	return compile_lua_string(wwwfile(file), file)
end)

function run_string(s, env, ...)
	return compile_lua_string(s)(env, ...)
end

function run(file, env, ...)
	return compile_lua(file)(env, ...)
end

--html filters ---------------------------------------------------------------

function filter_lang(s, lang)

	local lang0 = lang

	if config('lang_filter', false) == 'explicit' then

		local function repl_lang(lang)
			if lang ~= lang0 then return '' end
			return false
		end

		--replace <t lang=LANG> which can also be hidden via CSS with this syntax.
		s = s:gsub('<t%s+lang=(%w%w).->.-</t>', repl_lang)

		--replace attr:LANG="TEXT" and attr:LANG=TEXT
		s = s:gsub('%s[%w_%:%-]+%:(%a%a)=%b""'   , repl_lang)
		s = s:gsub('%s[%w_%:%-]+%:(%a%a)=[^%s>]*', repl_lang)

	end

	--replace `<t s=ID>EN_S</t>` with `S(ID, EN_S)`.
	s = s:gsub('<t%s+s=([%w_%-]+).->(.-)</t>', function(id, en_s)
		return S_for('html', id, en_s)
	end)

	--replace attr:s:ID="EN_S" and attr:s:ID=EN_S
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

function filter_comments(s)
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
				local mtime = fs.attr(path, 'mtime')
				add(t, tostring(mtime))
				add(c, function() outfile(path) end)
			elseif action then --file not found, try an action
				local s, found = record(exec, file, ...)
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

--mail sending ---------------------------------------------------------------

local function strip_name(email)
	return email:match'<(.-)>' or email
end
function sendmail(opt)

	local smtp = require'smtp'
	local multipart = require'multipart'

	local smtp = check500(smtp:connect{
		logging = true,
		debug = config'smtp_debug' and index(names(config'smtp_debug' or '')),
		host  = config('smtp_host', '127.0.0.1'),
		port  = config('smtp_port', 587), --TODO: 465
		tls   = config('smtp_tls', false), --TODO: true
		user  = config'smtp_user',
		pass  = config'smtp_pass',
		tls_options = {
			ca_file = config('ca_file', varpath'cacert.pem'),
			loadfile = glue.readfile,
		},
	})

	local req = update({}, opt)
	req.from = strip_name(opt.from)
	req.to = strip_name(opt.to)
	req = multipart.mail(req)

	check500(smtp:sendmail(req))
	check500(smtp:close())
end

--image processing -----------------------------------------------------------

function resize_image(src_path, dst_path, max_w, max_h)

	glue.fcall(function(finally, except)

		local src_ext = path.ext(src_path)
		local dst_ext = path.ext(dst_path)
		assert(src_ext == 'jpg' or src_ext == 'jpeg' or src_ext == 'png')
		assert(dst_ext == 'jpg' or dst_ext == 'jpeg' or dst_ext == 'png')

		--decode.
		local bmp do
			local f = assert(fs.open(src_path, 'r'), 'not_found')
			finally(function() f:close() end)

			if src_ext == 'jpg' or src_ext == 'jpeg' then

				local libjpeg = require'libjpeg'

				local read = f:buffered_read()
				local img = assert(libjpeg.open{read = read})
				finally(function() img:free() end)

				local w, h = box2d.fit(img.w, img.h, max_w, max_h)
				local sn = math.ceil(glue.clamp(math.max(w / img.w, h / img.h) * 8, 1, 8))
				bmp = assert(img:load{
					accept = {rgba8 = true},
					scale_num = sn,
					scale_denom = 8,
				})

			elseif src_ext == 'png' then

				local libspng = require'libspng'
				error'NYI'

			end
		end

		--scale down, if necessary.
		local w, h = box2d.fit(bmp.w, bmp.h, max_w, max_h)
		if w < bmp.w or h < bmp.h then

			webb.note('webb', 'resize', '%s %d,%d -> %d,%d %d%%', path.file(src_path),
				bmp.w, bmp.h, w, h, w / bmp.w * 100)

			local pil = require'pillow'

			local src_img = pil.image(bmp)
			local dst_img = src_img:resize(w, h)
			src_img:free()
			bmp = dst_img:bitmap()
			finally(function() dst_img:free() end)

		end

		--encode back.
		local write_protected = assert(fs.saver(dst_path))
		except(function() write_protected(fs.abort) end)
		local function write(buf, sz)
			return assert(write_protected(buf, sz))
		end
		if dst_ext == 'jpg' or dst_ext == 'jpeg' then

			local libjpeg = require'libjpeg'

			assert(libjpeg.save{
				bitmap = bmp,
				write = write,
				quality = 90,
			})

		elseif dst_ext == 'png' then

			local libspng = require'libspng'
			error'NYI'

		end
		write()

	end)

end

function base64_image_src(s)
	return s and 'data:image/png;base64, '..b64(s)
end

--webb.server respond function -----------------------------------------------

local next_request_id = 1

function webb.respond(req)
	webb.setcx(req.thread, {req = req, res = {headers = {}}, request_id = next_request_id})
	next_request_id = next_request_id + 1
	webb.note('webb', 'request', '%s %s', req.method, uri.unescape(req.uri))
	local main = assert(config('main_module', config'app_name'))
	local main = type(main) == 'string' and require(main) or main
	if type(main) == 'table' then
		main = main.respond
	end
	main()
end

function webb.request_finish()
	local f = cx.request_finish
	if f then f() end
	webb.setcx(cx.req.thread, nil)
end

function onrequestfinish(f)
	glue.after(cx, 'request_finish', f)
end

--standalone operation -------------------------------------------------------

function webb.run(f, ...)
	if cx then
		return f(...)
	end
	local tcp = {}
	tcp.istlssocket = true
	local http = {tcp = tcp}
	local req = {http = http, uri = '/'}
	req.headers = {}
	local cx = {req = req, res = {}, fake = true, request_id = next_request_id}
	next_request_id = next_request_id + 1
	function http:log(...)
		log(...)
	end
	local thread = coroutine.running()
	function cx.outfunc(s, sz)
		if type(s) == 'cdata' then
			s = ffi.string(s, sz)
		end
		io.stdout:write(s)
		io.stdout:flush()
	end
	function req:raise(status, content)
		local err
		if type(status) == 'number' then
			err = {status = status, content = content}
		elseif type(status) == 'table' then
			err = status
		else
			assert(false)
		end
		print('http_error', err.status, err.content)
		os.exit(1)
	end
	webb.setcx(thread, cx)
	local function pass(...)
		webb.setcx(thread, nil)
		return ...
	end
	return pass(sock.run(f, ...))
end

function webb.request(...)
	require'webb_action'
	webb.run(function(arg1, ...)
		local req = type(arg1) == 'table' and arg1 or {args = {arg1,...}}
		cx.req.method = req.method or 'get'
		cx.req.uri = req.uri or concat(glue.imap(glue.pack('', arg1, ...), tostring), '/')
		update(cx.req.headers, req.headers)
		function req.respond(req, res)
			assert(not res.want_out_function)
			if res.content then
				out(res.content)
			end
		end
		checkfound(action(unpack(args())))
	end, ...)
end

--pre-configured http app server ---------------------------------------------

function webb.server(opt)
	local server = require'http_server'
	local host       = config('host', 'localhost')
	local http_addr  = config('http_addr', '*')
	local https_addr = config('https_addr', '*')
	local crt_file = config'https_crt_file' or varpath(host..'.crt')
	local key_file = config'https_key_file' or varpath(host..'.key')
	if https_addr and host == 'localhost'
		and not config'https_crt_file'
		and not config'https_key_file'
		and not exists(crt_file)
		and not exists(key_file)
	then
		crt_file = indir(config'app_dir', 'sdk', 'tests', 'localhost.crt')
		key_file = indir(config'app_dir', 'sdk', 'tests', 'localhost.key')
	end
	return server:new(update({
		libs = 'zlib sock '..(config'https_addr' and 'sock_libtls' or ''),
		debug = config'http_debug' and index(names(config'http_debug' or '')),
		listen = {
			{
				host = host,
				addr = https_addr,
				port = config'https_port',
				tls = true,
				tls_options = {
					cert_file = crt_file,
					key_file  = key_file,
				},
			},
			{
				host = host,
				addr = http_addr,
				port = config'http_port',
			},
		},
		respond = webb.respond,
		request_finish = webb.request_finish,
	}, opt))
end

if not ... then

	--because we're gonna load `webb_action` which loads back `webb`.
	package.loaded.webb = true

	config('app_name', 'test')
	webb.request('')

end

return webb
