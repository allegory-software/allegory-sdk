--go@ plink d10 -t sdk/bin/linux/luajit sdk/lua/*

local bufread = require'memprof.bufread'
local memprof = require'memprof.parse'
local process = require'memprof.process'
local symtab  = require'memprof.symtab'
local view    = require'memprof.humanize'

function dump(inputfile, leak_only)
  local reader = bufread.new(inputfile)
  local symbols = symtab.parse(reader)
  local events = memprof.parse(reader, symbols)
  if not leak_only then
    view.profile_info(events, symbols)
  end
  local dheap = process.form_heap_delta(events, symbols)
  view.leak_info(dheap)
  view.aliases(symbols)
end

dump('memprof_new.bin')
