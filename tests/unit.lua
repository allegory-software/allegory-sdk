
require'glue'
require'fs'

assert(chdir(exedir()..'/../../tests'))

local tostr = pp
local function _test(t1, t2, prefix, level)
	if type(t1)=='table' and type(t2)=='table' then
		--for k,v in pairs(t1) do print('>t1',k,v) end
		--for k,v in pairs(t2) do print('>t2',k,v) end
		for k,v in pairs(t1) do
			_test(t2[k], v, prefix .. '.' .. tostr(k), level + 1)
		end
		for k,v in pairs(t2) do
			_test(t1[k], v, prefix .. '.' .. tostr(k), level + 1)
		end
	else
		if (t1 == t1 and t1 ~= t2) or (t1 ~= t1 and t2 == t2) then
			error(tostr(t1) .. " ~= " .. tostr(t2) ..
								" [" .. prefix .. "]", level)
		end
	end
end

function test(t1, t2)
	return _test(t1, t2, 't', 3)
end

function testmatch(s, pat)
	if not s:match(pat) then
		error("'" .. s .. "'" .. " not matching '" .. pat .. "'", 2)
	end
end

function ptest(t1,t2)
	print(t1)
	test(t1,t2,nil,3)
end

do
local time
local last_time
function timediff()
    local time = clock()
    local d = last_time and (time - last_time) or 0
    last_time = time
    return d
end
end

