
	} else if (opt.style) { // style prop
		let style = opt.style
		let format = opt.style_format || return_arg
		let parse  = opt.style_parse  || type == 'number' && num || (v => repl(v, '', undefined))
		if (dv != null && parse(e.style[style]) == null)
			e.style[style] = format(dv)
		function get() {
			return parse(e.style[style])
		}
		function set(v) {
			let v0 = get.call(e)
			v = convert(v, v0)
			if (v == v0)
				return
			e.style[style] = format(v)
			v = get.call(e) // take it again (browser only sets valid values)
			if (v == v0)
				return
			e[setter](v, v0)
			if (!priv)
				prop_changed(e, prop, v, v0)
			e.update()
		}
