--[[

	WebRTC call creation and signaling.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES

	- Users can create calls and get an invite token.
	- Anyone with the token can join, both users and non-users.
	- Forward media through Cloudflare SFU for calls above six peers.
	- Switch between peer-to-peer and SFU as peers join or leave.
	- Force SFU for the whole call, regardless of the number of peers.
	- Receive SFU media without publishing microphone or camera tracks.
	- A reconnect token allows a lost peer to be identified as the same
	  participant after returning, for up to 30s.
	- Detect a lost browser connection with heartbeat messages.
	- Prevent joining another call from the same signed-in browser session
	  until leaving the current call (one open call per session).
	- Connect through Cloudflare TURN relays when a direct connection is
	  unavailable.
	- Accept signaling only from pages served by this site (origin check).
	- Create a random media key for each live call and send it to every
	  admitted peer, for frame encryption that excludes Cloudflare.

API

	POST /call_create.json
		name -> {call = call_id, invite_token = invite_token}
		sign-in required.

	WebSocket /call_signal/<call_id>?invite_token=<invite_token>
		name: required for guests; use the account name when signed in.
		reconnect_token: resume an existing peer.
		replace_token: remove the earlier peer before joining anew.

	webb_call_repair()
		clear this process's stored open-call markers in browser sessions.

CONFIG

	app_instance   this process's number among the app's processes
	               (env APP_INSTANCE, default 1)
	cloudflare_turn_app_id
	cloudflare_turn_api_token
	cloudflare_sfu_app_id
	cloudflare_sfu_api_token
	base_url       allowed signaling origin (default: request scheme and host)

]]

require'webb_action'
require'webb_auth_mdbx'
require'websocket'
require'json'
require'http_client'
require'proc'

-- app instance number, for when running multiple app processes.
config{app_instance = tonumber(env'APP_INSTANCE')}

-- call records and the signed-in session's open call.

db_schema:import(function()

	tables.call = {
		call        , idpk,
		name        , name,
		invite_token, {str, maxlen = 64, fixed}, not_null, uk,
			default(nil, function()
				return tohex(secure_random_string(32))
			end),
	}

	tables.call_users = {
		call        , id, not_null, child_fk,
		usr         , id, not_null, child_fk, pk(call, usr),
	}

	add_cols('sess after ctime', {
		open_call   , id, weak_fk'call',
		open_call_instance, u16, -- app_instance holding open_call in memory
	})

end)

-- clear this process's stored session occupancy after losing in-memory
-- peers.

function webb_call_repair()
	local app_instance = config('app_instance', 1) -- this process's number
	for cur, _, open_call, open_call_instance
		in db():each('sess', 'open_call open_call_instance')
	do
		if open_call and open_call_instance == app_instance then
			cur:update('open_call open_call_instance', null, null)
		end
	end
end

-- named call creation and invite tokens for signed-in users.

action['call_create.json'] = function()
	checkarg(method'POST')
	allow(user() ~= nil and not user'anonymous', 'sign in required')
	local name = checkarg(str_arg(post'name'))
	local call_db = db()
	return call_db:atomic('w', function()
		local call_id = call_db:insert('call', '{}', {name = name})
		return {
			call = call_id,
			invite_token = call_db:must_find('call', 'invite_token', call_id),
		}
	end)
end

-- active peers and limits for signaling and reconnection.

local calls = {} -- {call_id -> {peers, media_mode, media_revision, ...}}
local next_peer_id = 0 -- last assigned peer id
local max_p2p_peers = 6 -- peers allowed before switching to SFU
local reconnect_timeout = 30 -- seconds allowed to reconnect signaling
local write_timeout = 10 -- seconds allowed to send one message
local heartbeat_interval = 5 -- seconds between browser heartbeats
local heartbeat_timeout = 15 -- seconds allowed without receiving a message
local max_queued_messages = 64 -- messages waiting to be sent on one socket
local rejected_close_code = 4000 -- close code for a refused join

local function queue_message(peer, msg)
	if peer.messages and not peer.messages:try_push(json_encode(msg)) then
		-- full queue: close the stalled socket.
		peer.ws.tcp:close()
	end
end

local function find_peer(call, reconnect_token)
	for _, peer in pairs(call.peers) do
		if peer.reconnect_token == reconnect_token then
			return peer
		end
	end
end

local function peer_count(call)
	local n = 0
	for _ in pairs(call.peers) do
		n = n + 1
	end
	return n
end

-- select automatic or forced SFU connections for the call.

local function update_media_mode(call, excluded_peer)
	local media_mode = -- 'p2p' or 'sfu' for the current call settings
		(call.want_force_sfu or peer_count(call) > max_p2p_peers)
			and 'sfu' or 'p2p'
	if call.media_mode == media_mode then return end
	call.media_mode = media_mode
	call.media_revision = call.media_revision + 1
	for _, peer in pairs(call.peers) do
		if peer.sfu then peer.sfu.is_ready = false end
		if peer ~= excluded_peer then
			queue_message(peer, {
				type = 'media_mode',
				media_mode = media_mode,
				media_revision = call.media_revision,
			})
		end
	end
end

-- Cloudflare SFU sessions, publications and same-call subscriptions.

local function sfu_fetch(sfu_id, path, body, method)
	local app_id = assert(config'cloudflare_sfu_app_id', -- SFU app id
		'cloudflare_sfu_app_id required')
	local api_token = assert(config'cloudflare_sfu_api_token', -- app secret
		'cloudflare_sfu_api_token required')
	local response, req = try_fetch{ -- decoded response and HTTP request
		url = 'https://rtc.live.cloudflare.com/v1/apps/'..app_id
			..'/sessions/'..(sfu_id and sfu_id..'/' or '')..path,
		method = method or 'POST',
		headers = {authorization = 'Bearer '..api_token},
		body = body,
		max_retries = 1,
		headers_timeout = write_timeout,
	}
	if not response then return nil, tostring(req) end
	if req.status < 200 or req.status >= 300 then
		return nil, 'Cloudflare SFU HTTP '..req.status, req.status
	elseif response.errorCode then
		return nil, response.errorDescription or response.errorCode
	end
	return response
end

local function notify_publication(call, peer)
	for _, other_peer in pairs(call.peers) do
		if other_peer ~= peer then
			queue_message(other_peer, {
				type = 'sfu_publication',
				peer_id = peer.id,
				sfu_id = peer.sfu and peer.sfu.is_ready and peer.sfu.id or nil,
				sfu_tracks = peer.sfu and peer.sfu.tracks or nil,
			})
		end
	end
end

local function close_sfu_tracks(sfu, tracks)
	local response, err, status = sfu_fetch(sfu.id, 'tracks/close', { -- reply
		tracks = tracks, force = true,
	}, 'PUT')
	if not response then return nil, err, status end
	for _, track in ipairs(response.tracks) do
		if not track.errorCode or track.errorCode == 'close_track_error' then
			sfu.mids[track.mid] = nil
		else
			err = track.errorDescription or track.errorCode
		end
	end
	for _, track in ipairs(tracks) do
		if sfu.mids[track.mid] then
			return nil, err or 'Cloudflare SFU track closure not confirmed'
		end
	end
	return response
end

local function close_sfu(call, peer)
	local sfu = peer.sfu -- owned Cloudflare session or nil
	if not sfu then return {} end
	sfu.is_ready = false
	notify_publication(call, peer)
	local tracks = {} -- {i -> {mid =}} owned senders and receivers
	for mid in pairs(sfu.mids) do
		add(tracks, {mid = mid})
	end
	if #tracks > 0 then
		local response, err, status = -- reply or error and HTTP status
			close_sfu_tracks(sfu, tracks)
		-- HTTP 410: the browser closed its connection first, so Cloudflare
		-- has already disconnected the session and its tracks.
		if not response and status ~= 410 then return nil, err end
	end
	peer.sfu = nil
	return {}
end

local function publish_sfu_tracks(sfu, msg)
	local tracks = {} -- {i -> Cloudflare local track}
	for kind, mid in pairs(msg.mids) do
		assert(kind == 'audio' or kind == 'video', 'invalid track kind')
		sfu.mids[mid] = true
		add(tracks, {
			location = 'local', mid = mid, trackName = kind..'-'..mid,
		})
	end
	local response, err = sfu_fetch(sfu.id, 'tracks/new', { -- reply or error
		sessionDescription = msg.description, tracks = tracks,
	})
	if not response then return nil, err end
	for kind, mid in pairs(msg.mids) do
		for _, track in ipairs(response.tracks) do
			if track.mid == mid and not track.errorCode then
				sfu.tracks[kind] = {mid = mid, trackName = track.trackName}
			end
		end
	end
	return response
end

local function sfu_request(call, peer, msg)
	if msg.op == 'close' then
		return close_sfu(call, peer)
	elseif msg.op == 'open' then
		assert(not peer.sfu, 'SFU session is already open')
		local response, err = sfu_fetch(nil, 'new') -- new session or error
		if not response then return nil, err end
		peer.sfu = { -- Cloudflare resources owned by this peer
			id = response.sessionId,
			mids = {}, -- {mid -> true} allocated senders and receivers
			tracks = {}, -- {kind -> {mid, trackName}} published local tracks
			is_ready = false, -- browser has announced its local publications
		}
		return response
	end
	local sfu = assert(peer.sfu) -- current Cloudflare session
	if msg.op == 'ready' then
		sfu.is_ready = true
		notify_publication(call, peer)
		return {}
	elseif msg.op == 'publish' then
		return publish_sfu_tracks(sfu, msg)
	elseif msg.op == 'unpublish' then
		local tracks = {} -- {i -> {mid =}} local tracks to close
		for _, kind in ipairs(msg.kinds) do
			add(tracks, {mid = assert(sfu.tracks[kind]).mid})
			sfu.tracks[kind] = nil
		end
		notify_publication(call, peer)
		return close_sfu_tracks(sfu, tracks)
	elseif msg.op == 'subscribe' then
		local tracks = {} -- {i -> Cloudflare remote track}
		local sources = {} -- {session_id/track_name -> {peer_id, kind}}
		for _, source in ipairs(msg.tracks) do
			local source_peer = call.peers[source.peer_id] -- publisher or nil
			local source_sfu = source_peer and source_peer.sfu -- session or nil
			local track = source_sfu and source_sfu.tracks[source.kind] -- or nil
			if source_peer ~= peer and source_sfu and source_sfu.is_ready
				and track
			then
				sources[source_sfu.id..'/'..track.trackName] = source
				add(tracks, {
					location = 'remote', sessionId = source_sfu.id,
					trackName = track.trackName, kind = source.kind,
				})
			end
		end
		if #tracks == 0 then return {tracks = tracks} end
		local response, err = sfu_fetch(sfu.id, 'tracks/new', { -- reply/error
			tracks = tracks,
		})
		if not response then return nil, err end
		for _, track in ipairs(response.tracks) do
			local source = -- requested publisher and track kind
				assert(sources[track.sessionId..'/'..track.trackName])
			track.peer_id = source.peer_id
			track.kind = source.kind
			if track.mid and not track.errorCode then
				sfu.mids[track.mid] = true
			end
		end
		return response
	elseif msg.op == 'answer' then
		return sfu_fetch(sfu.id, 'renegotiate', {
			sessionDescription = msg.description,
		}, 'PUT')
	elseif msg.op == 'unsubscribe' then
		local tracks = {} -- {i -> {mid =}} owned receiver mids to close
		for _, mid in ipairs(msg.mids) do
			assert(sfu.mids[mid], 'unknown SFU track')
			add(tracks, {mid = mid})
		end
		return close_sfu_tracks(sfu, tracks)
	end
	error('unknown SFU operation')
end

-- keep SFU requests ordered across signaling reconnects and departures.

local function queue_sfu_request(call, peer, ws, msg)
	if not peer.sfu_messages then
		peer.sfu_messages = wait_queue(max_queued_messages)
		local worker = thread(function() -- serialize this peer's SFU mutations
			while true do
				local job = peer.sfu_messages:pull() -- {ws, msg} or {free = true}
				if job.free then
					local response, err = close_sfu(call, peer) -- reply/error
					assertf(response, '%s', err)
					return
				end
				local msg = job.msg -- browser's SFU request
				local function is_current()
					return peer.ws == job.ws and call.peers[peer.id] == peer
						and call.media_revision == msg.media_revision
						and (msg.op == 'close' or call.media_mode == 'sfu')
				end
				local data, err -- Cloudflare reply or error text
				if is_current() then
					data, err = sfu_request(call, peer, msg)
				end
				if peer.ws == job.ws then
					queue_message(peer, {
						type = 'sfu_result', request_id = msg.request_id,
						data = data, error = err, canceled = not is_current(),
					})
				end
			end
		end, 'call SFU')
		worker:setowner(mainthread())
		worker:onfinish(function(_, ok)
			peer.sfu_messages = nil
			if not ok and peer.ws then peer.ws.tcp:close() end
		end)
		resume(worker)
	end
	ws.tcp:checkp(peer.sfu_messages:try_push({ws = ws, msg = msg}),
		'SFU queue full')
end

-- release session occupancy and notify browsers of a departure.

local function remove_peer(call_db, call_id, call, peer, want_notify)
	if peer.timer then peer.timer:cancel() end
	call.peers[peer.id] = nil
	if peer.session_id then
		call_db:atomic('w', function()
			if call_db:find('sess', 'open_call', peer.session_id) == call_id then
				call_db:update('sess', '{}', {
					sess = peer.session_id,
					open_call = null,
					open_call_instance = null,
				})
			end
		end)
	end
	for _, other_peer in pairs(call.peers) do
		if want_notify and other_peer.known_peer_ids[peer.id] then
			queue_message(other_peer, {
				type = 'peer_left',
				peer_id = peer.id,
			})
		end
		other_peer.known_peer_ids[peer.id] = nil
		other_peer.connected_peer_ids[peer.id] = nil
	end
	update_media_mode(call)
	if not next(call.peers) then
		calls[call_id] = nil
	end
	if peer.sfu_messages then
		peer.sfu_messages:push({free = true})
	end
end

action.call_signal = function(call_id)
	-- signaling only from pages served by this site.

	allow(headers'origin' == (config'base_url' or scheme()..'://'..host()),
		'invalid origin')

	-- invite validation and signed-in or guest identity.

	call_id = checkarg(tonumber(call_id), 'invalid call id')
	checkarg(call_id >= 1 and call_id <= 0xffffffff
		and call_id == floor(call_id), 'invalid call id')
	local call_db = db() -- application database
	local invite_token = checkfound(call_db:atomic('r',
		call_db.find, call_db, 'call', 'invite_token', call_id),
		'call not found')
	allow(args'invite_token' == invite_token, 'invalid invite token')
	local req = http_request() -- HTTP request

	local current_user = user'*'
	local session_id = current_user and not current_user.anonymous
		and req.session_id or nil
	local reconnect_token = args'reconnect_token'
	local replace_token = args'replace_token'
	local name -- display name for a new peer
	local ice_servers -- TURN credentials for a new peer
	if not reconnect_token then
		name = checkarg(session_id and current_user.name
			or str_arg(args'name'), 'display name required')
		checkarg(name_is_valid(name), 'invalid display name')

		-- relay credentials for browsers unable to connect directly.

		local turn_key_id = assert(config'cloudflare_turn_app_id',
			'cloudflare_turn_app_id required')
		local turn_api_token = assert(config'cloudflare_turn_api_token',
			'cloudflare_turn_api_token required')
		local turn_response, turn_request = fetch{
			url = 'https://rtc.live.cloudflare.com/v1/turn/keys/'
				..turn_key_id..'/credentials/generate-ice-servers',
			headers = {
				authorization = 'Bearer '..turn_api_token,
			},
			body = {
				ttl = 24 * 60 * 60,
			},
		}
		check500(turn_request.status == 201,
			'Cloudflare TURN request failed (HTTP %d)', turn_request.status)
		ice_servers = check500(turn_response.iceServers,
			'Cloudflare TURN response is missing iceServers')
	end
	local peer -- peer retained until leave or reconnect timeout
	local call -- {peers, media_mode, media_revision} or nil before upgrade
	local ws -- signaling WebSocket or nil before upgrade
	local messages -- wait_queue of encoded messages for ws or nil

	-- retain connected peers and idle SFU peers during a signaling disconnect.

	req:onfinish(function(_, _, err)
		if not peer or peer.ws ~= ws then return end
		peer.ws = nil
		peer.messages = nil
		if (not next(peer.connected_peer_ids)
			and call.media_mode ~= 'sfu') or err == CANCEL then
			remove_peer(call_db, call_id, call, peer, err ~= CANCEL)
		else
			peer.timer = runafter(reconnect_timeout, function()
				resume(thread(function()
					remove_peer(call_db, call_id, call, peer, true)
				end, 'call reconnect timeout'))
			end)
			for _, other_peer in pairs(call.peers) do
				if other_peer.known_peer_ids[peer.id] then
					queue_message(other_peer, {
						type = 'peer_disconnected',
						peer_id = peer.id,
					})
				end
			end
		end
	end)

	ws = websocket_upgrade(req, {
		max_message_size = 1024 * 1024,
		max_frame_size = 1024 * 1024,
	})
	ws.tcp:settimeout(write_timeout, 'w')
	messages = wait_queue(max_queued_messages)

	call = calls[call_id] or {
		peers = {}, -- {peer_id -> peer}
		want_force_sfu = false, -- use SFU regardless of the peer count
		media_mode = 'p2p', -- 'p2p' or 'sfu'
		media_revision = 0, -- current media connection setup number
		media_key = tohex(secure_random_string(16)), -- AES-128 frame key, hex
	}

	-- resume a peer or admit a new one.

	if reconnect_token then
		peer = find_peer(call, reconnect_token)
		if not peer then
			ws:close(rejected_close_code, 'reconnect_expired')
			return
		end
		if peer.timer then
			peer.timer:cancel()
			peer.timer = nil
		end
		local old_ws = peer.ws
		peer.ws = ws
		peer.messages = messages
		if old_ws then old_ws.tcp:close() end
	else
		-- earlier peer of this page (replace_token): remove it.
		local old_peer = replace_token and find_peer(call, replace_token)
		if old_peer then
			local old_ws = old_peer.ws
			old_peer.ws = nil
			old_peer.messages = nil
			remove_peer(call_db, call_id, call, old_peer, true)
			if old_ws then old_ws.tcp:close() end
		end

		-- one call per signed-in session.

		if session_id then
			local can_join = call_db:atomic('w', function()
				if call_db:find('sess', 'open_call', session_id) then
					return false
				end
				call_db:update('sess', '{}', {
					sess = session_id,
					open_call = call_id,
					open_call_instance = config('app_instance', 1),
				})
				return true
			end)
			if not can_join then
				ws:close(rejected_close_code, 'call_already_open')
				return
			end
		end
		next_peer_id = next_peer_id + 1
		peer = {
			id = next_peer_id,
			name = name,
			ws = ws,
			messages = messages,
			session_id = session_id,
			reconnect_token = tohex(secure_random_string(32)),
			ice_servers = ice_servers,
			known_peer_ids = {}, -- {peer_id -> true} told to this browser
			connected_peer_ids = {}, -- {peer_id -> true} reported connected
		}
		call.peers[peer.id] = peer
		calls[call_id] = call
		update_media_mode(call, peer)
	end

	-- peer introductions and reconnection notices.

	-- higher peer id offers; lower peer id answers.
	-- peer without a socket: list only if this browser
	-- knows it. listed in join order.
	local listed_peers = {} -- {i -> peer} listed in this browser's 'joined'
	for _, other_peer in pairs(call.peers) do
		if other_peer ~= peer
			and (other_peer.ws or peer.known_peer_ids[other_peer.id])
		then
			add(listed_peers, other_peer)
		end
	end
	sort(listed_peers, cmp'id')
	local joined_peers = {} -- {i -> {id =, name =}} sent in 'joined'
	for i, other_peer in ipairs(listed_peers) do
		peer.known_peer_ids[other_peer.id] = true
		joined_peers[i] = {
			id = other_peer.id,
			name = other_peer.name,
			media = other_peer.media,
			sfu_tracks = other_peer.sfu and other_peer.sfu.tracks or nil,
			sfu_id = other_peer.sfu and other_peer.sfu.is_ready
				and other_peer.sfu.id or nil,
		}
	end
	queue_message(peer, {
		type = 'joined',
		want_force_sfu = call.want_force_sfu,
		media_mode = call.media_mode,
		media_revision = call.media_revision,
		sfu_id = peer.sfu and peer.sfu.id or nil,
		peer_id = peer.id,
		name = peer.name,
		peers = joined_peers,
		ice_servers = peer.ice_servers,
		media_key = call.media_key,
		reconnect_token = peer.reconnect_token,
		reconnect_timeout = reconnect_timeout,
		heartbeat_interval = heartbeat_interval,
		heartbeat_timeout = heartbeat_timeout,
	})
	for _, other_peer in ipairs(listed_peers) do
		if other_peer.ws then
			local is_known_by_other = other_peer.known_peer_ids[peer.id]
			other_peer.known_peer_ids[peer.id] = true
			queue_message(other_peer, {
				type = is_known_by_other and 'peer_resumed' or 'peer_joined',
				peer_id = peer.id,
				name = peer.name,
				media = peer.media,
				sfu_tracks = peer.sfu and peer.sfu.tracks or nil,
				sfu_id = peer.sfu and peer.sfu.is_ready
					and peer.sfu.id or nil,
			})
		end
	end

	-- signaling delivery, heartbeats and explicit departures.

	-- writer and reader threads: return when either ends.
	local ts = threadset() -- signaling reader and writer
	resume(ts:thread(function()
		while true do
			local s = messages:pull() -- encoded message
			ws.tcp:settimeout(write_timeout, 'w')
			ws:send(s)
		end
	end, 'call writer'))
	resume(ts:thread(function()
		while true do
			ws.tcp:settimeout(heartbeat_timeout, 'r')
			local s, kind = ws:recv()
			if not s then break end
			ws.tcp:checkp(kind == 'text', 'expected text message')
			local msg = json_decode(s, null)
			if msg.type == 'leave' then
				peer.ws = nil
				peer.messages = nil
				remove_peer(call_db, call_id, call, peer, true)
				break
			elseif msg.type == 'heartbeat' then
				queue_message(peer, {type = 'heartbeat'})
			elseif msg.type == 'force_sfu' then
				-- apply the call-wide override and confirm it to every peer.

				call.want_force_sfu = msg.want_force_sfu
				for _, call_peer in pairs(call.peers) do
					queue_message(call_peer, {
						type = 'force_sfu',
						want_force_sfu = call.want_force_sfu,
					})
				end
				update_media_mode(call)
			elseif msg.type == 'sfu_request' then
				queue_sfu_request(call, peer, ws, msg)
			elseif msg.type == 'connected' then
				if call.peers[msg.peer_id] then
					peer.connected_peer_ids[msg.peer_id] = true
				end
			else
				ws.tcp:checkp(msg.type == 'signal', 'expected signal message')
				ws.tcp:checkp(msg.data ~= nil, 'signal data required')
				if msg.data.media then peer.media = msg.data.media end
				local other_peer = call.peers[msg.peer_id] -- recipient or nil
				if other_peer and (msg.data.media
					or (call.media_mode == 'p2p'
						and msg.media_revision == call.media_revision)) then
					queue_message(other_peer, {
						type = 'signal',
						peer_id = peer.id,
						data = msg.data,
						media_revision = msg.media_revision,
					})
				end
			end
		end
	end, 'call reader'))
	assert(ts:wait())
end
