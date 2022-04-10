--[=[

	Circular buffer (aka fixed-sized FIFO queue) of Lua values.
	Written by Cosmin Apreutesei. Public domain.

	* Allows removing a value at any position from the queue.
	* For a cdata ringbuffer, look at fs.mirror_buffer().
	* Implemented as an array, not a linked list, so remove(v) is O(n).
	* INDEX is a special key that if given will make find() and remove() O(1).

	queue.new(size) -> q           create a queue
	q:size()                       get queue capacity
	q:count()                      get queue item count
	q:full() -> t|f                check if the queue is full
	q:empty() -> t|f               check if the queue is empty
	q:push(v)                      add a value to the end of the queue
	q:pop() -> v|nil               remove the first value from the queue (nil if empty)
	q:peek() -> v|nil              get the first value without popping
	q:first() -> v|nil             get the first value without popping
	q:last() -> v|nil              get the last value wihtout popping
	q:items() -> iter() -> v       iterate values
	q:item_at(i) -> v|nil          get item at index i in 1..q:count() from tail
	q:remove(v) -> t|f             remove value (return `true` if found)

]=]

local function new(size, INDEX)

	local head = size
	local tail = 1
	local n = 0
	local t = {}
	local q = {}

	function q:size() return size end
	function q:count() return n end

	function q:full() return n >= size end
	function q:empty() return n == 0 end

	local function mi(x) return (x - 1) % size + 1 end

	function q:push(v)
		assert(v ~= nil)
		if n >= size then
			return nil, 'full'
		end
		head = (head % size) + 1
		t[head] = v
		n = n + 1
		if INDEX ~= nil then v[INDEX] = head end
		return true
	end

	function q:pop()
		if n == 0 then
			return nil
		end
		local v = t[tail]
		t[tail] = false
		tail = (tail % size) + 1
		n = n - 1
		if INDEX ~= nil then v[INDEX] = nil end
		return v
	end

	function q:peek()
		if n == 0 then
			return nil
		end
		return t[tail]
	end
	q.first = q.peek

	function q:last()
		if n == 0 then
			return nil
		end
		return t[head]
	end

	function q:items()
		local i = 0 --last i
		return function()
			if i >= n then
				return nil
			end
			i = i + 1
			return t[mi(tail + i - 1)]
		end
	end

	function q:item_at(i)
		if not (i >= 1 and i <= n) then return nil end
		return t[mi(tail + i - 1)]
	end

	local function remove_at(i)
		assert(n > 0)
		local from_head = true
		if tail <= head then --queue not wrapped around (has one segment).
			assert(i >= tail and i <= head)
		elseif i <= head then --queue wrapped; i is in the head's segment.
			assert(i >= 1)
		else --queue wrapped; i is in the tail's segment.
			assert(i >= tail and i <= size)
			from_head = false
		end
		if from_head then --move right of i to left.
			for i = i, head-1 do t[i] = t[i+1]; if INDEX then t[i][INDEX] = i+1 end end
			t[head] = false
			if INDEX ~= nil then t[head][INDEX] = nil end
			head = mi(head - 1)
		else --move left of i to right.
			for i = i-1, tail, -1 do t[i+1] = t[i]; if INDEX then t[i+1][INDEX] = i end end
			t[tail] = false
			if INDEX ~= nil then t[tail][INDEX] = nil end
			tail = mi(tail + 1)
		end
		n = n - 1
	end

	local find
	if INDEX ~= nil then
		function find(v)
			return v[INDEX]
		end
	else
		function find(v)
			for i = 1, n do
				local mi = mi(tail + i - 1)
				if t[mi] == v then
					return mi
				end
			end
		end
	end

	function q:remove(v)
		local mi = find(v)
		if not mi then return false end
		remove_at(mi)
		return true
	end

	return q
end

return {new = new}
