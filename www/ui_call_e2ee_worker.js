// Encrypt sent and decrypt received SFU frames for www/ui_call.js.

import {
	import_frame_key, encrypt_frame, decrypt_frame,
} from './ui_call_e2ee.js'

self.onrtctransform = async function(event) {
	let transformer = event.transformer // browser encoded-frame streams
	let {sending, kind, media_key} = transformer.options // hex key context
	let key = await import_frame_key( // AES-GCM frame key
		Uint8Array.from(media_key.match(/../g), s => parseInt(s, 16)))
	await transformer.readable.pipeThrough(new TransformStream({
		async transform(frame, controller) {
			// Chrome passes padding-only RTP packets as empty frames.
			if (!sending && !frame.data.byteLength) {
				controller.enqueue(frame)
				return
			}
			let data = new Uint8Array(frame.data) // encoded frame bytes
			let result = sending // encrypted or authenticated frame bytes
				? await encrypt_frame(key, kind, frame.type, data)
				: await decrypt_frame(key, kind, frame.type, data)
			// unauthenticated frame: drop.
			if (!result) return
			frame.data = result.buffer
			controller.enqueue(frame)
		},
	})).pipeTo(transformer.writable)
}

// Firefox often never starts a transform created before this script has
// run, so the page waits for this message before creating transforms.
self.postMessage({ready: true})
