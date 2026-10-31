{
let test_template = {
	t: 'v', fr: 2, gap: 20, e: [
		{t: 'text', id: 't1', s: 'TP Hello!'},
		{t: 'stack', id: 'st1', fr: 1, e: [
			{t: 'bb', bg_color: 'bg3'},
		]},
	]}
demos.template = function() {
ui.template('tpl1', test_template)
}
}

