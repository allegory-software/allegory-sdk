--[==[

	webb | x-module.js persistence

ROWSETS

	rowset.rowsets

ACTIONS

	xmodule_next_id
	xmodule_layer.json
	sql_rowset.json

CALLS

	xmodule_layer_file(layer)
	xmodule_layer(layer)

]==]

require'xrowset'
require'webb_action'

local path = require'path'
local fs = require'fs'
local _ = string.format

--rowsets --------------------------------------------------------------------

rowset.rowsets = virtual_rowset(function(rs)
	rs.fields = {
		{name = 'name'}
	}
	rs.pk = 'name'
	function rs:select_rows(res, params)
		res.rows = {}
		for name, rs in sortedpairs(rowset) do
			add(res.rows, {name})
		end
	end
end)

--xmodule --------------------------------------------------------------------

function xmodule_layer_file(layer)
	return varpath(_('xm-%s.json', layer))
end

function xmodule_layer(layer)
	local s = readfile(xmodule_layer_file(layer))
	return s and json(s)
end

function action.xmodule_next_id(module)
	local file = varpath(_('x-%s-next-id', module))
	local id = tonumber(assert(readfile(file) or '1'))
	if method'post' then
		save(file, tostring(id + 1))
	end
	setmime'txt'
	outall(module..id)
end

action['xmodule_layer.json'] = function(layer)
	layer = checkarg(str_arg(layer))
	checkarg(layer:find'^[%w_%-]+$')
	local file = xmodule_layer_file(layer)
	if method'post' then
		save(file, json(post(), '\t'))
	else
		outall(readfile(file) or '{}')
	end
end

action['sql_rowset.json'] = function(id, ...)
	local module = checkarg(id:match'^[^_%d]+')
	local layer = checkarg(xmodule_layer(_('%s-server', module)))
	local t = checkfound(layer[id])
	local rs = {}
	for k,v in pairs(t) do
		if k:starts'sql_' then
			rs[k:sub(5)] = v
		end
	end
	outall(sql_rowset(rs):respond())
end
