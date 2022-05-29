io.stdin:setvbuf'no'
io.stdout:setvbuf'no'
io.stderr:setvbuf'no'
require'glue'
sleep(.1)
print'Started'
sleep(.1)
local n = assert(io.stdin:read('*n'))
print('Got '..n)
sleep(.1)
io.stderr:write'Error1\n'
sleep(.1)
print'Hello1'
sleep(.1)
io.stderr:write'Error2\n'
sleep(.1)
print'Hello2'
io.stderr:write'Error3\n'
sleep(.1)
print'Hello3'
sleep(.1)
print'Waiting for EOF'
assert(io.stdin:read('*a') == '\n')
assert(io.stdin:read('*a') == '') --eof
print'Exiting'
os.exit(123)
