/*

	e.on_element(id, event_name, f, [on])


LINKED ELEMENTS

	e.set_linked_element(k, id|null)
	^e.linked_element_bind(k, te, on)
	^e.linked_element_id_changed(k, id1, id0)


*/

// register an event on an external element identified by id.
// the event is only active while both this element and the external element are bound.
e.on_element = function(id, name, f, on) {

	let handlers = obj() // id->{name->f}

	function elem_bind(te, on) {
		let hs = handlers[te.id]
		if (!hs) return
		for (let name in hs)
			te.on(name, hs[name], on)
	}

	e.on_bind(function(on) {
		window.on('element_bind', elem_bind, on)
		window.on('element_id_changed', elem_bind, on)
		for (let id in handlers) {
			let te = window[id]
			if (!iselem(te)) continue
			if (on && !te.bound) continue
			let hs = handlers[id]
			for (let name in hs)
				te.on(hs[name], f, on)
		}
	})

	e.on_element = function(id, name, f, on) {
		if (on)
			attr(handlers, id)[name] = f
		else {
			let hs = handlers[id]
			if (hs) delete hs[name]
			if (!count_keys(hs, 1)) delete handlers[id]
		}
	}

	e.on_element(id, name, f, on)
}




/* id-based dynamic binding of external elements -----------------------------

methods:
	e.set_linked_element(k, id|null)
	^e.linked_element_bind(k, te, on)
	^e.linked_element_id_changed(k, id1, id0)

*/
e.do_linked_element_bind = function(k, te, on) {
	this.fire('linked_element_bind', k, te, on)
}
e.set_linked_element = function(k, id1) {

	let e = this

	let links = map() // k->te
	let all_keys = map() // id->set(K)

	e.set_linked_element = function(k, id1) {
		let te1 = id1 != null && resolve_linked_element(id1)
		let te0 = links.get(k)
		if (te0) {
			let id0 = te0.id
			if (te1 == te0)
				return
			let keys = all_keys.get(id0)
			keys.delete(k)
			if (!keys.size)
				all_keys.delete(id0)
			if (te0.bound)
				e.do_linked_element_bind(k, te0, false)
		}
		links.set(k, te1)
		if (id1)
			attr(all_keys, id1, set).add(k)
		if (te1)
			e.do_linked_element_bind(k, te1, true)
	}

	function element_bind(te, on) { // ^window.element_bind
		let keys = all_keys.get(te.id)
		if (!keys) return
		te = resolve_linked_element(te.id)
		if (!te) return
		for (let k of keys) {
			links.set(k, on ? te : null)
			e.do_linked_element_bind(k, te, on)
		}
	}

	function element_id_changed(te, id1, id0) { // ^window.element_id_changed
		let keys = all_keys.get(id0)
		if (!keys) return
		for (let k of keys)
			e.fire('linked_element_id_changed', k, id1, id0)
		all_keys.delete(id0)
		all_keys.set(id1, keys)
	}

	e.on_bind(function(on) {
		for (let [id, keys] of all_keys) {
			for (let k of keys) {
				if (on) {
					let te = resolve_linked_element(id)
					if (te) {
						links.set(k, te)
						e.do_linked_element_bind(k, te, true)
					}
				} else {
					let te = links.get(k)
					if (te) {
						links.set(k, null)
						e.do_linked_element_bind(k, te, false)
					}
				}
			}
		}
		window.on('element_bind', element_bind, on)
		window.on('element_id_changed', element_id_changed, on)
	})

	e.set_linked_element(k, id1)
}


