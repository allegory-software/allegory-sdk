--[=[

	Circular buffer (aka fixed-sized FIFO queue) of Lua values.
	Written by Cosmin Apreutesei. Public domain.

	* Implemented as an array, not a linked list, so remove(v) is O(n).

	queue(size) -> q               create a queue
	q:push(v)                      add a value to the end of the queue    O(1)
	q:pull() -> v|nil              remove the first value from the queue  O(1)
	q:remove(v) -> v|nil           remove value                           O(n)
	q:peek() -> v|nil              get the first value without removing
	q:items() -> iter() -> v       iterate values
	q:count() -> n                 get queue item count
	q:empty() -> t|f               check if the queue is empty
	q:size()                       get queue capacity
	q:full() -> t|f                check if the queue is full

	NOTE: A linkedlist can be used as an unbounded queue with O(1) remove.

]=]

if not ... then require'queue_test'; return end

local assert = assert

function queue(size)

	local head = size -- push position
	local tail = 1 -- pull position
	local n = 0 -- count
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
		return true
	end

	function q:pull()
		if n == 0 then
			return nil
		end
		local v = t[tail]
		t[tail] = false
		tail = (tail % size) + 1
		n = n - 1
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
			for i = i, head-1 do t[i] = t[i+1] end
			t[head] = false
			head = mi(head - 1)
		else --move left of i to right.
			for i = i-1, tail, -1 do t[i+1] = t[i] end
			t[tail] = false
			tail = mi(tail + 1)
		end
		n = n - 1
	end

	local function find(v)
		for i = 1, n do
			local mi = mi(tail + i - 1)
			if t[mi] == v then
				return mi
			end
		end
	end
	function q:remove(v)
		local mi = find(v)
		if not mi then return nil end
		remove_at(mi)
		return v
	end

	return q
end
