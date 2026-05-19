--[=[

	Structured Exceptions

API

	errortype([classname], [super]) -> E    create/get an error class
	  E(...) -> e                           create an error object
	  E:__call(...) -> e                    error class constructor
	  E:__tostring() -> s                   to make `error(e)` work
	  E.addtraceback                        add a traceback to errors
	newerror(classname,... | e) -> e        create/wrap/pass-through an error object
	  e.message                             formatted error message
	  e.traceback                           traceback at error site
	iserror(v,[classes],[message]) -> true|false     match an error
	raise([level, ]classname,... | e)       (create and) raise an error
	check(errorclass, event, v, ...)        assert with structured errors and logging
	catch([classes], f, ...) -> true,... | false,e    pcall `f` and catch errors
	try(f, ...)                             alias of catch
	CANCEL                                  error that try/catch cannot catch
	protect([classes, ]f, [oncaught]) -> f  turn raising f into nil,err-returning
	pcall(f, ...) -> ok,...                 pcall that stores traceback in `e.traceback`
	lua_pcall(f, ...) -> ok,...             Lua's pcall renamed (no tracebacks)

RATIONALE

Structured exceptions are an enhancement over plain string errors by adding
selective catching and providing a context for the failure to help with
freeing resources, recovery or logging. They're most useful in network
protocols and file decoders (see errors_io.lua).

In the API `classes` can be given as either 'classname1 ...' or {class1->true}.
When given in table form, you must include all the superclasses in the table
since they are not added automatically!

raise() passes its varargs to newerror() which passes them to
eclass() which passes them to eclass:__call() which interprets them
as follows: `[err_obj, err_obj_options..., ][format, format_args...]`.
So if the first arg is a table it is converted to the final error object.
Any following table args are merged with this object. Any following args
after that are passed to string.format() and the result is placed in
err_obj.message (if `message` was not already set). All args are optional.

TRACEBACKS ON STRING ERRORS

Normally in Lua, when catching an error temporarily to free up resources and
then re-raising it, the original stack trace is lost. Catching errors with the
pcall() that's reimplemented here instead of with the standard Lua pcall()
adds a traceback to all string errors, which is useful when pcalling Lua code
in order to get visibility on bugs. But raising errors with a stack trace is
expensive so when a stack trace is not needed, use lua_pcall() instead.

TRACEBACKS ON STRUCTURED ERRORS

Structured errors are different: they don't get a traceback by default unless
you ask for it by setting addtraceback=true in the error object or class.

]=]

if not ... then require'errors_test'; return end

require'glue'

local
    type, xpcall, getmetatable, rawget =
    type, xpcall, getmetatable, rawget

local error = error
local lua_pcall = pcall

local classes = {} --{name -> class}
local class_sets = {} --{'name1 name2 ...' -> {class->true}}

local Error --fw. decl.

local function errortype(classname, super, default_error_message)
	local class = classname and classes[classname]
	if not class then
		super = type(super) == 'string' and assert(classes[super]) or super or Error
		class = object(super, {
			type = classname and classname..'_error' or 'error',
			errortype = classname, iserror = true,
			default_error_message = default_error_message
				or (classname and classname..' error') or 'error',
		})
		if classname then
			classes[classname] = class
			class_sets = {} --clear class_sets cache
		end
	end
	return class
end

local function newerror(arg, ...)
	if type(arg) ~= 'string' then return arg end --pass-through error objects
	local class = classes[arg] or errortype(arg)
	return class(...)
end

local function class_table(s)
	if type(s) == 'string' then
		local t = class_sets[s]
		if not t then
			t = {}
			class_sets[s] = t
			for s in words(s) do
				local class = classes[s]
				while class do
					t[class] = true
					class = class.__index
				end
			end
		end
		return t
	else
		assert(type(s) == 'table')
		return s --if given as table, must contain superclasses too!
	end
end

local function iserror(e, classes, message)
	local mt = getmetatable(e)
	if type(mt) ~= 'table' then return false end
	if not rawget(mt, 'iserror') then return false end
	if not classes then return true end
	if not class_table(classes)[e.__index] then return false end
	if not message then return true end
	if not e.message == message then return false end
	return true
end

local function raise(level, ...)
	if type(level) == 'number' then
		error(newerror(...), level)
	else
		error(newerror(level, ...), 2)
	end
end

local function check(errorclass, event, v, ...)
	if v then return v end
	assert(type(errorclass) == 'string' or iserror(errorclass))
	assert(type(event) == 'string')
	local e = newerror(errorclass, ...)
	if not e.logged then
		log('ERROR', e.errortype, event, '%s', e.message)
		e.logged = true
	end
	raise(e)
end

local CANCEL --fw. decl.

local function fix_traceback(s)
	return s:gsub('(.-:%d+: )([^\n])', '%1\n%2')
end
local function cont(classes, ok, ...)
	if ok then return true, ... end
	local e = ...
	if (not classes or iserror(e, classes)) and e ~= CANCEL then
		return false, e
	end
	error(e, 3)
end
local function onerror(e)
	if iserror(e) then
		if e.addtraceback and not e.traceback then
			e.traceback = fix_traceback(traceback(e.message or '', 2))
		end
	elseif isstr(e) then
		return fix_traceback(traceback(e, 2))
	end
	return e
end
local function pcall(f, ...)
	return xpcall(f, onerror, ...)
end
local function catch(classes, f, ...)
	return cont(classes, pcall(f, ...))
end
local try = catch --sounds weird but use try(f) and catch('class1 ...', f)

local function cont(oncaught, ok, ...)
	if ok then return ... end
	if oncaught then oncaught(...) end
	return nil, ...
end
local function protect(classes, f, oncaught)
	if type(classes) == 'function' then
		return protect(nil, classes, f)
	end
	return function(...)
		return cont(oncaught, catch(classes, f, ...))
	end
end

--base error class that all error types inherit from.

--[[local]] Error = errortype()

--identify, serialize and deserialize are for passing errors between
--OS threads via Lua states.

function Error.identify(e)
	return iserror(e)
end

function Error:serialize()
	return {errortype = self.errortype, message = tostring(self)}
end

function Error.deserialize(t)
	return newerror(t.errortype, t)
end

local function merge_option_tables(e, arg1, ...)
	if type(arg1) == 'table' then
		for k,v in pairs(arg1) do e[k] = v end
		return merge_option_tables(e, ...)
	else
		e.message = e.message or (arg1 and format(arg1, logargs(...)) or nil)
		return e
	end
end
function Error:__call(arg1, ...)
	local e
	if type(arg1) == 'table' then
		e = merge_option_tables(object(self, arg1), ...)
	else
		e = object(self, {message = arg1 and format(arg1, logargs(...)) or nil})
	end
	e.iserror = true
	e.__tostring = self.__tostring
	if e.init then
		e:init()
	end
	return e
end

function Error:__tostring()
	return self.traceback or self.message or self.default_error_message
end

--raise CANCEL to cancel any waiting thread. try() / catch() won't catch it.
--[[local]] CANCEL = newerror'cancel'

_G.errortype = errortype
_G.newerror = newerror
_G.iserror = iserror
_G.raise = raise
_G.check = check
_G.catch = catch
_G.try = try
_G.pcall = pcall
_G.lua_pcall = lua_pcall
_G.protect = protect
_G.Error = Error
_G.CANCEL = CANCEL
