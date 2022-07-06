--[==[

	webb | xapp language/country/currency setting UI
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

require'lang'
require'webb_spa'
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
		if isfunc(s) then
			s = s()
		end
		local ext = path_ext(file)
		if ext == 'html' then
			S_ids_add_html(file, s)
		elseif ext == 'js' then
			S_ids_add_js(file, s)
		elseif ext == 'lua' then
			S_ids_add_lua(file, s)
		end
	end

end)

rowset.S = virtual_rowset(function(self, ...)

	self.allow = 'admin'

	self.fields = {
		{name = 'ext'       , readonly = true , },
		{name = 'id'        , readonly = true , },
		{name = 'en_text'   , readonly = true , text = text_in_english},
		{name = 'text'      , readonly = false, text = text_in_current_language},
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

--S_schema_fields translation rowset -----------------------------------------

local function S_schema_file(lang, attr)
	return varpath(_('%s-s-%s-col-%s.lua', scriptname, lang, attr))
end

local function S_schema_texts(lang, attr)
	local file = S_schema_file(lang, attr)
	if not exists(file) then return {} end
	return eval_file(file)
end

local function save_S_schema_texts(lang, attr, t)
	save(S_schema_file(lang, attr), 'return '..pp(t, '\t'))
end

local ml_attrs --multi-language field attrs

rowset.S_schema_attrs = virtual_rowset(function(self, ...)

	self.allow = 'admin'

	self.fields = {
		{name = 'attr', },
		{name = 'info', hidden = true},
	}
	self.pk = 'attr'

	local rows = {
		{'text', Sf('field_attr_info_text', 'The name of field as it appears in grid headers')},
		{'info', Sf('field_attr_info_info', 'The long description of the field')},
	}
	function self:load_rows(rs)
		rs.rows = {}
		for i,row in ipairs(rows) do
			rs.rows[i] = {row[1], row[2]()}
		end
	end

	ml_attrs = imap(rows, 1)
	update(ml_attrs, index(ml_attrs))

end)

local function db_schema()
	return config('db_schema')
end

rowset.S_schema_fields = virtual_rowset(function(self, ...)

	self.allow = 'admin'

	self.fields = {
		{name = 'type'   , readonly = true , },
		{name = 'table'  , readonly = true , },
		{name = 'col'    , readonly = true , },
		{name = 'attr'   , readonly = true , },
		{name = 'en_text', readonly = true , text = text_in_english},
		{name = 'text'   , readonly = false, text = text_in_current_language},
	}

	self.pk = 'type table col attr'
	self.cols = 'type table col en_text text'
	function self:load_rows(rs, params)
		local attrs = params['param:filter']
		rs.rows = {}
		local function add_row(texts, tbl_type, tbl_name, fld, col, attr)
			local en_text = fld[attr]
			if isfunc(en_text) then --getter/generator
				en_text = en_text()
			end
			local text = texts[tbl_type..'.'..tbl_name..'.'..col]
			add(rs.rows, {tbl_type, tbl_name, col, attr, en_text, text})
		end
		for i,attr in ipairs(attrs) do
			local texts = S_schema_texts(lang(), attr)
			for tbl_name, tbl in sortedpairs(db_schema().tables) do
				for i, fld in ipairs(tbl.fields) do
					add_row(texts, 'table', tbl_name, fld, fld.col, attr)
				end
			end
			for rs_name, rs in sortedpairs(rowset) do
				if rs.client_fields then
					for i, fld in ipairs(rs.client_fields) do
						add_row(texts, 'rowset', rs_name, fld, fld.name, attr)
					end
				end
			end
		end
	end

	local function checkargs(vals)
		local typ  = checkarg(str_arg(vals['type:old']))
		local tbl  = checkarg(str_arg(vals['table:old']))
		local col  = checkarg(str_arg(vals['col:old']))
		local attr = checkarg(str_arg(vals['attr:old']))
		local text = str_arg(vals['text'])
		assert(ml_attrs[attr])
		local en_text =
			typ == 'table' and db_schema().tables[tbl].fields[col][attr]
			or typ == 'rowset' and rowset[tbl].fields[col][attr]
			or nil
		if isfunc(en_text) then --getter/generator
			en_text = en_text()
		end
		return typ, tbl, col, attr, text, en_text
	end

	function self:update_row(vals)
		local typ, tbl, col, attr, text = checkargs(vals)
		local texts = S_schema_texts(lang(), attr)
		texts[typ..'.'..tbl..'.'..col] = text
		save_S_schema_texts(lang(), attr, texts)
	end

	function self:load_row(vals)
		local typ, tbl, col, attr, text, en_text = checkargs(vals)
		local texts = S_schema_texts(lang(), attr)
		return {typ, tbl, col, attr, en_text, text}
	end

end)

local function S_col(tbl_col, attr)
	local texts = S_schema_texts(lang(), attr)
	return texts[tbl_col]
end

local function update_S_texts(tbl, fld, col, attr)
	local en_text = fld[attr]
	fld['en_'..attr] = en_text
	local tbl_col = tbl..'.'..col
	fld[attr] = function()
		local s = S_col(tbl_col, attr)
		if s then
			return s
		end
		s = en_text
		if isfunc(s) then
			s = s()
		end
		return s
	end
end

function update_S_schema_texts()
	local sc = db_schema()
	for _,attr in ipairs(ml_attrs) do
		for tbl_name, tbl in pairs(db_schema().tables) do
			for _,fld in ipairs(tbl.fields) do
				update_S_texts('table.'..tbl_name, fld, fld.col, attr)
			end
		end
		for rs_name, rs in pairs(rowset) do
			break
			if rs.client_fields then
				for _,fld in ipairs(rs.client_fields) do --virtual rowset
					update_S_texts('rowset.'..rs_name, fld, fld.name, attr)
				end
			end
		end
	end
end

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
