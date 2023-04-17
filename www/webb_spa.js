/*

	webb | single-page apps | client-side API
	Written by Cosmin Apreutesei. Public Domain.

You must load first:
	glue.js

You must call on DOM load:
	init_action()

CONFIG API

	config(name[, default]) -> value       for global config options
	S(name, [default], ...args) -> s       for internationalized strings

ACTIONS

	href(url, [lang]) -> url               traslate a URL
	current_url -> url                     current URL in the URL bar
	e.sethref([url])                       hook an action to a link
	e.sethrefs()                           hook actions to all links
	page_loading() -> t|f                  was current page loaded or exec()'ed?
	exec(url[, opt])                       change the tab URL
		opt.lang                            set a specific language
		opt.refresh                         exec server action instead of client action
		opt.samepace                        replace entry in history instead of adding
	back()                                 go back to last URL in history
	setscroll([top])                       set scroll to last position or reset
	settitle([title])                      set title to <h1> contents or arg
	^url_changed                           url changed event
	^action_not_found                      action not found event
	action: {action: handler}
	id_arg(s)
	opt_arg(s)
	slug(id, s)

PAGE FLAPS

	flap.NAME = function(on) { ... }
	setflaps('NAME1 ...')

TEMPLATES

	template(name) -> s                    get a template
	render_string(s, [data]) -> s          render a template from a string
	render(name, [data]) -> s              render a template
	e.render_string(s, data)               render template string into e
	e.render([data])                       render e.template into e
	^bind(on, [data])                      fired before & after render

*/

(function () {
"use strict"
let G = window
let e = Element.prototype

// config --------------------------------------------------------------------

// some of the values come from the server (see config.js action).
{
let t = obj()
G.config = function(name, val) {
	if (val !== undefined && t[name] === undefined)
		t[name] = val
	if (t[name] === undefined)
		warn('missing config value for', name)
	return t[name]
}}

// global S() for internationalizing strings.

G.S_texts = obj()

G.S = function(name, en_s, ...args) {
	let s = (S_texts[name] ?? en_s) || ''
	if (args.length)
		return s.subst(...args)
	else
		return s
}

// actions -------------------------------------------------------------------

function action_name(action) {
	return action.replaceAll('-', '_')
}

// extract the action from a decoded url
function url_action(t) {
	if (t.segments[0] == '' && t.segments.length >= 2)
		return action_name(t.segments[1])
}

// given an url (in encoded or decoded form), if it's an action url,
// replace its action name with a language-specific alias for a given
// (or current) language if any, or add ?lang= if the given language
// is not the default language.
G.href = function(url_s, target_lang) {
	let t = url_parse(url_s)

	// add impersonated user if any
	if (!t.args.usr && current_url.args.usr)
		t.args.usr = current_url.args.usr

	target_lang = target_lang || t.args.lang || lang()
	let action = url_action(t)

	if (action === undefined)
		return url_format(t)

	let is_root = t.segments[1] == ''
	if (is_root)
		action = action_name(config('root_action'))
	let aliases = config('aliases')
	let at = aliases && aliases.to_lang[action]
	let lang_action = at && at[target_lang]
	let default_lang = config('default_lang', 'en')
	if (lang_action) {
		if (!(is_root && target_lang == default_lang))
			t.segments[1] = lang_action
	} else {
		if (target_lang != default_lang) {
			t.args.lang = target_lang
		}
	}
	return url_format(t)
}

G.action = obj() // {name->handler}

// given a url (in encoded form), find its action and return the handler.
function action_handler(url) {
	let act = url_action(url)
	if (act === undefined)
		return
	if (act == '')
		act = config('root_action')
	else // an alias or the act name directly
		act = config('aliases').to_en[act] || act
	act = action_name(act)
	let handler = action[act] // find a handler
	if (!handler) {
		// no handler, find a static template with the same name
		// to be rendered on the #main element or on document.body.
		if (template(act)) {
			handler = function() {
				let main = window.main || document.body
				if (main)
					main.unsafe_html = render(act)
			}
		} else if (static_template(act)) {
			handler = function() {
				let main = window.main || document.body
				if (main)
					main.unsafe_html = static_template(act)
			}
		}
	}
	if (!handler)
		return
	let segs = url.segments
	segs.shift() // remove /
	segs.shift() // remove act
	return function(opt) {
		assign(url, opt)
		handler.call(null, segs, url)
	}
}

let loading = true

// check if the action was triggered by a page load or by exec()
G.page_loading = function() {
	return loading
}

let ignore_url_changed

G.current_url = url_parse(location.pathname + location.search) // this is global

function url_changed(ev) {
	if (ignore_url_changed)
		return
	current_url = url_parse(location.pathname + location.search)
	let opt = ev && ev.detail || empty
	fire('url_changed', opt)
	let handler = action_handler(current_url)
	if (handler)
		handler(opt)
	else
		fire('action_not_found', opt)
}

window.on('action_not_found', function(opt) {
	if (location.pathname == '/') {
		setflaps('action_not_found')
		return // no home action
	}
	exec('/', {samepage: true})
})

function save_scroll_state(top) {
	let state = history.state
	if (!state)
		return
	ignore_url_changed = true
	history.replaceState({top: top}, state.title, state.url)
	ignore_url_changed = false
}

let exec_aborted

function abort_exec() {
	exec_aborted = true
}

function check_exec() {
	exec_aborted = false
	fire('before_exec', abort_exec)
	return !exec_aborted
}

G.exec = function(url, opt) {
	opt = opt || {}
	if (opt.refresh) {
		window.location = href(url, opt.lang)
		return
	}
	if (!check_exec())
		return
	save_scroll_state(window.scrollY)
	url = href(url, opt.lang)
	if (opt.samepage) {
		history.replaceState(null, null, url)
	} else {
		if (window.location.href == (new URL(url, document.baseURI)).href)
			return
		history.pushState(null, null, url)
	}
	let ev = new PopStateEvent('popstate')
	ev.detail = opt
	window.fire(ev)
}

G.back = function() {
	if (!check_exec())
		return
	history.back()
}

// set scroll back to where it was or reset it
G.setscroll = function(top) {
	if (top !== undefined) {
		save_scroll_state(top)
	} else {
		let state = history.state
		if (!state)
			return
		let top = state.data && state.data.top || 0
	}
	window.scrollTo(0, top)
}

e.sethref = function(url, opt) {
	if (this._hooked)
		return
	if (this.attr('target'))
		return
	if (this.attr('href') == '')
		this.attr('href', null)
	url = url || this.attr('href')
	if (!url)
		return
	if (this.bool_attr('samepage') || this.bool_attr('sameplace')) {
		opt = opt || {}
		opt.samepage = this.bool_attr('samepage')
		opt.sameplace = this.bool_attr('sameplace')
	}
	url = href(url)
	this.attr('href', url)
	let handler = action_handler(url_parse(url))
	if (!handler)
		return
	this.on('click', function(ev) {
		// shit/ctrl+click passes through to open in new window or tab.
		if (ev.shiftKey || ev.ctrlKey)
			return
		ev.preventDefault()
		exec(url, opt)
	})
	this._hooked = true
	return this
}

e.sethrefs = function(selector) {
	for (let ce of this.$(selector || 'a[href]'))
		ce.sethref()
	return this
}

component('a', '[href]', function(e) {
	e.sethref()
})

G.settitle = function(title) {
	title = title
		|| $('h1').html()
		|| url_parse(location.pathname).segments[1].replace(/[-_]/g, ' ')
	if (title)
		document.title = title + config('page_title_suffix')
}

G.slug = function(id, s) {
	return (s.upper()
		.replace(/ /g,'-')
		.replace(/[^\w-]+/g,'')
	) + '-' + id
}

G.id_arg = function(s) {
	s = s && s.match(/\d+$/)
	return s && num(s) || null
}

G.opt_arg = function(s) {
	return s && ('/' + s) || null
}

// page flaps ----------------------------------------------------------------

{
let cur_cx
G.flap = obj()
G.setflaps = function(new_cx) {
	if (cur_cx == new_cx)
		return
	let cx0 = cur_cx && cur_cx.words().tokeys() || empty
	let cx1 = new_cx && new_cx.words().tokeys() || empty
	for (let cx in cx0)
		if (!cx1[cx]) {
			let handler = flap[cx]
			if (handler)
				handler(false)
		}
	for (let cx in cx1)
		if (!cx0[cx]) {
			let handler = flap[cx]
			if (handler)
				handler(true)
		}
	cur_cx = new_cx
}}

// templates -----------------------------------------------------------------

G.template = function(name) {
	if (!name) return null
	let e = window[name+'_template']
	warn_if(!e, 'unknown template', name)
	return e && (e.tag == 'script' || e.tag == 'xmp') ? e.html : null
}

G.static_template = function(name) {
	let e = window[name+'_template']
	return e && e.tag == 'template' ? e.html : null
}

G.render_string = function(s, data) {
	return Mustache.render(s, data || obj(), template)
}

G.render = function(template_name, data) {
	let s = template(template_name)
	assert(s != null, 'template not found: {0}', template_name)
	return render_string(s, data)
}

e.render_string = function(s, data, ev) {
	this.unsafe_html = render_string(s, data)
	this.fire('render', data, ev)
	return this
}

e.render = function(data, ev) {
	let s = this.template_string
		|| template(this.template || this.attr('template') || this.id || this.tag)
	return this.render_string(s, data, ev)
}

/* <render> ------------------------------------------------------------------

attrs:
	template
inner html:
	<template>
	<script>

*/

component('render', function(e) {

	let t = e.$1(':scope>template')
	let ts = t && t.html
	let tn = e.attr('template')

	let get_data
	let script = e.$1(':scope>script')
	get_data = script && new Function('', script.text)

	e.clear()

	e.on_update(function() {
		let data = get_data.call(e)
		if (ts)
			e.render_string(ts, data)
		else if (tn)
			e.render(tn, data)
	})

})

// init ----------------------------------------------------------------------

G.init_action = function() {
	window.on('popstate', function(ev) {
		loading = false
		url_changed(ev)
	})
	if (client_action) // set from server.
		url_changed()
}

}()) // module function
