/*

CSS DEV TOOLS
	css_report_specificity(css_file, max_spec)

COMPOSABLE CSS
	you can use the syntax `--inc: cls1 ...;` in css declarations.

*/

// CSS specificity reporting -------------------------------------------------

function css_selector_specificity(s0) {
	let s = s0
	let n = 0 // current specificity
	let maxn = 0 // current max specificity
	let cs = [0] // call stack: 1 for :is(), 0 for :not() and :where()
	let ns = [] // specificity stack for :is()
	let maxns = [] // max specificity stack for :is()
	let z = 0 // call stack depth of first :where()
	let sm // last matched string
	function match(re) {
		let m = s.match(re)
		if (!m) return
		sm = m[0]
		assert(sm.len)
		s = s.slice(sm.len)
		return true
	}
	function next() {
		if (!s.len) return max(maxn, n)
		if (match(/^[ >+~*]+/ )) return next()
		if (match(/^\)/      )) {
			assert(cs.len > 1, 'unexpected )')
			if (cs.pop()) { n = ns.pop() + max(maxn, n); maxn = maxns.pop() }
			if (z == cs.len) z = 0; return next()
		}
		if (match(/^:is\(/   )) {
			cs.push(1); ns.push(n); maxns.push(maxn); n = 0; maxn = 0
			return next()
		}
		if (match(/^:not\(/  )) { cs.push(0); return next() }
		if (match(/^:has\(/  )) { cs.push(0); return next() }
		if (match(/^:where\(/)) { if (!z) z = cs.len; cs.push(0); return next() }
		if (match(/^,/       )) { maxn = max(maxn, n); n = 0; return next() }
		if (match(/^\[[^\]]*\]/) || match(/^[\.:#]?[:a-zA-Z\-_][a-zA-Z0-9\-_]*/)) {
			if (!z)
				n += (sm[0] == '#' && 10 || sm[0] == '.' && 1 || sm[0] == ':' && sm[1] != ':' && 1 || .1)
			return next()
		}
		warn('invalid selector: '+s0, s)
	}
	return next()
}

function css_report_specificity(file, max_spec) {
	for (let ss of document.styleSheets) {
		if (!((ss.href || '').ends(file || '')))
			continue
		for (let r of ss.cssRules) {
			let s = r.selectorText
			if (!isstr(s))
				continue
			let spec = css_selector_specificity(s)
			if (spec > max_spec)
				debug('CSS spec', spec, s)
		}
	}
}


/* composable CSS ------------------------------------------------------------

	example.css:
		.foo { }
		.bar { }
		.baz { --inc: foo bar; }  # adds into .baz all properties from .foo and .bar

*/

on_dom_load(function() {

	css_report_specificity('x-widgets.css', 0)

	let t0 = time()

	let n = 0
	let class_rules = obj()
	for (let ss of document.styleSheets) {
		for (let r of ss.cssRules) {
			let s = r.selectorText // this is slow on Chrome :(
			if (!isstr(s))
				continue
			let m = s.match(/^\.([a-zA-Z0-9\-_]+)$/) // simple class
			if (!m)
			 	continue
			class_rules[m[1]] = r
			n++
		}
	}

	let t1 = time()

	for (let ss of document.styleSheets) {
		for (let r of ss.cssRules) {
			let sm = r.styleMap
			if (!sm) continue
			let inc = sm.get('--inc') // this is slow on Chrome :(
			inc = inc && inc[0]
			if (!inc) continue
			for (let s of words(inc)) {
				let cr = class_rules[s]
				if (cr) {
					debug('CSS', s, '->', r.selectorText)
					for (let [k, v] of cr.styleMap)
						r.style[k] = v
				} else {
					warn('class not found: '+s)
				}
			}
		}
	}

	let t2 = time()

	debug('CSS --inc', n, 'rules,',
		floor((t1 - t0) * 1000), 'ms to map,',
		floor((t2 - t1) * 1000), 'ms to update')

})
