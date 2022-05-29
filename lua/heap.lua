--[=[

	Priority queue implemented as a binary heap.
	Written by Cosmin Apreutesei. Public Domain.

	A binary heap is a binary tree that maintains the lowest (or highest)
	value at the root. The tree is laid as an implicit data structure over
	an array. Pushing and popping values from the heap is O(log n).
	Removal is O(n) by default unless a key is reserved on the elements
	(assuming they're indexable) to store the element index which makes
	removal O(log n) too.

	virtualheap(...) -> push, pop   create a heap API from a stack API
	cdataheap(h) -> h               create a fixed-capacity cdata-based heap
	heap([h]) -> h                  create a heap for Lua values
	h:push(val) -> i                push a value
	h:pop([i][, dst]) -> val        pop value (root value at default index 1)
	h:replace(i, val)               replace value at index
	h:peek([i][, dst]) -> val       get value without popping it
	h:find(v) -> i                  find value and return its index
	h:remove(v) -> t|f              find value and remove it
	h:length() -> n                 number of elements in heap

	Values that compare equally are popped in random order.

virtualheap(push, pop, swap, len, cmp) -> push, pop, rebalance

	Create a heap API:

		push(v) -> i         drop a value into the heap and return its index
		pop(i)               remove the value at index i (root is at index 1)
		rebalance(i)         rebalance the heap after the value at i has been changed

	from a stack API:

		push(v)              add a value to the top of the stack
		pop()                remove the value at the top of the stack
		swap(i, j)           swap two values (indices start at 1)
		len() -> n           number of elements in stack
		cmp(i, j) -> bool    compare elements

	The heap can be a min-heap or max-heap depending on the comparison
	function. If `cmp(i, j)` returns `a[i] < a[j]` then it's a min-heap.
	Stack indices are assumed to be consecutive.

cdataheap(h) -> h

	Create a cdata heap over table `h` which must contain:

	  * `ctype`: element type (required).
	  * `min_capacity`: heap starting capacity (optional, defaults to 0).
	  * `cmp`: a comparison function (optional).
	  * `index_key`: enables O(1) `h:find(v)` and thus O(log n) `h:remove(v)`
	  at the price of setting `e[index_key]` on all elements of the heap,
	  otherwise `h:find(v)` is O(n) and `h:remove(v)` is O(n).
	  * `dynarray`: alternative `dynarray` implementation (optional).

	NOTE: `cdata` heaps are 1-indexed just like value heaps.

	EXAMPLE

		local h = cdataheap{
			ctype = [[
				struct {
					int priority;
					int order;
				}
			]],
			cmp = function(a, b)
				if a.priority == b.priority then
					return a.order > b.order
				end
				return a.priority < b.priority
			end}
		h:push{priority = 20, order = 1}
		h:push{priority = 10, order = 2}
		h:push{priority = 10, order = 3}
		h:push{priority = 20, order = 4}
		assert(h:pop().order == 3)
		assert(h:pop().order == 2)
		assert(h:pop().order == 4)
		assert(h:pop().order == 1)

	Note: the `order` field in this example is used to stabilize
	the order in which elements with the same priority are popped.

heap([h]) -> h

	Create a value heap from table `h`, which can contain:

	  * `cmp`: a comparison function (optional).
	  * `index_key`: enables O(1) `h:find(v)` and thus O(log n) `h:remove(v)`
	  at the price of setting `e[index_key]` on all elements of the heap,
	  otherwise `h:find(v)` is O(n) and `h:remove(v)` is O(n).
	  * a pre-allocated heap in the array part of the table (optional).

	NOTE: trying to push `nil` into a value heap raises an error.

	Example:

		local h = valueheap{cmp = function(a, b)
				return a.priority < b.priority
			end}
		h:push{priority = 20, etc = 'bar'}
		h:push{priority = 10, etc = 'foo'}
		assert(h:pop().priority == 10)
		assert(h:pop().priority == 20)

TODO
  * heapifying the initial array
  * merge(h), meld(h)

]=]

if not ... then require'heap_test'; return end

local
	assert, floor =
	assert, math.floor

--heap algorithm working over abstract API that counts from one.

function virtualheap(add, remove, swap, length, cmp)

	local function moveup(child)
		local parent = floor(child / 2)
		while child > 1 and cmp(child, parent) do
			swap(child, parent)
			child = parent
			parent = floor(child / 2)
		end
		return child
	end

	local function movedown(parent)
		local last = length()
		local child = parent * 2
		while child <= last do
			if child + 1 <= last and cmp(child + 1, child) then
				child = child + 1 --sibling is smaller
			end
			if not cmp(child, parent) then break end
			swap(parent, child)
			parent = child
			child = parent * 2
		end
		return parent
	end

	local function push(v)
		add(v)
		return moveup(length())
	end

	local function pop(i)
		swap(i, length())
		remove()
		movedown(i)
	end

	local function rebalance(i)
		if moveup(i) == i then
			movedown(i)
		end
	end

	return push, pop, rebalance
end

--common methods for both cdata and value heaps.

function heap_mixin(h, INDEX)

	function h:find(v)
		for i,v1 in ipairs(self) do
			if v1 == v then
				return i
			end
		end
		return nil
	end

	if INDEX ~= nil then
		function h:find(v) --O(1..logN)
			return v[INDEX]
		end
	else
		function h:find(v) --O(n)
			for i,v1 in ipairs(self) do
				if v1 == v then
					return i
				end
			end
			return nil
		end
	end

end

--cdata heap working over a cdata dynamic array.

function cdataheap(h)

	require'glue'

	local ctype = typeof(h.ctype)
	local arr = h.dynarray
	if not arr then
		arr = dynarray(typeof('$[?]', ctype), h.min_capacity)
	end
	local t, n = nil, 0

	local add, rem, swap
	local INDEX = h.index_key
	if INDEX ~= nil then --for O(n) removal.
		function add(v)
			n = n + 1
			t = arr(n + 1) --elem 0 is temp space for swapping.
			t[n] = v
			t[n][INDEX] = n
		end
		function rem()
			t[n][INDEX] = 0
			n = n - 1
		end
		function swap(i, j)
			t[0]=t[i]; t[i]=t[j]; t[j]=t[0]
			t[i][INDEX] = i
			t[j][INDEX] = j
		end
	else
		function add(v)
			n = n + 1
			t = arr(n + 1) --elem 0 is temp space for swapping.
			t[n] = v
		end
		function rem()
			n = n - 1
		end
		function swap(i, j)
			t[0]=t[i]; t[i]=t[j]; t[j]=t[0]
		end
	end
	local function length()
		return n
	end
	local cmp = h.cmp
		and function(i, j) return h.cmp(t[i], t[j]) end
		or  function(i, j) return t[i] < t[j] end

	local push, pop, rebalance = virtualheap(add, rem, swap, length, cmp)

	heap_mixin(h, INDEX)

	local function get(i, box)
		if not (i >= 1 and i <= n) then
			return nil
		end
		if box then
			box[0] = t[i]
		else
			return ctype(t[i])
		end
	end
	function h:push(v)
		push(v)
	end
	function h:pop(i, box)
		assert(n > 0, 'buffer underflow')
		local v = get(i or 1, box)
		pop(i or 1)
		return v
	end
	function h:peek(i, box)
		return get(i or 1, box)
	end
	function h:replace(i, v)
		assert(i >= 1 and i <= n, 'invalid index')
		t[i] = v
		rebalance(i)
	end
	h.length = length
	function h:remove(v)
		local i = self:find(v)
		if i then
			self:pop(i)
			return true
		else
			return false
		end
	end

	return h
end

--value heap working over a Lua table

function heap(h)
	h = h or {}
	local t, n = h, #h
	local add, rem, swap
	local INDEX = h.index_key
	if INDEX ~= nil then --for O(log n) removal.
		function add(v) n=n+1; t[n]=v; v[INDEX] = n end
		function rem() t[n][INDEX] = nil; t[n]=nil; n=n-1 end
		function swap(i, j)
			t[i], t[j] = t[j], t[i]
			t[i][INDEX] = i
			t[j][INDEX] = j
		end
	else
		function add(v) n=n+1; t[n]=v end
		function rem() t[n]=nil; n=n-1 end
		function swap(i, j) t[i], t[j] = t[j], t[i] end
	end
	local function length() return n end
	local cmp = h.cmp
		and function(i, j) return h.cmp(t[i], t[j]) end
		or  function(i, j) return t[i] < t[j] end
	local push, pop, rebalance = virtualheap(add, rem, swap, length, cmp)

	heap_mixin(h, INDEX)

	function h:push(v)
		assert(v ~= nil, 'invalid value')
		push(v)
	end
	function h:pop(i)
		assert(n > 0, 'buffer underflow')
		local v = t[i or 1]
		pop(i or 1)
		return v
	end
	function h:peek(i)
		return t[i or 1]
	end
	function h:replace(i, v)
		assert(i >= 1 and i <= n, 'invalid index')
		t[i] = v
		rebalance(i)
	end
	h.length = length
	function h:remove(v)
		local i = self:find(v)
		if i then
			self:pop(i)
			return true
		else
			return false
		end
	end
	return h
end
