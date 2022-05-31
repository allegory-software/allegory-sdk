--[=[

	Full-spec mustache parser and bytecode-based renderer.
	Written by Cosmin Apreutesei. Public Domain.

	Produces the exact same output as mustache.js on the same template and
	cjson-encoded view. Mustache is a HTML templating system. If you're new
	to it, see https://mustache.github.io/mustache.5.html .

FEATURES

	* syntax:
		* html-escaped values: {{var}}
		* unescaped values: {{{var}}} or {{& var}}
		* sections: {{#var}} ... {{/var}}
		* inverted sections: {{^var}} ... {{/var}}
		* comments: {{! ... }}
		* partials: {{>name}}
		* set delimiters: {{=<% %>=}}
		* scoped vars: a.b.c wherever `var` is expected.
	* semantics:
		* compatible with mustache.js as to what constitutes a non-false value,
		in particular '', 0 and '0' are considered false.
		* compatibile with [cjson](cjson.md) as to what is considered an array
		and what is a hashmap, in particular sparse arrays that contain
		no other keys are seen as lists and their non-nil elements are iterated.
		* section lambdas f(text, render) and value lambdas f() are supported.
	* rendering:
		* passes all mustache.js tests.
		* preserves the indentation of standalone partials.
		* escapes &, >, <, ", ', /, `, = like mustache.js.
	* other:
		* error reporting with line and column number information.
		* dump tool for debugging compiled templates.
		* text position info for all tokens (can be used for syntax highlighting).

API

mustache_render(template, [data], [partials], [write], [d1, d2], [escape_func]) -> s

	(Compile and) render a template.

	template    : the template, in compiled or in string form.
	view        : the template view.
	partials    : either {name->template} or f(name)->template
	write       : an f(s) to output the rendered pieces to.
	d1, d2      : initial set delimiters.
	escape_func : the escape function for {{var}} substitutions.

mustache_compile(template[, d1, d2]) -> template

	Compile a template to bytecode (if not already compiled).

mustache_dump(program, [d1, d2], [print])

	Dump the template bytecode (for debugging).

]=]

if not ... then require'mustache_test'; return end

require'glue'

--raise an error for something that happened at s[i], so that position in
--file (line, column) can be printed. if i is nil, eof is assumed.
--if s is nil, no position info is printed with the error.
local function raise(s, i, err, ...)
	err = _(err, ...)
	local where
	if s then
		if i then
			local line, col = lineinfo(s, i)
			where = _('line %d, col %d', line, col)
		else
			where = 'eof'
		end
		err = _('error at %s: %s', where, err)
	else
		err = _('error: %s', err)
	end
	error(newerror('mustache', '%s', err), 2)
end

--calls parse(i, j, token_type, ...) for each token in s. i and j are such
--that s:sub(i, j) gives the unparsed token. tokens can be 'text' and 'var'.
--var tokens get more args: (name, modifier, d1, d2, i1). name is unparsed.
--modifiers can be '&' ,'#', '^', '>', '/'. d1 and d2 are the current set
--delimiters (needed for lambdas). i1 is such that s:sub(i, i1) gives the
--indent of a standalone section (for partials). set delimiters and comments
--are dealt with in the tokenizer.
local function tokenize(s, parse, d1, d2)
	local d1 = d1 or '{{' --start delimiter
	local d2 = d2 or '}}' --end delimiter
	local patt, patt2
	local function setpatt()
		patt = '()\r?\n?()[ \t]*()'..
			esc(d1)..'([!&#%^/>=]?)().-()'..
			esc(d2)..'()[ \t]*()\r?\n?()'
		--secondary pattern for matching the special case `{{{...}}}`
		patt2 = d1 == '{{' and d2 == '}}' and
			'()\r?\n?()[ \t]*(){{({)().-()}}}()[ \t]*()\r?\n?()'
	end
	setpatt()
	local i = 1
	local was_newline = true
	while i <= #s do
		local patt = patt2 and s:match('{{{?', i) == '{{{' and patt2 or patt
		local i1, i2, i3, mod, k1, k2, j, j1, j2 = s:match(patt, i)
		if i1 then
			if mod == '{' then mod = '&' end --merge `{` and `&` cases
			local starts_alone = i1 < i2 or (i1 == i and was_newline)
			local ends_alone = j1 < j2 or j2 == #s + 1
			local can_be_standalone = mod ~= '' and mod ~= '&'
			local standalone = can_be_standalone and starts_alone and ends_alone
			local p1, p2 --the char positions delimiting the `{{...}}` token
			if standalone then
				p1 = i2 --first char of the line
				p2 = j2 --first char of the next line
			else
				p1 = i3 --where `{{` starts
				p2 = j  --1st char after `}}`
			end
			if p1 > i then --there's text before `{{`
				parse(i, p1-1, 'text')
			end
			if mod ~= '!' then --not a comment (we skip those)
				local var = trim(s:sub(k1, k2-1))
				if var == '' then
					raise(s, k1, 'empty var')
				end
				if mod == '=' then --set delimiter
					d1, d2 = var:match'^%s*([^%s]+)%s+([^%s=]+)%s*='
					d1 = d1 and trim(d1)
					d2 = d2 and trim(d2)
					if not d1 or d1 == '' or d2 == '' then
						raise(s, k1, 'invalid set delimiters')
					end
					setpatt()
				else
					parse(p1, p2-1, 'var', var, mod, d1, d2, i3-1)
				end
			end
			i = p2 --advance beyond the var
			was_newline = j1 < j2
		else --not matched, so it's text till the end then
			parse(i, #s, 'text')
			i = #s + 1
		end
	end
end

local function parse_var(var) --parse 'a.b.c' to {'a', 'b', 'c'}
	if var == '.' or not var:find('.', 1, true) then
		return var --simple var, leave it
	end
	local path = {}
	for s in var:gmatch'[^%.]+' do --split by `.`
		path[#path+1] = s
	end
	return path
end

local cache = setmetatable({}, {__mode = 'kv'}) --{template -> prog} cache

--compile a template to a program that can be interpreted with render().
--the program is a list of commands with varargs.
--  'text',   i, j, s       : constant text, render it as is
--  'html',   i, j, var     : substitute var and render it as html, escaped
--  'string', i, j, var     : substitute var and render it as is, unescaped
--  'iter',   i, j, var, nextpc, ti, tj, d1, d2 : section (*)
--  'ifnot',  i, j, var, nextpc, ti, tj, d1, d2 : inverted section (*)
--  'end'     i, j          : end of section or inverted section
--  'render', i, j, partial, i1 : render partial (**)
--(*) for sections, nexpc is the index in the program where the next command
--after the section is (for jumping to it); ti and tj are such that
--template:sub(ti, tj) gives the unparsed text inside the section (for lambdas),
--and d1 and d2 are the current set delimiters (for lambdas).
--(**) for partials, i1 is such that template:sub(i, i1) gives the
--indent of the partial which must be applied to the lines of the result.
function mustache_compile(template, d1, d2)
	if istab(template) then --already compiled
		return template
	end
	assert(not d1 == not d2, 'error: only one delimiter specified')
	local key = (d1 or '')..'\0'..(d2 or '')..'\0'..template
	local prog = cache[key]
	if prog then
		return prog
	end
	prog = {template = template}
	cache[key] = prog

	local function cmd(...)
		for i=1,select('#',...) do
			prog[#prog+1] = select(i,...)
		end
	end

	local sec_stack = {} --stack of section names
	local arg_stack = {} --stack of (pi_nexpc, pi_j)

	tokenize(template, function(i, j, what, var, mod, d1, d2, i1)
		if what == 'text' then
			cmd('text', i, j, template:sub(i, j))
		elseif what == 'var' then
			if mod == '' then
				cmd('html', i, j, parse_var(var))
			elseif mod == '&' then --no escaping
				cmd('string', i, j, parse_var(var))
			elseif mod == '#' or mod == '^' then --section
				local c = mod == '#' and 'iter' or 'ifnot'
			 	cmd(c, i, j, parse_var(var), 0, j+1, 0, d1, d2)
				push(sec_stack, var)     --unparsed section name
				push(arg_stack, #prog-4) --index in prog of yet-unknown nexpc
				push(arg_stack, #prog-2) --index in prog of yet-unknown tj
			elseif mod == '/' then --close section
				local pi_tj     = pop(arg_stack)
				local pi_nextpc = pop(arg_stack)
				local section   = pop(sec_stack)
				if section ~= var then
					local expected = section and _('{{/%s}}', section)
						or 'no section open'
					raise(template, i, '%s but found {{/%s}}', expected, var)
				end
				cmd('end', i, j)
				prog[pi_nextpc] = #prog + 1 --set nextpc on the iter cmd
				prog[pi_tj] = i-1 --set the end position of the inner text
			elseif mod == '>' then --partial
				cmd('render', i, j, var, i1)
			end
		end
	end, d1, d2)

	if #sec_stack > 0 then
		local sections = concat(sec_stack, ', ')
		raise(template, nil, 'unclosed sections: %s', sections)
	end

	return prog
end

function mustache_dump(prog, d1, d2, print) --dump bytecode
	print = print or _G.print
	prog = mustache_compile(prog, d1, d2)
	local function var(var)
		return istab(var) and concat(var, '.') or var
	end
	local function text(s)
		local s = pp(s)
		if #s > 50 then
			s = s:sub(1, 50-3)..'...'
		end
		return s
	end
	local lineinfo = lineinfo(prog.template)
	local pc = 1
	print'  IDX  #  LN:COL  PC  CMD    ARGS'
	while pc <= #prog do
		local cmd = prog[pc]
		local i = prog[pc+1]
		local j = prog[pc+2]
		local line, col = lineinfo(i)
		local s
		if cmd == 'text' then
			s = text(prog[pc+3])
			pc = pc + 1
		elseif cmd == 'html' or cmd == 'string' then
			s = _('%-12s', var(prog[pc+3]))
			pc = pc + 1
		elseif cmd == 'render' then
			s = _('%-12s i1: %d', var(prog[pc+3]), prog[pc+4])
			pc = pc + 2
		elseif cmd == 'iter' or cmd == 'ifnot' then
			local name, nextpc, ti, tj, d1, d2 = unpack(prog, pc+3, pc+8)
			local inner = prog.template:sub(ti, tj)
			s = _('%-12s nextpc: %d, delim: %s %s, text: %s',
					var(name), nextpc, d1, d2, text(inner))
			pc = pc + 6
		elseif cmd == 'end' then
			s = ''
		else
			assert(false)
		end
		print(_('%5d %2d %3d:%3d %3d  %-6s %s', i, j-i+1, line, col, pc, cmd, s))
		pc = pc + 3
	end
end

--check if a value is considered valid in a way compatible with mustache.js.
local function istrue(v)
	if istab(v) then
		return next(v) ~= nil
	else
		return v and v ~= '' and v ~= 0 and v ~= '0' or false
	end
end

--check if a value is an array using cjson semantics (tip: it works with
--sparse arrays) and return an iterator giving the next non-nil value.
local function listvalues(t)
	if type(t) ~= 'table' then return end
	local n = 0
	local i0, i1 = 1/0, 0
	for k in pairs(t) do
		if type(k) ~= 'number' then return end
		if k <= 0 then return end
		if math.floor(k) ~= k then return end
		n = n + 1
		i0 = math.min(i0, k)
		i1 = math.max(i1, k)
	end
	if n == 0 then return end
	local i = i0-1
	local val
	return function()
		repeat
			i = i + 1
			val = t[i]
		until i >= i1 or val ~= nil
		return val
	end
end

local function indent(s, indent)
	return s:gsub('([^\r\n]+\r?\n?)', indent..'%1')
end

local function lookup(ctx_stack, var, i) --search up a context stack
	local val = ctx_stack[i][var]
	if val ~= nil then --var found
		return val
	end
	if i == 1 then --top context
		return nil
	end
	return lookup(ctx_stack, var, i-1) --check parent (tail call)
end

local function resolve(ctx_stack, var) --find a value in a context stack
	if #ctx_stack == 0 then
		return --no view
	end
	if var == '.' then --"this" var
		return ctx_stack[#ctx_stack]
	elseif istab(var) then --'a.b.c' parsed as {'a', 'b', 'c'}
		local val = lookup(ctx_stack, var[1], #ctx_stack)
		for i=2,#var do
			if not istrue(val) then --falsey values resolve to ''
				return
			elseif type(val) ~= 'table' then
				raise(nil, nil, 'table expected for field "%s" but got %s',
					var[i], type(val))
			end
			val = val[var[i]]
		end
		return val
	else --simple var
		return lookup(ctx_stack, var, #ctx_stack)
	end
end

local function render(prog, ctx_stack, getpartial, write, d1, d2, esc)

	prog = mustache_compile(prog, d1, d2)

	local outbuf
	if not write then --writer not given, do buffered output
		outbuf = {}
		write = function(s)
			outbuf[#outbuf+1] = s
		end
	end
	local function out(s)
		if s == nil then return end
		write(tostring(s))
	end

	local function run_section_lambda(lambda, ti, tj, d1, d2)
		local text = prog.template:sub(ti, tj)
		local function render_lambda(text)
			return render(text, ctx_stack, getpartial, nil, d1, d2, esc)
		end
		return lambda(text, render_lambda)
	end

	local function render_lambda_result(val, d1, d2)
		if type(val) == 'string' and val:find('{{', 1, true) then
			val = render(val, ctx_stack, getpartial, nil, d1, d2, esc)
		end
		return val
	end

	local function check_value_lambda(val)
		if type(val) == 'function' then
			val = render_lambda_result((val()))
		end
		return val
	end

	local pc = 1 --program counter
	local iter_stack = {} --stack of iteration states

	local function iter(val, nextpc, ti, tj, d1, d2)
		local nextvalue = listvalues(val)
		if nextvalue then --it's a list, iterate it
			push(iter_stack, nextvalue)
			push(iter_stack, pc)
			push(iter_stack, 'list')
			push(ctx_stack, nextvalue()) --always non-nil
		elseif istab(val) then --hashmap, set as context
			push(iter_stack, 'hash')
			push(ctx_stack, val)
		else --conditional section, don't push a context
			push(iter_stack, 'cond')
		end
	end

	local function enditer()
		local itertype = iter_stack[#iter_stack]
		if itertype == 'list' then
			local nextvalue = iter_stack[#iter_stack-2]
			local startpc   = iter_stack[#iter_stack-1]
			local val = nextvalue()
			if val ~= nil then --loop back with the next value as context
				ctx_stack[#ctx_stack] = val
				pc = startpc
			else
				pop(iter_stack)
				pop(iter_stack)
				pop(iter_stack)
				pop(ctx_stack)
			end
		else
			pop(iter_stack)
			if itertype == 'hash' then
				pop(ctx_stack)
			end
		end
	end

	while pc <= #prog do
		local cmd = prog[pc]
		if cmd == 'text' then
			local s = prog[pc+3]
			pc = pc + 4
			out(s)
		elseif cmd == 'html' then
			local var = prog[pc+3]
			pc = pc + 4
			local val = check_value_lambda(resolve(ctx_stack, var))
			if val ~= nil then
				out(esc(tostring(val)))
			end
		elseif cmd == 'string' then
			local var = prog[pc+3]
			pc = pc + 4
			out(check_value_lambda(resolve(ctx_stack, var)))
		elseif cmd == 'iter' or cmd == 'ifnot' then
			local var, nextpc, ti, tj, d1, d2 =
				prog[pc+3], prog[pc+4], prog[pc+5],
				prog[pc+6], prog[pc+7], prog[pc+8]
				pc = pc + 9
			local val = resolve(ctx_stack, var)
			if type(val) == 'function' then
				val = run_section_lambda(val, ti, tj, d1, d2)
				if cmd == 'ifnot' then --lambdas on inv. sections must be truthy
					val = nil
				end
				val = render_lambda_result(val, d1, d2)
				if istrue(val) then
					out(val)
				end
				pc = nextpc --section is done
			else
				if cmd == 'ifnot' then
					val = not istrue(val)
				end
				if istrue(val) then --valid section value, iterate it
					iter(val, nextpc)
				else
					pc = nextpc --skip section entirely
				end
			end
		elseif cmd == 'end' then
			pc = pc + 3
			enditer() --loop back or end iteration
		elseif cmd == 'render' then
			local i, partial, i1 = prog[pc+1], prog[pc+3], prog[pc+4]
			pc = pc + 5
			local partial = getpartial(partial)
			if partial then
				if i1 >= i then --indented
					local spaces = prog.template:sub(i, i1)
					partial = indent(partial, spaces)
				end
				render(partial, ctx_stack, getpartial, write, nil, nil, esc)
			end
		end
	end

	if outbuf then
		return concat(outbuf)
	end
end

function mustache_render(prog, view, getpartial, write, d1, d2, esc)
	if istab(getpartial) then --partials table given, build getter
		local partials = getpartial
		getpartial = function(name)
			return partials[name]
		end
	end
	local ctx_stack = {view}
	esc = esc or html_escape
	return render(prog, ctx_stack, getpartial, write, d1, d2, esc)
end
