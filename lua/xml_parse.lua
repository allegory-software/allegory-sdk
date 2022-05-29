--[=[

	XML parsing based on expat.
	Written by Cosmin Apreutesei. Public Domain.

xml_parse(source, callbacks) -> true

	Parse a XML from a string, cdata, file, or reader function, calling
	a callback for each piece of the XML parsed.

	The optional `namespacesep` field is a single-character string. If present,
	it causes XML namespaces to be resolved during parsing. Namespace URLs are
	then concatenated to tag names using the specified character.

	source = {path = S} | {string = S} | {cdata = CDATA, size = N} | {read = f} & {[namespacesep=S]}

	callbacks = {
	  element         = function(name, model) end,
	  attr_list       = function(elem, name, type, dflt, is_required) end,
	  xml             = function(version, encoding, standalone) end,
	  entity          = function(name, is_param_entity, val, base, sysid, pubid, notation) end,
	  start_tag       = function(name, attrs) end,
	  end_tag         = function(name) end,
	  cdata           = function(s) end,
	  pi              = function(target, data) end,
	  comment         = function(s) end,
	  start_cdata     = function() end,
	  end_cdata       = function() end,
	  default         = function(s) end,
	  default_expand  = function(s) end,
	  start_doctype   = function(name, sysid, pubid, has_internal_subset) end,
	  end_doctype     = function() end,
	  unparsed        = function(name, base, sysid, pubid, notation) end,
	  notation        = function(name, base, sysid, pubid) end,
	  start_namespace = function(prefix, uri) end,
	  end_namespace   = function(prefix) end,
	  not_standalone  = function() end,
	  ref             = function(parser, context, base, sysid, pubid) end,
	  skipped         = function(name, is_parameter_entity) end,
	  unknown         = function(name, info) end,
	}

xml_parse(source, [known_tags]) -> root_node

	Parse a XML to a tree of nodes. known_tags filters the output so that only
	the tags that known_tags indexes are returned.

	Nodes look like this:

		node = {tag=, attrs={<k>=v}, children={node1,...},
				tags={<tag> = node}, cdata=, parent=}

xml_children(node, tag) -> iter() -> node

	Iterate a node's children that have a specific tag.

]=]

if not ... then require'xml_parse_test'; return end

require'glue'
require'expat_h'
local C = ffi.load'expat'

local
	str =
	str

local cbsetters = {
	'element',        C.XML_SetElementDeclHandler,            typeof'XML_ElementDeclHandler',
	'attlist',        C.XML_SetAttlistDeclHandler,            typeof'XML_AttlistDeclHandler',
	'xml',            C.XML_SetXmlDeclHandler,                typeof'XML_XmlDeclHandler',
	'entity',         C.XML_SetEntityDeclHandler,             typeof'XML_EntityDeclHandler',
	'start_tag',      C.XML_SetStartElementHandler,           typeof'XML_StartElementHandler',
	'end_tag',        C.XML_SetEndElementHandler,             typeof'XML_EndElementHandler',
	'cdata',          C.XML_SetCharacterDataHandler,          typeof'XML_CharacterDataHandler',
	'pi',             C.XML_SetProcessingInstructionHandler,  typeof'XML_ProcessingInstructionHandler',
	'comment',        C.XML_SetCommentHandler,                typeof'XML_CommentHandler',
	'start_cdata',    C.XML_SetStartCdataSectionHandler,      typeof'XML_StartCdataSectionHandler',
	'end_cdata',      C.XML_SetEndCdataSectionHandler,        typeof'XML_EndCdataSectionHandler',
	'default',        C.XML_SetDefaultHandler,                typeof'XML_DefaultHandler',
	'default_expand', C.XML_SetDefaultHandlerExpand,          typeof'XML_DefaultHandler',
	'start_doctype',  C.XML_SetStartDoctypeDeclHandler,       typeof'XML_StartDoctypeDeclHandler',
	'end_doctype',    C.XML_SetEndDoctypeDeclHandler,         typeof'XML_EndDoctypeDeclHandler',
	'unparsed',       C.XML_SetUnparsedEntityDeclHandler,     typeof'XML_UnparsedEntityDeclHandler',
	'notation',       C.XML_SetNotationDeclHandler,           typeof'XML_NotationDeclHandler',
	'start_namespace',C.XML_SetStartNamespaceDeclHandler,     typeof'XML_StartNamespaceDeclHandler',
	'end_namespace',  C.XML_SetEndNamespaceDeclHandler,       typeof'XML_EndNamespaceDeclHandler',
	'not_standalone', C.XML_SetNotStandaloneHandler,          typeof'XML_NotStandaloneHandler',
	'ref',            C.XML_SetExternalEntityRefHandler,      typeof'XML_ExternalEntityRefHandler',
	'skipped',        C.XML_SetSkippedEntityHandler,          typeof'XML_SkippedEntityHandler',
}

local NULL = new'void*'

local function decode_attrs(attrs) --char** {k1,v1,...,NULL}
	local t = {}
	local i = 0
	while true do
		local k = str(attrs[i]);   if not k then break end
		local v = str(attrs[i+1]); if not v then break end
		t[k] = v
		i = i + 2
	end
	return t
end

local pass_nothing = function(_) end
local cbdecoders = {
	element = function(_, name, model) return str(name), model end,
	attr_list = function(_, elem, name, type, dflt, is_required)
		return str(elem), str(name), str(type), str(dflt), is_required ~= 0
	end,
	xml = function(_, version, encoding, standalone)
		return str(version), str(encoding), standalone ~= 0
	end,
	entity = function(_, name, is_param_entity, val, val_len, base, sysid, pubid, notation)
		return str(name), is_param_entity ~= 0, str(val, val_len), str(base),
					str(sysid), str(pubid), str(notation)
	end,
	start_tag = function(_, name, attrs) return str(name), decode_attrs(attrs) end,
	end_tag = function(_, name) return str(name) end,
	cdata = function(_, s, len) return str(s, len) end,
	pi = function(_, target, data) return str(target), str(data) end,
	comment = function(_, s) return str(s) end,
	start_cdata = pass_nothing,
	end_cdata = pass_nothing,
	default = function(_, s, len) return str(s, len) end,
	default_expand = function(_, s, len) return str(s, len) end,
	start_doctype = function(_, name, sysid, pubid, has_internal_subset)
		return str(name), str(sysid), str(pubid), has_internal_subset ~= 0
	end,
	end_doctype = pass_nothing,
	unparsed = function(name, base, sysid, pubid, notation)
		return str(name), str(base), str(sysid), str(pubid), str(notation)
	end,
	notation = function(_, name, base, sysid, pubid)
		return str(name), str(base), str(sysid), str(pubid)
	end,
	start_namespace = function(_, prefix, uri) return str(prefix), str(uri) end,
	end_namespace = function(_, prefix) return str(prefix) end,
	not_standalone = pass_nothing,
	ref = function(parser, context, base, sysid, pubid)
		return parser, str(context), str(base), str(sysid), str(pubid)
	end,
	skipped = function(_, name, is_parameter_entity) return str(name), is_parameter_entity ~= 0 end,
	unknown = function(_, name, info) return str(name), info end,
}

local parser = {}

function parser.read(read, callbacks, options)
	local cbt = {}
	local function cb(cbtype, callback, decode)
		local cb = cast(cbtype, function(...) return callback(decode(...)) end)
		cbt[#cbt+1] = cb
		return cb
	end
	local function free_callbacks()
		for _,cb in ipairs(cbt) do
			cb:free()
		end
	end
	return fpcall(function(finally)
		finally(free_callbacks)

		local parser = options.namespacesep and C.XML_ParserCreateNS(options.encoding, options.namespacesep:byte())
				or C.XML_ParserCreate(options.encoding)
		finally(function() C.XML_ParserFree(parser) end)

		for i=1,#cbsetters,3 do
			local k, setter, cbtype = cbsetters[i], cbsetters[i+1], cbsetters[i+2]
			if callbacks[k] then
				setter(parser, cb(cbtype, callbacks[k], cbdecoders[k]))
			elseif k == 'entity' then
				setter(parser, cb(cbtype,
						function(parser) C.XML_StopParser(parser, false) end,
						function(parser) return parser end))
			end
		end
		if callbacks.unknown then
			C.XML_SetUnknownEncodingHandler(parser,
				cb('XML_UnknownEncodingHandler', callbacks.unknown, cbdecoders.unknown), nil)
		end

		C.XML_SetUserData(parser, parser)

		repeat
			local data, size, more = read()
			if C.XML_Parse(parser, data, size, more and 0 or 1) == 0 then
				error(format('XML parser error at line %d, col %d: "%s"',
						tonumber(C.XML_GetCurrentLineNumber(parser)),
						tonumber(C.XML_GetCurrentColumnNumber(parser)),
						str(C.XML_ErrorString(C.XML_GetErrorCode(parser)))))
			end
		until not more
	end)
end

function parser.path(file, callbacks, options)
	return fpcall(function(finally)
		local f = assert(io.open(file, 'rb'))
		finally(function() f:close() end)
		local function read()
			local s = f:read(16384)
			if s then
				return s, #s, true
			else
				return nil, 0
			end
		end
		parser.read(read, callbacks, options)
	end)
end

function parser.string(s, callbacks, options)
	local function read()
		return s, #s
	end
	return parser.read(read, callbacks, options)
end

function parser.cdata(cdata, callbacks, options)
	local function read()
		return cdata, options.size
	end
	return parser.read(read, callbacks, options)
end

local function maketree_callbacks(known_tags)
	local root = {tag = 'root', attrs = {}, children = {}, tags = {}}
	local t = root
	local skip
	return {
		cdata = function(s)
			t.cdata = s
		end,
		start_tag = function(s, attrs)
			if skip then skip = skip + 1; return end
			if known_tags and not known_tags[s] then skip = 1; return end

			t = {tag = s, attrs = attrs, children = {}, tags = {}, parent = t}
			local ct = t.parent.children
			ct[#ct+1] = t
			t.parent.tags[t.tag] = t
		end,
		end_tag = function(s)
			if skip then
				skip = skip - 1
				if skip == 0 then skip = nil end
				return
			end

			t = t.parent
		end,
	}, root
end

function xml_parse(t, callbacks)
	local root = true
	if type(callbacks) ~= 'function' then
		local known_tags = callbacks
		callbacks, root = maketree_callbacks(known_tags)
	end
	for k,v in pairs(t) do
		if parser[k] then
			local ok, err = parser[k](v, callbacks, t)
			if not ok then return nil, err end
			return root
		end
	end
	error'source missing'
end

function xml_children(t,tag) --iterate a node's children of a specific tag
	local i=1
	return function()
		local v
		repeat
			v = t.children[i]
			i = i + 1
		until not v or v.tag == tag
		return v
	end
end
