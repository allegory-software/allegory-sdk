--[=[

	Doubly-linked lists of Lua values.
	Written by Cosmin Apreutesei. Public Domain.

	In this implementation items must be Lua tables for which fields `_prev`
	and `_next` are reserved for linking.

	linkedlist() -> list                    create a linked list
	list.first -> t, list:peek() -> t       first item
	list.last -> t                          last item
	list.length -> n, list:count() -> n     number of items
	list:clear()                            clear the list
	list:insert_first(t)                    add an item at beginning of the list
	list:insert_last(t), list:push(t)       add an item at the end of the list
	list:insert_after([anchor, ]t)          add an item after another item (or at the end)
	list:insert_before([anchor, ]t)         add an item before another item (or at the beginning)
	list:remove(t) -> t|nil                 remove a specific item (nil if not found)
	list:pull() -> t                        remove and return the first item, if any
	list:next([current]) -> t               next item after some item (or first item)
	list:prev([current]) -> t               previous item after some item (or last item)
	list:items() -> iterator<item>          iterate items
	list:reverse_items() -> iterator<item>  iterate items in reverse
	list:copy() -> new_list                 copy the list
	list:empty() -> true|false              length == 0

	NOTE: A linkedlist can be used as a drop-in replacement for a queue.

]=]

if not ... then require'linkedlist_test'; return end

linkedlist = {}
linkedlist.__index = linkedlist

function linkedlist:new()
	return setmetatable({length = 0}, self)
end

setmetatable(linkedlist, {__call = linkedlist.new})

function linkedlist:clear()
	self.length = 0
	self.first = nil
	self.last = nil
end

function linkedlist:insert_first(t)
	assert(t)
	if self.first then
		self.first._prev = t
		t._next = self.first
		self.first = t
	else
		self.first = t
		self.last = t
	end
	self.length = self.length + 1
end

function linkedlist:insert_after(anchor, t)
	if not t then anchor, t = nil, anchor end
	if not anchor then anchor = self.last end
	assert(t)
	if anchor then
		assert(t ~= anchor)
		if anchor._next then
			anchor._next._prev = t
			t._next = anchor._next
		else
			self.last = t
		end
		t._prev = anchor
		anchor._next = t
		self.length = self.length + 1
	else
		self:insert_first(t)
	end
end

function linkedlist:insert_last(t)
	self:insert_after(nil, t)
end

function linkedlist:insert_before(anchor, t)
	if not t then anchor, t = nil, anchor end
	if not anchor then anchor = self.first end
	anchor = anchor and anchor._prev
	assert(t)
	if anchor then
		self:insert_after(anchor, t)
	else
		self:insert_first(t)
	end
end

function linkedlist:remove(t)
	if not t then return nil end
	if t._next then
		if t._prev then
			t._next._prev = t._prev
			t._prev._next = t._next
		elseif t == self.first then
			t._next._prev = nil
			self.first = t._next
		else
			return nil --not in this list
		end
	elseif t._prev then
		if t == self.last then
			t._prev._next = nil
			self.last = t._prev
		else
			return nil --not in this list
		end
	elseif t == self.first then
		self.first = nil
		self.last = nil
	else
		return nil --not in this list
	end
	t._next = nil
	t._prev = nil
	self.length = self.length - 1
	return t
end

--iterating

function linkedlist:next(last)
	if last then
		return last._next
	else
		return self.first
	end
end

function linkedlist:items()
	return self.next, self
end

function linkedlist:prev(last)
	if last then
		return last._prev
	else
		return self.last
	end
end

function linkedlist:reverse_items()
	return self.prev, self
end

--utils

function linkedlist:copy()
	local list = self:new()
	for item in self:items() do
		list:insert_last(item)
	end
	return list
end

--queue API

linkedlist.push = linkedlist.insert_last
function linkedlist:pull() return self:remove(self.first) end
function linkedlist:peek() return self.first end
function linkedlist:count() return self.length end
function linkedlist:empty() return self.length == 0 end
