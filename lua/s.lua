--[==[

	WIP Basic internationalization module.
	Written by Cosmin Apreutesei. Public Domain.

API

	lang([k])                               get current lang or lang property
	setlang(lang)                           set current lang
	default_lang()                          get default lang

	country([k])                            get current country or country property
	setcountry(country, [if_not_set])       set current country
	default_country()                       get default country

	S(id, en_s, ...) -> s                   get Lua string in current language
	Sf(id, en_s) -> f(...) -> s             create a getter for a string in current language
	S_for(ext, id, en_s, ...) -> s          get Lua/JS/HTML string in current language

	texts(lang, ext) -> {id->s}             get translated strings (for updating)
	set_texts(lang, ext, t)                 set translated strings

STUBS

	langinfo[lang] -> {k->v}                language property table
	countryinfo[country] -> {k->v}          country property table
	get_current_lang() -> lang              get current lang
	set_current_lang(lang)                  set current lang
	get_current_country() -> country        get current country
	set_current_country(country)            set current country

	Sfile'file1 ...'                        register source code file
	Sfile_ids() -> {id->{file=,n=,en_s=}    parse source code files for S() calls

]==]

local M = {}

--current language & lang info -----------------------------------------------

M.langinfo = { --stub
	en = {
		rtl = false,
		en_name = 'English',
		name = 'English',
		decimal_separator = ',',
		thousands_separator = '.',
	},
}

function M.default_lang() return 'en' end --stub
local current_lang
function M.get_current_lang() return current_lang end --stub
function M.set_current_lang(lang) current_lang = lang end --stub

function M.lang(k)
	local lang = M.get_current_lang() or M.default_lang()
	if not k then return lang end
	local t = assert(M.langinfo[lang])
	local v = t[k]
	assert(v ~= nil)
	return v
end

function M.setlang(lang)
	if not lang or not M.langinfo[lang] then return end --missing/invalid: ignore.
	M.set_current_lang(lang)
end

--current country & country info ---------------------------------------------

webb.countryinfo = { --stub
	US = {
		lang = 'en',
		currency = 'USD',
		imperial_system = true,
		week_start_offset = 0,
		en_name = 'United States',
	},
}

function M.default_country() return 'US' end --stub
local current_country
function M.get_current_country() return return current_country end --stub
function M.set_current_country(country) current_country = country end --stub

function country(k)
	local country = M.get_current_country() or M.default_country()
	if not k then return country end
	local t = assert(M.countryinfo[country])
	local v = t[k]
	assert(v ~= nil)
	return v
end

function setcountry(country)
	if not country or not M.countryinfo[country] then return end --missing/invalid: ignore
	M.set_current_country(country)
end

--multi-language strings in source code --------------------------------------

local files = {}
local ids --{id->{files=,n=,en_s}}

function M.Sfile(filenames)
	update(files, index(words(filenames)))
	ids = nil
end

function M.Sfile_template(ids, file, s)

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
function M.texts(lang, ext)
	local f = loadfile(s_file(lang, ext))
	return f and f() or {}
end

local function save_S_texts(lang, ext, t)
	save(s_file(lang, ext), 'return '..pp.format(t, '\t'))
end

local function S_for(ext, id, en_s, ...)
	local lang = M.lang()
	local t = M.texts(lang, ext)
	local s = t[id]
	if not s then
		local dlang = M.default_lang()
		if dlang ~= 'en' and dlang ~= lang then
			s = M.texts(dlang, ext)
		end
	end
	s = s or en_s or ''
	if select('#', ...) > 0 then
		return glue.subst(s, ...)
	else
		return s
	end
end

local function S(...)
	return S_for('lua', ...)
end

local function Sf(id, en_s)
	return function(...)
		return S_for('lua', id, en_s, ...)
	end
end

M.S_for = S_for
M.S = S
M.Sf = Sf

return M
