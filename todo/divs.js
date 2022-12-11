/* Virtual DOM: WIP ------------------------------------------------------- */

function V(tag, attrs, ...child_nodes) {
	return {tag: tag, attrs: attrs, child_nodes: child_nodes}
}

(function() {
	function same_nodes(t, items) {
		if (t.length != items.length)
			return false
		for (let i = 0; i < t.length; i++) {
			let id0 = items[i].id
			let id1 = isstr(t[i]) ? t[i] : t[i].id
			if (!id1 || !id0 || id1 != id0)
				return false
		}
		return true
	}
	method(Element, 'set_vdom', function(vdom_nodes) {
		for (let i = 0, n = vdom_nodes.length; i < n; i++) {
			let v = vdom_nodes[i]
		}
	})
})()

