--[==[

	JSON encoding and decoding API.
	Written by Cosmin Apreutesei. Public Domain.

	json.decode(s[, null_val]) -> t     decode JSON
	json.encode(t) -> s                 encode JSON
	json.null                           value to encode json `null`
	json.asarray(t) -> t                mark t to be encoded as a json array
	json.pack(...) -> t                 like pack() but nils become null
	json.unpack(t) -> ...               like unpack() but nulls become nil

]==]

local cjson = require'cjson'.new()
local prettycjson = require'prettycjson'
local json = {}

cjson.encode_sparse_array(false, 0, 0) --encode all sparse arrays.
cjson.encode_empty_table_as_object(false) --encode empty tables as arrays.

json.null = cjson.null

function json.asarray(t)
	return setmetatable(t or {}, cjson.array_mt)
end

function json.pack(...)
	local t = json_array{...}
	for i=1,select('#',...) do
		if t[i] == nil then
			t[i] = null
		end
	end
	return t
end

function json.unpack(t)
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
	else
		return repl(v, null, null_val)
	end
end

function json.decode(v, null_val)
	if type(v) ~= 'string' then return v end
	return repl_nulls(cjson.decode(v), null_val)
end

function json.encode(v, indent)
	if indent and indent ~= '' then
		return prettycjson(v, nil, indent)
	else
		return cjson.encode(v)
	end
end

return json
