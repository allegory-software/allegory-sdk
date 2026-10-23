(function() {
"use strict"

window.join_call = function(opt) {
	let {call_id, token, on_change, ice_transport_policy = 'all'} = opt
	let call = {
		state: 'capturing', // current call phase
		error: null, // terminal error text or null
		audio_error: null, // remote audio playback error text or null
		peer_id: null, // remote participant id or null
		local_stream: null, // captured MediaStream or null
		remote_stream: null, // received MediaStream or null
	}
	let socket = null // signaling WebSocket or null
	let connection = null // RTCPeerConnection or null
	let ice_servers = null // RTCIceServer array received on admission
	let messages = Promise.resolve() // serialized signaling operations
	let audio = new Audio() // remote audio playback element

	function close_peer() {
		if (connection) {
			connection.onicecandidate = null
			connection.ontrack = null
			connection.onconnectionstatechange = null
			connection.close()
			connection = null
		}
		audio.pause()
		audio.srcObject = null
		if (call.remote_stream) {
			for (let track of call.remote_stream.getTracks())
				track.stop()
		}
		call.remote_stream = null
		call.peer_id = null
		call.audio_error = null
	}

	function close() {
		if (socket) {
			socket.onmessage = null
			socket.onerror = null
			socket.onclose = null
			socket.close()
			socket = null
		}
		close_peer()
		if (call.local_stream) {
			for (let track of call.local_stream.getTracks())
				track.stop()
			call.local_stream = null
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

	call.play_audio = function() {
		let stream = call.remote_stream
		audio.play().then(function() {
			if (audio.srcObject != stream) return
			call.audio_error = null
			on_change()
		}, function(error) {
			if (audio.srcObject != stream) return
			call.audio_error = error.name+': '+error.message
			on_change()
		})
	}

	function enqueue(fn) {
		messages = messages.then(function() {
			if (socket) return fn()
		}).catch(function(error) {
			if (socket) fail(error)
		})
	}

	function send_signal(data) {
		socket.send(JSON.stringify({
			type: 'signal',
			peer_id: call.peer_id,
			data: data,
		}))
	}

	async function connect_peer(peer_id, is_offerer) {
		glue.assert(!connection, 'peer already connected')
		let peer_connection = new RTCPeerConnection({
			iceServers: ice_servers,
			iceTransportPolicy: ice_transport_policy,
		})
		connection = peer_connection
		call.peer_id = peer_id
		call.remote_stream = new MediaStream()
		audio.srcObject = call.remote_stream
		for (let track of call.local_stream.getTracks())
			peer_connection.addTrack(track, call.local_stream)
		peer_connection.onicecandidate = function(ev) {
			if (!ev.candidate) return
			enqueue(function() {
				if (connection != peer_connection) return
				send_signal({candidate: ev.candidate.toJSON()})
			})
		}
		peer_connection.ontrack = function(ev) {
			call.remote_stream.addTrack(ev.track)
			if (ev.track.kind == 'audio') call.play_audio()
			on_change()
		}
		peer_connection.onconnectionstatechange = function() {
			if (peer_connection.connectionState == 'failed') {
				fail(new Error('Peer connection failed'))
			} else {
				call.state = peer_connection.connectionState
				on_change()
			}
		}
		call.state = 'connecting'
		on_change()
		if (is_offerer) {
			await peer_connection.setLocalDescription(
				await peer_connection.createOffer())
			if (connection != peer_connection) return
			send_signal({description: peer_connection.localDescription})
		}
	}

	async function receive(msg) {
		if (msg.type == 'joined') {
			ice_servers = msg.ice_servers
			call.state = 'waiting'
			on_change()
			if (msg.other_peer_id)
				await connect_peer(msg.other_peer_id, true)
		} else if (msg.type == 'peer_joined') {
			await connect_peer(msg.peer_id, false)
		} else if (msg.type == 'peer_left'
			|| msg.type == 'error' && msg.error == 'peer_left') {
			if (msg.peer_id == call.peer_id) {
				close_peer()
				call.state = 'waiting'
				on_change()
			}
		} else if (msg.type == 'signal') {
			if (msg.peer_id != call.peer_id) return
			let peer_connection = connection
			let data = msg.data
			if (data.description) {
				await peer_connection.setRemoteDescription(data.description)
				if (connection != peer_connection) return
				if (data.description.type == 'offer') {
					await peer_connection.setLocalDescription(
						await peer_connection.createAnswer())
					if (connection != peer_connection) return
					send_signal({description: peer_connection.localDescription})
				}
			} else if (data.candidate) {
				await peer_connection.addIceCandidate(data.candidate)
			}
		} else if (msg.type == 'error') {
			throw new Error(msg.error)
		} else {
			throw new Error('Unknown signaling message: '+msg.type)
		}
	}

	navigator.mediaDevices.getUserMedia({
		audio: true,
		video: true,
	}).then(function(stream) {
		if (call.state == 'left') {
			for (let track of stream.getTracks()) track.stop()
			return
		}
		call.local_stream = stream
		let url = new URL('/call_signal/'+encodeURIComponent(call_id),
			location.href)
		url.protocol = location.protocol == 'https:' ? 'wss:' : 'ws:'
		url.searchParams.set('token', token)
		socket = new WebSocket(url)
		socket.onmessage = function(ev) {
			enqueue(function() { return receive(JSON.parse(ev.data)) })
		}
		socket.onerror = function() {
			fail(new Error('Signaling connection failed; check the server log'))
		}
		socket.onclose = function(ev) {
			fail(new Error('Signaling closed ('+ev.code+'): '+ev.reason))
		}
		call.state = 'joining'
		on_change()
	}).catch(function(error) {
		if (call.state != 'left') fail(error)
	})

	return call
}

})()
