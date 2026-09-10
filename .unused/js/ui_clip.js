//// CLIP --------------------------------------------------------------------

const CMD_CLIP     = cmd('clip')
const CMD_END_CLIP = cmd('end_clip')

const CMD_CLIP_CT_I = 0

ui.clip     = function() { return ui_cmd(CMD_CLIP, ui.ct_i()) }
ui.end_clip = function() { return ui_cmd(CMD_END_CLIP) }

draw[CMD_CLIP] = function(a, i) {
	let ct_i = a[i+CMD_CLIP_CT_I]
	let x = a[ct_i+0]
	let y = a[ct_i+1]
	let w = a[ct_i+2]
	let h = a[ct_i+3]
	cx.save()
	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.clip()
}

draw[CMD_END_CLIP] = function() {
	cx.restore()
}
