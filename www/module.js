/*

	Persistence for widget-based self-editing UIs.
	Written by Cosmin Apreutesei. Public Domain.

*/

function init_xmodule(opt) {

	opt = opt || {layers: []}

	let xm = {}
	xmodule = xm // singleton.

	let generation = 1

	xm.root_widget = null

	xm.slots = opt.slots || obj() // {name -> {color:, }}
	xm.modules = opt.modules || obj() // {name -> {icon:, }}
	xm.layers = obj() // {name -> {name:, props: {id -> {k -> v}}}}
	xm.instances = obj() // {id -> [e1,...]}
	xm.selected_module = null
	xm.selected_slot = null
	xm.active_layers = obj() // {'module:slot' -> layer} in override order

	// init & changing root widget --------------------------------------------

	function get_root_module_layer() {
		let layer = xm.get_active_layer(opt.root_module, 'base')
		if (!layer) {
			warn('layer not found for root module', opt.root_module)
			return
		}
		return layer
	}

	function init_root_widget() {
		if (!opt.root_module)
			return
		let layer = get_root_module_layer()
		let root_id = layer && layer.root_id
		if (layer && !root_id)
			warn('root_id not found in root module layer')
		xm.set_root_widget(root_id && element(root_id), false)
	}

	window.init_root_widget = init_root_widget

	xm.set_root_widget = function(root_widget, noupdate) {
		xm.root_container = opt.root_container
			&& $(opt.root_container)[0] || document.body
		root_widget = root_widget || widget_placeholder({module: opt.root_module})
		let old_root_widget = xm.root_widget
		xm.root_widget = root_widget

		xm.root_container.replace(old_root_widget, root_widget)
		if (opt.root_module) {
			let layer = get_root_module_layer()
			if (!layer)
				return
			layer.props['<root>'] = root_widget.id
			layer.modified = !!noupdate
		}
	}

	// init prop layer slots --------------------------------------------------

	function slot_name(s) { assert(s.search(/[:]/) == -1); return s }
	function module_name(s) { assert(s.search(/[_:\d]/) == -1); return s }

	xm.get_active_layer = function(module, slot) {
		return xm.active_layers[module+':'+slot]
	}

	function set_active_layer(module, slot, layer) {
		let s = module_name(module)+':'+slot_name(slot)
		let layer0 = xm.active_layers[s]
		let layer1 = get_layer(layer)
		xm.active_layers[s] = layer1
		return [layer0, layer1]
	}

	function init_prop_layers() {
		for (let t of opt.layers)
			set_active_layer(t.module, t.slot, t.layer)
		document.fire('prop_layer_slots_changed')
	}

	// loading layer prop vals into instances ---------------------------------

	function prop_vals(id) {
		let pv = obj()
		let layer0
		for (let k in xm.active_layers) {
			let layer = xm.active_layers[k]
			if (layer != layer0) {
				assign_opt(pv, layer.props[id])
				layer0 = layer
			}
		}
		delete pv.tag
		return pv
	}

	component.instance_tag = function(id) {
		for (let k in xm.active_layers) {
			let props = xm.active_layers[k].props[id]
			if (props && props.tag)
				return props.tag
		}
	}

	component.init_instance = function(e, opt) {
		let pv
		opt.id = opt.id || e.id
		if (!opt.id) {
			delete opt.id
			// ^^ because `e.id = ''` sets the id attribute instead of removing it.
			// && because `e.id = null` sets the id to "null" so we can't win.
		}
		if (opt.id == '<new>') {
			assert(e.tag)
			assert(opt.module)
			opt.id = xm.next_id(opt.module)
			xm.set_val(null, opt.id, 'type', e.tag, null, null, null, opt.module)
			pv = empty_obj
		} else if (opt.id) {
			pv = prop_vals(opt.id)
			opt.module = opt.id.match(/^[^_\d]+/)[0]
		}

		// Set init values as default values, which assumes that init values
		// i.e. html attrs as well as values passed to (or returned from) the
		// component init function are static!
		// If instead these values are dynamic for the same id, then they
		// won't be saved right! To fix that, set nodefault="prop1 ..."
		// for the props that don't have a static default value.
		e.xoff()
		for (let k in opt)
			e.set_prop(k, opt[k])
		e.xon()

		if (e.id) {
			e.xmodule_generation = generation

			e.__nodefault = opt.nodefault ? set(words(opt.nodefault)) : empty_set

			// override prop vals.
			e.__pv0 = obj()
			for (let k in pv)
				e.set_prop(k, pv[k])
		}
	}

	function update_instance(e) {
		if (e.xmodule_generation == generation)
			return
		assert(e.id)
		e.xmodule_generation = generation
		e.xoff()
		let pv = prop_vals(e.id)
		let pv0 = attr(e, '__pv0') // initial vals of overridden props.
		// restore prop vals that are not present in this override.
		for (let k in pv0)
			if (!(k in pv)) {
				e.set_prop(k, pv0[k])
				delete pv0[k]
			}
		// apply this override, saving current vals that were not saved before.
		for (let k in pv) {
			if (!(k in pv0))
				pv0[k] = e.get_prop(k)
			e.set_prop(k, pv[k])
		}
		e.xon()
	}

	xm.bind_instance = function(e, on) {
		assert(e.id)
		if (on) {
			attr(xm.instances, e.id, array).push(e)
			update_instance(e)
		} else {
			let t = xm.instances[e.id]
			t.remove_value(e)
			if (!t.length)
				delete xm.instances[e.id]
		}
	}

	listen('bind', function(e, on) {
		xm.bind_instance(e, on)
		document.fire('widget_tree_changed')
	})

	// saving prop vals into prop layers --------------------------------------

	xm.prop_module_slot_layer = function(e, prop) {
		let attrs = e.get_prop_attrs(prop)
		let slot = xm.selected_slot || attrs.slot || 'base'
		let module = xm.selected_module || attrs.module
		let layer = xm.active_layers[module+':'+slot]
		return [module, slot, layer]
	}

	let debug_msgs = obj()

	xm.set_val = function(e, id, k, v, v0, dv, slot, module, serialize) {
		slot = xm.selected_slot || slot || 'base'
		if (slot == 'none')
			return
		module = xm.selected_module || module
		let layer = module && xm.active_layers[module+':'+slot]
		if (v === dv && !e.__nodefault.has(k))
			v = undefined // don't save defaults.
		else if (serialize)
			v = serialize.call(e, k, v)
		if (!layer) {
			if (module)
				debug_msgs[id+'.'+k] = 'prop-val-lost ['+module+':'+slot+'] '
					+id+'.'+k+' '+(repl(v, undefined, '[remove]'))
			return
		}
		let t = attr(layer.props, id)
		if (t[k] === v) // value already stored.
			return
		layer.modified = true
		let pv0 = e && attr(e, '__pv0')
		if (v === undefined) { // `undefined` signals removal.
			if (k in t) {
				debug_msgs[id+'.'+k] = 'prop-val-deleted ['+module+':'+slot+'='+layer.name+'] '+id+' '+k
				delete t[k]
				if (pv0)
					delete pv0[k] // no need to keep this anymore.
			}
		} else {
			if (pv0 && !(k in pv0)) // save current val if it wasn't saved before.
				pv0[k] = v0
			t[k] = v
			debug_msgs[id+'.'+k] = 'prop-val-set ['+module+':'+slot+'='+layer.name+'] '+id+' '+k+' '+json(v)
		}

		// synchronize other instances of this id.
		let instances = xm.instances[id] || empty_array
		for (let e1 of instances) {
			if (e1 != e) {
				e1.xoff()
				let pv0 = attr(e1, '__pv0')
				if (!(k in pv0)) // save current val if it wasn't saved before.
					pv0[k] = e1.get_prop(k)
				e1.set_prop(k, v)
				e1.xon()
			}
		}

	}

	listen('prop_changed', function(e, k, v, v0) {
		if (!e.id)
			return
		let pa = e.get_prop_attrs(k)
		if (!pa || pa.private)
			return
		xm.set_val(e, e.id, k, v, v0, pa.default, pa.slot, e.module, e.serialize_prop)
	})

	// loading prop layers and assigning to slots -----------------------------

	xm.set_layer = function(module, slot, layer, opt) {
		opt = opt || empty
		generation++
		let [layer0, layer1] = set_active_layer(module, slot, layer)
		if (opt.update_instances !== false) {
			let ids1 = layer1 && layer1.props
			let ids0 = layer0 && layer0.props
			for (let id in xm.instances)
				if ((ids1 && ids1[id]) || (ids0 && ids0[id]))
					for (let e of xm.instances[id])
						update_instance(e)
			if (module && slot)
				document.fire('prop_layer_slots_changed')
		}
	}

	// id generation ---------------------------------------------------------

	xm.next_id = function(module) {
		let ret_id
		ajax({
			url: '/xmodule-next-id/'+assert(module),
			method: 'post',
			async: false,
			success: id => ret_id = id,
		})
		return ret_id
	}

	// loading & saving prop layers -------------------------------------------

	function get_layer(name) {
		let t = xm.layers[name]
		if (!t) {
			let props
			if (name.starts('local:')) {
				let shortname = name.replace(/^local\:/, '')
				props = json_arg(load('xmodule-layers/'+shortname))
			} else {
				ajax({
					url: '/xmodule-layer.json/'+name,
					async: false,
					success: function(props1) {
						props = props1
					},
					fail: function(err, how, status) {
						assert(how == 'http' && status == 404)
					},
				})
			}
			t = {name: name, props: props || obj()}
			t.root_id = t.props['<root>']
			xm.layers[name] = t
		}
		return t
	}

	xm.save = function() {
		for (let k in debug_msgs)
			debug(debug_msgs[k])
		debug_msgs = obj()
		for (let name in xm.layers) {
			let t = xm.layers[name]
			if (t.modified) {
				function saved() {
					debug('layer-saved', name)
					t.modified = false
				}
				if (name.starts('local:')) {
					let shortname = name.replace(/^local\:/, '')
					save('xmodule-layers/'+shortname, json(t.props))
					saved(t)
				} else if (!t.save_request) {
					t.save_request = ajax({
						url: '/xmodule-layer.json/'+name,
						upload: json(t.props, null, '\t'),
						headers: {'content-type': 'application/json'},
						done: () => t.save_request = null,
						success: saved,
					})
				}
			}
		}
	}

	init_prop_layers()

}

