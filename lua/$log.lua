 --[[

	$ | logging and error checking.

LOGGING API

	log(severity, module, event, fmt, ...)
	note(module, event, fmt, ...)
	dbg(module, event, fmt, ...)
	warnif(module, event, condition, fmt, ...)
	logerror(module, event, fmt, ...)
	loglive(e, [fmt, ...] | nil)
	logliveadd(e, fmt, ...)

	logarg(v) -> s
	logprintarg(v) -> s
	logargs(...) -> ...
	logprintargs(...) -> ...

	pr(...)

CONFIG

	logging.env <- 'dev' | 'prod', etc.
	logging.filter <- {severity->true}

	logging:tofile(logfile, max_disk_size)
	logging:toserver(host, port, queue_size, timeout)

]]

require'$'
logging = require'logging'

log          = logging.log
note         = logging.note
dbg          = logging.dbg
warnif       = logging.warnif
logerror     = logging.logerror
loglive      = logging.live
logliveadd   = logging.liveadd
logarg       = logging.arg
logprintarg  = logging.printarg
logargs      = logging.args
logprintargs = logging.printargs

function pr(...)
	for i=1,select('#',...) do
		io.stderr:write(logging.printarg((select(i,...))))
		io.stderr:write'\t'
	end
	io.stderr:write'\n'
	io.stderr:flush()
	return ...
end
