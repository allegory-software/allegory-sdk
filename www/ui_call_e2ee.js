/*

	Audio/video frame encryption with browser Web Crypto.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES

	- Encrypt and authenticate Opus and VP8 frames with AES-128-GCM.
	- Keep the VP8 header unencrypted so that the receiving browser reads
	  the real frame type; authenticate it with the encrypted bytes.
	- Use a random 12-byte nonce for every frame.
	- Reject truncated frames and failed authentication.

API

	await import_frame_key(raw) -> key
	await encrypt_frame(key, kind, type, data) -> Uint8Array
	await decrypt_frame(key, kind, type, data) -> Uint8Array or null

	kind is 'audio' or 'video'. type is the encoded video frame type,
	'key' or 'delta'. Byte strings are Uint8Arrays.
	Frame layout: [VP8 header][ciphertext and 16-byte tag][12-byte nonce].
	The VP8 header is 3 bytes, or 10 bytes on a keyframe. Audio frames
	have no unencrypted bytes.
	decrypt_frame() returns null when the frame is truncated or fails
	authentication.

*/

const nonce_size = 12 // random AES-GCM nonce bytes
const tag_size = 16 // AES-GCM authentication tag bytes

function header_size(kind, type, size) {
	return Math.min(kind == 'audio' ? 0 : type == 'key' ? 10 : 3, size)
}

export function import_frame_key(raw) {
	return crypto.subtle.importKey('raw', raw, 'AES-GCM', false,
		['encrypt', 'decrypt'])
}

export async function encrypt_frame(key, kind, type, data) {
	let n = header_size(kind, type, data.length) // unencrypted header bytes
	let nonce = // random per-frame nonce
		crypto.getRandomValues(new Uint8Array(nonce_size))
	let ciphertext = new Uint8Array(await crypto.subtle.encrypt({
		name: 'AES-GCM', iv: nonce, tagLength: 128,
		additionalData: data.subarray(0, n),
	}, key, data.subarray(n))) // encrypted bytes and authentication tag
	let frame = // encrypted wire frame
		new Uint8Array(n + ciphertext.length + nonce_size)
	frame.set(data.subarray(0, n))
	frame.set(ciphertext, n)
	frame.set(nonce, n + ciphertext.length)
	return frame
}

export async function decrypt_frame(key, kind, type, data) {
	let size = data.length - tag_size - nonce_size // plaintext frame size
	if (size < 0) return null
	let n = header_size(kind, type, size) // unencrypted header bytes
	let plaintext // authenticated bytes
	try {
		plaintext = new Uint8Array(await crypto.subtle.decrypt({
			name: 'AES-GCM', iv: data.subarray(size + tag_size),
			tagLength: 128, additionalData: data.subarray(0, n),
		}, key, data.subarray(n, size + tag_size)))
	} catch (error) {
		// Web Crypto reports failed authentication as OperationError.
		if (error.name == 'OperationError') return null
		throw error
	}
	let frame = new Uint8Array(size) // decrypted wire frame
	frame.set(data.subarray(0, n))
	frame.set(plaintext, n)
	return frame
}
