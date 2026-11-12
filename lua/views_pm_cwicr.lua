
-- Import the CWICR cost database into the views_pm work item tables.
--	Written by Cosmin Apreutesei. Public Domain.

require'views_pm'
require'json'

local levels = {'category', 'collection', 'department', 'section',
	'subsection'} -- CWICR classification levels, root first

--units ---------------------------------------------------------------------

local measure_units = {m = true, m2 = true, m3 = true, t = true, kg = true,
	km = true, ha = true, l = true, h = true} -- {unit -> true}
local unit_synonyms = {bucat = 'buc', ['bucăți'] = 'buc',
	['buc.'] = 'buc'} -- {unit -> unit}

-- `100 M2` -> 100, 'm2'. A text that starts with a measure unit gets that
-- unit: `m3 de pământ` -> 1, 'm3'. A text longer than max_len bytes or
-- that is no unit returns nothing.
local function parse_unit(s, max_len)
	s = s:lower():gsub('²', '2'):gsub('³', '3')
	local mult, rest = s:match'^(%d+)%s*(.-)%s*$'
	if not mult then
		mult, rest = 1, s:trim()
	end
	local first = rest:match'^(%S+)%s'
	if measure_units[first] then
		rest = first
	end
	rest = unit_synonyms[rest] or rest:gsub('^de ', '')
	if rest == '' or #rest > max_len then return end
	return tonumber(mult), rest
end

--import --------------------------------------------------------------------

cmd('import-cwicr', 'Import a CWICR export (see demo/cwicr_export.sql)',
function(opt, file)

	local max_len -- max bytes of a unit
	local unit_seen = {} -- {unit -> true}
	local folder_ids = {} -- {parent_id..'\0'..name -> folder_id}
	local resource_ids = {} -- {code..'\0'..name..'\0'..unit -> resource_id}
	local n_items = 0 -- items read
	local n_comps = 0 -- wi_comp rows added
	local n_dropped = 0 -- items dropped for having no unit
	local dropped_units = {} -- {unit text -> n items}

	local function add_unit(unit)
		if unit_seen[unit] then return end
		unit_seen[unit] = true
		db():insert('unit', '{}', {unit = unit})
	end

	local function folder_id(parent_id, name)
		local key = (parent_id or 0)..'\0'..name
		local id = folder_ids[key]
		if not id then
			id = db():insert('folder', '{}', {name = name, parent = parent_id})
			folder_ids[key] = id
		end
		return id
	end

	-- one resource per (code, name, unit): CWICR reuses a code for
	-- different resources, and each (code, name, unit) has a single rate.
	local function resource_id(c, currency)
		local key = c.code..'\0'..c.name..'\0'..c.unit
		local id = resource_ids[key]
		if not id then
			local _, unit = parse_unit(c.unit, max_len)
			if unit then add_unit(unit) end
			id = db():insert('resource', '{}', {
				name = c.name,
				code = c.code,
				type = c.type,
				unit = unit,
				unit_cost = tonumber(c.rate),
				currency = currency,
			})
			resource_ids[key] = id
		end
		return id
	end

	db():atomic('w', function()
		max_len = db():table_schema'unit'.fields.unit.maxlen

		for line in io.lines(file) do
			local item = json_decode(line)
			n_items = n_items + 1

			local mult, unit = parse_unit(item.unit, max_len)
			if not unit then
				n_dropped = n_dropped + 1
				dropped_units[item.unit] = (dropped_units[item.unit] or 0) + 1
				goto continue
			end
			add_unit(unit)

			local leaf_id
			for _, level in ipairs(levels) do
				local name = item.cls[level]
				if name then
					leaf_id = folder_id(leaf_id, name)
				end
			end

			local wi_id = db():insert('wi', '{}', {
				name = item.name,
				code = item.code,
				unit = unit,
				folder = leaf_id,
			})

			-- a resource listed twice in an item has one rate: sum the
			-- quantities, per unit of the item.
			local qtys = {} -- {resource_id -> qty}
			local ids = {} -- {resource_id,...} in first-seen order
			for _, c in ipairs(item.comps) do
				local id = resource_id(c, item.currency)
				if not qtys[id] then
					qtys[id] = 0
					add(ids, id)
				end
				qtys[id] = qtys[id] + tonumber(c.qty) / mult
			end
			for _, id in ipairs(ids) do
				db():insert('wi_comp', '{}', {
					wi = wi_id, resource = id, qty = qtys[id],
				})
				n_comps = n_comps + 1
			end

			::continue::
		end
		assertf(n_dropped * 10 < n_items,
			'%d of %d items have no usable unit', n_dropped, n_items)
	end)

	pr('items read     ', n_items)
	pr('items dropped  ', n_dropped)
	pr('units          ', count(unit_seen))
	pr('folders        ', count(folder_ids))
	pr('resources      ', count(resource_ids))
	pr('wi_comp rows   ', n_comps)
	for unit, n in pairs(dropped_units) do
		pr('dropped unit   ', unit, n)
	end
end)
