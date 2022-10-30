--go@ plink d10 -t sdk/bin/linux/luajit sdk/tests/*
jit.off()
local memprof = require'misc.memprof'
assert(memprof.start("memprof_new.bin"))
-- Lua does not create a new frame to call string.rep and all allocations are
-- attributed not to `append()` function but to the parent scope.
local function append(str, rep)
 return string.rep(str, rep)
end

local t = {}
for _ = 1, 1e4 do
-- table.insert is a builtin and all corresponding allocations
-- are reported in the scope of main chunk.
table.insert(t,
  append('q', _)
)
end
memprof.stop()
