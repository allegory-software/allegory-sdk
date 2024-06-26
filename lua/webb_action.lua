--[==[

	webb | action-based routing with multi-language support
	Written by Cosmin Apreutesei. Public Domain.

MULTI-LANGUAGE ACTIONS & LINKS

	alias(name_en, name, lang)            set an action alias for a language
	href(s|t[, target_lang]) -> s         translate page URL based on alias
	setlinks(s) -> s                      html filter to translate URLs

ACTIONS

	action(name, args...) -> t|f          execute action as http response
	execaction(name, args...) -> ret...|true    execute action internally

	function action.NAME(args) end        define a Lua action handler

CONFIG

	config('root_action', 'en')           name of the '/' (root) action
	config('404_html_action', '404.html') 404 action for text/html
	config('404_png_action' , '404.png' ) 404 action for image/png
	config('404_jpeg_action', '404.jpg' ) 404 action for image/jpeg

DEFINES

	config'aliases'                       used by webb_spa.lua

TODO

	* cascaded actions: html.m.lua, html.m.lp, etc.
	* .markdown filter.

]==]

require'webb'
require'lang'

--multi-language actions & links ---------------------------------------------

--[[
It is assumed that action names are always in English even if they actually
request a page in the default language which can configured to be different
than English. Action name translation is done automatically provided that
1) all links are passed through href(), 2) routing is done by calling
action(unpack(args())) which calls find_action() and 3) action names are
translated in different languages with alias(). Using action aliases is
the key to avoiding the appending of ?lang=xx to links. Aliases for the
root action ('en') are also allowed in order to avoid the ?lang param.
]]

local aliases = {} --{alias={lang=, action=}}
local aliases_json = {to_en = {}, to_lang = {}}
config('aliases', aliases_json) --we pass those to the client

local function action_name(action)
	return action:gsub('-', '_')
end

function alias(en_action, alias_action, alias_lang)
	local default_lang = default_lang()
	alias_lang = alias_lang or default_lang
	alias_action = action_name(alias_action)
	en_action = action_name(en_action)
	aliases[alias_action] = {lang = alias_lang, action = en_action}
	--If the default language is not English and we're making
	--an alias for the default language, then we can safely assign
	--the English action name for the English language, whereas before
	--we would use the English action name for the default language.
	if default_lang ~= 'en' and alias_lang == default_lang then
		if not aliases[en_action] then --user can override this
			aliases[en_action] = {lang = 'en', action = en_action}
			attr(aliases_json.to_lang, en_action).en = en_action
		end
	end
	aliases_json.to_en[alias_action] = en_action
	attr(aliases_json.to_lang, en_action)[alias_lang] = alias_action
end

--given a url (in encoded or decoded form), if it's an action url,
--replace its action name with a language-specific alias for a given
--(or current) language if any, or add ?lang= if the given language
--is not the default language.
function href(s, target_lang)
	local t = isstr(s) and url_parse(s) or s
	local segs = t.segments
	local action = not t.host and (segs and segs[1] == '' and segs[2] and action_name(segs[2])) or nil
	if not action then
		return url_format(s)
	end
	local default_lang = default_lang()
	local target_lang = target_lang or (t.args and t.args.lang) or lang()
	local is_root = segs[2] == ''
	if is_root then
		action = action_name(config('root_action', 'en'))
	end
	local at = aliases_json.to_lang[action]
	local lang_action = at and at[target_lang]
	if lang_action then
		if not (is_root and target_lang == default_lang) then
			t[2] = lang_action
		end
	elseif target_lang ~= default_lang then
		attr(t, 'args').lang = target_lang
	end
	return url_format(t)
end

--given a list of path elements, find the action they point to
--and change the current language if necessary.
local function find_action(action, ...)
	if not action then --root action in current language
		action = config('root_action', 'en')
	else
		local alias = aliases[action_name(action)] --look for a regional alias
		if alias then
			setlang(alias.lang)
			action = alias.action
		end
	end
	setlang(args'lang') --?lang= has priority over lang set by alias.
	return action, ...
end

--html output filter for rewriting links based on current language aliases
function setlinks(s)
	local function repl(prefix, s)
		return prefix..href(s)
	end
	s = s:gsub('(%shref=")([^"]+)', repl)
	s = s:gsub('(%shref=)([^ >]+)', repl)
	return s
end

--override http_redirect() to automatically translate URLs.
local _http_redirect = http_redirect
function http_redirect(url, ...)
	return _http_redirect(href(url), ...)
end

--output filters -------------------------------------------------------------

local function html_filter(handler, ...)
	local s = record(handler, ...)
	local s = setlinks(html_filter_lang(html_filter_comments(s), lang()))
	check_etag(s)
	outall(s)
end

local function json_filter(handler, ...)
	local s = handler(...)
	if s ~= nil then
		s = json_encode(s)
		check_etag(s)
		outall(s)
	end
end

local function js_filter(handler, ...)
	if not config'minify_js' then
		handler(...)
		return
	end
	local minify = require'jsmin'.minify
	local s = record(handler, ...)
	s = minify(s)
	check_etag(s)
	outall(s)
end

local mime_type_filters = {
	['text/html']        = html_filter,
	['application/json'] = json_filter,
	['application/javascript']  = js_filter,
}

--routing logic --------------------------------------------------------------

local file_handlers = {
	cat = function(file, ...)
		outcatlist(file, ...)
	end,
	lua = function(file, ...)
		return run_lua_file(file, nil, ...)
	end,
	lp = function(file, ...)
		include(file)
	end,
}

local actions_ext = keys(file_handlers, true)

local actions = {} --{action -> handler | s}

local function action_handler(action, ...)

	local action_ext = path_ext(action)
	local action_no_ext
	local action_with_ext = action
	if not action_ext then --add the default .html extension to the action
		action_no_ext = action
		action_ext = 'html'
		action_with_ext = action .. '.' .. action_ext
	elseif action_ext == 'html' then
		action_no_ext = action:gsub('%.html$', '')
	end
	local ext = action_ext

	local handler =
		(action_no_ext and actions[action_name(action_no_ext)]) --look in the default action table
		or actions[action_name(action_with_ext)] --look again with .html extension

	if not handler then --look in the filesystem
		local file = concat({action, ...}, '/')
		local file_ext = path_ext(file)
		if not file_ext then
			file_ext = 'html'
			file = file .. '.html'
		end
		local plain_file_allowed = not file_handlers[file_ext]
		if plain_file_allowed then
			handler = wwwfile[file] and wwwfile(file)
			if not handler then
				local path = wwwpath(file)
				if path then
					if not method'get' then
						http_error(405)
					end
					handler = assert(outfile_function(path))
				end
			end
		end
		if handler then
			ext = file_ext
		end
	end

	if not handler then
		local action_file, file_handler
		for i,ext in ipairs(actions_ext) do
			local action_file1 = action_with_ext..'.'..ext
			if wwwfile[action_file1] or wwwpath(action_file1) then
				assertf(not action_file,
					'multiple action files for %s (%s, was %s)',
						action_with_ext, action_file1, action_file)
				file_handler = file_handlers[ext]
				action_file = action_file1
			end
		end
		handler = action_file and function(...)
			return file_handler(action_file, ...)
		end
	end

	if handler and not isfunc(handler) then
		local s = handler
		handler = function()
			outall(s)
		end
	end

	return handler, ext
end

--exec an action without setting content type, looking for a 404 handler
--or filtering the output based on mime type, instead returns whatever
--the action returns (good for exec'ing json actions which return a table).
local function pass(arg1, ...)
	if not arg1 then
		return true, ...
	else
		return arg1, ...
	end
end
function execaction(action, ...)
	local handler = action_handler(action, ...)
	if not handler then return false end
	return pass(handler(...))
end

local function run_action(fallback, action, handler, ext, ...)
	local mime = mime_types[ext]
	if not handler then
		if not fallback then
			return false
		end
		local not_found_actions = {
			['text/html' ] = config('404_html_action', '404.html'),
			['image/png' ] = config('404_png_action' , '404.png'),
			['image/jpeg'] = config('404_jpeg_action', '404.jpg'),
		}
		local nf_action = not_found_actions[mime]
		if not nf_action then
			http_log('note', 'webb', '404', '%s', concat({action, ...}, '/'))
			return false
		end
		local handler, ext = action_handler(nf_action, ...)
		return run_action(false, nf_action, handler, ext, action, ...)
	end
	setmime(ext)
	local filter = mime_type_filters[mime]
	if filter then
		filter(handler, ...)
	else
		handler(...)
	end
	if not http_request().respond_called then
		outall'' --avoid 404 if out() or outall() was not called in the action handler.
	end
	return true
end

function internal_action(action, ...)
	local handler, ext = action_handler(find_action(action, ...))
	return run_action(false, action, handler, ext, ...)
end

setmetatable(actions, {__call = function(self, action, ...)
	local handler, ext = action_handler(find_action(action, ...))
	return run_action(true, action, handler, ext, ...)
end})
action = actions
