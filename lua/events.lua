--[[

	Pub/sub mixin for object systems.
	Written by Cosmin Apreutesei. Public Domain.

Events are a way to associate an action with one or more callback functions
to be called on that action, with the distinct ability to remove one or more
callbacks later on, based on a criteria.

This module is only a mixin (a plain table with methods). It must be added to
your particular object system by copying the methods over to your base class.

EVENT FACTS

  * events fire in the order in which they were added.
  * extra args passed to `fire()` are passed to each event handler.
  * if the method `obj:on_EVENT(args...)` is found, it is called first.
  * returning a non-nil value from a handler interrupts the event handling
    call chain and the value is returned back by `fire()`.
  * the meta-event called `'event'` is fired on all events (the name of the
    event that was fired is received as arg#1).
  * events can be tagged with multiple tags/namespaces `'event.ns1.ns2...'`
    or `{event, ns1, ns2, ...}`: tags/namespaces are useful for easy bulk
    event removal with `obj:off'.ns1'` or `obj:off({nil, ns1})`.
  * multiple handlers can be added for the same event and/or namespace.
  * handlers are stored in `self.__observers`.
  * tags/namespaces can be of any type, which allows objects to register
    event handlers on other objects using `self` as tag so they can later
	 remove them with `obj:off({nil, self})`.
  * `obj:off()` can be safely called inside any event handler, even to remove
    itself.

LIMITATIONS

  * no bubbling or trickling/capturing as there is no awareness of a hierarchy.
  Add them yourself as needed by walking up or down the tree and firing them
  for each node (don't forget to inject the target object in the arg list).

EXAMPLES

  * `apple:on('falling.ns1.ns2', function(self, args...) ... end)` - register
  an event handler and associate it with the `ns1` and `ns2` tags/namespaces.
  * `apple:on({'falling', ns1, ns2}, function ... end)` - same but the tags
  can be any type.
  * `apple:once('falling', function ... end)` - fires only once.
  * `Apple:falling(args...)` - default event handler for the `falling` event.
  * `apple:fire('falling', args...)` - call all `falling` event handlers.
  * `apple:off'falling'` - remove all `falling` event handlers.
  * `apple:off'.ns1'` - remove all event handlers on the `ns1` tag.
  * `apple:off{nil, ns1}` - remove all event handlers on the `ns1` tag.
  * `apple:off() - remove all event handlers registered on `apple`.

API

	obj:on('event[.ns1...]', function(self, args...) ... end)
	obj:on({event_name, ns1, ...}, function(self, args...) ... end)
	obj:once(event, function(self, args...) ... end)
	obj:fire(event, args...) -> ret
	obj:off('[event][.ns1...]')
	obj:off({[event], [ns1, ...]})
	obj:off()

]]

local glue = require'glue'

local add = table.insert
local remove = table.remove
local indexof = glue.indexof
local attr = glue.attr

local events = {}

--default values to speed up look-up in class systems with dynamic dispatch.
events.event = false
events.__observers = false

local function parse_event(s)
	local ev, t
	if type(s) == 'table' then -- {ev|false, ns1, ...}
		local ev = s[1] or nil
		t = {}
		for i=2,#s do t[i-1] = s[i] end
	elseif s:find('.', 1, true) then -- `[ev].ns1.ns2`
		t = {}
		for s in s:gmatch'[^%.]*' do
			if not ev then
				ev = s
			elseif s ~= '' then
				add(t, s)
			end
		end
	else --`ev`
		ev = s
	end
	if ev == '' then ev = nil end
	return ev, t
end

--register a function to be called for a specific event type.
function events:on(ev, fn)
	local ev, nss = parse_event(ev)
	assert(ev, 'event name missing')
	local t = self.__observers
	if not t then
		t = {}
		self.__observers = t
	end
	local t = attr(t, ev)
	add(t, fn)
	if nss then
		for _,ns in ipairs(nss) do
			add(attr(t, ns), fn)
		end
	end
end

--remove a handler or all handlers of an event and/or namespace.
function events:off(s)
	local t = self.__observers
	if not t then return end
	local ev, nss = parse_event(s)
	if ev and nss then
		local t = t[ev]
		if t then
			for _,ns in ipairs(nss) do
				local fns = t[ns]
				if fns then
					for _,fn in ipairs(fns) do
						local i = indexof(fn, t)
						if i then
							remove(t, i)
						end
					end
				end
			end
		end
	elseif ev then
		t[ev] = nil
	elseif nss then
		for _,ns in ipairs(nss) do
			for _,t in pairs(t) do
				local fns = t[ns]
				if fns then
					for _,fn in ipairs(fns) do
						remove(t, indexof(fn, t))
					end
				end
			end
		end
	else
		self.__observers = nil
	end
end

function events:once(ev, func)
	local ev, nss = parse_event(ev)
	local id = {}
	local ev
	if nss then
		add(nss, 1, ev)
		add(nss, id)
	else
		ev = {ev, id}
	end
	self:on(ev, function(...)
		self:off(ev)
		return func(...)
	end)
end

--fire an event, i.e. call its handler method and all observers.
function events:fire(ev, ...)
	if self['on_'..ev] then
		local ret = self[ev](self, ...)
		if ret ~= nil then return ret end
	end
	local t = self.__observers
	local t = t and t[ev]
	if t then
		local i = 1
		while true do
			local handler = t[i]
			if not handler then break end --list end or handler removed
			local ret = handler(self, ...)
			if ret ~= nil then return ret end
			if t[i] ~= handler then
				--handler was removed from inside itself, stay at i
			else
				i = i + 1
			end
		end
	end
	if ev ~= 'event' then
		return self:fire('event', ev, ...)
	end
end

--tests ----------------------------------------------------------------------

if not ... then

local obj = {}
for k,v in pairs(events) do obj[k] = v end
local n = 0
local t = {}
local function handler_func(order)
	return function(self, a, b, c)
		assert(a == 3)
		assert(b == 5)
		assert(c == nil)
		n = n + 1
		table.insert(t, order)
	end
end

obj:on('testing.ns1', handler_func(2))
obj:on('testing.ns2', handler_func(3))
obj:on('testing.ns3', handler_func(4))
obj.testing = handler_func(1)

obj:fire('testing', 3, 5)
assert(#t == 4)
assert(t[1] == 1)
assert(t[2] == 2)
assert(t[3] == 3)
assert(t[4] == 4)

t = {}
obj:off'.ns2'
obj:fire('testing', 3, 5)
assert(#t == 3)
assert(t[1] == 1)
assert(t[2] == 2)
assert(t[3] == 4)

t = {}
obj:off'testing'
obj:fire('testing', 3, 5)
assert(#t == 1)
assert(t[1] == 1)

end


return events
