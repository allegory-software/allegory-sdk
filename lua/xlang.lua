--[==[

	webb | xapp language/country/currency setting UI
	Written by Cosmin Apreutesei. Public Domain.

ROWSETS

	S                  used by translation UIs
	lang               used by the language chooser

]==]

require'webb_lang'
require'webb_spa'
require'xrowset_sql'

--S translation rowset -------------------------------------------------------

rowset.S = virtual_rowset(function(self, ...)

	self.fields = {
		{name = 'ext'},
		{name = 'id'},
		{name = 'en_text'},
		{name = 'text'},
		{name = 'files'},
		{name = 'occurences', type = 'number', max_w = 30},
	}
	self.pk = 'ext id'
	self.cols = 'id en_text text'
	function self:load_rows(rs, params)
		rs.rows = {}
		local lang = lang()
		for ext_id, t in pairs(Sfile_ids()) do
			local ext, id = ext_id:match'^(.-):(.*)$'
			local s = S_texts(lang, ext)[id]
			add(rs.rows, {ext, id, t.en_s, s, t.files, t.n})
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
		update_S_texts(lang, ext, {[id] = text or false})
	end

	function self:load_row(vals)
		local ext, id, lang = update_key(vals)
		local t = Sfile_ids()[ext..':'..id]
		if not t then return end
		local s = S_texts(lang, ext)[id]
		return {ext, id, t.en_s, s, t.files, t.n}
	end

end)

--lang picker rowset ---------------------------------------------------------

rowset.lang = sql_rowset{
	select = [[
		select
			lang,
			name
		from lang
	]],
	pk = 'lang',
}
