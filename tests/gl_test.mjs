// run: node tests/gl_test.mjs [path/to/gl.js] [path/to/3d.js]
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const sdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = {
	'/glue.js': path.join(sdk, 'www/glue.js'),
	'/3d.js': process.argv[3] ?? path.join(sdk, 'www/3d.js'),
	'/gl.js': process.argv[2] ?? path.join(sdk, 'www/gl.js'),
}
const page_html = `<!DOCTYPE html><canvas id=c width=16 height=16></canvas>
<script src=glue.js global></script>
<script src=3d.js global></script>
<script src=gl.js></script>`

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
await page.goto(`http://127.0.0.1:${server.address().port}/`)

const results = await page.evaluate(() => {
	const results = []
	const canvas = document.getElementById('c')
	const gl = canvas.getContext('webgl2', {antialias: false})
	if (!gl)
		return [['no webgl2 context']]
	function check(name, f) {
		let r
		try {
			r = f()
		} catch (e) {
			r = 'threw: ' + e.message
		}
		let err = gl.getError()
		if (r === true && err)
			r = 'gl error ' + err
		while (gl.getError()) {}
		if (r !== true)
			results.push([name, r === false ? '' : String(r)])
	}
	const px = (x = 8, y = 8) => {
		let a = new Uint8Array(4)
		gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a)
		return Array.from(a)
	}
	const eq = (a, b) => a.length == b.length && a.every((x, i) => x == b[i])
	const sh = {
		vs: `#version 300 es
			in vec3 pos;
			void main() { gl_Position = vec4(pos, 1.); }`,
		fs: `#version 300 es
			precision mediump float;
			out vec4 color;
			void main() { color = vec4(1., 0., 0., 1.); }`,
		vs_inst: `#version 300 es
			in vec3 pos;
			in vec3 off;
			void main() { gl_Position = vec4(pos + off, 1.); }`,
		fs_uni: `#version 300 es
			precision mediump float;
			uniform mat4 m;
			uniform vec3 c3;
			out vec4 color;
			void main() { color = vec4(m[1][1], m[0][0], c3.x, 1.); }`,
		fs_ub: `#version 300 es
			precision mediump float;
			layout(std140) uniform G { vec4 col; float k; };
			out vec4 color;
			void main() { color = col * k; }`,
		fs_tex: `#version 300 es
			precision mediump float;
			uniform sampler2D t;
			out vec4 color;
			void main() { color = texture(t, vec2(.5)); }`,
	}
	const tri = [-1, -1, 0,  3, -1, 0,  -1, 3, 0] // covers the viewport
	const clear = () => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.COLOR_BUFFER_BIT)
	}

	check('gl.program links and reports a link error', () => {
		let msg
		try {
			gl.program('bad_link',
				`#version 300 es
				in vec3 pos; out vec3 v;
				void main() { v = pos; gl_Position = vec4(pos, 1.); }`,
				`#version 300 es
				precision mediump float; in vec4 v; out vec4 color;
				void main() { color = v; }`)
		} catch (e) { msg = e.message }
		return /linking failed/.test(msg) || 'got: ' + msg
	})

	check('program + vao + draw_triangles (non-indexed)', () => {
		clear()
		let p = gl.program('p1', sh.vs, sh.fs)
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('draw_triangles indexed', () => {
		clear()
		let p = gl.program('p1', sh.vs, sh.fs)
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		vao.set_index(gl.index_buffer([0, 1, 2]))
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('draw_triangles indexed with element offset', () => {
		clear()
		let p = gl.program('p1', sh.vs, sh.fs)
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer([...tri, ...tri]))
		vao.set_index(gl.u16_index_buffer([0, 0, 0, 3, 4, 5]))
		gl.draw_triangles(3, 3) // second triangle, 3 elements in
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('instanced draw', () => {
		clear()
		let p = gl.program('p_inst', sh.vs_inst, sh.fs)
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		vao.set_attr('off', gl.v3_instance_buffer([0, 0, 0]))
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('index_buffer infers u16 from max index', () => {
		let b = gl.index_buffer([0, 1, 300])
		return b.type == 'u16' || 'type ' + b.type
	})

	check('shared gl.vao(programs)', () => {
		let p = gl.program('p1', sh.vs, sh.fs)
		let vao = gl.vao([p])
		return !!vao
	})

	check('prog.free without vaos', () => {
		let p = gl.program('p_free', sh.vs, sh.fs)
		p.free()
		return true
	})

	check('vao.free', () => {
		let p = gl.program('p_vf', sh.vs, sh.fs)
		let vao = p.vao()
		vao.free()
		return true
	})

	check('uniform mat4 first upload carries the value', () => {
		clear()
		let p = gl.program('p_uni', sh.vs, sh.fs_uni)
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		let m = mat4f32(); m[0] = .5; m[5] = 1
		p.set_uni('m', m)
		p.set_uni('c3', 0xff0000)
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 128, 255, 255]) || 'pixel ' + r
	})

	check('ubo', () => {
		clear()
		let p = gl.program('p_ub', sh.vs, sh.fs_ub)
		let ubo = gl.ubo('G')
		ubo.set('col', v4(1, 0, 0, 1))
		ubo.set('k', 1)
		ubo.upload().bind()
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('ubo.free releases the buffer and the binding slot', () => {
		clear()
		let p = gl.program('p_ub', sh.vs, sh.fs_ub)
		let ubo = gl.ubo('G')
		ubo.set('col', v4(1, 0, 0, 1))
		ubo.set('k', 1)
		ubo.upload().bind()
		ubo.free()
		if (gl.isBuffer(ubo.buffer))
			return 'buffer not deleted'
		let ubo2 = gl.ubo('G')
		ubo2.set('col', v4(0, 1, 0, 1))
		ubo2.set('k', 1)
		ubo2.upload().bind()
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		ubo2.free()
		return eq(r, [0, 255, 0, 255]) || 'pixel ' + r
	})

	check('texture set_rgba samples after set_filter', () => {
		clear()
		let p = gl.program('p_tex', sh.vs, sh.fs_tex)
		let t = gl.texture()
		t.set_rgba(1, 1, new Uint8Array([255, 0, 0, 255]))
		t.set_filter('nearest', 'nearest')
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		p.set_uni('t', t)
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('gl.set_uni sets a sampler on a program used later', () => {
		clear()
		let p = gl.program('p_tex_global', sh.vs, sh.fs_tex)
		let t = gl.texture()
		t.set_rgba(1, 1, new Uint8Array([0, 255, 0, 255]))
		t.set_filter('nearest', 'nearest')
		gl.set_uni('t', t)
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [0, 255, 0, 255]) || 'pixel ' + r
	})

	check('gl.set_uni updates the active program', () => {
		clear()
		let p = gl.program('p_tex_global', sh.vs, sh.fs_tex)
		let t = gl.texture()
		t.set_rgba(1, 1, new Uint8Array([0, 0, 255, 255]))
		t.set_filter('nearest', 'nearest')
		let vao = p.vao()
		vao.use()
		vao.set_attr('pos', gl.v3_buffer(tri))
		gl.set_uni('t', t)
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [0, 0, 255, 255]) || 'pixel ' + r
	})

	check('buffer upload/download round trip', () => {
		let b = gl.f32_buffer(4)
		b.upload(new Float32Array([1, 2, 3, 4]))
		let a = b.download(new Float32Array(4))
		return eq(Array.from(a), [1, 2, 3, 4]) || 'got ' + Array.from(a)
	})

	check('v3 buffer len and arr', () => {
		let b = gl.v3_buffer([1, 2, 3, 4, 5, 6])
		return b.len == 2 && b.arr().length == 6 || 'len ' + b.len
	})

	check('dyn_buffer grow keeps contents', () => {
		let db = gl.dyn_f32_buffer(2)
		db.buffer.upload(new Float32Array([7, 8]))
		db.grow(100)
		let a = db.buffer.download(new Float32Array(2))
		return eq(Array.from(a), [7, 8]) || 'got ' + Array.from(a)
	})

	check('dyn_index_buffer grow_type keeps contents', () => {
		let db = gl.dyn_index_buffer([0, 1, 2], 'u8')
		db.grow_type(70000)
		if (db.arr_type != Uint32Array)
			return 'arr_type ' + db.arr_type.name
		let a = db.buffer.download(db.buffer.arr())
		return eq(Array.from(a), [0, 1, 2]) || 'got ' + Array.from(a)
	})

	check('dyn_arr_buffer set/upload', () => {
		let dab = gl.dyn_arr_v3_buffer(4)
		dab.len = 2
		dab.array.set([1, 2, 3, 4, 5, 6])
		dab.upload()
		let a = dab.buffer.download(new Float32Array(6))
		return eq(Array.from(a), [1, 2, 3, 4, 5, 6]) || 'got ' + Array.from(a)
	})

	check('dyn_arr_buffer grow returns this', () => {
		let dab = gl.dyn_arr_v3_buffer(4)
		return dab.grow(100) === dab
	})

	check('dyn_arr_vertex_buffer + set_attrs draw', () => {
		clear()
		let p = gl.program('p1', sh.vs, sh.fs)
		let davb = gl.dyn_arr_vertex_buffer({pos: 'v3'}, 3)
		davb.len = 3
		davb.pos.array.set(tri)
		davb.upload()
		let vao = p.vao()
		vao.use()
		vao.set_attrs(davb)
		gl.draw_triangles()
		let r = px()
		vao.unuse()
		return eq(r, [255, 0, 0, 255]) || 'pixel ' + r
	})

	check('rbo.free', () => {
		let r = gl.rbo().set_rgba(4, 4)
		r.free()
		return true
	})

	check('rbo multisample', () => {
		let r = gl.rbo().set_rgba(4, 4, 4)
		r.bind()
		let n = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES)
		return n > 1 && n == r.n_samples || `allocated ${n}, rbo.n_samples ${r.n_samples}`
	})

	check('fbo draw + read_pixels at x,y', () => {
		let f = gl.fbo()
		let pixels = new Uint8Array(4 * 4 * 4) // r = 10 * x, g = 10 * y
		for (let y = 0; y < 4; y++)
			for (let x = 0; x < 4; x++)
				pixels.set([10 * x, 10 * y, 0, 255], 4 * (4 * y + x))
		let t = gl.texture().set_rgba(4, 4, pixels)
		f.bind('draw')
		f.attach(t, 'color')
		let a = f.read_pixels('color', 0, null, 1, 2, 2, 1)
		f.unbind()
		return a.length == 8 && eq(Array.from(a.slice(0, 4)), [10, 20, 0, 255]) || 'got ' + Array.from(a)
	})

	check('gl.clear_all on a depth-only fbo', () => {
		let f = gl.fbo()
		let t = gl.texture().set_rgba(4, 4, null)
		let d = gl.texture().set_depth(4, 4)
		f.bind('draw')
		f.attach(t, 'color')
		f.attach(d, 'depth')
		gl.clear_all(0, 0, 0, 1)
		f.unbind()
		return true
	})

	check('gl.blit mask accepts color+depth', () => {
		let src = gl.fbo(), dst = gl.fbo()
		let t1 = gl.texture().set_rgba(4, 4, null), t2 = gl.texture().set_rgba(4, 4, null)
		let d1 = gl.texture().set_depth(4, 4), d2 = gl.texture().set_depth(4, 4)
		src.bind('draw'); src.attach(t1, 'color'); src.attach(d1, 'depth'); src.unbind()
		dst.bind('draw'); dst.attach(t2, 'color'); dst.attach(d2, 'depth'); dst.unbind()
		// only observable through the call arguments:
		let args
		let f = gl.blitFramebuffer
		gl.blitFramebuffer = function(...a) { args = a; return f.apply(this, a) }
		gl.blit(src, 'color', 0, dst, 'color', 'color depth')
		delete gl.blitFramebuffer
		let mask = args[8]
		return mask == (gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT) || 'mask ' + mask
	})

	check('start_trace / stop_trace', () => {
		gl.start_trace()
		let p = gl.program('p1', sh.vs, sh.fs)
		p.use()
		let t = gl.stop_trace()
		p.unuse()
		return t._n > 0 || 'n ' + t._n
	})

	check('gl.cull', () => {
		gl.cull('back'); gl.cull('front'); gl.cull(null)
		return !gl.isEnabled(gl.CULL_FACE)
	})

	return results
})

for (let [name, msg] of results)
	console.log('FAIL', name, msg)
console.log(results.length ? `${results.length} failed` : 'all passed')
await browser.close()
server.close()
process.exit(results.length ? 1 : 0)
