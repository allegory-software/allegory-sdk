
--libtls binding.
--Written by Cosmin Apreutesei. Public Domain.

if not ... then require'libtls_test'; return end

require'libtls_h'
require'glue'
local C = ffi.load(tls_libname or 'tls_bearssl')

TLS_WANT_POLLIN  = C.TLS_WANT_POLLIN
TLS_WANT_POLLOUT = C.TLS_WANT_POLLOUT

local function P(s)
	return exists(s) and s or nil
end
function ca_file_path()
	return config'ca_file'
		or P(varpath'cacert.pem')
		or Linux and (
			   P'/etc/ssl/certs/ca-certificates.crt'                --Debian/Ubuntu/Gentoo etc.
			or P'/etc/pki/tls/certs/ca-bundle.crt'                  --Fedora/RHEL 6
			or P'/etc/ssl/ca-bundle.pem'                            --OpenSUSE
			or P'/etc/pki/tls/cacert.pem'                           --OpenELEC
			or P'/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem' --CentOS/RHEL 7
			or P'/etc/ssl/cert.pem'                                 --Alpine Linux
		)
		or P(indir(exedir(), '..', '..', 'etc', 'ca-certificates.crt'))
end

local config = {}

function tls_config(t)
	if isctype('struct tls_config', t) then
		return t --pass-through
	end
	local self = assert(ptr(C.tls_config_new()))
	self:verify() --default, so `insecure_*` options must be set explicitly.
	if t then
		local ok, err = self:set(t)
		if not ok then
			self:free()
			error(err)
		end
	end
	return self, true
end

function config:free()
	C.tls_config_free(self)
end

local function check(self, ret)
	if ret == 0 then return true end
	return nil, str(C.tls_config_error(self)) or 'unknown tls config error'
end

function config:add_keypair(cert, cert_size, key, key_size, staple, staple_size)
	return check(self, C.tls_config_add_keypair_ocsp_mem(self,
		cert, cert_size or #cert,
		key, key_size or #key,
		staple, staple_size or (staple and #staple or 0)))
end

function config:set_alpn(alpn)
	return check(self, C.tls_config_set_alpn(self, alpn))
end

function config:set_ca(s, sz)
	return check(self, C.tls_config_set_ca_mem(self, s, sz or #s))
end

function config:set_cert(s, sz)
	return check(self, C.tls_config_set_cert_mem(self, s, sz or #s))
end

function config:set_key(s, sz)
	return check(self, C.tls_config_set_key_mem(self, s, sz or #s))
end

function config:set_ocsp_staple(s, sz)
	return check(self, C.tls_config_set_ocsp_staple_mem(self, s, sz or #s))
end

function config:set_keypairs(t)
	for i,t in ipairs(t) do
		if i == 1 then
			if t.cert then
				local ok, err = self:set_cert(t.cert, t.cert_size)
				if not ok then return nil, err end
			end
			if t.key then
				local ok, err = self:set_key(t.key, t.key_size)
				if not ok then return nil, err end
			end
			if t.ocsp_staple then
				local ok, err = self:set_ocsp_staple(t.ocsp_staple, t.ocsp_staple_size)
				if not ok then return nil, err end
			end
		else
			local ok, err = self:add_keypair(
				t.cert, t.cert_size,
				t.key, t.key_size,
				t.ocsp_staple, t.ocsp_staple_size)
			if not ok then return nil, err end
		end
	end
	return true
end

--NOTE: session tickets not supported by BearSSL.
function config:set_ticket_keys(t)
	for _,t in ipairs(t) do
		local ok, err = self:add_ticket_key(t.ticket_key_rev, t.ticket_key, t.ticket_key_size)
		if not ok then return nil, err end
	end
	return true
end

function config:add_ticket_key(keyrev, key, key_size)
	return check(self, C.tls_config_add_ticket_key(self, keyrev, key, key_size or #key))
end

function config:set_ciphers(s)
	s = s:gsub('^%s+', ''):gsub('%s+$', ''):gsub('%s+', ':')
	return check(self, C.tls_config_set_ciphers(self, s))
end

function config:set_crl(crl, sz)
	return check(self, C.tls_config_set_crl_mem(self, crl, sz or #crl))
end

function config:set_dheparams(params)
	return check(self, C.tls_config_set_dheparams(self, params))
end

function config:set_ecdhecurve(curve)
	return check(self, C.tls_config_set_ecdhecurve(self, curve))
end

function config:set_ecdhecurves(curves)
	return check(self, C.tls_config_set_ecdhecurves(self, curves))
end

function config:set_protocols(protocols)
	local err
	if isstr(protocols) then
		protocols, err = self:parse_protocols(protocols)
		if not protocols then return nil, err end
	end
	return check(self, C.tls_config_set_protocols(self, protocols))
end

function config:set_verify_depth(verify_depth)
	return check(self, C.tls_config_set_verify_depth(self, verify_depth))
end

local function return_true(f)
	return function(self)
		f(self)
		return true
	end
end
config.prefer_ciphers_client  = return_true(C.tls_config_prefer_ciphers_client)
config.prefer_ciphers_server  = return_true(C.tls_config_prefer_ciphers_server)
config.insecure_noverifycert  = return_true(C.tls_config_insecure_noverifycert)
config.insecure_noverifyname  = return_true(C.tls_config_insecure_noverifyname)
config.insecure_noverifytime  = return_true(C.tls_config_insecure_noverifytime)
config.verify                 = return_true(C.tls_config_verify)
config.ocsp_require_stapling  = return_true(C.tls_config_ocsp_require_stapling)
config.verify_client          = return_true(C.tls_config_verify_client)
config.verify_client_optional = return_true(C.tls_config_verify_client_optional)
config.clear_keys             = return_true(C.tls_config_clear_keys)

local proto_buf = u32a(1)
function config:parse_protocols(s)
	s = s:gsub('^%s+', ''):gsub('%s+$', ''):gsub('%s+', ':')
	local ok, err = check(self, C.tls_config_parse_protocols(proto_buf, s))
	if not ok then return nil, err end
	return proto_buf[0]
end

function config:set_session_id(session_id, sz)
	return check(self, C.tls_config_set_session_id(self, session_id, sz or #session_id))
end

function config:set_session_lifetime(lifetime)
	return check(self, C.tls_config_set_session_lifetime(self, lifetime))
end

do
	local function barg(set_method)
		return function(self, arg)
			if not arg then return true end
			return set_method(self)
		end
	end

	local keys = {
		{'ca'                    , config.set_ca, true},
		{'cert'                  , config.set_cert, true},
		{'key'                   , config.set_key, true},
		{'ocsp_staple'           , config.set_ocsp_staple, true},
		{'keypairs'              , config.set_keypairs},
		{'ticket_keys'           , config.set_ticket_keys},
		{'ciphers'               , config.set_ciphers},
		{'alpn'                  , config.set_alpn},
		--NOTE: DHE not supported by BearSSL (but supported by LibreSSL).
		{'dheparams'             , config.set_dheparams},
		{'ecdhecurve'            , config.set_ecdhecurve},
		{'ecdhecurves'           , config.set_ecdhecurves},
		{'protocols'             , config.set_protocols},
		{'prefer_ciphers_client' , barg(config.prefer_ciphers_client)},
		{'prefer_ciphers_server' , barg(config.prefer_ciphers_server)},
		{'insecure_noverifycert' , barg(config.insecure_noverifycert)},
		{'insecure_noverifyname' , barg(config.insecure_noverifyname)},
		{'insecure_noverifytime' , barg(config.insecure_noverifytime)},
		{'verify'                , barg(config.verify)},
		{'verify_client'         , barg(config.verify_client)},
		{'verify_client_optional', barg(config.verify_client_optional)},
		{'verify_depth'          , config.set_verify_depth},
		{'ocsp_require_stapling' , barg(config.ocsp_require_stapling)},
		--NOTE: CRL not supported by BearSSL (but supported by LibreSSL).
		{'crl'                   , config.set_crl, true},
		--TODO: add sessions to libtls-bearssl.
		{'session_id'            , config.set_session_id, true},
		{'session_lifetime'      , config.set_session_lifetime},
	}

	local function load_files(t)
		local st = {}
		for k,v in pairs(t) do
			if k:find'_file$' then
				--NOTE: bearssl doesn't handle CRLF.
				local v, err = try_load(v)
				if v then
					st[k:gsub('_file$', '')] = v:gsub('\r', '')
				end
				t[k] = nil
			end
		end
		update(t, st)
	end

	function config:set(t1)

		local t = {}
		for k,v in pairs(t1) do
			t[k] = call(v)
		end
		load_files(t)
		if t.keypairs then
			for i,t in ipairs(t.keypairs) do
				load_files(t)
			end
		end
		if t.ticket_keys then
			for i,t in ipairs(t.ticket_keys) do
				load_files(t)
			end
		end

		for i,kt in ipairs(keys) do
			local k, set_method, is_str = unpack(kt)
			local v = t[k]
			if v ~= nil then
				local sz = is_str and (t[k..'_size'] or #v) or nil
				local ok, err = set_method(self, v, sz)
				if not ok then return nil, err end
				log('', 'tls', 'config', '%-25s %s', k,
					sz and (sz <= 64 and tostring(v) or kbytes(sz)) or '')
			end
		end
		return true
	end

end

metatype('struct tls_config', {__index = config})

local function check(self, ret)
	if ret == 0 then return true end
	return nil, str(C.tls_error(self)) or 'unknown tls error'
end

local tls = {}

function tls:configure(t)
	if t then
		local conf, created = tls_config(t)
		local ok, err = check(self, C.tls_configure(self, conf))
		if created then
			conf:free() --self holds the only ref to conf now.
		end
		assertf(ok, '%s\n%s', err, pp(t))
	end
	return self
end

function tls_client(conf)
	return assert(ptr(C.tls_client())):configure(conf)
end

function tls_server(conf)
	return assert(ptr(C.tls_server())):configure(conf)
end

function tls:reset(conf)
	C.tls_reset(self)
	return self:configure(conf)
end

function tls:free()
	C.tls_free(self)
end

local ctls_buf = new'struct tls*[1]'
function tls:try_accept(read_cb, write_cb, cb_arg)
	local ok, err = check(self, C.tls_accept_cbs(self, ctls_buf, read_cb, write_cb, cb_arg))
	if not ok then return nil, err end
	return ctls_buf[0]
end

function tls:try_connect(vhost, read_cb, write_cb, cb_arg)
	return check(self, C.tls_connect_cbs(self, read_cb, write_cb, cb_arg, vhost))
end

local function checklen(self, ret)
	ret = tonumber(ret)
	if ret >= 0 then return ret end
	if ret == C.TLS_WANT_POLLIN  then return nil, 'wantrecv' end
	if ret == C.TLS_WANT_POLLOUT then return nil, 'wantsend' end
	return nil, str(C.tls_error(self))
end

function tls:try_recv(buf, sz)
	return checklen(self, C.tls_read(self, buf, sz))
end

function tls:try_send(buf, sz)
	return checklen(self, C.tls_write(self, buf, sz or #buf))
end

function tls:try_close()
	local len, err = checklen(self, C.tls_close(self))
	if not len then return nil, err end
	return true
end

metatype('struct tls', {__index = tls})
