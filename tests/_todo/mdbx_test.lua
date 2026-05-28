
local db = mdbx_open(homedir()..'/testdb')

db:begin'w'
db:open_table('users', 'w')
db:commit()

db:begin'w'
local s = _('%03x %d foo bar', 32, 3141592)
local k = i32a(1, 123456789)
assert(db:try_put_raw('users', cast(u8p, k), sizeof(k), s, #s))
db:commit()

db:begin()
for ok,cur,k,k_sz,v,v_sz in db:each_raw'users' do
	assert(cast(i32p, k)[0] == 123456789)
	assert(str(v, v_sz) == s)
end
db:commit()

db:close()
print'mdbx ok'
