
--MySQL result pretty printing.
--Written by Cosmin Apreutesei. Public Domain.

local null = require'cjson'.null
local cat = table.concat

local function ellipsis(s,n)
	return #s > n and (s:sub(1,n-3) .. '...') or s
end

local align = {}

function align.left(s,n)
	s = s..(' '):rep(n - #s)
	return ellipsis(s,n)
end

function align.right(s,n)
	s = (' '):rep(n - #s)..s
	return ellipsis(s,n)
end

function align.center(s,n)
	local total = n - #s
	local left = math.floor(total / 2)
	local right = math.ceil(total / 2)
	s = (' '):rep(left)..s..(' '):rep(right)
	return ellipsis(s,n)
end

local function fit(s,n,al)
	return align[al or 'left'](s,n)
end

local function print_table(opt)
	local rows    = opt.rows
	local cols    = opt.cols
	local aligns  = opt.aligns
	local minsize = opt.minsize or 0
	local sumdefs = opt.sums
	local print   = opt.print or _G.print
	local null    = opt.null

	local max_sizes = {}
	for j=1,#cols do
		max_sizes[j] = math.max(max_sizes[j] or minsize,
			#cols[j], sd and #sd[1] or 0, sd and #sd[2] or 0)
	end
	for i=1,#rows do
		for j=1,#cols do
			max_sizes[j] = math.max(max_sizes[j], #rows[i][j])
		end
	end

	local function fits(j, s)
		return fit(s, max_sizes[j], aligns and aligns[j]) .. ' | '
	end

	local function hr(j)
		return ('-'):rep(max_sizes[j]) .. ' + '
	end

	print()
	local t, p = {}, {}
	for j=1,#cols do
		t[j] = fits(j, cols[j])
		p[j] = hr(j)
	end
	print(cat(t))
	print(cat(p))

	local t = {}
	for i=1,#rows do
		local s = ''
		for j=1,#cols do
			t[j] = fits(j, rows[i][j])
		end
		print(cat(t))
	end

	if sumdefs then
		local sums, sumops, p = {}, {}, {}
		for j=1,#cols do
			local sd = sumdefs[cols[j]]
			p[j] = hr(j)
			sumops[j] = fits(j, sd and sd[1] or '')
			sums  [j] = fits(j, sd and sd[2] or '')
		end
		print(cat(p))
		print(cat(sumops))
		print(cat(sums))
		print(cat(p))
	end

	print()
end

local function invert_table(cols, rows, minsize)
	local ft, rt = {'field'}, {}
	for i=1,#rows do
		ft[i+1] = tostring(i)
	end
	for j=1,#cols do
		local row = {cols[j]}
		for i=1,#rows do
			row[i+1] = rows[i][j]
		end
		rt[j] = row
	end
	return ft, rt
end

local function format_cell(v, field, null)
	if v == null or v == nil then
		return null
	elseif field.to_text then
		return field.to_text(v, field)
	else
		return tostring(v)
	end
end

local function cell_align(current_align, cell_value, field)
	if field and field.align then return field.align end
	if current_align == 'left' then return 'left' end
	if type(cell_value) == 'number' or type(cell_value) == 'cdata' then return 'right' end
	return 'left'
end

function print_result(opt)
	local rows    = opt.rows
	local fields  = opt.fields
	local minsize = opt.minsize
	local sums    = opt.sums
	local null    = opt.null or ''

	local cols = {}
	local colindex = {}
	for i, field in ipairs(fields) do
		cols[i] = field.name
		colindex[field.name] = i
	end

	local textrows = {}
	local aligns = {}
	for i,row in ipairs(rows) do
		local t = {}
		for j=1,#cols do
			t[j] = format_cell(row[j], fields[j], null)
			aligns[j] = cell_align(aligns[j], row[j], fields[j])
		end
		textrows[i] = t
	end

	local sumdefs
	if opt.sums then
		sumdefs = {}
		local function to_number(s) return tonumber(s) end
		local function from_number(n) return tostring(n) end
		for col, op in pairs(opt.sums) do
			local n
			local j = colindex[col]
			local field = fields[j]
			if not field then error('sum col not found: '..col) end
			local to_number   = field.to_number   or to_number
			local from_number = field.from_number or from_number
			for i,row in ipairs(rows) do
				local v = row[j]
				if v ~= nil then
					local x = to_number(v, field)
					if op == 'sum' or op == 'avg' then
						n = (n or 0) + x
					elseif op == 'min' then
						n = math.min(n or 1/0, x)
					elseif op == 'max' then
						n = math.max(n or -1/0, x)
					end
				end
			end
			local v
			if n then
				if op == 'avg' then
					n = n / #rows
				end
				v = from_number(n, field)
			end
			sumdefs[col] = {op, format_cell(v, field, null)}
		end
	end

	print_table{
		rows = textrows, cols = cols, aligns = aligns,
		minsize = minsize, sums = sumdefs, print = opt.print,
	}
end

return {
	fit = fit,
	format_cell = format_cell,
	cell_align = cell_align,
	table = print_table,
	result = print_result,
}
