--[[

	$ | networking

EXPORTS

	sock

]]

require'$'
sock = require'sock'

thread         = sock.thread
threadenv      = sock.threadenv
resume         = sock.resume
suspend        = sock.suspend
transfer       = sock.transfer
cofinish       = sock.cofinish
cowrap         = sock.cowrap
yield          = sock.yield
currentthread  = sock.currentthread
onthreadfinish = sock.onthreadfinish
sleep_until    = sock.sleep_until
sleep          = sock.sleep
sleep_job      = sock.sleep_job
runat          = sock.runat
runafter       = sock.runafter
runevery       = sock.runevery
