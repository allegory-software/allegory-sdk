(function () {
"use strict"
const G = window

/*

TODO:

- Lua tokenizer -> tokens array
- Lua parser -> AST
	- tabs are separate tokens
	- newlines are separate tokens
- line_number -> start_node array
- tree rendering
	- syntax highlighting
	- tab size adjustment
	- show spaces with dots
	- matching parens highlight
	-
- tree hit-testing
- line numbers rendering
- tree editing
	- cursor movement between tokens
	- cursor movement within token
	- insert char (split token)
	- delete char (merge tokens)
	- linear selection
	- node selection
	- block selection
	- indent / outdent lines
	- indent / outdent block
	- cut, copy, paste
	- multiple cursors
- code navigation
	-

*/


let VIEW_ID  = ui.S-1
let VIEW_AST = ui.S+0

let view = {}

view.create = function(cmd, id, ast, fr, align, valign, min_w, min_h) {
	ui.keepalive(id)
	let ss = ui.state(id)
	return ui.cmd_box(cmd, fr, align, valign, min_w, min_h, id, ast)
}

function draw_node(cx, x, y, x0, node) {
	let s = node.s
	let m = ui.measure_text(cx, s)
	let asc = m.fontBoundingBoxAscent
	let dsc = m.fontBoundingBoxDescent
	cx.fillStyle = 'white'
	cx.fillText(s, x, y + asc)
	if (s == '\n') {
		y += (asc + dsc) * 1.5
		x = x0
	} else {
		x += m.width
	}
	if (node.c)
		for (let cnode of node.c)
			[x, y] = draw_node(cx, x, y, x0, cnode)
	return [x, y]
}

view.draw = function(a, i) {
	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let id  = a[i+VIEW_ID]
	let ast = a[i+VIEW_AST]

	let cx = ui.cx

	cx.fillStyle = 'black'
	cx.fillRect(x, y, w, h)

	cx.save()
	cx.font = '22px Monospace'
	draw_node(cx, x, y, x, ast.root)
	cx.restore()

}

view.hit = function(a, i) {
	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let id = a[i+VIEW_ID]
}

ui.box_widget('ast_edit_view', view)

ui.ast_edit = function(...args) {
	//ui.m(ui.sp() * 10)
	ui.ast_edit_view(...args)
}

}()) // module function
