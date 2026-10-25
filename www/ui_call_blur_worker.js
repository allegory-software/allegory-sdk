importScripts('mediapipe/vision_bundle.js')

let segmenter = null // MediaPipe ImageSegmenter after initialization
let output = new OffscreenCanvas(1, 1) // processed camera frames
let background = new OffscreenCanvas(1, 1) // blurred camera frames
let cx = background.getContext('2d') // background canvas context
let drawing = null // MediaPipe DrawingUtils after initialization

self.onmessage = async function(ev) {
	if (ev.data.type == 'init') {
		let fileset = await Vision.FilesetResolver.forVisionTasks(
			new URL('mediapipe/wasm', self.location.href).href)
		segmenter = await Vision.ImageSegmenter.createFromOptions(fileset, {
			baseOptions: {
				modelAssetPath: new URL('mediapipe/selfie_segmenter.tflite',
					self.location.href).href,
				delegate: 'GPU',
			},
			canvas: output,
			runningMode: 'VIDEO',
			outputConfidenceMasks: true,
			outputCategoryMask: false,
		})
		drawing = new Vision.DrawingUtils(output.getContext('webgl2'))
		self.postMessage({type: 'ready'})
	} else {
		let {frame, time} = ev.data // camera ImageBitmap and timestamp in ms
		try {
			if (output.width != frame.width || output.height != frame.height) {
				output.width = background.width = frame.width
				output.height = background.height = frame.height
			}
			cx.filter = 'blur(12px)'
			cx.drawImage(frame, -12, -12, frame.width + 24, frame.height + 24)
			segmenter.segmentForVideo(frame, time, function(result) {
				drawing.drawConfidenceMask(result.confidenceMasks[0],
					background, frame)
				let blurred_frame = output.transferToImageBitmap() // output frame
				self.postMessage({type: 'frame', frame: blurred_frame},
					[blurred_frame])
			})
		} finally {
			frame.close()
		}
	}
}

self.onunhandledrejection = function(ev) {
	self.postMessage({type: 'error', message: ev.reason.message})
}
