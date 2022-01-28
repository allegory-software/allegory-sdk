--go @ plink d10 sdk/bin/linux/luajit sdk/tests/sha2_test.lua
local sha2 = require'sha2'
local glue = require'glue'

sha = {
	SHA256 = function(s) return glue.tohex(sha2.sha256(s)) end,
	SHA384 = function(s) return glue.tohex(sha2.sha384(s)) end,
	SHA512 = function(s) return glue.tohex(sha2.sha512(s)) end,
}

for file in io.popen('ls '..glue.bin..'/sha2_test/*.dat'):lines() do
	local s = glue.readfile(file, 'rb')
	local hashes = {}
	do
		local f = assert(io.open(file:gsub('%.dat$', '')..'.info'))
		do
			local name, hash
			for line in f:lines() do
				if line:find'^SHA' then
					name = line:match'^(SHA.?.?.?)'
					hash = ''
				elseif hash then
					if #line == 0 then
						hashes[name] = hash
						hash = nil
					elseif hash then
						hash = hash .. line:match'^%s*(.-)%s*$'
					end
				end
			end
		end
		f:close()
	end

	for k,v in pairs(hashes) do
		local h = sha[k](s)
		print(file, k..'x', #s, h == v and 'ok' or h .. ' ~= ' .. v)
	end
end
