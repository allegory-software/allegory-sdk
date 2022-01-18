
## `local queue = require'queue'`

Circular buffer (aka fixed-sized FIFO queue) of Lua values.

Allows removing a value at any position from the queue.

For a cdata ringbuffer, look at `fs.mirror_map()`.

## API

| API                              | Description  |
| :---                             | :---         |
| `queue.new(size) -> q`           | create a queue
| `q:size()`                       | get queue capacity
| `q:count()`                      | get queue item count
| `q:full() -> t\|f`               | check if the queue is full
| `q:empty() -> t\|f`              | check if the queue is empty
| `q:push(v)`                      | push a value
| `q:pop() -> v`                   | pop a value (nil if empty)
| `q:peek() -> v`                  | get value from the top without popping
| `q:items() -> iter() -> v`       | iterate values
| `q:remove_at(i)`                 | remove value at index `i`
| `q:remove(v) -> t\|f`            | remove value (return `true` if found)
| `q:find(v) -> t\|f`              | find value
