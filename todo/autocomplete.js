/* <autocomplete> ------------------------------------------------------------

in props:

update opt:
	input

*/

css('.autocomplete', 'b v-s p-input bg-input z3', `
	resize: both;
`)

G.autocomplete = component('autocomplete', 'Input', function(e) {

	e.class('autocomplete')
	e.make_disablable()
	e.init_child_components()

	e.prop_vals.list = e.$1('list')

	if (!e.prop_vals.list) { // static list
		e.prop_vals.list = div()
		for (let ce of [...e.at])
			e.prop_vals.list.add(ce)
		e.prop_vals.list.make_list_items_focusable()
		e.clear()
	}

	function bind_list(list, on) {
		if (!list) return
		if (on) {
			list.make_list_items_focusable({multiselect: false})
			list_items_changed.call(list)
			list.class('dropdown-picker')
			list.make_popup(null, 'bottom', 'start')
			list.hide()
			list.on('search', function() {
				e.open()
			})
			e.add(list)
		} else {
			list.del()
		}
		e.update({value: true})
	}

	e.set_list = function(list1, list0) {
		bind_list(list0, false)
		bind_list(list1, true)
	}

	e.prop('list', {private: true})

	function item_value(item_e, k) {
		if (item_e.data != null) { // dynamic list with a data model
			return item_e.data[k]
		} else { // static list, value kept in a prop or attr.
			return strict_or(item_e[k], item_e.attr(k))
		}
	}

	function input_input(ev) {
		e.update({input: this.value, show: !!this.value})
	}

	e.on_update(function(opt) {
		if (opt.input) {
			let list = this
			for (let i = 0, n = list.list_len; i < n; i++) {
				let item_e = list.at[i]
				let text = item_value(item_e, 'text')
				let matches = text != null && text.starts(prefix)
				// if (matches)
				item_e.show(matches)
			}
		}
	})

	e.bind_input = function(input, on) {
		if (warn_if(input.tag != 'input', 'autocomplete: not an input tag: {0}', e.input_id))
			return
		input.on('input', input_input, on)
		e.popup_target = on ? input : null
		e.show(!!input.value)
	}

	e.prop('input_id', {type: 'id', attr: 'for', on_bind: e.bind_input})

	e.make_popup(null, 'bottom', 'start')
	e.hide()

})



<!--------------------------------------------------------------------------->

<xmp id=autocomplete_demo>
<input id=my_input>
<autocomplete id=my_auto for=my_input>
	<div text="">Option 1</div>
</autocomplete>
</xmp>

