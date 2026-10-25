let connections = [] // RTCPeerConnections owned by this test page
let worker = null // encoded-transform worker for the current scenario
let audio_context = null // synthetic source and received audio analyser
let video_timer = null // synthetic camera animation interval
let capture = null // synthetic audio/video stream
let permission_capture = null // fake device capture held for permission case
let worker_errors = [] // transform failures
let observations = [] // browser capabilities and decoded media counts
let want_encryption = false // current test uses encoded-frame encryption
let transformed = [] // first processed frame per sender and receiver
let video_dropped = false // receiver worker dropped its test video frames
let media_key = null // meeting key shared within one test only

function check(condition, message) {
	if (!condition) throw new Error(message)
}

// Firefox often never starts a transform created before its worker script
// has run, so attach transforms only after the worker reports that it is
// ready.

function start_worker() {
	worker = new Worker('/tests/ui_call_e2ee_worker.js', {type: 'module'})
	return new Promise((resolve, reject) => {
		worker.onmessage = event => {
			if (event.data.ready) resolve()
			else if (event.data.error) worker_errors.push(event.data.error)
			else if (event.data.dropped) video_dropped = true
			else transformed.push(event.data)
		}
		worker.onerror = event => {
			worker_errors.push(event.message)
			reject(new Error(event.message))
		}
	})
}

function attach_transform(endpoint, sending, kind) {
	endpoint.transform = new RTCRtpScriptTransform(worker, {
		sending, kind, media_key: want_encryption ? media_key : null,
		drop: !sending && kind == 'video' ? {from: 300, n: 5} : null,
	})
}

async function wait_until(predicate, message, timeout = 10000) {
	let deadline = performance.now() + timeout // operation time limit
	while (!await predicate()) {
		check(!worker_errors.length, worker_errors.join('; '))
		check(performance.now() < deadline, message)
		await new Promise(resolve => setTimeout(resolve, 50))
	}
}

async function set_local(connection, description) {
	connection.onicecandidateerror = event => observations.push({
		ice_error: event.errorCode, text: event.errorText,
	})
	await connection.setLocalDescription(description)
	await wait_until(() => connection.iceGatheringState == 'complete',
		'ICE gathering timed out')
	let result = connection.localDescription.toJSON() // complete local SDP
	let hostname = result.sdp.match( // first obfuscated candidate hostname
		/^a=candidate:\S+ \S+ \S+ \S+ (\S+\.local) /m)?.[1]
	if (hostname) {
		let response = await fetch('/probe-mdns', { // system mDNS lookup
			method: 'POST', body: hostname,
		})
		observations.push({mdns_lookup: await response.json()})
	}
	observations.push({
		description: result.type,
		media: result.sdp.split('\r\n').filter(line =>
			/^m=|^a=(send|recv|inactive|mid:)/.test(line)),
		local_candidates: (result.sdp.match(/^a=candidate:/gm) || []).length,
		mdns_candidates: (result.sdp.match(/\.local /g) || []).length,
	})
	return result
}

function make_capture() {
	audio_context = new AudioContext()
	let oscillator = audio_context.createOscillator() // synthetic microphone
	let destination = // synthetic microphone stream
		audio_context.createMediaStreamDestination()
	oscillator.frequency.value = 440
	oscillator.connect(destination)
	oscillator.start()
	let canvas = document.createElement('canvas') // synthetic camera
	canvas.width = 320
	canvas.height = 180
	let context = canvas.getContext('2d') // synthetic video drawing context
	let frame_i = 0 // synthetic video frame index
	video_timer = setInterval(() => {
		context.fillStyle = frame_i++ % 2 ? '#123456' : '#abcdef'
		context.fillRect(0, 0, 320, 180)
	}, 33)
	return new MediaStream([
		...destination.stream.getAudioTracks(),
		...canvas.captureStream(30).getVideoTracks(),
	])
}

function make_receiver() {
	let connection = new RTCPeerConnection() // receiving test connection
	connections.push(connection)
	let stream = new MediaStream() // received audio and video
	let audio = new Audio() // remote audio playback element
	audio.muted = true
	let analyser = audio_context.createAnalyser() // received sample analyser
	let output = audio_context.createGain() // silent analyser output
	output.gain.value = 0
	analyser.connect(output)
	output.connect(audio_context.destination)
	document.body.append(audio)
	let video = document.createElement('video') // decoder for received video
	video.muted = true
	video.autoplay = true
	document.body.append(video)
	connection.ontrack = event => {
		attach_transform(event.receiver, false, event.track.kind)
		stream.addTrack(event.track)
		if (event.track.kind == 'video') {
			video.srcObject = new MediaStream([event.track])
			video.play().catch(error => worker_errors.push(String(error)))
		} else {
			audio.srcObject = new MediaStream([event.track])
			audio.play().catch(error => worker_errors.push(String(error)))
			audio_context.createMediaStreamSource(audio.srcObject)
				.connect(analyser)
		}
	}
	return {connection, stream, analyser}
}

async function check_media(receiver, label) {
	let decoded_frames = 0 // received video frames decoded by the browser
	let received = [] // most recent inbound RTP statistics
	try {
		await wait_until(async () => {
			let stats = // receive statistics
				await receiver.connection.getStats()
			received = []
			for (let stat of stats.values())
				if (stat.type == 'inbound-rtp') {
					received.push({
						kind: stat.kind, packets: stat.packetsReceived,
						bytes: stat.bytesReceived, frames: stat.framesReceived,
						decoded: stat.framesDecoded,
					})
					if (stat.kind == 'video')
						decoded_frames = stat.framesDecoded || 0
				}
			return decoded_frames >= 10
		}, label + ': no decoded video', 15000)
	} finally {
		observations.push({label, received, transformed: [...transformed]})
		for (let connection of connections) {
			let stats = await connection.getStats() // connection diagnostics
			observations.push({
				connection: connection.connectionState,
				ice: connection.iceConnectionState,
				audio: audio_context.state,
				outbound: [...stats.values()].filter(stat =>
					stat.type == 'outbound-rtp').map(stat => ({
					kind: stat.kind, packets: stat.packetsSent,
					frames: stat.framesEncoded, bytes: stat.bytesSent,
				})),
				candidates: [...stats.values()].filter(stat =>
					stat.type == 'candidate-pair').map(stat => stat.state),
				dependency_descriptor: [
					connection.currentLocalDescription,
					connection.currentRemoteDescription,
				].every(description =>
					/dependency-descriptor/.test(description.sdp)),
			})
		}
	}
	await wait_until(() => receiver.stream.getAudioTracks().length,
		label + ': no audio track')
	let analyser = receiver.analyser // received playback sample analyser
	let samples = new Float32Array(analyser.fftSize) // received audio samples
	let peak = 0 // largest absolute received sample
	try {
		await wait_until(() => {
			analyser.getFloatTimeDomainData(samples)
			for (let sample of samples) peak = Math.max(peak, Math.abs(sample))
			return peak > 0.01
		}, label + ': no received audio samples')
	} finally {
		for (let connection of connections) {
			let stats = await connection.getStats() // audio sample statistics
			observations.push({
				audio_stats: [...stats.values()].filter(stat =>
					stat.kind == 'audio' && ['inbound-rtp', 'media-source']
						.includes(stat.type)),
				time: audio_context.currentTime, peak,
			})
		}
	}
	observations.push({label, decoded_frames, audio_peak: peak})
	await wait_until(() => video_dropped,
		label + ': receiver dropped no video frames', 30000)
	let read_video = async () => // receiver video statistics
		[...(await receiver.connection.getStats()).values()].find(stat =>
			stat.type == 'inbound-rtp' && stat.kind == 'video')
	let video0 = await read_video() // statistics after the dropped frames
	let video1 = video0 // latest statistics
	try {
		await wait_until(async () => {
			video1 = await read_video()
			return video1.framesDecoded >= video0.framesDecoded + 30
		}, label + ': video did not recover after dropped frames')
	} finally {
		observations.push({label, recovery: {
			decoded: [video0.framesDecoded, video1.framesDecoded],
			key_frames: [video0.keyFramesDecoded, video1.keyFramesDecoded],
			plis: [video0.pliCount, video1.pliCount],
			firs: [video0.firCount, video1.firCount],
		}})
	}
}

async function run() {
	await fetch('/progress', {
		method: 'POST', body: 'Starting ' + navigator.userAgent,
	})
	if (new URL(location.href).searchParams.has('capture_permission')) {
		await fetch('/progress', {
			method: 'POST', body: 'Requesting fake capture',
		})
		permission_capture = await navigator.mediaDevices.getUserMedia({
			audio: true, video: true,
		})
		observations.push({capture_permission: true})
		await fetch('/progress', {
			method: 'POST', body: 'Fake capture acquired',
		})
	}
	observations.push({
		browser: navigator.userAgent,
		script_transform: typeof RTCRtpScriptTransform,
	})
	check(typeof RTCRtpScriptTransform == 'function',
		'RTCRtpScriptTransform unavailable')
	for (want_encryption of [false, true]) {
		for (let mode of new URL(location.href).searchParams.has('sfu')
			? ['p2p', 'sfu'] : ['p2p']) {
			transformed = []
			video_dropped = false
			media_key = crypto.getRandomValues(new Uint8Array(16))
			await run_media(mode)
			if (mode == 'sfu') await request_sfu('cleanup')
			for (let connection of connections) connection.close()
			worker.terminate()
			connections = []
			worker = null
			clearInterval(video_timer)
			for (let track of capture.getTracks()) track.stop()
			await audio_context.close()
			audio_context = null
			for (let element of document.querySelectorAll('audio, video')) {
				element.pause()
				element.srcObject = null
				element.remove()
			}
		}
	}
}

async function run_media(mode) {
	await start_worker()
	capture = make_capture()
	await audio_context.resume()
	let sender = new RTCPeerConnection() // publishing test connection
	connections.push(sender)
	let transceivers = [] // sending audio/video transceivers
	for (let track of capture.getTracks()) {
		let transceiver = sender.addTransceiver(track, { // test publication
			direction: 'sendonly', streams: [capture],
		})
		let codecs = RTCRtpSender.getCapabilities(track.kind).codecs // codecs
		let mime_types = track.kind == 'audio' // codecs used by www/ui_call.js
			? ['audio/opus'] : ['video/vp8', 'video/rtx']
		transceiver.setCodecPreferences(codecs.filter(codec =>
			mime_types.includes(codec.mimeType.toLowerCase())))
		attach_transform(transceiver.sender, true, track.kind)
		transceivers.push(transceiver)
	}
	let receiver = make_receiver() // browser media receiver
	if (mode == 'sfu') {
		await connect_sfu(sender, receiver.connection, transceivers)
	} else {
		await receiver.connection.setRemoteDescription(
			await set_local(sender, await sender.createOffer()))
		await sender.setRemoteDescription(await set_local(
			receiver.connection, await receiver.connection.createAnswer()))
	}
	await check_media(receiver, mode.toUpperCase() + (want_encryption
		? ' Opus/VP8 encrypted' : ' Opus/VP8 plaintext control'))
}

// Keep provider credentials in the test runner; forward only control requests.

async function request_sfu(method, path, body) {
	let response = await fetch('/sfu', { // test runner control reply
		method: 'POST', body: JSON.stringify({method, path, body}),
	})
	let text = await response.text() // provider reply or control error
	check(response.ok, text)
	let result = JSON.parse(text) // provider result
	if (result?.tracks)
		for (let track of result.tracks)
			check(!track.errorCode, JSON.stringify(track))
	return result
}

async function connect_sfu(sender, receiver, transceivers) {
	let publication = await request_sfu('POST', '/sessions/new') // publisher
	let description = await set_local( // browser publication offer
		sender, await sender.createOffer())
	let published = await request_sfu('POST', // published audio/video tracks
		'/sessions/' + publication.sessionId + '/tracks/new', {
			sessionDescription: description,
			tracks: transceivers.map(transceiver => ({
				location: 'local', mid: transceiver.mid,
				trackName: transceiver.sender.track.kind,
			})),
		})
	await sender.setRemoteDescription(published.sessionDescription)
	await wait_until(() => sender.connectionState == 'connected',
		'SFU publisher connection timed out')
	let subscription = await request_sfu('POST', '/sessions/new') // receiver
	let subscribed = await request_sfu('POST', // SFU subscription offer
		'/sessions/' + subscription.sessionId + '/tracks/new', {
			tracks: published.tracks.map(track => ({
				location: 'remote', sessionId: publication.sessionId,
				trackName: track.trackName,
			})),
		})
	await receiver.setRemoteDescription(subscribed.sessionDescription)
	await request_sfu('PUT',
		'/sessions/' + subscription.sessionId + '/renegotiate', {
			sessionDescription: await set_local(
				receiver, await receiver.createAnswer()),
		})
}

let error = null // run failure or null
try {
	await run()
} catch (failure) {
	error = String(failure)
} finally {
	clearInterval(video_timer)
	for (let connection of connections) connection.close()
	if (worker) worker.terminate()
	if (capture) for (let track of capture.getTracks()) track.stop()
	if (permission_capture)
		for (let track of permission_capture.getTracks()) track.stop()
	if (audio_context) await audio_context.close()
}
await fetch('/report', {
	method: 'POST', body: JSON.stringify({error, observations, worker_errors}),
})
