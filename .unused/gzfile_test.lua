require'gzfile'
local function gztest(file, content)
	local gz = gzip_open(file)
	test(gz:read(#content), content)
	test(#gz:read(1), 0)
	test(gz:eof(), true)
	gz:close()
end

local gz = gzip_open('gzip_test/test1.txt.gz', 'w')
test(gz:write'The game done changed.', #'The game done changed.')
gz:close()

gztest('gzip_test/test.txt.gz', 'The game done changed.')
gztest('gzip_test/test1.txt.gz', 'The game done changed.')
os.remove('gzip_test/test1.txt.gz')
