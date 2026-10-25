import {
	import_frame_key, encrypt_frame, decrypt_frame,
} from '../www/ui_call_e2ee.js'

self.onrtctransform = async function(event) {
	let transformer = event.transformer // browser encoded-frame streams
	let {sending, kind, media_key, drop} = // test key and loss context
		transformer.options
	let key = media_key && await import_frame_key(media_key) // or null
	let process_frame = sending ? encrypt_frame : decrypt_frame // direction
	let count = 0 // successfully processed frames
	let frame_i = 0 // non-empty frame index
	try {
		await transformer.readable.pipeThrough(new TransformStream({
			async transform(frame, controller) {
				if (!sending && !frame.data.byteLength) {
					controller.enqueue(frame)
					return
				}
				frame_i++
				if (drop && frame_i >= drop.from
					&& frame_i < drop.from + drop.n
				) {
					if (frame_i == drop.from + drop.n - 1)
						self.postMessage({dropped: true})
					return
				}
				if (key) {
					let data = await process_frame( // authenticated frame bytes
						key, kind, frame.type, new Uint8Array(frame.data))
					if (!data) throw new Error('Frame failed authentication')
					frame.data = data.buffer
				}
				controller.enqueue(frame)
				if (++count == 1)
					self.postMessage({sending, kind})
			},
		})).pipeTo(transformer.writable)
	} catch (error) {
		self.postMessage({error: String(error), sending, kind, count})
	}
}

self.postMessage({ready: true})
