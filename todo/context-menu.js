
// ---------------------------------------------------------------------------
// context menu
// ---------------------------------------------------------------------------

component('x-context-menu', function(e) {

	// TODO:

	let cmenu

	function close_context_menu() {
		if (cmenu) {
			cmenu.close()
			cmenu = null
		}
	}

	e.on('rightpointerdown', close_context_menu)

	e.on('contextmenu', function(ev) {

		close_context_menu()

		if (update_mouse(ev))
			fire_pointermove()

		let items = []

		if (tool.context_menu)
			items.extend(tool.context_menu())

		cmenu = menu({
			items: items,
		})

		cmenu.popup(e, 'inner-top', null, null, null, null, null, mouse.x, mouse.y)

		return false
	})

})
