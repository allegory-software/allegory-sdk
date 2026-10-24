/*

	WebRTC call session and call widget.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES

	- Talk to several participants at once.
	- Switch microphones or cameras during a call without reconnecting.
	- Rejoin as the same participant after a disconnect or page reload,
	  within the server's reconnect window.
	- Automatically detect a lost server connection and try to reconnect.
	- Automatically try to restore lost audio and video connections.
	  Stop retrying after the recovery time limit.
	- Choose from an updated list of microphones and cameras after plugging
	  in or unplugging devices.
	- Check microphone activity with a level meter.

API

	ui.call(id, opt, [fr], [align], [valign]) -> call
		call_id, token, name, can_join, ice_transport_policy
		name is optional when the user enters a guest name.
		can_join defaults to true.
		ice_transport_policy defaults to 'all'.

	create_call({on_change}) -> call
	call.join({call_id, token, [name], [ice_transport_policy]})
	call.leave()
	call.set_microphone(is_enabled, [device_id]) -> promise
	call.set_camera(is_enabled, [device_id]) -> promise
	call.microphone_level() -> number or null
	call.play_audio(peer)

*/

(function() {
"use strict"

let rejected_close_code = 4000 // signaling close code for a refused join
let repair_timeout = 30 // seconds allowed to repair a failed connection

function is_media_enabled(media) {
	return !!(media.track?.enabled && media.track.readyState == 'live'
		&& !media.track.muted)
}

// Call session, captured media and remote participants.

window.create_call = function(opt) {
	let {on_change} = opt
	let call = {
		state: 'preview', // current call phase
		error: null, // terminal error text or null
		name: null, // display name accepted by the server or null
		peers: [], // remote participant objects in join order
		local_stream: new MediaStream(), // captured MediaStream or null
		devices: [], // available MediaDeviceInfo objects for audio/video input
		microphone: { // microphone selection and capture state
			device_id: null, // selected device id or null for the default
			track: null, // captured MediaStreamTrack or null
			is_enabled: false, // requested microphone transmission
			pending: null, // pending capture/update promise or null
			error: null, // microphone error text or null
		},
		camera: { // camera selection and capture state
			device_id: null, // selected device id or null for the default
			track: null, // captured MediaStreamTrack or null
			is_enabled: false, // requested camera capture
			pending: null, // pending capture/update promise or null
			error: null, // camera error text or null
		},
	}
	let socket = null // signaling WebSocket or null
	let signal_url = null // URL used to join or reconnect signaling
	let reconnect_token = null // credential for this participant or null
	let token_key = null // sessionStorage key of the stored reconnect token
	let reconnect_timeout = null // server reconnect window in seconds
	let reconnect_deadline = null // local retry deadline or null
	let is_joined = false // current socket has been admitted by the server
	let retry_timer = glue.timer(retry_signaling) // arm/cancel retry timer
	let heartbeat_interval = null // server heartbeat interval in seconds
	let heartbeat_timeout = null // server silence limit in seconds
	let last_message_time = null // glue.clock() of the last message or null
	let heartbeat_timer = glue.timer(send_heartbeat) // arm/cancel heartbeat
	let ice_servers = null // RTCIceServer array received on admission
	let ice_transport_policy = 'all' // selected ICE transport policy
	let messages = Promise.resolve() // serialized signaling operations
	let media_devices = navigator.mediaDevices // capture API or undefined
	let device_request = null // latest device enumeration promise or null
	let microphone_context = null // meter AudioContext or null
	let microphone_source = null // captured audio source node or null
	let microphone_analyser = null // microphone AnalyserNode or null
	let microphone_samples = null // reusable Float32Array of audio samples

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

	function stop_capture(media) {
		if (!media.track) return
		if (media == call.microphone) {
			microphone_source.disconnect()
			microphone_source = null
		}
		media.track.onended = null
		media.track.onmute = null
		media.track.onunmute = null
		media.track.stop()
		call.local_stream.removeTrack(media.track)
		media.track = null
	}

	// Available microphones and cameras after capture or hardware changes.

	async function refresh_devices() {
		let request = media_devices.enumerateDevices()
		device_request = request
		try {
			let devices = await request
			if (is_closed() || device_request != request) return
			call.devices = devices.filter(device =>
				device.kind == 'audioinput' || device.kind == 'videoinput')
		} catch (error) {
			if (is_closed() || device_request != request) return
			for (let media of [call.microphone, call.camera])
				media.error = 'Device list: '+error.name+': '+error.message
		}
		on_change()
	}

	// Device switching across existing participant connections.

	async function replace_capture(media, kind, track) {
		// a peer connected during an await got the previous track: repeat
		// until every sender has this one.
		let replaced_senders = new Set() // senders given track
		while (true) {
			let peer = call.peers.find(call_peer => call_peer.senders[kind]
				&& !replaced_senders.has(call_peer.senders[kind]))
			if (!peer) break
			let sender = peer.senders[kind]
			replaced_senders.add(sender)
			try {
				await sender.replaceTrack(track)
			} catch (error) {
				if (peer.senders[kind] == sender) throw error
			}
		}
		if (is_closed()) {
			if (track) track.stop()
			return
		}
		stop_capture(media)
		if (track) {
			media.track = track
			track.enabled = media.is_enabled
			call.local_stream.addTrack(track)
			if (kind == 'audio') {
				microphone_source = microphone_context
					.createMediaStreamSource(call.local_stream)
				microphone_source.connect(microphone_analyser)
			}
			track.onended = function() {
				stop_capture(media)
				media.error = 'Capture ended; select or enable the device again'
				send_media_to_all()
				on_change()
				refresh_devices()
			}
			track.onmute = track.onunmute = function() {
				send_media_to_all()
				on_change()
			}
			if (kind == 'video' && !media.is_enabled)
				stop_capture(media)
		}
	}

	// Capture using the latest device and on/off choices.

	async function update_media(media, kind) {
		while (!is_closed()) {
			let device_id = media.device_id
			let is_enabled = media.is_enabled
			try {
				if (!is_enabled) {
					if (kind == 'video')
						await replace_capture(media, kind, null)
					if (!media.is_enabled) return
					continue
				}
				if (media.track && (media.track.getConstraints()
					.deviceId?.exact ?? null) == device_id) {
					media.track.enabled = true
					send_media_to_all()
					return
				}
				if (!media_devices)
					throw new Error('Media capture requires HTTPS or localhost')
				let constraints = {} // requested capture constraints
				if (device_id) constraints.deviceId = {exact: device_id}
				if (kind == 'audio') {
					constraints.echoCancellation = true
					constraints.noiseSuppression = true
				}
				let stream = await media_devices.getUserMedia({
					audio: kind == 'audio' ? constraints : false,
					video: kind == 'video' ? constraints : false,
				})
				let track = stream.getTracks()[0]
				if (is_closed() || !media.is_enabled
					|| media.device_id != device_id) {
					track.stop()
					continue
				}
				try {
					await replace_capture(media, kind, track)
				} catch (error) {
					track.stop()
					throw error
				}
				if (is_closed()) return
				media.error = null
				send_media_to_all()
				on_change()
				refresh_devices()
				if (media.device_id == device_id && media.is_enabled) return
			} catch (error) {
				if (is_closed()) return
				if (media.device_id != device_id
					|| media.is_enabled != is_enabled) continue
				media.error = error.name+': '+error.message
				return
			}
		}
	}

	function set_media(media, kind, is_enabled, device_id) {
		glue.assert(!is_closed(), 'call is closed')
		media.device_id = device_id
		media.is_enabled = is_enabled
		media.error = null
		if (media.track && !is_enabled) {
			if (kind == 'audio') {
				media.track.enabled = false
			} else {
				stop_capture(media)
			}
			send_media_to_all()
		}
		if (!media.pending) {
			media.pending = update_media(media, kind).finally(function() {
				media.pending = null
				on_change()
			})
		}
		on_change()
		return media.pending
	}

	// Microphone control and audio analysis for the level meter.

	call.set_microphone = function(is_enabled,
		device_id = call.microphone.device_id) {
		let pending = set_media(call.microphone, 'audio', is_enabled, device_id)
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

	call.set_camera = function(is_enabled, device_id = call.camera.device_id) {
		return set_media(call.camera, 'video', is_enabled, device_id)
	}

	// Participant removal and call shutdown.

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
	}

	function close_socket() {
		is_joined = false
		heartbeat_timer()
		if (socket) {
			socket.onmessage = null
			socket.onclose = null
			socket.close()
			socket = null
		}
	}

	function close() {
		retry_timer()
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
			if (!is_closed()) fail(error)
		})
	}

	function send_signal(peer, data) {
		if (!is_joined) return
		socket.send(JSON.stringify({
			type: 'signal',
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
			microphone: is_media_enabled(call.microphone),
			camera: is_media_enabled(call.camera),
		}})
	}

	function send_media_to_all() {
		for (let peer of call.peers)
			send_media(peer)
	}

	// Audio and video connection setup for each participant.

	async function send_offer(peer, offer_opt) {
		let peer_connection = peer.connection
		await peer_connection.setLocalDescription(
			await peer_connection.createOffer(offer_opt))
		if (peer.connection != peer_connection) return
		send_signal(peer, {description: peer_connection.localDescription})
	}

	async function connect_peer(peer_id, name, want_offer) {
		glue.assert(!find_peer(peer_id), 'peer already connected')
		let peer_connection = new RTCPeerConnection({
			iceServers: ice_servers,
			iceTransportPolicy: ice_transport_policy,
		})
		let peer = { // remote participant
			id: peer_id, // participant id
			name: name, // display name
			state: 'connecting', // connection status
			stream: new MediaStream(), // received MediaStream
			media: null, // {microphone: boolean, camera: boolean} or null
			audio_error: null, // remote audio playback error text or null
			connection: peer_connection, // RTCPeerConnection or null if failed
			senders: {audio: null, video: null}, // {kind -> RTCRtpSender or null}
			audio: new Audio(), // remote audio playback element
			is_offerer: want_offer, // this browser made the offer
			is_connected: false, // connection has connected
			is_repairing: false, // ICE restart of a failed connection is running
			repair_timer: null, // (seconds?) -> arm/cancel repair time limit
		}
		peer.repair_timer = glue.timer(function() {
			fail_connection(peer)
		})
		peer.audio.srcObject = peer.stream
		call.peers.push(peer)
		if (peer.is_offerer)
			for (let kind of ['audio', 'video']) {
				let track = kind == 'audio'
					? call.microphone.track : call.camera.track
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
		// Connection recovery with a separate time limit per participant.

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

	// Server messages and remote connection updates.

	async function receive(msg) {
		if (msg.type == 'joined') {
			is_joined = true
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
			// participants missing from the list left while this socket was
			// down; listed ones this browser doesn't have yet joined meanwhile.
			let listed_ids = new Set( // ids of the participants in msg.peers
				msg.peers.map(listed_peer => listed_peer.id))
			for (let peer of call.peers.filter(peer => !listed_ids.has(peer.id)))
				close_peer(peer)
			for (let listed_peer of msg.peers) {
				let peer = find_peer(listed_peer.id)
				if (!peer) {
					await connect_peer(listed_peer.id, listed_peer.name, true)
				} else {
					// this socket was down: the server dropped the restart offer.
					if (peer.is_repairing && peer.is_offerer)
						await send_offer(peer, {iceRestart: true})
					if (peer.is_connected)
						send_connected(peer)
				}
			}
			call.state = 'joined'
			send_media_to_all()
			on_change()
		} else if (msg.type == 'heartbeat') {
			// reply to send_heartbeat(): onmessage already recorded it.
		} else if (msg.type == 'peer_joined') {
			await connect_peer(msg.peer_id, msg.name, false)
		} else if (msg.type == 'peer_disconnected') {
			let peer = find_peer(msg.peer_id)
			if (peer) {
				peer.state = 'reconnecting'
				on_change()
			}
		} else if (msg.type == 'peer_resumed') {
			let peer = find_peer(msg.peer_id)
			if (peer) {
				// partner socket was down: the server dropped the restart offer.
				if (peer.is_repairing && peer.is_offerer)
					await send_offer(peer, {iceRestart: true})
				if (peer.connection)
					peer.state = connection_state(peer)
				send_media(peer)
				on_change()
			}
		} else if (msg.type == 'peer_left') {
			let peer = find_peer(msg.peer_id)
			if (peer) {
				close_peer(peer)
				on_change()
			}
		} else if (msg.type == 'signal') {
			let peer = find_peer(msg.peer_id)
			if (!peer || !peer.connection) return
			let peer_connection = peer.connection
			let data = msg.data
			if (data.description) {
				await peer_connection.setRemoteDescription(data.description)
				if (peer.connection != peer_connection) return
				if (data.description.type == 'offer') {
					for (let transceiver of peer_connection.getTransceivers()) {
						let kind = transceiver.receiver.track.kind
						let media = kind == 'audio' ? call.microphone : call.camera
						transceiver.direction = 'sendrecv'
						transceiver.sender.setStreams(call.local_stream)
						peer.senders[kind] = transceiver.sender
						await transceiver.sender.replaceTrack(media.track)
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
			} else if (data.media) {
				peer.media = data.media
				on_change()
			}
		} else {
			throw new Error('Unknown signaling message: '+msg.type)
		}
	}

	// Server silence detection and reconnection within the allowed time.

	function drop_socket(error_text) {
		close_socket()
		if (!reconnect_token || !call.peers.some(peer => peer.is_connected)) {
			fail(new Error(error_text))
		} else {
			if (reconnect_deadline == null) {
				reconnect_deadline = glue.clock() + reconnect_timeout
				retry_timer(1)
			}
			call.state = 'reconnecting'
			on_change()
		}
	}

	function send_heartbeat() {
		if (glue.clock() - last_message_time >= heartbeat_timeout) {
			drop_socket('Signaling heartbeat timed out')
		} else {
			socket.send(JSON.stringify({type: 'heartbeat'}))
			heartbeat_timer(heartbeat_interval)
		}
	}

	function retry_signaling() {
		if (glue.clock() >= reconnect_deadline) {
			fail(new Error('Signaling reconnect timed out'))
		} else {
			if (!socket) open_socket()
			retry_timer(Math.min(1, reconnect_deadline - glue.clock()))
		}
	}

	// Signaling socket setup and stored participant tokens.

	function open_socket() {
		let url = new URL(signal_url)
		let replace_token = sessionStorage.getItem(token_key) // or null
		if (reconnect_token)
			url.searchParams.set('reconnect_token', reconnect_token)
		else if (replace_token)
			url.searchParams.set('replace_token', replace_token)
		socket = new WebSocket(url)
		socket.onmessage = function(ev) {
			last_message_time = glue.clock()
			enqueue(function() { return receive(JSON.parse(ev.data)) })
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
		glue.assert(call.state == 'preview', 'call already joined or closed')
		let {call_id, token} = opt
		ice_transport_policy = opt.ice_transport_policy ?? 'all'
		token_key = 'ui_call.reconnect_token.'+call_id
		signal_url = new URL('/call_signal/'+encodeURIComponent(call_id),
			location.href)
		signal_url.protocol = location.protocol == 'https:' ? 'wss:' : 'ws:'
		signal_url.searchParams.set('token', token)
		if (opt.name) signal_url.searchParams.set('name', opt.name)
		open_socket()
		call.state = 'joining'
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

let call_device_defaults = { // {input kind -> system default choice}
	audioinput: {deviceId: null, label: 'Default microphone'},
	videoinput: {deviceId: null, label: 'Default camera'},
}
let call_device_field = ui.create_field({ // device choice display
	to_text: device => device.label || 'Unnamed device',
})

function draw_call_media(id, media, devices, kind, label, set_media,
	is_closed) {
	let input_devices = [call_device_defaults[kind]] // input device choices
	for (let device of devices)
		if (device.kind == kind && device.deviceId) input_devices.push(device)
	let selected_device = input_devices.find(device =>
		device.deviceId == media.device_id)
	if (!selected_device)
		selected_device = {
			deviceId: media.device_id,
			label: 'Unavailable device',
		}
	ui.h(0, ui.sp())
		ui.label(id, label, 0)
		let is_enabled = ui.checkbox(id, media.is_enabled,
			null, 0, null, null, is_closed)
		let device = ui.list_dropdown(id+'.device', input_devices,
			selected_device, call_device_field, 1, null, null, is_closed)
		let device_id = device ? device.deviceId : null
		if (is_enabled != media.is_enabled || device_id != media.device_id)
			set_media(is_enabled, device_id)
		if (media.pending) ui.text('', 'Updating...', 0)
		if (media.track) {
			ui.text('', media.track.label, 0)
			ui.text('', media.track.enabled ? 'On' : 'Muted', 0)
		} else {
			ui.text('', 'Not capturing', 0)
		}
		if (media.error && !media.pending && !is_closed)
			if (ui.button(id+'.retry', 'Retry', 0))
				set_media(true, media.device_id)
	ui.end_h()
	if (media.error) ui.text('', media.error, 0)
}

// One participant's name, microphone state, video and connection status.

function draw_call_tile(id, name, is_muted, stream, placeholder, status) {
	ui.v(1, ui.sp(), 's', 's')
		ui.text('', status ? name+' ('+status+')' : name, 0)
		if (is_muted) ui.text('', 'Microphone muted', 0)
		ui.stack('', 1, 's', 's')
			ui.bb('bg1', null, 1, 'intense')
			if (stream)
				ui.video(id, stream)
			else
				ui.text('', placeholder, 0, 'c', 'c')
		ui.end_stack()
		let playback_error = ui.state_of(id, 'playback_error')
		if (playback_error) ui.text('', playback_error, 0)
	ui.end_v()
}

// Call widget lifetime, join/leave controls and media display.

ui.call = ui.stateful_widget(function(id) {
	let call = window.create_call({on_change: ui.animate}) // call session
	let guest_name = null // name for this call when no account name is given
	let microphone_level = null // cached level or null until sampled
	let meter_timer = glue.timer(function() { // (seconds?) -> arm/cancel
		microphone_level = null
		ui.animate()
	})
	let e = {} // {build -> function}
	ui.on_free(id, function() {
		meter_timer()
		call.leave()
	})

	e.build = function(id, opt, fr, align, valign) {
		ui.state(id)
		let {call_id, token, can_join = true} = opt
		let is_closed = call.state == 'left' || call.state == 'failed'
		let is_active = call.state != 'preview' && !is_closed
		ui.v(fr ?? 1, ui.sp(), align ?? 's', valign ?? 's')
			if (call.state == 'preview' && !opt.name) {
				ui.h(0, ui.sp())
					ui.label(id+'.name', 'Your name', 0)
					guest_name = ui.input(id+'.name', guest_name, null, 1)
				ui.end_h()
			}
			ui.h(0, ui.sp())
				if (is_active) {
					if (ui.button(id+'.leave', 'Leave', 0))
						call.leave()
				} else if (is_closed) {
					if (ui.button(id+'.preview', 'New preview', 0))
						call = window.create_call({on_change: ui.animate})
				} else {
					if (ui.button(id+'.join', 'Join', 0,
						null, null, null, !can_join || !call_id || !token
							|| !(opt.name || guest_name?.trim())))
						call.join({...opt, name: opt.name || guest_name.trim()})
				}
			ui.end_h()
			ui.text('', 'Status: '+call.state, 0)
			if (call.error) ui.text('', call.error, 0)
			draw_call_media(id+'.microphone', call.microphone, call.devices,
				'audioinput', 'Microphone', call.set_microphone, is_closed)

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
						let fr = glue.clamp( // bar fraction
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
				'videoinput', 'Camera', call.set_camera, is_closed)
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

			// Local and participant tiles in a grid.

			let tile_n = 1 + call.peers.length // local and participant tiles
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
									!is_media_enabled(call.microphone),
									is_media_enabled(call.camera)
										? call.local_stream : null,
									'Camera off', null)
							} else {
								let peer = call.peers[tile_i - 1]
								draw_call_tile(id+'.peer.'+peer.id, peer.name,
									peer.media && !peer.media.microphone,
									peer.media?.camera ? peer.stream : null,
									peer.media ? 'Camera off'
										: 'Waiting for media state',
									peer.state != 'connected' ? peer.state : null)
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
