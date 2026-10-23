require'webb_action'
require'webb_auth_mdbx'
require'websocket'
require'json'
require'http_client'

local function censor_token_arg(separator, key, value)
	if url_unescape(key) == 'token' then
		value = '[redacted]'
	end
	return separator..key..'='..value
end

function logging.censor.call_token(msg)
	return (msg:gsub('([?&;])([^%s&;=]+)=([^%s&;]*)', censor_token_arg))
end

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

end)

local calls = {} -- {call_id -> {slot -> peer}}
local next_peer_id = 0 -- last assigned participant id

action.call_signal = function(call_id)
	call_id = checkarg(tonumber(call_id), 'invalid call id')
	checkarg(call_id >= 1 and call_id <= 0xffffffff
		and call_id == floor(call_id), 'invalid call id')
	local call_db = db() -- application database
	local token = checkfound(call_db:atomic('r',
		call_db.find, call_db, 'call', 'token', call_id), 'call not found')
	allow(args'token' == token, 'invalid invite token')
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
	local ice_servers = check500(turn_response.iceServers,
		'Cloudflare TURN response is missing iceServers')
	local req = http_request() -- HTTP request
	local peer -- {id = participant id, ws = websocket} or nil
	local call -- {slot -> peer} or nil before admission
	local slot -- participant slot (1 or 2) or nil before admission

	req:onfinish(function(_, _, err)
		if not peer then return end
		call[slot] = nil
		local other_peer = call[3 - slot]
		if other_peer then
			if err ~= CANCEL then
				other_peer.ws:send(json_encode{
					type = 'peer_left',
					peer_id = peer.id,
				})
			end
		else
			calls[call_id] = nil
		end
	end)

	local ws = websocket_upgrade(req, {
		max_message_size = 64 * 1024,
		max_frame_size = 64 * 1024,
	})
	ws.tcp:settimeout(10, 'w')

	local joined_call = calls[call_id] or {} -- {slot -> peer}
	local joined_slot = not joined_call[1] and 1
		or not joined_call[2] and 2
	if not joined_slot then
		ws:send(json_encode{type = 'error', error = 'call_full'})
		ws:close(1008, 'call full')
		return
	end

	next_peer_id = next_peer_id + 1
	peer = {id = next_peer_id, ws = ws}
	call, slot = joined_call, joined_slot
	call[slot] = peer
	calls[call_id] = call

	local other_peer = call[3 - slot]
	ws:send(json_encode{
		type = 'joined',
		peer_id = peer.id,
		other_peer_id = other_peer and other_peer.id or nil,
		ice_servers = ice_servers,
	})
	other_peer = call[3 - slot]
	if other_peer then
		other_peer.ws:send(json_encode{
			type = 'peer_joined',
			peer_id = peer.id,
		})
	end

	while true do
		local s, kind = ws:recv()
		if not s then break end
		ws.tcp:checkp(kind == 'text', 'expected text message')
		local msg = json_decode(s, null)
		ws.tcp:checkp(msg.type == 'signal', 'expected signal message')
		ws.tcp:checkp(msg.data ~= nil, 'signal data required')
		local other_peer = call[3 - slot]
		if other_peer and other_peer.id == msg.peer_id then
			other_peer.ws:send(json_encode{
				type = 'signal',
				peer_id = peer.id,
				data = msg.data,
			})
		else
			ws:send(json_encode{
				type = 'error',
				error = 'peer_left',
				peer_id = msg.peer_id,
			})
		end
	end
end
