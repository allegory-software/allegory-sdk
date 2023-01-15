/*

CSS DEV TOOLS
	css_report_specificity(css_file, max_spec)

COMPOSABLE CSS
	you can use the syntax `--inc: cls1 ...;` in css declarations.

*/

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
