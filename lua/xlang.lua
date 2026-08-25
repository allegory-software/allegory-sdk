--[==[

	webb | language/country/currency rowsets
	Written by Cosmin Apreutesei. Public Domain.

API

	update_S_schema_texts()

ROWSETS

	S                  translation UI: labeled strings from source code
	S_schema_attrs     translation UI: list translatable field attributes
	S_schema_fields    translation UI: translate schema & rowset fields
	lang               used for setting supported languages
	pick_lang          used for choosing the current language

]==]

if os.getenv'AUTO' then return end

require'lang'
require'xrowset_sql'

local text_in_english          = Sf('text_in_english', 'Text in English')
local text_in_current_language = Sf('text_in_current_language', 'Text in Current Language')

--S translation rowset -------------------------------------------------------

local load_s_ids = memoize(function()

	--load html templates and scan them for S-ids.
	for _,name in ipairs(template()) do
		S_ids_add_html('template_'..name, template(name))
	end

	--scan Lua searchpath for Lua files and scan them for S-ids.
	local tsep = package.config:sub(3,3) --';'
	local wild = package.config:sub(5,5) --'?'
	local psep = package.config:sub(1,1) --'/'
	for patt in package.path:gmatch('[^'..esc(tsep)..']+') do
		local path = patt:gsub(esc(psep)..esc(wild)..'.*$', '')
		for sc in scandir(path, function(sc)
			return sc:name() ~= 'www' and sc:name() ~= 'var'
		end) do
			local name = sc:name()
			if sc:is'file' and path_ext(name) == 'lua' then
				S_ids_add_lua(sc:relpath(), load(sc:path()))
			end
		end
	end

	--scan www paths for HTML, JS and Lua files.
	for sc in scandir({wwwdir(), libwwwdir()}) do
		local name = sc:name()
		local ext = path_ext(name)
		if ext == 'html' then
			S_ids_add_html(sc:relpath(), load(sc:path()))
		elseif ext == 'js' then
			S_ids_add_js(sc:relpath(), load(sc:path()))
		elseif ext == 'lua' then
			S_ids_add_lua(sc:relpath(), load(sc:path()))
		end
	end

	--scan virtual www paths for the same.
	for file,s in pairs(wwwfile) do
		s = call(s)
		local ext = path_ext(file)
		if ext == 'html' then
			S_ids_add_html(file, s)
		elseif ext == 'js' then
			S_ids_add_js(file, s)
		elseif ext == 'lua' then
			S_ids_add_lua(file, s)
		end
	end

	--scan schema for field texts and info texts.
	local function add_row(texts, tbl_type, tbl_name, fld, col, attr)
		local text = texts[tbl_type..'.'..tbl_name..'.'..col]
		add(rs.rows, {tbl_type, tbl_name, col, attr, en_text, text})
	end
	local field_names = {}
	--kind is both the file that the id is grouped under and the id's suffix.
	local function add_ids(attr, id_name, en_text, kind, container)
		S_ids_add_id('lua', 'field', _('%s:%s', attr, id_name), en_text)
		S_ids_add_id('lua', kind,
			_('%s:%s.%s.%s', attr, id_name, container, kind), en_text)
	end
	local function add_field_ids(fld, id_name, kind, container)
		for i, attr in ipairs{'label', 'info'} do
			add_ids(attr, id_name, call(fld['en_'..attr]), kind, container)
		end
		for v, en_text in sortedpairs(fld.en_enum_labels or empty) do
			add_ids('enum_label', id_name..'.'..v, en_text, kind, container)
		end
	end
	for tbl_name, tbl in sortedpairs(config'db_schema'.tables) do
		for i, fld in ipairs(tbl.fields) do
			add_field_ids(fld, fld.col, 'table', tbl_name)
		end
	end
	for rs_name, rs in sortedpairs(rowset) do
		for i, fld in ipairs(rs.fields or empty) do
			add_field_ids(fld, fld.name, 'rowset', rs_name)
		end
	end

end)

rowset.S = virtual_rowset(function(self, ...)

	self.allow = 'admin'

	self.fields = {
		{name = 'ext'       , readonly = true , },
		{name = 'id'        , readonly = true , },
		{name = 'en_text'   , readonly = true , label = text_in_english},
		{name = 'text'      , readonly = false, label = text_in_current_language},
		{name = 'files'     , readonly = true , },
	}
	self.pk = 'ext id'
	self.cols = 'id en_text text'
	function self:load_rows(rs, params)
		load_s_ids()
		rs.rows = {}
		local lang = lang()
		for ext_id, t in sortedpairs(S_ids) do
			local ext, id = ext_id:match'^(.-):(.*)$'
			local s = S_texts(lang, ext)[id]
			add(rs.rows, {ext, id, t.en_s, s, cat(keys(t.files, true), ', ')})
		end
	end

	local function update_key(vals)
		local ext  = checkarg(json_str_arg(vals['ext:old']))
		local id   = checkarg(json_str_arg(vals['id:old']))
		local lang = checkarg(json_str_arg(vals['param:lang']))
		return ext, id, lang
	end

	function self:update_row(vals)
		local ext, id, lang = update_key(vals)
		local text = json_str_arg(vals.text)
		S_texts_update(lang, ext, id, text)
	end
	local apply_changes = self.apply_changes
	function self:apply_changes(...)
		local res = apply_changes(self, ...)
		S_texts_save()
		return res
	end

	function self:load_row(vals)
		local ext, id, lang = update_key(vals)
		local t = S_ids[ext..':'..id]
		if not t then return end
		local s = S_texts(lang, ext)[id]
		return {ext, id, t.en_s, s, cat(keys(t.files, true), ', ')}
	end

end)

--lang picker rowset ---------------------------------------------------------

rowset.lang = sql_rowset{
	allow = 'admin',
	select = [[
		select
			lang,
			en_name,
			name,
			supported
		from lang
		]],
	pk = 'lang',
	field_attrs = {
		lang    = {w = 40, readonly = true},
		en_name = {readonly = true},
		name    = {readonly = true},
	},
	update_row = function(self, row)
		update_row('lang', row, 'supported')
	end,
}

rowset.pick_lang = sql_rowset{
	select = [[
		select
			lang,
			concat(name, ' (', en_name, ')') as name
		from lang
		]],
	where_all = 'supported = 1',
	pk = 'lang',
}
