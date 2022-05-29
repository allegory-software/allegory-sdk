--[=[

	Size-limited LRU cache in Lua.
	Written by Cosmin Apreutesei. Public Domain.

	Values can have different sizes. When a new value is put in the cache and
	the cache is full, just enough old values are removed to make room for the
	new value and not exceed the cache max size.

	lrucache([options]) -> cache      create a new cache
	cache.max_size <- size            set the cache size limit
	cache:clear()                     clear the cache
	cache:free()                      destroy the cache
	cache:free_value(val)             value destructor (to be overriden)
	cache:value_size(val) -> size     get value size (to be overriden; returns 1)
	cache:free_size() -> size         size left until `max_size`
	cache:get(key) -> val             get a value from the cache by key
	cache:remove(key) -> val          remove a value from the cache by key
	cache:remove_val(val) -> key      remove a value from the cache
	cache:remove_last() -> val        remove the last value from the cache
	cache:put(key, val)               put a value in the cache, making room as needed

]=]

require'linkedlist'

local lrucache = {}
lrucache.__index = lrucache

lrucache.max_size = 1

function lrucache:clear()
	if self.keys then
		for val in pairs(self.keys) do
			self:free_value(val)
		end
	end
	self.lru = linkedlist()
	self.values = {} --{key -> val}
	self.keys = {} --{val -> key}
	self.total_size = 0
	return self
end

function _G.lrucache(t)
	local self = setmetatable(t or {}, lrucache)
	return self:clear()
end

setmetatable(lrucache, {__call = lrucache.new})

function lrucache:free()
	if self.keys then
		for val in pairs(self.keys) do
			self:free_value(val)
		end
		self.lru = false
		self.values = false
		self.keys = false
		self.total_size = 0
	end
end

function lrucache:free_size()
	return self.max_size - self.total_size
end

function lrucache:value_size(val) return 1 end --stub, size must be >= 0 always
function lrucache:free_value(val) end --stub

function lrucache:get(key)
	local val = self.values[key]
	if not val then return nil end
	self.lru:remove(val)
	self.lru:insert_first(val)
	return val
end

function lrucache:_remove(key, val)
	local val_size = self:value_size(val)
	self.lru:remove(val)
	self:free_value(val)
	self.values[key] = nil
	self.keys[val] = nil
	self.total_size = self.total_size - val_size
end

function lrucache:remove(key)
	local val = self.values[key]
	if not val then return nil end
	self:_remove(key, val)
	return val
end

function lrucache:remove_val(val)
	local key = self.keys[val]
	if not key then return nil end
	self:_remove(key, val)
	return key
end

function lrucache:remove_last()
	local val = self.lru.last
	if not val then return nil end
	self:_remove(self.keys[val], val)
	return val
end

function lrucache:put(key, val)
	local val_size = self:value_size(val)
	local old_val = self.values[key]
	if old_val then
		self.lru:remove(old_val)
		self.total_size = self.total_size - val_size
	end
	while self.lru.last and self.total_size + val_size > self.max_size do
		self:remove_last()
	end
	if not old_val then
		self.values[key] = val
		self.keys[val] = key
	end
	self.lru:insert_first(val)
	self.total_size = self.total_size + val_size
end
