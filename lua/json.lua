--[==[

	JSON encoding and decoding API.
	Written by Cosmin Apreutesei. Public Domain.

	[try_]json_decode(s[, null_val]) -> v   decode JSON
	json_encode(v[, indent]) -> s       encode JSON
	null                                value to encode/decode json `null`
	json_asarray(t) -> t                mark t to be encoded as a json array
	json_pack(...) -> t                 like pack() but nils become null
	json_unpack(t) -> ...               like unpack() but nulls become nil

]==]

local cjson      = require'cjson'.new()
local cjson_safe = require'cjson.safe'.new()

cjson.encode_sparse_array(false, 0, 0) --encode all sparse arrays.
cjson.encode_empty_table_as_object(false) --encode empty tables as arrays.
cjson_safe.encode_sparse_array(false, 0, 0) --encode all sparse arrays.
cjson_safe.encode_empty_table_as_object(false) --encode empty tables as arrays.

null = cjson.null

local
	type, select, pairs, unpack =
	type, select, pairs, unpack

function json_asarray(t)
	return setmetatable(t or {}, cjson.array_mt)
end

function json_pack(...)
	local t = json_array{...}
	for i=1,select('#',...) do
		if t[i] == nil then
			t[i] = null
		end
	end
	return t
end

function json_unpack(t)
	local dt = {}
	for i=1,#t do
		if t[i] == null then
			dt[i] = nil
		else
			dt[i] = t[i]
		end
	end
	return unpack(dt, 1, #t)
end

local function repl_nulls_t(t, null_val)
	if null_val == nil and t[1] ~= nil then --array
		local n = #t
		for i=1,n do
			if t[i] == null then --sparse
				t[i] = nil
				t.n = n
			elseif type(t[i]) == 'table' then
				repl_nulls_t(t[i], nil)
			end
		end
	else
		for k,v in pairs(t) do
			if v == null then
				t[k] = null_val
			elseif type(v) == 'table' then
				repl_nulls_t(v, null_val)
			end
		end
	end
	return t
end
local function repl_nulls(v, null_val)
	if null_val == null then return v end
	if type(v) == 'table' then
		return repl_nulls_t(v)
	elseif v == null then
		return null_val
	else
		return v
	end
end

function json_decode(v, null_val)
	if type(v) ~= 'string' then return v end
	return repl_nulls(cjson.decode(v), null_val)
end

function try_json_decode(v, null_val)
	if type(v) ~= 'string' then return v end
	local v, err = cjson_safe.decode(v)
	if v == nil then return nil, err end
	return repl_nulls(v, null_val)
end

--prettycjson 1.5 from https://github.com/bungle/lua-resty-prettycjson.
--Copyright (c) 2015 — 2016, Aapo Talvensaari. BSD license.
local rep = string.rep
local cat = table.concat
local function pretty(s, lf, id, ac)
	lf, id, ac = lf or '\n', id or '\t', ac or ' '
	local i, j, k, n, r, p, q  = 1, 0, 0, #s, {}, nil, nil
	local al = ac:sub(-1) == '\n'
	for x = 1, n do
		local c = s:sub(x, x)
		if not q and (c == '{' or c == '[') then
			r[i] = p == ':' and c..lf or rep(id, j)..c..lf
			j = j + 1
		elseif not q and (c == '}' or c == ']') then
			j = j - 1
			if p == '{' or p == '[' then
				i = i - 1
				r[i] = rep(id, j)..p..c
			else
				r[i] = lf..rep(id, j)..c
			end
		elseif not q and c == ',' then
			r[i] = c..lf
			k = -1
		elseif not q and c == ':' then
			r[i] = c..ac
			if al then
				i = i + 1
				r[i] = rep(id, j)
			end
		else
			if c == '\'' and p ~= '\\' then
				q = not q and true or nil
			end
			if j ~= k then
				r[i] = rep(id, j)
				i, k = i + 1, j
			end
			r[i] = c
		end
		p, i = c, i + 1
	end
	return cat(r)
end

function json_encode(v, indent)
	local s = cjson.encode(v)
	if indent and indent ~= '' then
		return pretty(s, nil, indent)
	else
		return s
	end
end
