--[[

	webrtc call creation and signaling.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES

	- Create named calls when signed in and invite others with a call token.
	- Join as a signed-in user or as a guest with a display name.
	- Talk to up to six participants in one call.
	- Resume as the same participant for up to 30 seconds after losing the
	  server connection, after connecting to another participant.
	- Prevent joining another call from the same signed-in browser session
	  until leaving the current call.
	- Connect through Cloudflare TURN relays when a direct connection is
	  unavailable.

API

	POST /call_create.json
		name -> {call = call_id, token = invite_token}
		sign-in required.

	WebSocket /call_signal/<call_id>?token=<invite_token>
		name: required for guests; use the account name when signed in.
		reconnect_token: resume an existing participant.
		replace_token: remove the earlier participant before joining anew.

	webb_call_repair()
		clear stored open-call markers in browser sessions.

CONFIG

	cloudflare_turn_app_id
	cloudflare_turn_api_token

]]

require'webb_action'
require'webb_auth_mdbx'
require'websocket'
require'json'
require'http_client'

-- call records and the signed-in session's open call.

db_schema:import(function()

	tables.call = {
		call        , idpk,
		name        , name,
		token       , {str, maxlen = 64, fixed}, not_null, uk,
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
	})

end)

-- clear stored session occupancy after losing in-memory participants.

function webb_call_repair()
	for cur, _, open_call in db():each('sess', 'open_call') do
		if open_call then
			cur:update('open_call', null)
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
			token = call_db:must_find('call', 'token', call_id),
		}
	end)
end

-- active participants and limits for signaling and reconnection.

local calls = {} -- {call_id -> {peer_id -> peer}}
local next_peer_id = 0 -- last assigned participant id
local max_peers = 6 -- participants allowed in one call
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
	for _, peer in pairs(call) do
		if peer.reconnect_token == reconnect_token then
			return peer
		end
	end
end

local function peer_count(call)
	local n = 0
	for _ in pairs(call) do
		n = n + 1
	end
	return n
end

-- release session occupancy and notify browsers of a departure.

local function remove_peer(call_db, call_id, call, peer, want_notify)
	if peer.timer then peer.timer:cancel() end
	call[peer.id] = nil
	if peer.session_id then
		call_db:atomic('w', function()
			if call_db:find('sess', 'open_call', peer.session_id) == call_id then
				call_db:update('sess', '{}', {
					sess = peer.session_id,
					open_call = null,
				})
			end
		end)
	end
	for _, other_peer in pairs(call) do
		if want_notify and other_peer.known_peer_ids[peer.id] then
			queue_message(other_peer, {
				type = 'peer_left',
				peer_id = peer.id,
			})
		end
		other_peer.known_peer_ids[peer.id] = nil
		other_peer.connected_peer_ids[peer.id] = nil
	end
	if not next(call) then
		calls[call_id] = nil
	end
end

action.call_signal = function(call_id)
	-- invite validation and signed-in or guest identity.

	call_id = checkarg(tonumber(call_id), 'invalid call id')
	checkarg(call_id >= 1 and call_id <= 0xffffffff
		and call_id == floor(call_id), 'invalid call id')
	local call_db = db() -- application database
	local token = checkfound(call_db:atomic('r',
		call_db.find, call_db, 'call', 'token', call_id), 'call not found')
	allow(args'token' == token, 'invalid invite token')
	local req = http_request() -- HTTP request
	local current_user = user'*'
	local session_id = current_user and not current_user.anonymous
		and req.session_id or nil
	local reconnect_token = args'reconnect_token'
	local replace_token = args'replace_token'
	local name -- display name for a new participant
	local ice_servers -- TURN credentials for a new participant
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
	local peer -- participant retained until leave or reconnect timeout
	local call -- {peer_id -> peer} or nil before upgrade
	local ws -- signaling WebSocket or nil before upgrade
	local messages -- wait_queue of encoded messages for ws or nil

	-- retain connected participants during a signaling disconnect.

	req:onfinish(function(_, _, err)
		if not peer or peer.ws ~= ws then return end
		peer.ws = nil
		peer.messages = nil
		if not next(peer.connected_peer_ids) or err == CANCEL then
			remove_peer(call_db, call_id, call, peer, err ~= CANCEL)
		else
			peer.timer = runafter(reconnect_timeout, function()
				resume(thread(function()
					remove_peer(call_db, call_id, call, peer, true)
				end, 'call reconnect timeout'))
			end)
			for _, other_peer in pairs(call) do
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
		max_message_size = 64 * 1024,
		max_frame_size = 64 * 1024,
	})
	ws.tcp:settimeout(write_timeout, 'w')
	messages = wait_queue(max_queued_messages)

	call = calls[call_id] or {}

	-- resume a participant or admit a new one.

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
		-- earlier participant of this page (replace_token): remove it.
		local old_peer = replace_token and find_peer(call, replace_token)
		if old_peer then
			local old_ws = old_peer.ws
			old_peer.ws = nil
			old_peer.messages = nil
			remove_peer(call_db, call_id, call, old_peer, true)
			if old_ws then old_ws.tcp:close() end
		end

		-- six participants per call and one call per signed-in session.

		if peer_count(call) >= max_peers then
			ws:close(rejected_close_code, 'call_full')
			return
		end
		if session_id then
			local can_join = call_db:atomic('w', function()
				if call_db:find('sess', 'open_call', session_id) then
					return false
				end
				call_db:update('sess', '{}', {
					sess = session_id,
					open_call = call_id,
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
		call[peer.id] = peer
		calls[call_id] = call
	end

	-- participant introductions and reconnection notices.

	-- browser told about a participant by 'joined': offers; by 'peer_joined':
	-- answers. participant without a socket: list only if this browser
	-- knows it. listed in join order.
	local listed_peers = {} -- {i -> peer} listed in this browser's 'joined'
	for _, other_peer in pairs(call) do
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
		joined_peers[i] = {id = other_peer.id, name = other_peer.name}
	end
	queue_message(peer, {
		type = 'joined',
		peer_id = peer.id,
		name = peer.name,
		peers = joined_peers,
		ice_servers = peer.ice_servers,
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
			})
		end
	end

	-- signaling delivery, heartbeats and explicit departures.

	-- writer and reader threads: return when either ends.
	local ts = threadset()
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
			elseif msg.type == 'connected' then
				if call[msg.peer_id] then
					peer.connected_peer_ids[msg.peer_id] = true
				end
			else
				ws.tcp:checkp(msg.type == 'signal', 'expected signal message')
				ws.tcp:checkp(msg.data ~= nil, 'signal data required')
				local other_peer = call[msg.peer_id]
				if other_peer then
					queue_message(other_peer, {
						type = 'signal',
						peer_id = peer.id,
						data = msg.data,
					})
				end
			end
		end
	end, 'call reader'))
	assert(ts:wait())
end
