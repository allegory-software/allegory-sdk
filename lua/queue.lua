--[=[

	Circular buffer (aka fixed-sized FIFO queue) of Lua values.
	Written by Cosmin Apreutesei. Public domain.

	Allows removing a value at any position from the queue.
	For a cdata ringbuffer, look at fs.mirror_map().

	queue.new(size) -> q           create a queue
	q:size()                       get queue capacity
	q:count()                      get queue item count
	q:full() -> t|f                check if the queue is full
	q:empty() -> t|f               check if the queue is empty
	q:push(v)                      push a value
	q:pop() -> v                   pop a value (nil if empty)
	q:peek() -> v                  get value from the top without popping
	q:items() -> iter() -> v       iterate values
	q:remove_at(i)                 remove value at index `i`
	q:remove(v) -> t|f             remove value (return `true` if found)
	q:find(v) -> t|f               find value

]=]

--Allows removing a value at any position from the queue.

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

	function q:remove_at(i)
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

	function q:remove(v)
		local i = self:find(v)
		if not i then return false end
		self:remove_at(i)
		return true
	end

	if INDEX ~= nil then
		function q:find(v)
			return v[INDEX]
		end
	else
		function q:find(v)
			for i = 1, n do
				local i = mi(tail + i - 1)
				if t[i] == v then
					return i
				end
			end
		end
	end

	return q
end

return {new = new}
