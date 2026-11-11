// run: node tests/gl_renderer_test.mjs [path/to/gl_renderer.js]
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const sdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = {
	'/glue.js': path.join(sdk, 'www/glue.js'),
	'/3d.js': path.join(sdk, 'www/3d.js'),
	'/gl.js': path.join(sdk, 'www/gl.js'),
	'/earcut.js': path.join(sdk, 'www/earcut.js'),
	'/gl_renderer.js': process.argv[2] ?? path.join(sdk, 'www/gl_renderer.js'),
}
const page_html = `<!DOCTYPE html><canvas id=c width=64 height=64></canvas>
<script src=glue.js global></script>
<script src=earcut.js></script>
<script src=3d.js global></script>
<script src=gl.js></script>
<script src=gl_renderer.js></script>`

const server = http.createServer(async (req, res) => {
	if (req.url == '/') {
		res.setHeader('content-type', 'text/html')
		return res.end(page_html)
	}
	if (!files[req.url]) {
		res.statusCode = 404
		return res.end()
	}
	res.setHeader('content-type', 'text/javascript')
	res.end(await fs.readFile(files[req.url]))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))

const browser = await chromium.launch({channel: 'chrome', headless: true,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
const page = await browser.newPage()
page.on('pageerror', e => console.log('PAGE ERROR', e.message))
page.on('console', m => { if (m.type() == 'error') console.log('CONSOLE', m.text().slice(0, 300)) })
await page.goto(`http://127.0.0.1:${server.address().port}/`)

const results = await page.evaluate(() => {
	const results = []
	const canvas = document.getElementById('c')
	const gl = canvas.getContext('webgl2', {antialias: false})
	canvas.cw = 64
	canvas.ch = 64
	function check(name, f) {
		let r
		if (gl.active_vao)
			gl.active_vao.unuse()
		if (gl.active_program)
			gl.active_program.unuse()
		try {
			r = f()
		} catch (e) {
			r = 'threw: ' + e.message + ' @ ' +
				(e.stack || '').split('\n').slice(1, 4).map(s => s.trim().replace(/http:\/\/[^/]+\//, '')).join(' | ')
		}
		let err = gl.getError()
		if (r === true && err)
			r = 'gl error ' + err
		while (gl.getError()) {}
		if (r !== true)
			results.push([name, r === false ? '' : String(r)])
	}
	const px = (x, y) => {
		let a = new Uint8Array(4)
		gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a)
		return Array.from(a)
	}
	// brightest red value in a column: 1px lines can land on either side of y.
	const column_max = x => {
		let m = 0
		for (let y = 28; y < 36; y++)
			m = Math.max(m, px(x, y)[0])
		return m
	}
	const eq = (a, b) => a.length == b.length && a.every((x, i) => x == b[i])

	// scene_renderer needs the `globals` UB, which a program must register
	// first (the editor creates other renderers before the scene renderer).
	gl.points_renderer()

	function make_camera() {
		let c = camera3({pos: v3(0, 0, 5), dir: v3(0, 0, 1), up: v3(0, 1, 0)})
		c.view_size.set(64, 64)
		c.ortho(-1, 1, -1, 1, -100, 100)
		c.update()
		return c
	}

	function square_face() {
		let f = poly3(0, 1, 2, 3)
		f.points = [-1, -1, 0,  1, -1, 0,  1, 1, 0,  -1, 1, 0]
		f.i = 1
		return f
	}

	check('scene_renderer', () => {
		let r = gl.scene_renderer({camera: make_camera()})
		return !!r.render
	})

	check('scene_renderer with shadows', () => {
		let r = gl.scene_renderer({camera: make_camera(), enable_shadows: true,
			shadow_map_resolution: 64})
		r.update()
		return true
	})

	check('faces_renderer samples the diffuse map across the face (uv)', () => {
		let cam = make_camera()
		let r = gl.scene_renderer({camera: cam, ambient_strength: 1,
			sunlight_dir: v3(0, 0, 1), background_color: v4(0, 0, 0, 1)})
		let rr = gl.faces_renderer()
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let tex = gl.texture().set_rgba(2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]))
		tex.set_filter('nearest', 'nearest')
		let mat = {diffuse_color: 0, diffuse_map: tex, uv: v2(.5, .5)}
		rr.update(0, new Map([[mat, [square_face()]]]))
		r.render(prog => rr.draw(prog))
		let left = px(16, 32), right = px(48, 32)
		return (left[0] > 200 && right[1] > 200) || `left ${left} right ${right}`
	})

	check('faces_renderer draws', () => {
		let cam = make_camera()
		let r = gl.scene_renderer({camera: cam, ambient_strength: 1,
			sunlight_dir: v3(0, 0, 1), background_color: v4(0, 0, 0, 1)})
		let rr = gl.faces_renderer()
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let mat = {diffuse_color: 0xff0000, uv: v2(1, 1)}
		rr.update(0, new Map([[mat, [square_face()]]]))
		r.render(prog => rr.draw(prog))
		let c = px(32, 32)
		return c[0] > 200 || 'pixel ' + c
	})

	check('shadow map: an occluder darkens the floor behind it', () => {
		let cam = camera3({pos: v3(0, 5, 0), dir: v3(0, 1, 0), up: v3(0, 0, -1)})
		cam.view_size.set(64, 64)
		cam.ortho(-4, 4, -4, 4, -100, 100)
		cam.update()
		let r = gl.scene_renderer({camera: cam, enable_shadows: true,
			shadow_map_resolution: 256, shadow_radius: 8, sunlight_dir: v3(1, 2, 0),
			background_color: v4(0, 0, 0, 1)})
		let rr = gl.faces_renderer()
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let quad = (s, y, i) => {
			let f = poly3(0, 1, 2, 3)
			f.points = [-s, y, -s,  -s, y, s,  s, y, s,  s, y, -s]
			f.i = i
			return f
		}
		let mat = {diffuse_color: 0xffffff, uv: v2(1, 1)}
		rr.update(0, new Map([[mat, [quad(3, 0, 1), quad(1, 1, 2)]]]))
		r.update()
		r.render(prog => rr.draw(prog))
		// the occluder (x in -1..1) shadows the floor at x in -1.5..0.5.
		let in_shadow = px(22, 32), lit = px(52, 32)
		return (lit[0] > in_shadow[0] + 50) ||
			`shadowed floor ${in_shadow}, lit floor ${lit}`
	})

	function shadow_scene(shadow_radius) {
		let cam = camera3({pos: v3(0, 5, 0), dir: v3(0, 1, 0), up: v3(0, 0, -1)})
		cam.view_size.set(64, 64)
		cam.ortho(-4, 4, -4, 4, -100, 100)
		cam.update()
		return gl.scene_renderer({camera: cam, enable_shadows: true,
			shadow_map_resolution: 256, shadow_radius, sunlight_dir: v3(1, 2, 0),
			background_color: v4(1, 1, 1, 1)})
	}

	function quad(s, y, i) {
		let f = poly3(0, 1, 2, 3)
		f.points = [-s, y, -s,  -s, y, s,  s, y, s,  s, y, -s]
		f.i = i
		return f
	}

	check('faces outside the shadow map are not shadowed', () => {
		let r = shadow_scene(1)
		let rr = gl.faces_renderer()
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let mat = {diffuse_color: 0xffffff, uv: v2(1, 1)}
		rr.update(0, new Map([[mat, [quad(3, 0, 1)]]]))
		r.update()
		r.render(prog => rr.draw(prog))
		let c = px(12, 32) // x = -2.5: past the far plane of the radius-1 map.
		return c[0] > 200 || 'floor outside the map ' + c
	})

	check('ground_plane_renderer shows only the shadows', () => {
		let r = shadow_scene(8)
		let rr = gl.faces_renderer()
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let g = gl.ground_plane_renderer({size: 6})
		let mat = {diffuse_color: 0xffffff, uv: v2(1, 1)}
		rr.update(0, new Map([[mat, [quad(1, 1, 2)]]]))
		r.update()
		r.render(prog => { g.draw(prog); rr.draw(prog) })
		// the occluder (x in -1..1, y = 1) shadows the ground at x in -1.5..0.5.
		let in_shadow = px(22, 32), lit = px(52, 32)
		return (lit[0] > 240 && in_shadow[0] < 150) ||
			`shadowed ground ${in_shadow}, lit ground ${lit}`
	})

	check('hit_test_renderer', () => {
		let cam = make_camera()
		let h = gl.hit_test_renderer()
		let rr = gl.faces_renderer()
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let mat = {diffuse_color: 0xff0000, uv: v2(1, 1)}
		let f = square_face(); f.i = 7
		rr.update(3, new Map([[mat, [f]]]))
		gl.scene_renderer({camera: cam})
		h.render(prog => rr.draw(prog))
		let r = h.hit_test(32, 32)
		return (r && r.comp_id == 3 && r.face_id == 7) || 'hit ' + JSON.stringify(r)
	})

	check('solid_lines_renderer', () => {
		let rr = gl.solid_lines_renderer()
		return !!rr.draw
	})
	check('points_renderer', () => !!gl.points_renderer().draw)
	check('dashed_lines_renderer', () => !!gl.dashed_lines_renderer().draw)
	check('fat_lines_renderer', () => !!gl.fat_lines_renderer().draw)

	check('fat_lines_renderer draws a line', () => {
		let cam = make_camera()
		let r = gl.scene_renderer({camera: cam, background_color: v4(0, 0, 0, 1)})
		let rr = gl.fat_lines_renderer({base_color: 0xffffff})
		rr.model = gl.mat4_instance_buffer(mat4f32())
		let lines = [line3(v3(-1, 0, 0), v3(1, 0, 0))]
		rr.update(f => { for (let l of lines) f(l) }, 1)
		r.render(prog => rr.draw(prog))
		let c = px(32, 32)
		return c[0] > 200 || 'pixel ' + c
	})

	check('helper_lines_renderer does not leak a global `line`', () => {
		delete window.line
		let h = gl.helper_lines_renderer()
		let l = h.line(line3(v3(-1, 0, 0), v3(1, 0, 0)), 0xff0000, 'solid')
		l.update()
		h.s.update()
		return !('line' in window) || 'global `line` created'
	})

	check('helper_lines_renderer draws solid and dashed', () => {
		let cam = make_camera()
		let r = gl.scene_renderer({camera: cam, background_color: v4(0, 0, 0, 1)})
		let h = gl.helper_lines_renderer()
		let l = h.line(line3(v3(-1, 0, 0), v3(1, 0, 0)), 0xffffff, 'solid')
		l.update()
		r.render(prog => h.draw(prog))
		let c = column_max(32)
		return c > 100 || 'brightest pixel in column ' + c
	})

	check('axes_renderer', () => {
		let a = gl.axes_renderer()
		let x = a.axes()
		x.update()
		return !!a.draw
	})

	check('axes_renderer draws', () => {
		let cam = make_camera()
		let r = gl.scene_renderer({camera: cam, background_color: v4(0, 0, 0, 1)})
		let a = gl.axes_renderer({x_color: 0xffffff})
		let x = a.axes()
		r.render(prog => a.draw(prog))
		let c = column_max(48)
		return c > 100 || 'brightest pixel in column ' + c
	})

	check('axes_renderer draws nothing and does not break with no axes()', () => {
		let cam = make_camera()
		let r = gl.scene_renderer({camera: cam, background_color: v4(0, 0, 0, 1)})
		let a = gl.axes_renderer({x_color: 0xffffff})
		r.render(prog => a.draw(prog))
		return eq(px(48, 32), [0, 0, 0, 255])
	})

	check('box_geometry', () => {
		let g = gl.box_geometry().set(2, 4, 6)
		return g.pos[0] == -1 && g.pos[1] == -2 && g.pos[2] == -3 &&
			g.pos[21] == -1 && g.pos[23] == 3 || 'pos ' + Array.from(g.pos)
	})

	check('skybox', () => {
		let s = gl.skybox({})
		s.update_view(v3(0, 0, 0))
		return !!s.draw
	})

	check('skybox with Image objects', () => {
		let s = gl.skybox({})
		s.images = {}
		for (let side of ['right', 'left', 'top', 'bottom', 'front', 'back'])
			s.images[side] = Object.assign(document.createElement('canvas'),
				{width: 4, height: 4})
		s.update()
		return true
	})

	check('shadow_map_quad', () => {
		if (gl.active_vao) gl.active_vao.unuse()
		if (gl.active_program) gl.active_program.unuse()
		let t = gl.texture().set_depth(4, 4)
		let q = gl.shadow_map_quad(t)
		q.update()
		q.free()
		return true
	})

	return results
})

for (let [name, msg] of results)
	console.log('FAIL', name, msg)
console.log(results.length ? `${results.length} failed` : 'all passed')
await browser.close()
server.close()
process.exit(results.length ? 1 : 0)
