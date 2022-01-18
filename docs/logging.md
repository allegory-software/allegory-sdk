
## `local logging = require'logging'`

File and TCP logging with capped disk & memory usage.

## API

| API                                                   | Description |
| :---                                                  | :---        |
| __logging__                                           |
| `logging.log(severity, module, event, fmt, ...)`      | log a message
| `logging.note(module, event, fmt, ...)`               | log a note message
| `logging.dbg(module, event, fmt, ...)`                | log a debug message
| `logging.warnif(module, event, condition, fmt, ...)`  | log a warning conditionally
| `logging.logerror(module, event, fmt, ...)`           | log an error
| __utils__                                             |
| `logging.args(...) -> ...`                            | format args for logging
| `logging.printargs(...) -> ...`                       | format args for logging to stderr
| __config__                                            |
| `logging.quiet`                                       | do not log anything to stderr (false)
| `logging.verbose`                                     | log `note` messages to stderr (true)
| `logging.debug`                                       | log `debug` messages to stderr (false)
| `logging.flush`                                       | flush stderr after each message (false)
| `logging.max_disk_size`                               | max disk size occupied by logging (16M)
| `logging.queue_size`                                  | queue size for when the server is slow (10000)
| `logging.timeout`                                     | timeout (5)
| `logging.env`                                         | current environment, eg. 'dev', 'prod', etc.
| `logging.deploy`                                      | name the current deployment
| `logging.filter.severity = true`                      | filter out messages of a specific severity
| `logging.censor.name <- f(severity, module, ev, msg)` | set a function for censoring secrets in logs
| __init__                                              |
| `logging:tofile(logfile, max_disk_size)`              | set up logging to a file
| `logging:toserver(host, port, queue_size, timeout)`   | set up logging to a log server

Logging is done to stderr by default. To start logging to a file, call
`logging:tofile()`. To start logging to a server, call `logging:toserver()`.
You can call both.

