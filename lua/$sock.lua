--[[

	$ | networking

EXPORTS

	sock

]]

require'$'
sock = require'sock'

thread         = sock.thread
resume         = sock.resume
suspend        = sock.suspend
transfer       = sock.transfer
cofinish       = sock.cofinish
cowrap         = sock.cowrap
yield          = sock.yield
currentthread  = sock.currentthread
threadstatus   = sock.threadstatus
threadenv      = sock.threadenv
getthreadenv   = sock.getthreadenv
getownthreadenv= sock.getownthreadenv
onthreadfinish = sock.onthreadfinish
sleep_until    = sock.sleep_until
sleep          = sock.sleep
sleep_job      = sock.sleep_job
runat          = sock.runat
runafter       = sock.runafter
runevery       = sock.runevery
runagainevery  = sock.runagainevery
