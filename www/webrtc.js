/*

	RTC wrapper

*/

(function () {
"use strict"
let G = window
let rtc = {}
G.rtc = rtc

let {
	min, max,
	set,
	debug, pr, clock, json, json_arg, noop,
	runafter, runevery,
	announce,
	assign,
} = glue

rtc.DEBUG = 1
rtc.servers = {
	iceServers: [{
		// Google STUN server
		urls: 'stun:74.125.142.127:19302'
	}]
}

function rtc_debug(...args) {
	if (!rtc.DEBUG) return
	debug(this.signal_con.sid, this.type, ':', ...args)
}

rtc.offer = function(e) {

	e.type = 'offer'
	e.debug = rtc_debug
	e.open = false
	e.ready = false
	e.max_message_size = null

	e.connect = async function(to_sid) {
		if (e.open)
			return
		e.open = true

		e.signal_con.to_sid = to_sid

		e.con = new RTCPeerConnection(rtc.servers)

		e.chan = e.con.createDataChannel('chan', {ordered: true})
		e.chan.binaryType = 'arraybuffer'

		e.con.onicecandidate = function(ev) {
			if (!ev.candidate) return
			e.signal_con.signal('candidate', ev.candidate)
		}

		e.chan.onopen = function() {
			e.debug('chan open')
			e.max_message_size = e.con.sctp.maxMessageSize
			e.ready = true
			announce('rtc', e, 'ready')
		}

		e.chan.onclose = function() {
			e.debug('chan closed')
			e.chan = null
			e.close()
		}

		e.chan.onmessage = function(ev) {
			e.recv(ev.data)
		}

		let offer = await e.con.createOffer()
		await e.con.setLocalDescription(offer)

		e.signal_con.signal('offer', offer, to_sid)

		announce('rtc', e, 'open')
	}

	e.close = function() {
		if (!e.open)
			return
		e.open = false
		e.ready = false
		e.max_message_size = null

		if (e.chan) {
			e.chan.close()
			e.chan = null
		}
		if (e.con) {
			e.con.close()
			e.con = null
		}

		e.signal_con.signal('close')
		announce('rtc', e, 'close')

		e.signal_con.close()
	}

	e.signal_con = e.signal_server.connect({})

	e.signal_con.on_signal = function(k, v) {
		if (!e.open)
			return
		if (k == 'candidate') {
			e.debug('<- candidate', v)
			let c = new RTCIceCandidate(assign(v, {
				sdpMLineIndex: v.label ?? v.sdpMLineIndex,
			}))
			e.con.addIceCandidate(c)
		} else if (k == 'answer') {
			e.debug('<- answer', v)
			e.con.setRemoteDescription(v)
		}
	}

	e.send = function(s) {
		if (!e.ready)
			return
		let wait_bytes = e.chan.bufferedAmount
		if (wait_bytes > 64 * 1024)
			return
		e.chan.send(s)
	}

	return e
}

rtc.answer = function(e) {

	e.type = 'answer'
	e.debug = rtc_debug
	e.open = false
	e.ready = false

	e.connect = function(to_sid) {
		if (e.open)
			return
		e.open = true

		e.signal_con.to_sid = to_sid

		e.con = new RTCPeerConnection(rtc.servers)

		e.con.onicecandidate = function(ev) {
			if (!ev.candidate) return
			e.signal_con.signal('candidate', ev.candidate)
		}

		e.con.ondatachannel = function(ev) {

			e.debug('remote chan open')

			e.chan = ev.channel
			e.chan.binaryType = 'arraybuffer'

			e.chan.onclose = function() {
				e.debug('remote chan closed')
				e.chan = null
				e.close()
			}

			e.chan.onmessage = function(ev) {
				e.recv(ev.data)
			}

			e.ready = true
			announce('rtc', e, 'ready')
		}

		e.signal_con.signal('ready')

		announce('rtc', e, 'open')
	}

	e.close = function() {
		if (!e.open)
			return
		e.open = false
		e.ready = false

		if (e.chan) {
			e.chan.close()
			e.chan = null
		}
		if (e.con) {
			e.con.close()
			e.con = null
		}

		e.signal_con.signal('close')
		announce('rtc', e, 'close')

		e.signal_con.close()
	}

	e.signal_con = e.signal_server.connect({})

	e.signal_con.on_signal = function(k, v) {
		if (!e.open)
			return
		if (k == 'candidate') {
			e.debug('<- candidate', v)
			let c = new RTCIceCandidate(assign(v, {
				sdpMLineIndex: v.label ?? v.sdpMLineIndex,
			}))
			e.con.addIceCandidate(c)
		} else if (k == 'offer') {
			e.debug('<- offer', v)
			e.con.setRemoteDescription(v)
			runafter(0, async function() {
				let answer = await e.con.createAnswer()
				await e.con.setLocalDescription(answer)
				e.signal_con.signal('answer', answer)
			})
		}
	}

	e.send = function(s) {
		if (!e.ready)
			return
		let wait_bytes = e.chan.bufferedAmount
		if (wait_bytes > 64 * 1024)
			return
		e.chan.send(s)
	}

	return e
}

rtc.mock_signal_server = function() {

	let e = {}

	e.offers    = {} // {id->offer}
	e.ready_con = {} // {id->con}
	e.offer_con = {} // {id->con}

	let {offers, ready_con, offer_con} = e

	e.connect = function(c) {

		c.on_signal = null
		c.candidates = set()

		let id = 'local'

		c.signal_candidates = function(id) {
			let c2 = c == offer_con[id] ? ready_con[id] : offer_con[id]
			if (!c2)
				return
			for (let candidate of c.candidates) {
				c2.on_signal('candidate', candidate)
				c.candidates.delete(candidate)
			}
		}

		c.signal = function(k, v) {
			if (k == 'offer') {
				let offer = v
				offers[id] = offer
				offer_con[id] = c
				let rc = ready_con[id]
				let oc = offer_con[id]
				if (rc) {
					rc.on_signal('offer', offer)
					oc.signal_candidates(id)
				}
			} else if (k == 'ready') {
				ready_con[id] = c
				let offer = offers[id]
				let oc = offer_con[id]
				if (offer) {
					c.on_signal('offer', offer)
					oc.signal_candidates(id)
				}
			} else if (k == 'answer') {
				let answer = v
				let oc = offer_con[id]
				let rc = ready_con[id]
				if (oc) {
					oc.on_signal('answer', answer)
					rc.signal_candidates(id)
				}
			} else if (k == 'candidate') {
				let candidate = v.toJSON()
				c.candidates.add(candidate)
				c.signal_candidates(id)
			} else if (k == 'close') {
				delete offers[id]
				delete ready_con[id]
				delete offer_con[id]
			}
		}

		return c

	}

	return e
}

rtc.demo_signal_server = function() {

	let e = {}

	e.connect = function(c) {

		c.on_signal = null

		c.signal = function(k, v) {
			assert(c.sid, 'connection to signal server not ready')
			let t = {sid: c.sid, k: k, v: v, to_sid: c.to_sid}
			post('/rtc_signal', t)
		}

		// poor man's bidi communication in lieu of websockets.
		// the server identifies our "connection" based on sid (session id).
		let es = new EventSource('/rtc_signal.events')

		es.onmessage = function(ev) {
			let t = json_arg(ev.data)
			if (t.sid)
				c.sid = t.sid
			else
				c.on_signal(t.k, t.v)
		}

		c.close = function() {
			es.close()
			es = null
		}

		return c
	}

	return e
}

}()) // module function
