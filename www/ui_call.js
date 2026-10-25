/*

	WebRTC call and call widget.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES / NETWORKING

	- Use direct connections by default for calls with up to six peers.
	- Forward media through Cloudflare SFU for larger calls.
	- Switch between P2P and SFU when peers join or leave.
	- Force SFU for the whole call, regardless of the number of peers.
	- Receive SFU media without publishing microphone or camera tracks.
	- Switch microphones or cameras during a call without reconnecting,
	  by replacing the capture.
	- Rejoin as the same peer after a disconnect using a reconnect token.
	- After a page reload or crash, reconnect using the saved reconnect token
	  as replace token to replace the lost peer slot instead of adding one.
	- Auto-detect lost server connection via heartbeat messages and reconnect.
	- Auto-repair lost audio/video connections within a repair timeout.
	- Auto-lower video bitrate based on number of peers.

FEATURES / DEVICES

	- Preview camera and check microphone before joining.
	- Mute microphone and turn camera off independently.
	- Choose microphone, camera and speaker. Remember choices on device.
	- Auto-update the list of microphones and cameras as devices come and go.
	- Auto-retry capture after device error.
	- Auto-retry audio playback when the browser blocks it.
	- Microphone echo cancellation and noise suppression options.
	- Microphone level meter.
	- Blur the camera background with MediaPipe.

API

	ui.call(id, opt, [fr], [align], [valign]) -> call
		call_id, invite_token, name, can_join, ice_transport_policy
		name is optional when the user enters a guest name.
		can_join defaults to true.
		ice_transport_policy defaults to 'all'.

	create_call({on_change}) -> call
	call.join({call_id, invite_token, [name], [ice_transport_policy]})
	call.leave()
	call.want_force_sfu: server-confirmed SFU override for the whole call.
	call.set_force_sfu(want_force_sfu)
	call.set_microphone(is_enabled, [device_id],
		[want_echo_cancellation], [want_noise_suppression]) -> promise
	call.set_camera(is_enabled, [device_id], [want_background_blur]) -> promise
	call.set_speaker([device_id])
	call.microphone_level() -> number or null
	call.play_audio(peer)

*/

(function() {
"use strict"

const {
	assert, clamp, clock, timer, load, save,
} = glue

let rejected_close_code = 4000 // signaling close code for a refused join
let repair_timeout = 30 // seconds allowed to repair a failed connection

// Camera bitrate sent to each peer, lowered as the call grows.

function camera_bitrate(participant_n) { // -> bits per second
	return participant_n <= 2 ? 1500000 : participant_n <= 4 ? 800000 : 400000
}

function is_capture_enabled(capture) {
	return !!(capture.track?.enabled && capture.track.readyState == 'live'
		&& !capture.track.muted)
}

function create_camera_blur(track, signal, on_error) {
	signal.throwIfAborted()
	let video = document.createElement('video') // raw camera playback
	let canvas = document.createElement('canvas') // outgoing blurred video
	canvas.width = canvas.height = 1
	let cx = canvas.getContext('2d') // outgoing canvas context
	let output_track = // outgoing CanvasCaptureMediaStreamTrack
		canvas.captureStream(0).getVideoTracks()[0]
	let worker = new Worker('/ui_call_blur_worker.js') // camera processing
	let frame_request = null // pending video frame callback id or null
	let is_closed = false // processing resources have been released
	let is_ready = false // the first processed frame has been returned
	let resolve_ready, reject_ready // first-frame promise callbacks
	let ready = new Promise(function(resolve, reject) {
		resolve_ready = resolve
		reject_ready = reject
	}) // -> {track, close, error} after the first processed frame
	let blur = {track: output_track, close, error: null} // processing result

	function close() {
		if (is_closed) return
		is_closed = true
		signal.removeEventListener('abort', on_abort)
		if (frame_request != null)
			video.cancelVideoFrameCallback(frame_request)
		worker.terminate()
		video.pause()
		video.srcObject = null
		track.stop()
		output_track.stop()
	}

	function fail(error) {
		if (is_closed) return
		blur.error = error
		close()
		if (is_ready)
			on_error(error)
		else
			reject_ready(error)
	}

	function on_abort() {
		close()
		reject_ready(new DOMException(
			'Camera capture canceled', 'AbortError'))
	}

	function request_frame() {
		frame_request = video.requestVideoFrameCallback(
		async function(_, metadata) {
			frame_request = null
			try {
				let frame = // captured camera frame
					await createImageBitmap(video)
				if (is_closed) {
					frame.close()
					return
				}
				worker.postMessage({
					type: 'frame',
					frame,
					time: metadata.mediaTime * 1000,
				}, [frame])
			} catch (error) {
				fail(error)
			}
		})
	}

	worker.onmessage = function(ev) {
		if (ev.data.type == 'error') {
			fail(new Error(ev.data.message))
		} else if (ev.data.type == 'ready') {
			request_frame()
		} else {
			let frame = ev.data.frame // processed ImageBitmap
			try {
				if (canvas.width != frame.width
					|| canvas.height != frame.height) {
					canvas.width = frame.width
					canvas.height = frame.height
				}
				cx.drawImage(frame, 0, 0)
				output_track.requestFrame()
				if (!is_ready) {
					is_ready = true
					signal.removeEventListener('abort', on_abort)
					resolve_ready(blur)
				}
				request_frame()
			} catch (error) {
				fail(error)
			} finally {
				frame.close()
			}
		}
	}
	worker.onerror = function(ev) {
		ev.preventDefault()
		fail(new Error(ev.message))
	}
	signal.addEventListener('abort', on_abort, {once: true})
	video.muted = true
	video.playsInline = true
	video.srcObject = new MediaStream([track])
	video.play().then(function() {
		if (!is_closed) worker.postMessage({type: 'init'})
	}).catch(fail)
	return ready
}

// Call, captured media and remote peers.

window.create_call = function(opt) {
	let {on_change} = opt

	let call = {
		state: 'preview', // current call phase
		error: null, // terminal error text or null
		name: null, // display name accepted by the server or null
		want_force_sfu: false, // server-confirmed call-wide SFU override
		peers: [], // remote peer objects in join order
		local_stream: new MediaStream(), // captured MediaStream or null
		devices: [], // available MediaDeviceInfo inputs and audio outputs
		microphone: { // microphone selection and capture state
			device_id: load('ui_call.audio'), // or null: default
			track: null, // captured MediaStreamTrack or null
			is_enabled: false, // requested microphone transmission
			want_echo_cancellation: // requested echo cancellation
				load('ui_call.echo_cancellation') != 'false',
			want_noise_suppression: // requested noise suppression
				load('ui_call.noise_suppression') != 'false',
			pending: null, // pending capture/update promise or null
			error: null, // microphone error text or null
		},
		camera: { // camera selection and capture state
			device_id: load('ui_call.video'), // or null: default
			track: null, // captured MediaStreamTrack or null
			is_enabled: false, // requested camera capture
			want_background_blur: // requested background blur
				load('ui_call.background_blur') == 'true',
			blur: null, // {track, close, error} for processed video or null
			pending: null, // pending capture/update promise or null
			error: null, // camera error text or null
		},
		speaker: { // audio output selection
			device_id: load('ui_call.speaker'), // or null: default
			error: null, // speaker error text or null
		},
	}

	// Signaling and reconnection.

	let socket = null // signaling WebSocket or null
	let signal_url = null // URL used to join or reconnect signaling
	let reconnect_token = null // credential for this peer or null
	let token_key = null // sessionStorage key of the stored reconnect token
	let reconnect_timeout = null // server reconnect window in seconds
	let reconnect_deadline = null // local retry deadline or null
	let is_joined = false // current socket has been admitted by the server
	let retry_timer = timer(retry_signaling) // arm/cancel retry timer
	let messages = Promise.resolve() // serialized signaling operations

	// Heartbeats.

	let heartbeat_interval = null // server heartbeat interval in seconds
	let heartbeat_timeout = null // server silence limit in seconds
	let last_message_time = null // clock() of the last message or null
	let heartbeat_timer = timer(send_heartbeat) // arm/cancel heartbeat

	// ICE settings.

	let ice_servers = null // RTCIceServer array received on admission
	let ice_transport_policy = 'all' // selected ICE transport policy

	// Capture devices and camera requests.

	let media_devices = navigator.mediaDevices // capture API or undefined
	let device_request = null // latest device enumeration promise or null
	let camera_abort = new AbortController() // current camera request lifetime

	// Microphone level meter state.

	let microphone_context = null // meter AudioContext or null
	let microphone_source = null // captured audio source node or null
	let microphone_analyser = null // microphone AnalyserNode or null
	let microphone_samples = null // reusable Float32Array of audio samples

	// Peer connection statistics state.

	let peer_stats = new Map() // {peer -> previous RTCStatsReport}
	let stats_timer = timer(update_stats) // arm/cancel statistics sampling

	// Peer identity and media mode state.

	let local_peer_id = null // this browser's peer id
	let media_mode = null // 'p2p', 'sfu' or null before admission
	let received_media_revision = null // latest setup number from the server
	let media_revision = null // server's current media setup number

	// Cloudflare SFU state.

	let sfu = null // {id, connection, senders, abort, subscriptions} or null
	let sfu_sources = new Map() // {peer_id -> {id, tracks}} publications
	let sfu_requests = new Map() // {request_id -> {resolve, reject}}
	let next_sfu_request_id = 0 // last assigned request id
	let sfu_repair_deadline = null // clock() limit for SFU connection repair
	let sfu_repair_timer = timer(function() { // arm/cancel SFU repair limit
		fail(new Error('SFU connection timed out'))
	})

	const media_changed = Symbol('media changed') // canceled setup operation

	function is_closed() {
		return call.state == 'left' || call.state == 'failed'
	}

	function connection_state(peer) {
		let state = peer.connection.connectionState // RTCPeerConnection state
		return state == 'new' ? 'connecting' : state
	}

	function find_peer(peer_id) {
		return call.peers.find(peer => peer.id == peer_id)
	}

	function get_capture_track(capture) {
		return capture == call.camera && capture.blur
			? capture.blur.track : capture.track
	}

	function stop_capture(capture) {
		if (!capture.track) return
		if (capture == call.microphone) {
			microphone_source.disconnect()
			microphone_source = null
		}
		capture.track.onended = null
		capture.track.onmute = null
		capture.track.onunmute = null
		capture.track.stop()
		call.local_stream.removeTrack(get_capture_track(capture))
		if (capture == call.camera && capture.blur) {
			capture.blur.close()
			capture.blur = null
		}
		capture.track = null
	}

	// Available microphones and cameras after capture or hardware changes.

	async function refresh_devices() {
		let request = media_devices.enumerateDevices()
		device_request = request
		try {
			let devices = await request
			if (is_closed() || device_request != request) return
			call.devices = devices.filter(device =>
				device.kind == 'audioinput' || device.kind == 'videoinput'
				|| device.kind == 'audiooutput')
		} catch (error) {
			if (is_closed() || device_request != request) return
			for (let capture of [call.microphone, call.camera])
				capture.error = 'Device list: '+error.name+': '+error.message
		}
		on_change()
	}

	// Device switching across existing peer connections.

	async function replace_capture(capture, kind, track, blur = null,
		signal = null) {
		// a peer connected during an await got the previous track: repeat
		// until every sender has the output track.
		let replaced_senders = new Set() // senders given track
		while (true) {
			let peer = call.peers.find(call_peer => call_peer.senders[kind]
				&& !replaced_senders.has(call_peer.senders[kind]))
			let sender = // direct or SFU sender still needing this track
				peer ? peer.senders[kind] : sfu?.senders[kind]
			if (!sender || replaced_senders.has(sender)) break
			replaced_senders.add(sender)
			try {
				await sender.replaceTrack(blur ? blur.track : track)
			} catch (error) {
				if ((peer ? peer.senders[kind] : sfu?.senders[kind]) == sender)
					throw error
			}
		}
		if (blur?.error) throw blur.error
		if (is_closed() || signal?.aborted) {
			if (track) track.stop()
			if (blur) blur.close()
			return
		}
		stop_capture(capture)
		if (track) {
			capture.track = track
			if (kind == 'video') capture.blur = blur
			track.enabled = capture.is_enabled
			call.local_stream.addTrack(get_capture_track(capture))
			if (kind == 'audio') {
				microphone_source = microphone_context
					.createMediaStreamSource(call.local_stream)
				microphone_source.connect(microphone_analyser)
			}
			track.onended = function() {
				stop_capture(capture)
				capture.error = 'Capture ended; select or enable the device again'
				send_media_to_all()
				on_change()
				refresh_devices()
			}
			track.onmute = track.onunmute = function() {
				send_media_to_all()
				on_change()
			}
			if (kind == 'video' && !capture.is_enabled)
				stop_capture(capture)
		}
	}

	// Capture using the latest device and on/off choices.

	async function update_capture(capture, kind) {
		while (!is_closed()) {
			let device_id = capture.device_id
			let is_enabled = capture.is_enabled
			let want_background_blur = // requested blur for this capture attempt
				kind == 'video' && capture.want_background_blur
			let signal = // camera request signal or null for microphone capture
				kind == 'video' ? camera_abort.signal : null
			let {
				want_echo_cancellation, // requested echo cancellation
				want_noise_suppression, // requested noise suppression
			} = capture
			try {
				if (!is_enabled) {
					if (kind == 'video')
						await replace_capture(capture, kind, null)
					if (!capture.is_enabled) return
					continue
				}
				let track_constraints = // requested constraints or undefined
					capture.track?.getConstraints()
				if (capture.track
					&& (track_constraints.deviceId?.exact ?? null) == device_id
					&& (kind != 'video' || !!capture.blur == want_background_blur)
					&& (kind != 'audio'
						|| (track_constraints.echoCancellation
								== want_echo_cancellation
							&& track_constraints.noiseSuppression
								== want_noise_suppression))) {
					capture.track.enabled = true
					send_media_to_all()
					return
				}
				if (!media_devices)
					throw new Error('Media capture requires HTTPS or localhost')
				let constraints = {} // requested capture constraints
				if (device_id) constraints.deviceId = {exact: device_id}
				if (kind == 'audio') {
					constraints.echoCancellation = want_echo_cancellation
					constraints.noiseSuppression = want_noise_suppression
				}
				let stream = await media_devices.getUserMedia({
					audio: kind == 'audio' ? constraints : false,
					video: kind == 'video' ? constraints : false,
				})
				let track = stream.getTracks()[0]
				if (is_closed() || signal?.aborted || !capture.is_enabled
					|| capture.device_id != device_id
					|| capture.want_echo_cancellation != want_echo_cancellation
					|| capture.want_noise_suppression != want_noise_suppression
					|| (kind == 'video'
						&& capture.want_background_blur != want_background_blur)) {
					track.stop()
					continue
				}
				let stop_track = signal && (() => track.stop()) // source cleanup
				if (signal)
					signal.addEventListener('abort', stop_track, {once: true})
				let blur = null // {track, close, error} or null
				try {
					if (want_background_blur)
						blur = await create_camera_blur(track, signal,
							function(error) {
								if (is_closed() || capture.track != track) return
								stop_capture(capture)
								capture.error = error.name+': '+error.message
								send_media_to_all()
								on_change()
							})
					if (is_closed() || signal?.aborted || !capture.is_enabled
						|| capture.device_id != device_id
						|| (kind == 'video'
							&& capture.want_background_blur
								!= want_background_blur)) {
						track.stop()
						if (blur) blur.close()
						continue
					}
					await replace_capture(capture, kind, track, blur, signal)
				} catch (error) {
					track.stop()
					if (blur) blur.close()
					throw error
				} finally {
					if (signal) signal.removeEventListener('abort', stop_track)
				}
				if (is_closed()) return
				capture.error = null
				send_media_to_all()
				on_change()
				refresh_devices()
				if (capture.device_id == device_id && capture.is_enabled
					&& capture.want_echo_cancellation == want_echo_cancellation
					&& capture.want_noise_suppression == want_noise_suppression
					&& (kind != 'video'
						|| (!signal.aborted
							&& capture.want_background_blur == want_background_blur)))
					return
			} catch (error) {
				if (is_closed()) return
				if (capture.device_id != device_id
					|| signal?.aborted
					|| capture.is_enabled != is_enabled
					|| capture.want_echo_cancellation != want_echo_cancellation
					|| capture.want_noise_suppression != want_noise_suppression
					|| (kind == 'video'
						&& capture.want_background_blur != want_background_blur))
					continue
				capture.error = error.name+': '+error.message
				return
			}
		}
	}

	function set_capture(capture, kind, is_enabled, device_id) {
		assert(!is_closed(), 'call is closed')
		capture.device_id = device_id
		save('ui_call.'+kind, device_id) // remembered on this device
		capture.is_enabled = is_enabled
		capture.error = null
		if (capture.track && !is_enabled) {
			if (kind == 'audio') {
				capture.track.enabled = false
			} else {
				stop_capture(capture)
			}
			send_media_to_all()
		}
		if (!capture.pending) {
			capture.pending = update_capture(capture, kind).finally(function() {
				capture.pending = null
				on_change()
			})
		}
		on_change()
		return capture.pending
	}

	// Microphone control and audio analysis for the level meter.

	call.set_microphone = function(is_enabled,
		device_id = call.microphone.device_id,
		want_echo_cancellation = call.microphone.want_echo_cancellation,
		want_noise_suppression = call.microphone.want_noise_suppression) {
		call.microphone.want_echo_cancellation = want_echo_cancellation
		call.microphone.want_noise_suppression = want_noise_suppression
		save('ui_call.echo_cancellation', want_echo_cancellation)
		save('ui_call.noise_suppression', want_noise_suppression)
		let pending = set_capture(call.microphone, 'audio',
			is_enabled, device_id)
		if (is_enabled) {
			if (!microphone_context) {
				microphone_context = new AudioContext()
				microphone_context.onstatechange = on_change
				microphone_analyser = microphone_context.createAnalyser()
				microphone_analyser.fftSize = 256
				microphone_samples = new Float32Array(256)
			}
			if (microphone_context.state == 'suspended')
				microphone_context.resume().catch(function(error) {
					if (is_closed()) return
					call.microphone.error = 'Microphone meter: '+error.message
					on_change()
				})
		}
		return pending
	}

	call.microphone_level = function() {
		if (!call.microphone.track) return null
		if (!call.microphone.track.enabled) return 0
		if (microphone_context.state != 'running') return null
		microphone_analyser.getFloatTimeDomainData(microphone_samples)
		let energy = 0 // sum of squared sample amplitudes
		for (let sample of microphone_samples) energy += sample * sample
		return Math.min(1, Math.sqrt(energy / microphone_samples.length))
	}

	call.set_camera = function(is_enabled, device_id = call.camera.device_id,
		want_background_blur = call.camera.want_background_blur) {
		if (is_enabled != call.camera.is_enabled
			|| device_id != call.camera.device_id
			|| want_background_blur != call.camera.want_background_blur) {
			camera_abort.abort()
			camera_abort = new AbortController()
			if (want_background_blur != call.camera.want_background_blur) {
				stop_capture(call.camera)
				send_media_to_all()
			}
		}
		call.camera.want_background_blur = want_background_blur
		save('ui_call.background_blur', want_background_blur)
		return set_capture(call.camera, 'video', is_enabled, device_id)
	}

	// Speaker selection for every peer's audio.

	function set_peer_speaker(peer) {
		let device_id = call.speaker.device_id ?? '' // '' means the default
		peer.audio.setSinkId(device_id).catch(function(error) {
			if (is_closed()) return
			call.speaker.error = 'Speaker: '+error.name+': '+error.message
			on_change()
		})
	}

	call.set_speaker = function(device_id = null) {
		assert(!is_closed(), 'call is closed')
		call.speaker.device_id = device_id
		save('ui_call.speaker', device_id) // remembered on this device
		call.speaker.error = null
		for (let peer of call.peers)
			set_peer_speaker(peer)
		on_change()
	}

	// Peer removal and call shutdown.

	function close_connection(peer) {
		let peer_connection = peer.connection
		if (peer_connection) {
			peer_connection.onicecandidate = null
			peer_connection.ontrack = null
			peer_connection.onconnectionstatechange = null
			peer_connection.close()
			peer.connection = null
		}
		peer.senders.audio = null
		peer.senders.video = null
		peer.is_connected = false
		peer.is_repairing = false
		peer.connection_type = null
		peer.video_bitrate = null
		peer_stats.delete(peer)
		peer.repair_timer()
	}

	function fail_connection(peer) {
		close_connection(peer)
		peer.state = 'failed'
		on_change()
	}

	function close_peer(peer) {
		close_connection(peer)
		peer.audio.pause()
		peer.audio.srcObject = null
		for (let track of peer.stream.getTracks())
			track.stop()
		call.peers.splice(call.peers.indexOf(peer), 1)
		set_camera_bitrates()
	}

	// Camera bitrate for the current number of peers.

	function set_camera_bitrate(sender) {
		let params = sender.getParameters()
		params.encodings[0].maxBitrate = camera_bitrate(1 + call.peers.length)
		sender.setParameters(params)
	}

	// peers not connected yet: set by the 'connected' state change.
	function set_camera_bitrates() {
		for (let peer of call.peers)
			if (peer.connection && peer.is_connected)
				set_camera_bitrate(peer.senders.video)
	}

	// Measured video bitrate for direct and SFU connections.

	async function update_stats() {
		let sfu_connection = sfu?.connection // shared SFU connection or none
		let sfu_stats = null // one shared RTCStatsReport per sample
		if (sfu_connection?.connectionState == 'connected') {
			try {
				sfu_stats = await sfu_connection.getStats()
			} catch (error) {
				if (sfu?.connection == sfu_connection) throw error
			}
		}
		for (let peer of call.peers.slice()) { // remote peer
			let peer_connection = // current RTCPeerConnection
				peer.connection || sfu?.connection
			if (!peer_connection) continue
			if (peer_connection.connectionState != 'connected') {
				peer.connection_type = null
				peer.video_bitrate = null
				peer_stats.delete(peer)
				continue
			}
			let stats // RTCStatsReport for this sample
			try {
				stats = peer_connection == sfu_connection
					? sfu_stats : await peer_connection.getStats()
			} catch (error) {
				if ((peer.connection || sfu?.connection) != peer_connection)
					continue
				throw error
			}
			if ((peer.connection || sfu?.connection) != peer_connection)
				continue
			peer.connection_type = peer.connection ? null : 'SFU'
			for (let stat of stats.values()) { // RTCStats object
				if (!peer.connection) break
				if (stat.type != 'transport' || !stat.selectedCandidatePairId)
					continue
				let candidate_pair = // selected ICE candidate pair
					stats.get(stat.selectedCandidatePairId)
				let local_candidate = // selected local ICE candidate
					stats.get(candidate_pair.localCandidateId)
				let remote_candidate = // selected remote ICE candidate
					stats.get(candidate_pair.remoteCandidateId)
				if (local_candidate.candidateType == 'relay'
					|| remote_candidate.candidateType == 'relay') {
					peer.connection_type = 'Relayed'
					break
				}
				peer.connection_type = 'P2P'
			}
			let prev_stats = peer_stats.get(peer) // previous report or undefined
			let video_bitrate = null // sum of incoming video rates in kb/s
			for (let stat of stats.values()) { // RTCStats object
				if (stat.type != 'inbound-rtp' || stat.kind != 'video') continue
				if (!peer.connection
					&& sfu.subscriptions.get(stat.mid)?.peer_id != peer.id)
					continue
				let prev_video_stats = // previous video stats or undefined
					prev_stats?.get(stat.id)
				if (!prev_video_stats
					|| stat.timestamp <= prev_video_stats.timestamp
					|| stat.bytesReceived < prev_video_stats.bytesReceived) {
					video_bitrate = null
					break
				}
				video_bitrate = (video_bitrate ?? 0)
					+ 8 * (stat.bytesReceived - prev_video_stats.bytesReceived)
						/ (stat.timestamp - prev_video_stats.timestamp)
			}
			peer.video_bitrate = video_bitrate
			peer_stats.set(peer, stats)
		}
		if (!is_closed()) {
			stats_timer(1)
			on_change()
		}
	}

	function close_socket() {
		is_joined = false
		cancel_sfu_requests()
		if (sfu) sfu.abort.abort()
		heartbeat_timer()
		if (socket) {
			socket.onmessage = null
			socket.onclose = null
			socket.close()
			socket = null
		}
	}

	function close() {
		camera_abort.abort()
		retry_timer()
		stats_timer()
		sfu_repair_timer()
		stop_sfu()
		window.removeEventListener('pagehide', call.leave)
		if (media_devices)
			media_devices.removeEventListener('devicechange', refresh_devices)
		if (is_joined)
			socket.send(JSON.stringify({type: 'leave'}))
		close_socket()
		while (call.peers.length)
			close_peer(call.peers[0])
		stop_capture(call.microphone)
		stop_capture(call.camera)
		call.local_stream = null
		if (microphone_context) {
			microphone_context.onstatechange = null
			microphone_context.close()
			microphone_context = null
			microphone_analyser = null
			microphone_samples = null
		}
	}

	function fail(error) {
		close()
		call.state = 'failed'
		call.error = error.message
		on_change()
	}

	call.leave = function() {
		close()
		call.state = 'left'
		on_change()
	}

	// Remote audio playback and browser playback errors.

	call.play_audio = function(peer) {
		peer.audio.play().then(function() {
			if (peer.audio.srcObject != peer.stream) return
			peer.audio_error = null
			on_change()
		}, function(error) {
			if (peer.audio.srcObject != peer.stream) return
			peer.audio_error = error.name+': '+error.message
			on_change()
		})
	}

	// Ordered signaling and microphone/camera status notifications.

	function enqueue(fn) {
		let signal_socket = socket
		messages = messages.then(function() {
			if (socket && socket == signal_socket) return fn()
		}).catch(function(error) {
			if (!is_closed() && socket == signal_socket
				&& error != media_changed) fail(error)
		})
	}

	function send_signal(peer, data) {
		if (!is_joined) return
		socket.send(JSON.stringify({
			type: 'signal',
			media_revision: media_revision,
			peer_id: peer.id,
			data: data,
		}))
	}

	function send_connected(peer) {
		if (!is_joined) return
		socket.send(JSON.stringify({
			type: 'connected',
			peer_id: peer.id,
		}))
	}

	function send_media(peer) {
		send_signal(peer, {media: {
			microphone: is_capture_enabled(call.microphone),
			camera: is_capture_enabled(call.camera),
		}})
	}

	function send_media_to_all() {
		for (let peer of call.peers)
			send_media(peer)
		if (sfu && media_mode == 'sfu') enqueue(sync_sfu_publications)
	}

	// Audio and video connection setup for each peer.

	async function send_offer(peer, offer_opt) {
		let peer_connection = peer.connection
		await peer_connection.setLocalDescription(
			await peer_connection.createOffer(offer_opt))
		if (peer.connection != peer_connection) return
		send_signal(peer, {description: peer_connection.localDescription})
	}

	function add_peer(peer_id, name) {
		assert(!find_peer(peer_id), 'peer already connected')
		let peer = { // remote peer
			id: peer_id, // peer id
			name: name, // display name
			state: 'connecting', // connection status
			connection_type: null, // 'P2P', 'Relayed', 'SFU' or null
			video_bitrate: null, // measured incoming video kb/s or null
			stream: new MediaStream(), // received MediaStream
			media: null, // {microphone: boolean, camera: boolean} or null
			audio_error: null, // remote audio playback error text or null
			connection: null, // direct RTCPeerConnection or null
			senders: {audio: null, video: null}, // {kind -> RTCRtpSender or null}
			audio: new Audio(), // remote audio playback element
			is_offerer: local_peer_id > peer_id, // this browser offers for P2P
			is_connected: false, // connection has connected
			is_repairing: false, // ICE restart of a failed connection is running
			repair_timer: null, // (seconds?) -> arm/cancel repair time limit
		}
		peer.repair_timer = timer(function() {
			fail_connection(peer)
		})
		peer.audio.srcObject = peer.stream
		if (call.speaker.device_id)
			set_peer_speaker(peer)
		call.peers.push(peer)
		set_camera_bitrates()
		return peer
	}

	async function connect_peer(peer) {
		let peer_connection = new RTCPeerConnection({ // direct connection
			iceServers: ice_servers,
			iceTransportPolicy: ice_transport_policy,
		})
		peer.connection = peer_connection
		peer.state = 'connecting'
		if (peer.is_offerer)
			for (let kind of ['audio', 'video']) {
				let track = kind == 'audio'
					? call.microphone.track : get_capture_track(call.camera)
				peer.senders[kind] = peer_connection.addTransceiver(track || kind, {
					direction: 'sendrecv',
					streams: [call.local_stream],
				}).sender
			}
		peer_connection.onicecandidate = function(ev) {
			if (!ev.candidate) return
			enqueue(function() {
				if (peer.connection != peer_connection) return
				send_signal(peer, {candidate: ev.candidate.toJSON()})
			})
		}
		peer_connection.ontrack = function(ev) {
			peer.stream.addTrack(ev.track)
			if (ev.track.kind == 'audio') call.play_audio(peer)
			on_change()
		}
		// Connection repair with a separate time limit per peer.

		peer_connection.onconnectionstatechange = function() {
			if (peer_connection.connectionState == 'failed' && !peer.is_connected) {
				fail_connection(peer)
			} else if (peer_connection.connectionState == 'failed') {
				// connection lost: the offerer restarts ICE on every failure
				// until it connects or repair_timer() closes the connection.
				if (!peer.is_repairing) {
					peer.is_repairing = true
					peer.repair_timer(repair_timeout)
				}
				if (peer.is_offerer)
					enqueue(function() {
						if (peer.is_repairing)
							return send_offer(peer, {iceRestart: true})
					})
				peer.state = 'reconnecting'
				on_change()
			} else {
				if (peer_connection.connectionState == 'connected') {
					peer.is_connected = true
					peer.is_repairing = false
					peer.repair_timer()
					set_camera_bitrate(peer.senders.video)
					send_connected(peer)
				}
				peer.state = connection_state(peer)
				on_change()
			}
		}
		send_media(peer)
		on_change()
		if (peer.is_offerer)
			await send_offer(peer)
	}

	// Cloudflare SFU requests and the shared media connection.

	function cancel_sfu_requests() {
		for (let request of sfu_requests.values()) request.reject(media_changed)
		sfu_requests.clear()
	}

	function request_sfu(op, args = {}) {
		if (!is_joined || media_revision != received_media_revision)
			return Promise.reject(media_changed)
		let request_id = ++next_sfu_request_id // request awaiting a reply
		return new Promise(function(resolve, reject) {
			sfu_requests.set(request_id, {resolve, reject})
			socket.send(JSON.stringify({
				type: 'sfu_request', request_id, media_revision, op, ...args,
			}))
		})
	}

	function remove_received_tracks(peer) {
		for (let track of peer.stream.getTracks()) {
			peer.stream.removeTrack(track)
			track.stop()
		}
		peer.connection_type = null
		peer.video_bitrate = null
		peer_stats.delete(peer)
	}

	function stop_sfu() {
		if (!sfu) return
		sfu.abort.abort()
		sfu.connection.ontrack = null
		sfu.connection.onconnectionstatechange = null
		sfu.connection.close()
		sfu = null
		for (let peer of call.peers) {
			peer.is_connected = false
			remove_received_tracks(peer)
		}
	}

	function wait_sfu(connection, event, is_ready) {
		if (sfu?.connection != connection) return Promise.reject(media_changed)
		let signal = sfu.abort.signal // lifetime of this connection
		return new Promise(function(resolve, reject) {
			function finish() {
				if (!signal.aborted && !is_ready()) return
				connection.removeEventListener(event, finish)
				signal.removeEventListener('abort', finish)
				if (signal.aborted) reject(media_changed)
				else resolve()
			}
			connection.addEventListener(event, finish)
			signal.addEventListener('abort', finish)
			finish()
		})
	}

	// Create the SFU session when media negotiation is needed.

	async function open_sfu(connection) {
		if (sfu?.connection != connection || sfu.abort.signal.aborted)
			throw media_changed
		if (connection.connectionState != 'connected') {
			if (sfu_repair_deadline == null)
				sfu_repair_deadline = clock() + repair_timeout
			sfu_repair_timer(Math.max(0, sfu_repair_deadline - clock()))
		}
		if (!sfu.id) {
			let response = await request_sfu('open') // created SFU session
			if (sfu?.connection != connection || sfu.abort.signal.aborted)
				throw media_changed
			sfu.id = response.sessionId
		}
	}

	async function set_sfu_description(connection, response) {
		if (sfu?.connection != connection || sfu.abort.signal.aborted)
			throw media_changed
		if (!response.sessionDescription) return
		await connection.setRemoteDescription(response.sessionDescription)
		if (sfu?.connection != connection || sfu.abort.signal.aborted)
			throw media_changed
		if (response.sessionDescription.type == 'offer') {
			await connection.setLocalDescription(await connection.createAnswer())
			await wait_sfu(connection, 'icegatheringstatechange',
				() => connection.iceGatheringState == 'complete')
			await request_sfu('answer', {
				description: connection.localDescription,
			})
		}
	}

	// Publish enabled captures and close disabled publications.

	async function sync_sfu_publications() {
		if (!sfu || sfu.abort.signal.aborted || media_mode != 'sfu') return
		let connection = sfu.connection // current SFU connection
		let kinds = [] // track kinds disabled since their publication
		for (let kind of ['audio', 'video']) {
			let capture = kind == 'audio' // local capture for this sender
				? call.microphone : call.camera
			if (sfu.senders[kind] && !is_capture_enabled(capture))
				kinds.push(kind)
		}
		if (kinds.length) {
			await request_sfu('unpublish', {kinds})
			if (sfu?.connection != connection || sfu.abort.signal.aborted)
				throw media_changed
			for (let kind of kinds) {
				connection.getTransceivers().find(transceiver =>
					transceiver.sender == sfu.senders[kind]).stop()
				sfu.senders[kind] = null
			}
		}
		let transceivers = {} // {kind -> new sending RTCRtpTransceiver}
		for (let kind of ['audio', 'video']) {
			let capture = kind == 'audio' // local capture for this sender
				? call.microphone : call.camera
			if (sfu.senders[kind] || !is_capture_enabled(capture)) continue
			transceivers[kind] = connection.addTransceiver(
				get_capture_track(capture),
				{direction: 'sendonly', streams: [call.local_stream]})
			sfu.senders[kind] = transceivers[kind].sender
		}
		if (!Object.keys(transceivers).length) return
		await open_sfu(connection)
		await connection.setLocalDescription(await connection.createOffer())
		await wait_sfu(connection, 'icegatheringstatechange',
			() => connection.iceGatheringState == 'complete')
		let mids = {} // {kind -> new sending mid}
		for (let kind in transceivers) mids[kind] = transceivers[kind].mid
		let response = await request_sfu('publish', { // publication reply
			description: connection.localDescription, mids,
		})
		await set_sfu_description(connection, response)
		for (let track of response.tracks)
			if (track.errorCode)
				throw new Error(track.errorDescription || track.errorCode)
		await wait_sfu(connection, 'connectionstatechange',
			() => connection.connectionState == 'connected')
		if (sfu.senders.video) set_camera_bitrate(sfu.senders.video)
		await request_sfu('ready')
	}

	function set_sfu_source(peer_id, msg) {
		if (msg.sfu_id)
			sfu_sources.set(peer_id, {id: msg.sfu_id, tracks: msg.sfu_tracks})
		else
			sfu_sources.delete(peer_id)
	}

	async function sync_sfu_subscriptions() {
		if (!sfu || sfu.abort.signal.aborted || media_mode != 'sfu') return
		let connection = sfu.connection // current SFU connection
		let mids = [] // receiving mids whose publisher left or reconnected
		for (let [mid, source] of sfu.subscriptions) {
			let publication = // current publisher or none
				sfu_sources.get(source.peer_id)
			if (publication?.id != source.sfu_id
				|| publication.tracks[source.kind]?.trackName != source.track_name
				|| !find_peer(source.peer_id)) mids.push(mid)
		}
		if (mids.length) {
			let response = // closed receiver tracks
				await request_sfu('unsubscribe', {mids})
			if (sfu?.connection != connection || sfu.abort.signal.aborted)
				throw media_changed
			for (let mid of mids) {
				sfu.subscriptions.delete(mid)
				let transceiver = connection.getTransceivers() // closed receiver
					.find(transceiver => transceiver.mid == mid)
				let track = transceiver.receiver.track // closed remote track
				for (let peer of call.peers) peer.stream.removeTrack(track)
				transceiver.stop()
			}
			await set_sfu_description(connection, response)
		}
		let tracks = [] // {peer_id, kind} requested remote tracks
		for (let peer of call.peers) {
			let publication = sfu_sources.get(peer.id) // publisher or none
			peer.is_connected = !!publication
				&& connection.connectionState == 'connected'
			if (publication)
				peer.state = peer.is_connected ? 'connected' : 'connecting'
			else
				peer.state = peer.media?.microphone || peer.media?.camera
					? 'reconnecting' : 'joined'
			if (!publication) continue
			for (let kind of ['audio', 'video']) {
				if (!publication.tracks[kind]) continue
				let is_enabled = kind == 'audio' // remote capture is transmitting
					? peer.media?.microphone : peer.media?.camera
				if (!is_enabled) continue
				if ([...sfu.subscriptions.values()].some(source =>
					source.peer_id == peer.id && source.kind == kind)) continue
				tracks.push({peer_id: peer.id, kind})
			}
		}
		// Add no more than Cloudflare's limit of 64 tracks per request.
		for (let track_i = 0; track_i < tracks.length; track_i += 64) {
			await open_sfu(connection)
			let response = await request_sfu('subscribe', { // track batch reply
				tracks: tracks.slice(track_i, track_i + 64),
			})
			if (sfu?.connection != connection || sfu.abort.signal.aborted)
				throw media_changed
			for (let track of response.tracks) {
				if (track.errorCode) continue
				sfu.subscriptions.set(track.mid, {
					peer_id: track.peer_id, kind: track.kind,
					sfu_id: track.sessionId, track_name: track.trackName,
				})
			}
			await set_sfu_description(connection, response)
			if (connection.remoteDescription) {
				await wait_sfu(connection, 'connectionstatechange',
					() => connection.connectionState == 'connected')
			} else {
				await request_sfu('close')
				if (sfu?.connection != connection || sfu.abort.signal.aborted)
					throw media_changed
				sfu.id = null
				sfu_repair_timer()
				sfu_repair_deadline = null
			}
			for (let track of response.tracks) {
				if (!track.errorCode) continue
				let peer = find_peer(track.peer_id) // failed publisher or none
				if (peer) peer.state = 'failed'
			}
		}
		on_change()
	}

	async function start_sfu() {
		if (media_mode != 'sfu' || media_revision != received_media_revision)
			throw media_changed
		stop_sfu()
		await request_sfu('close')
		let connection = new RTCPeerConnection({ // shared SFU connection
			iceServers: ice_servers,
			iceTransportPolicy: ice_transport_policy,
		})
		sfu = {
			id: null, // Cloudflare session id or null before the first media
			connection, // RTCPeerConnection for sending and receiving
			senders: {}, // {kind -> local RTCRtpSender}
			abort: new AbortController(), // setup and repair lifetime
			subscriptions: new Map(), // {mid -> received track source}
		}
		connection.ontrack = function(ev) {
			let source = sfu.subscriptions.get(ev.transceiver.mid) // publisher
			let peer = find_peer(source.peer_id) // remote peer or none
			if (!peer) { ev.track.stop(); return }
			peer.stream.addTrack(ev.track)
			peer.is_connected = connection.connectionState == 'connected'
			peer.state = peer.is_connected ? 'connected' : 'connecting'
			if (ev.track.kind == 'audio') call.play_audio(peer)
			on_change()
		}
		connection.onconnectionstatechange = function() {
			if (connection.connectionState == 'connected') {
				sfu_repair_timer()
				sfu_repair_deadline = null
				for (let peer of call.peers) {
					if (!sfu_sources.has(peer.id)) continue
					peer.is_connected = true
					peer.state = 'connected'
				}
			} else if (connection.connectionState == 'failed') {
				cancel_sfu_requests()
				stop_sfu()
				for (let peer of call.peers) peer.state = 'reconnecting'
				enqueue(function() {
					if (!sfu) return start_sfu()
				})
			}
			on_change()
		}
		await sync_sfu_publications()
		await sync_sfu_subscriptions()
	}

	// Call-wide Force SFU control and server-controlled media switching.

	call.set_force_sfu = function(want_force_sfu) {
		assert(is_joined, 'call is not joined')
		socket.send(JSON.stringify({type: 'force_sfu', want_force_sfu}))
	}

	async function set_media_mode(msg, is_rejoined = false) {
		if (msg.media_revision != received_media_revision) return
		let prev_mode = media_mode // previous connection mode or null
		let want_rebuild = // the server requested new media connections
			media_mode != msg.media_mode || media_revision != msg.media_revision
		media_mode = msg.media_mode
		media_revision = msg.media_revision
		if (media_mode == 'sfu') {
			if (want_rebuild && !is_rejoined) sfu_sources.clear()
			if (want_rebuild || is_rejoined) {
				for (let peer of call.peers) {
					close_connection(peer)
					remove_received_tracks(peer)
					peer.state = 'connecting'
				}
				await start_sfu()
			}
		} else {
			stop_sfu()
			sfu_repair_timer()
			sfu_repair_deadline = null
			if (prev_mode == 'sfu' || msg.sfu_id) await request_sfu('close')
			for (let peer of call.peers) {
				if (!peer.connection) await connect_peer(peer)
				else if (is_rejoined) {
					if (peer.is_repairing && peer.is_offerer)
						await send_offer(peer, {iceRestart: true})
					if (peer.is_connected) send_connected(peer)
				}
			}
		}
		on_change()
	}

	// Server messages and remote connection updates.

	async function receive(msg) {
		if (msg.type == 'joined') {
			is_joined = true
			call.want_force_sfu = msg.want_force_sfu
			retry_timer()
			reconnect_deadline = null
			reconnect_token = msg.reconnect_token
			sessionStorage.setItem(token_key, reconnect_token)
			reconnect_timeout = msg.reconnect_timeout
			heartbeat_interval = msg.heartbeat_interval
			heartbeat_timeout = msg.heartbeat_timeout
			heartbeat_timer(heartbeat_interval)
			ice_servers = msg.ice_servers
			call.name = msg.name
			// peers missing from the list left while this socket was
			// down; listed ones this browser doesn't have yet joined meanwhile.
			let listed_ids = new Set( // ids of the peers in msg.peers
				msg.peers.map(listed_peer => listed_peer.id))
			for (let peer of call.peers.filter(peer => !listed_ids.has(peer.id)))
				close_peer(peer)
			local_peer_id = msg.peer_id
			sfu_sources.clear()
			for (let listed_peer of msg.peers) {
				let peer = find_peer(listed_peer.id) // retained peer or none
				if (!peer) peer = add_peer(listed_peer.id, listed_peer.name)
				peer.media = listed_peer.media
				set_sfu_source(peer.id, listed_peer)
			}
			await set_media_mode(msg, true)
			call.state = 'joined'
			send_media_to_all()
			on_change()
		} else if (msg.type == 'heartbeat') {
			// reply to send_heartbeat(): onmessage already recorded it.
		} else if (msg.type == 'media_mode') {
			await set_media_mode(msg)
		} else if (msg.type == 'force_sfu') {
			call.want_force_sfu = msg.want_force_sfu
			on_change()
		} else if (msg.type == 'sfu_publication') {
			set_sfu_source(msg.peer_id, msg)
			await sync_sfu_subscriptions()
		} else if (msg.type == 'peer_joined') {
			let peer = add_peer(msg.peer_id, msg.name) // newly admitted peer
			peer.media = msg.media
			set_sfu_source(peer.id, msg)
			if (media_mode == 'p2p') await connect_peer(peer)
			else await sync_sfu_subscriptions()
			send_media(peer)
			on_change()
		} else if (msg.type == 'peer_disconnected') {
			let peer = find_peer(msg.peer_id)
			if (peer) {
				peer.state = 'reconnecting'
				on_change()
			}
		} else if (msg.type == 'peer_resumed') {
			let peer = find_peer(msg.peer_id)
			if (peer) {
				peer.media = msg.media
				// partner socket was down: the server dropped the restart offer.
				if (peer.is_repairing && peer.is_offerer)
					await send_offer(peer, {iceRestart: true})
				if (peer.connection)
					peer.state = connection_state(peer)
				else if (peer.is_connected) peer.state = 'connected'
				send_media(peer)
				on_change()
			}
			set_sfu_source(msg.peer_id, msg)
			await sync_sfu_subscriptions()
		} else if (msg.type == 'peer_left') {
			let peer = find_peer(msg.peer_id)
			if (peer) {
				close_peer(peer)
				sfu_sources.delete(peer.id)
				await sync_sfu_subscriptions()
				on_change()
			}
		} else if (msg.type == 'signal') {
			let peer = find_peer(msg.peer_id)
			if (!peer) return
			let data = msg.data // setup or media state
			if (data.media) {
				peer.media = data.media
				await sync_sfu_subscriptions()
				on_change()
				return
			}
			if (media_mode != 'p2p' || msg.media_revision != media_revision
				|| !peer.connection) return
			let peer_connection = peer.connection
			if (data.description) {
				await peer_connection.setRemoteDescription(data.description)
				if (peer.connection != peer_connection) return
				if (data.description.type == 'offer') {
					for (let transceiver of peer_connection.getTransceivers()) {
						let kind = transceiver.receiver.track.kind
						let capture = kind == 'audio'
							? call.microphone : call.camera
						transceiver.direction = 'sendrecv'
						transceiver.sender.setStreams(call.local_stream)
						peer.senders[kind] = transceiver.sender
						await transceiver.sender.replaceTrack(
							get_capture_track(capture))
						if (peer.connection != peer_connection) return
					}
					await peer_connection.setLocalDescription(
						await peer_connection.createAnswer())
					if (peer.connection != peer_connection) return
					send_signal(peer,
						{description: peer_connection.localDescription})
				}
			} else if (data.candidate) {
				await peer_connection.addIceCandidate(data.candidate)
			}
		} else {
			throw new Error('Unknown signaling message: '+msg.type)
		}
	}

	// Server silence detection and reconnection within the allowed time.

	function drop_socket(error_text) {
		close_socket()
		if (!reconnect_token || (!call.peers.some(peer => peer.is_connected)
			&& media_mode != 'sfu')) {
			fail(new Error(error_text))
		} else {
			if (reconnect_deadline == null) {
				reconnect_deadline = clock() + reconnect_timeout
				retry_timer(1)
			}
			call.state = 'reconnecting'
			on_change()
		}
	}

	function send_heartbeat() {
		if (clock() - last_message_time >= heartbeat_timeout) {
			drop_socket('Signaling heartbeat timed out')
		} else {
			socket.send(JSON.stringify({type: 'heartbeat'}))
			heartbeat_timer(heartbeat_interval)
		}
	}

	function retry_signaling() {
		if (clock() >= reconnect_deadline) {
			fail(new Error('Signaling reconnect timed out'))
		} else {
			if (!socket) open_socket()
			retry_timer(Math.min(1, reconnect_deadline - clock()))
		}
	}

	// Signaling socket setup and stored peer tokens.

	function open_socket() {
		let url = new URL(signal_url)
		let replace_token = sessionStorage.getItem(token_key) // or null
		if (reconnect_token)
			url.searchParams.set('reconnect_token', reconnect_token)
		else if (replace_token)
			url.searchParams.set('replace_token', replace_token)
		socket = new WebSocket(url)
		socket.onmessage = function(ev) {
			last_message_time = clock()
			let msg = JSON.parse(ev.data) // server message
			if (msg.type == 'sfu_result') {
				let request = sfu_requests.get(msg.request_id) // pending request
				if (!request) return
				sfu_requests.delete(msg.request_id)
				if (msg.canceled) request.reject(media_changed)
				else if (msg.error) request.reject(new Error(msg.error))
				else request.resolve(msg.data)
			} else {
				if (msg.type == 'media_mode' || msg.type == 'joined') {
					received_media_revision = msg.media_revision
					cancel_sfu_requests()
					if (sfu) sfu.abort.abort()
				}
				enqueue(function() { return receive(msg) })
			}
		}
		socket.onclose = function(ev) {
			if (ev.code == rejected_close_code) {
				close_socket()
				fail(new Error(ev.reason))
			} else {
				drop_socket('Signaling closed ('+ev.code+'): '+ev.reason)
			}
		}
	}

	call.join = function(opt) {
		assert(call.state == 'preview', 'call already joined or closed')
		let {call_id, invite_token} = opt
		ice_transport_policy = opt.ice_transport_policy ?? 'all'
		token_key = 'ui_call.reconnect_token.'+call_id
		signal_url = new URL('/call_signal/'+encodeURIComponent(call_id),
			location.href)
		signal_url.protocol = location.protocol == 'https:' ? 'wss:' : 'ws:'
		signal_url.searchParams.set('invite_token', invite_token)
		if (opt.name) signal_url.searchParams.set('name', opt.name)
		open_socket()
		call.state = 'joining'
		stats_timer(1)
		on_change()
	}

	window.addEventListener('pagehide', call.leave)
	if (media_devices) {
		media_devices.addEventListener('devicechange', refresh_devices)
		refresh_devices()
	}

	return call
}

// Device choices, on/off controls and capture retries.

let call_device_defaults = { // {device kind -> system default choice}
	audioinput: {deviceId: null, label: 'Default microphone'},
	videoinput: {deviceId: null, label: 'Default camera'},
	audiooutput: {deviceId: null, label: 'Default speaker'},
}
let call_device_field = ui.create_field({ // device choice display
	to_text: device => device.label || 'Unnamed device',
})

function get_device_choices(devices,
	device_kind) { // -> [default, device1, ...]
	let choices = [call_device_defaults[device_kind]]
	for (let device of devices)
		if (device.kind == device_kind && device.deviceId) choices.push(device)
	return choices
}

function get_device_choice(choices, device_id) {
	return choices.find(device => device.deviceId == device_id) || {
		deviceId: device_id,
		label: 'Unavailable device',
	}
}

function draw_call_media(id, capture, devices, device_kind, label,
	set_capture) {
	let input_devices = get_device_choices(devices,
		device_kind) // device choices
	let selected_device = get_device_choice(input_devices, capture.device_id)
	ui.h(0, ui.sp())
		ui.label(id, label, 0)
		let is_enabled = ui.checkbox(id, capture.is_enabled, null, 0)
		let device = ui.list_dropdown(id+'.device', input_devices,
			selected_device, call_device_field, 1)
		let device_id = device ? device.deviceId : null
		if (is_enabled != capture.is_enabled || device_id != capture.device_id)
			set_capture(is_enabled, device_id)
		if (capture.pending) ui.text('', 'Updating...', 0)
		if (capture.track) {
			ui.text('', capture.track.label, 0)
			ui.text('', capture.track.enabled ? 'On' : 'Muted', 0)
		} else {
			ui.text('', 'Not capturing', 0)
		}
		if (capture.error && !capture.pending)
			if (ui.button(id+'.retry', 'Retry', 0))
				set_capture(true, capture.device_id)
	ui.end_h()
	if (capture.error) ui.text('', capture.error, 0)
}

// Speaker choice for peers' audio.

function draw_call_speaker(id, call) {
	let output_devices = get_device_choices(call.devices, 'audiooutput')
	let selected_device = get_device_choice(output_devices,
		call.speaker.device_id)
	ui.h(0, ui.sp())
		ui.label(id, 'Speaker', 0)
		let device = ui.list_dropdown(id, output_devices, selected_device,
			call_device_field, 1)
		let device_id = device ? device.deviceId : null
		if (device_id != call.speaker.device_id)
			call.set_speaker(device_id)
	ui.end_h()
	if (call.speaker.error) ui.text('', call.speaker.error, 0)
}

// One peer's name, microphone state, video and connection status.

function draw_call_tile(id, name, is_muted, stream, placeholder, status,
	connection_info) {
	ui.v(1, ui.sp(), 's', 's')
		ui.text('', status ? name+' ('+status+')' : name, 0)
		if (is_muted) ui.text('', 'Microphone muted', 0)
		ui.stack('', 1, 's', 's')
			ui.bb('bg1', null, 1, 'intense')
			if (stream)
				ui.video(id, stream)
			else
				ui.text('', placeholder, 0, 'c', 'c')
			if (connection_info) {
				ui.m(ui.sp05())
				ui.p(ui.sp05())
				ui.h(0, 0, 'r', 't')
					ui.bg(':rgba(0,0,0,0.65)')
					ui.color(':white')
					ui.text('', connection_info, 0)
					ui.end_h()
			}
		ui.end_stack()
		let playback_error = ui.state_of(id, 'playback_error')
		if (playback_error) ui.text('', playback_error, 0)
	ui.end_v()
}

// Call widget lifetime, join/leave controls and media display.

ui.call = ui.stateful_widget(function(id) {
	let call = window.create_call({on_change: ui.animate}) // call
	let call_error = null // error text of the last ended call or null
	let guest_name = null // name for this call when no account name is given
	let microphone_level = null // cached level or null until sampled
	let meter_timer = timer(function() { // (seconds?) -> arm/cancel
		microphone_level = null
		ui.animate()
	})
	let e = {} // {build -> function}
	ui.on_free(id, function() {
		meter_timer()
		call.leave()
	})

	// call ended (left or failed): continue in a new call in preview.
	function replace_ended_call() {
		let ended_call = call // call being replaced
		call_error = ended_call.error
		call = window.create_call({on_change: ui.animate})
		call.set_microphone(ended_call.microphone.is_enabled,
			call.microphone.device_id,
			ended_call.microphone.want_echo_cancellation,
			ended_call.microphone.want_noise_suppression)
		if (ended_call.camera.is_enabled) call.set_camera(true)
	}

	e.build = function(id, opt, fr, align, valign) {
		ui.state(id)
		if (call.state == 'left' || call.state == 'failed')
			replace_ended_call()
		let {call_id, invite_token, can_join = true} = opt
		let is_active = call.state != 'preview' // in a call
		ui.v(fr ?? 1, ui.sp(), align ?? 's', valign ?? 's')
			if (call.state == 'preview' && !opt.name) {
				ui.h(0, ui.sp())
					ui.label(id+'.name', 'Your name', 0)
					guest_name = ui.input(id+'.name', guest_name, null, 1)
				ui.end_h()
			}
			ui.h(0, ui.sp())
				if (is_active) {
					if (ui.button(id+'.leave', 'Leave', 0)) {
						call.leave()
						replace_ended_call()
					}
				} else {
					if (ui.button(id+'.join', 'Join', 0,
						null, null, null, !can_join || !call_id || !invite_token
							|| !(opt.name || guest_name?.trim()))) {
						call_error = null
						call.join({...opt, name: opt.name || guest_name.trim()})
					}
				}
			ui.end_h()

			// Force SFU for every peer in the joined call.

			if (call.state == 'joined') {
				ui.h(0, ui.sp())
					ui.label(id+'.force_sfu', 'Force SFU (whole call)', 0)
					let want_force_sfu = ui.checkbox( // requested SFU override
						id+'.force_sfu', call.want_force_sfu, null, 0)
					if (want_force_sfu != call.want_force_sfu)
						call.set_force_sfu(want_force_sfu)
				ui.end_h()
			}
			ui.text('', 'Status: '+call.state, 0)
			if (call_error) ui.text('', call_error, 0)
			draw_call_media(id+'.microphone', call.microphone, call.devices,
				'audioinput', 'Microphone', call.set_microphone)
			ui.h(0, ui.sp())
				ui.label(id+'.echo_cancellation', 'Echo cancellation', 0)
				let want_echo_cancellation = ui.checkbox( // checkbox value
					id+'.echo_cancellation', call.microphone.want_echo_cancellation,
					null, 0)
				ui.label(id+'.noise_suppression', 'Noise suppression', 0)
				let want_noise_suppression = ui.checkbox( // checkbox value
					id+'.noise_suppression', call.microphone.want_noise_suppression,
					null, 0)
			ui.end_h()
			if (want_echo_cancellation != call.microphone.want_echo_cancellation
				|| want_noise_suppression
					!= call.microphone.want_noise_suppression)
				call.set_microphone(call.microphone.is_enabled,
					call.microphone.device_id,
					want_echo_cancellation, want_noise_suppression)

			// Microphone level sampling and meter display.

			let level
			if (!call.microphone.track?.enabled) {
				meter_timer()
				microphone_level = null
				level = call.microphone_level()
			} else {
				if (microphone_level == null) {
					microphone_level = call.microphone_level()
					if (microphone_level != null) meter_timer(.1)
				}
				level = microphone_level
			}
			if (call.microphone.track) {
				ui.h(0, ui.sp())
					ui.text('', 'Microphone level', 0)
					if (level == null) {
						if (ui.button(id+'.meter', 'Enable meter', 0))
							call.set_microphone(true)
					} else {
						let fr = clamp( // bar fraction
							1 + Math.log10(level) / 3, 0, 1)
						ui.min_wh(ui.em(8), ui.em(.5))
						ui.h(0, 0, 'l', 'c')
							ui.bb('bg1', null, 1, 'intense')
							if (fr > 0) {
								ui.stack('', fr, 's', 's')
									ui.bb('link')
								ui.end_stack()
							}
							if (fr < 1) {
								ui.stack('', 1 - fr, 's', 's')
								ui.end_stack()
							}
						ui.end_h()
					}
				ui.end_h()
			}
			draw_call_media(id+'.camera', call.camera, call.devices,
				'videoinput', 'Camera', call.set_camera)
			ui.h(0, ui.sp())
				ui.label(id+'.background_blur', 'Blur background', 0)
				let want_background_blur = ui.checkbox( // checkbox value
					id+'.background_blur', call.camera.want_background_blur,
					null, 0)
			ui.end_h()
			if (want_background_blur != call.camera.want_background_blur)
				call.set_camera(call.camera.is_enabled, call.camera.device_id,
					want_background_blur)
			// browsers without audio output routing: no speaker choice.
			if (HTMLMediaElement.prototype.setSinkId)
				draw_call_speaker(id+'.speaker', call)
			for (let peer of call.peers)
				if (peer.audio_error) {
					ui.h(0, ui.sp())
						ui.text('', peer.name+': '+peer.audio_error, 0)
						if (ui.button(id+'.audio.'+peer.id, 'Play audio', 0))
							call.play_audio(peer)
					ui.end_h()
				}
			if (call.state == 'joined' && !call.peers.length)
				ui.text('', 'Waiting for participants', 0)

			// Local and peer tiles in a grid.

			let tile_n = 1 + call.peers.length // local and peer tiles
			let col_n = Math.ceil(Math.sqrt(tile_n)) // tiles per row
			ui.v(1, ui.sp(), 's', 's')
				for (let row_i = 0; row_i * col_n < tile_n; row_i++) {
					ui.h(1, ui.sp(), 's', 's')
						let tile_i1 = row_i * col_n // first tile index of the row
						let tile_i2 = Math.min(tile_i1 + col_n, tile_n) // row end
						for (let tile_i = tile_i1; tile_i < tile_i2; tile_i++) {
							if (tile_i == 0) {
								draw_call_tile(id+'.local',
									call.name || opt.name || guest_name || 'Local',
									!is_capture_enabled(call.microphone),
									is_capture_enabled(call.camera)
										? call.local_stream : null,
									'Camera off', null)
							} else {
								let peer = call.peers[tile_i - 1]
								let video_bitrate = // incoming video Mbps or '--'
									peer.video_bitrate == null
										? '--' : (peer.video_bitrate / 1000).toFixed(1)
								draw_call_tile(id+'.peer.'+peer.id, peer.name,
									peer.media && !peer.media.microphone,
									peer.media?.camera ? peer.stream : null,
									peer.media ? 'Camera off'
										: 'Waiting for media state',
									peer.state != 'connected' ? peer.state : null,
									(peer.connection_type || '--')+' | '
										+video_bitrate+' Mbps')
							}
						}
					ui.end_h()
				}
			ui.end_v()
		ui.end_v()
		return call
	}

	return e
})

})()
