// Run with: node tests/ui_call_e2ee_test.mjs

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
	import_frame_key, encrypt_frame, decrypt_frame,
} from '../www/ui_call_e2ee.js'

const overhead = 28 // tag and nonce bytes added to every frame

function make_frame(size) {
	let data = new Uint8Array(size) // distinct test frame bytes
	for (let i = 0; i < size; i++) data[i] = (i * 7 + 1) & 255
	return data
}

async function make_key() {
	return import_frame_key(crypto.getRandomValues(new Uint8Array(16)))
}

test('round trips keep only the VP8 header unencrypted', async () => {
	let key = await make_key() // test media key
	for (let [kind, type, header_n, sizes] of [
		['audio', undefined, 0, [0, 1, 80]],
		['video', 'key', 10, [0, 5, 10, 11, 500]],
		['video', 'delta', 3, [0, 2, 3, 4, 500]],
	])
		for (let size of sizes) {
			let data = make_frame(size) // plaintext frame
			let frame = await encrypt_frame(key, kind, type, data) // wire
			let n = Math.min(header_n, size) // expected unencrypted bytes
			assert.equal(frame.length, size + overhead)
			assert.deepEqual(frame.subarray(0, n), data.subarray(0, n))
			if (size > n)
				assert.notDeepEqual(frame.subarray(n, size), data.subarray(n))
			assert.deepEqual(await decrypt_frame(key, kind, type, frame), data)
		}
})

test('every frame gets a fresh nonce', async () => {
	let key = await make_key() // test media key
	let data = make_frame(100) // repeated plaintext frame
	let frame1 = await encrypt_frame(key, 'video', 'delta', data)
	let frame2 = await encrypt_frame(key, 'video', 'delta', data)
	assert.notDeepEqual(frame1.subarray(-12), frame2.subarray(-12))
	assert.notDeepEqual(frame1, frame2)
})

test('modified bytes, wrong key and wrong frame type are rejected',
async () => {
	let key = await make_key() // test media key
	let frame = // encrypted VP8 keyframe
		await encrypt_frame(key, 'video', 'key', make_frame(100))
	let positions = [ // header, ciphertext, tag and nonce bytes
		0, 9, 10, 99, 100, 115, 116, 127,
	]
	for (let byte_i of positions) {
		let modified = frame.slice() // frame with one flipped bit
		modified[byte_i] ^= 1
		assert.equal(await decrypt_frame(key, 'video', 'key', modified), null)
	}
	assert.equal(await decrypt_frame(await make_key(), 'video', 'key',
		frame), null)
	assert.equal(await decrypt_frame(key, 'video', 'delta', frame), null)
	assert.equal(await decrypt_frame(key, 'audio', undefined, frame), null)
})

test('truncated frames are rejected', async () => {
	let key = await make_key() // test media key
	let frame = // encrypted Opus frame
		await encrypt_frame(key, 'audio', undefined, make_frame(80))
	for (let size = 0; size < frame.length; size++)
		assert.equal(await decrypt_frame(key, 'audio', undefined,
			frame.subarray(0, size)), null)
})
