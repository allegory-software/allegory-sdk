
--proc/system/registry: Registry API
--Written by Cosmin Apreutesei. Public Domain.

setfenv(1, require'winapi')
advapi32 = ffi.load'advapi32'

cdef[[

typedef DWORD ACCESS_MASK;
typedef LONG LSTATUS;
typedef ACCESS_MASK REGSAM;

LSTATUS RegCreateKeyExW(
	HKEY     hKey,
	LPCWSTR  lpSubKey,
	DWORD    Reserved,
	LPWSTR   lpClass,
	DWORD    dwOptions,
	REGSAM   samDesired,
	LPSECURITY_ATTRIBUTES lpSecurityAttributes,
	PHKEY    phkResult,
	LPDWORD  lpdwDisposition
);

LSTATUS RegOpenKeyExW(
	HKEY    hKey,
	LPCWSTR lpSubKey,
	DWORD   ulOptions,
	REGSAM  samDesired,
	PHKEY   phkResult
);

LSTATUS RegCloseKey(
	HKEY hKey
);

LSTATUS RegSetValueExW(
	HKEY    hKey,
	LPCWSTR lpValueName,
	DWORD   Reserved,
	DWORD   dwType,
	BYTE*   lpData,
	DWORD   cbData
);

LSTATUS RegDeleteKeyExW(
	HKEY    hKey,
	LPCWSTR lpSubKey,
	REGSAM  samDesired,
	DWORD   Reserved
);

LSTATUS RegDeleteKeyValueW(
	HKEY    hKey,
	LPCWSTR lpSubKey,
	LPCWSTR lpValueName
);

LSTATUS RegDeleteValueW(
	HKEY    hKey,
	LPCWSTR lpValueName
);

LSTATUS RegRenameKey(
	HKEY    hKey,
	LPCWSTR lpSubKeyName,
	LPCWSTR lpNewKeyName
);

]]

--root keys
HKEY_CLASSES_ROOT                   = 0x80000000
HKEY_CURRENT_USER                   = 0x80000001
HKEY_LOCAL_MACHINE                  = 0x80000002
HKEY_USERS                          = 0x80000003
HKEY_PERFORMANCE_DATA               = 0x80000004
HKEY_PERFORMANCE_TEXT               = 0x80000050
HKEY_PERFORMANCE_NLSTEXT            = 0x80000060
HKEY_CURRENT_CONFIG                 = 0x80000005
HKEY_DYN_DATA                       = 0x80000006
HKEY_CURRENT_USER_LOCAL_SETTINGS    = 0x80000007

--key create options
REG_OPTION_RESERVED         = 0x00000000 -- Parameter is reserved
REG_OPTION_NON_VOLATILE     = 0x00000000 -- Key is preserved
REG_OPTION_VOLATILE         = 0x00000001 -- Key is not preserved
REG_OPTION_CREATE_LINK      = 0x00000002 -- Created key is a symbolic link
REG_OPTION_BACKUP_RESTORE   = 0x00000004 -- Open for backup or restore
REG_OPTION_OPEN_LINK        = 0x00000008 -- Open symbolic link

--disposition return value
REG_CREATED_NEW_KEY     = 0x00000001
REG_OPENED_EXISTING_KEY = 0x00000002

--value types
REG_NONE                       =  0  -- No value type
REG_SZ                         =  1  -- Unicode nul terminated string
REG_EXPAND_SZ                  =  2  -- Unicode nul terminated string with env var expansion
REG_BINARY                     =  3  -- Free form binary
REG_DWORD                      =  4  -- 32-bit number
REG_LINK                       =  6  -- Symbolic Link (unicode)
REG_MULTI_SZ                   =  7  -- Multiple Unicode strings
REG_RESOURCE_LIST              =  8  -- Resource list in the resource map
REG_FULL_RESOURCE_DESCRIPTOR   =  9  -- Resource list in the hardware description
REG_RESOURCE_REQUIREMENTS_LIST = 10
REG_QWORD                      = 11  -- 64-bit number

local band, bor, bnot = bit.band, bit.bor, bit.bnot

STANDARD_RIGHTS_READ  = 0x00020000
STANDARD_RIGHTS_WRITE = 0x00020000
STANDARD_RIGHTS_ALL   = 0x001F0000

--access flags
SYNCHRONIZE             = 0x00100000
KEY_QUERY_VALUE         = 0x0001
KEY_SET_VALUE           = 0x0002
KEY_CREATE_SUB_KEY      = 0x0004
KEY_ENUMERATE_SUB_KEYS  = 0x0008
KEY_NOTIFY              = 0x0010
KEY_CREATE_LINK         = 0x0020
KEY_WOW64_32KEY         = 0x0200
KEY_WOW64_64KEY         = 0x0100
KEY_WOW64_RES           = 0x0300
KEY_READ                = band(bor(
	STANDARD_RIGHTS_READ    ,
	KEY_QUERY_VALUE         ,
	KEY_ENUMERATE_SUB_KEYS  ,
	KEY_NOTIFY
	), bnot(SYNCHRONIZE))

KEY_WRITE = band(bor(
	STANDARD_RIGHTS_WRITE ,
   KEY_SET_VALUE         ,
   KEY_CREATE_SUB_KEY
	), bnot(SYNCHRONIZE))

KEY_EXECUTE = band(KEY_READ, bnot(SYNCHRONIZE))

KEY_ALL_ACCESS = band(bor(
	STANDARD_RIGHTS_ALL       ,
   KEY_QUERY_VALUE           ,
   KEY_SET_VALUE             ,
   KEY_CREATE_SUB_KEY        ,
   KEY_ENUMERATE_SUB_KEYS    ,
   KEY_NOTIFY                ,
   KEY_CREATE_LINK
	), bnot(SYNCHRONIZE))

local function hkey(s)
	return ffi.cast('HKEY', flags(s))
end

local function checkrz(ret)
	if ret == 0 then return true end
	local msg = get_error_message(ret)
	error(msg)
end

local rb = ffi.new'HKEY[1]'
local db = ffi.new'DWORD[1]'
function RegCreateKey(hk, subkey, opt, access)
	access = access or KEY_ALL_ACCESS
	checkrz(C.RegCreateKeyExW(hkey(hk), wcs(subkey), 0, nil, flags(opt), access, nil, rb, db))
	local hk = rb[0]
	ffi.gc(hk, RegCloseKey)
	return hk, db[0] == REG_CREATED_NEW_KEY
end

function RegOpenKey(hk, subkey, opt, access)
	access = access or KEY_ALL_ACCESS
	local ret = C.RegOpenKeyExW(hkey(hk), wcs(subkey), flags(opt), access, rb)
	if ret == 2 then return nil, 'not_found' end
	checkrz(ret)
	local hk = rb[0]
	ffi.gc(hk, RegCloseKey)
	return hk
end

function RegCloseKey(hk)
	ffi.gc(hk, nil)
	checkrz(C.RegCloseKey(hk))
end

KEY_WOW64_32KEY = 0x0200
KEY_WOW64_64KEY = 0x0100

function RegDeleteKey(hk, subkey, access)
	access = access or KEY_WOW64_64KEY
	checkrz(C.RegDeleteKeyExW(hkey(hk), wcs(subkey), access, 0))
	return hk
end

local dwbuf = ffi.new'DWORD[1]'
local qwbuf = ffi.new'ULONG64[1]'
function RegSetValue(hk, name, data, type, sz)
	type = flags(type or REG_SZ)
	if type == REG_SZ then --string
		data, sz = wcs_sz(data)
		data = ffi.cast('BYTE*', data)
		sz = sz * 2 --wchars -> bytes
	elseif type == REG_DWORD then
		dwbuf[0] = data
		data, sz = dwbuf, 4
	elseif type == REG_QWORD then
		qwbuf[0] = data
		data, sz = qwbuf, 8
	else
		sz = sz or #data
	end
	checkrz(C.RegSetValueExW(hk, wcs(name), 0, type, data, sz))
	return hk
end

function RegDeleteValue(hk, name)
	checkrz(C.RegDeleteValueW(hk, wcs(name)))
	return hk
end

function RegDeleteKeyValue(hk, name, val_name)
	checkrz(C.RegDeleteKeyValueW(hk, wcs(name), wcs(val_name)))
end

function RegRenameKey(hk, old_name, new_name)
	checkrz(advapi32.RegRenameKey(hk, wcs(old_name), wcs(new_name)))
	return hk
end

ffi.metatype('struct HKEY__', {__index = {
	close      = RegCloseKey,
	set        = RegSetValue,
	remove     = RegDeleteValue,
	open_key   = RegOpenKey,
	create_key = RegCreateKey,
	remove_key = RegDeleteKey,
	rename_key = RegRenameKey,
}})


if not ... then

	local hk, ks = 'HKEY_CURRENT_USER', [[SOFTWARE\LuaTest]]
	local k, err = RegOpenKey(hk, ks)
	assert(not k and err == 'not_found')
	local k, created = RegCreateKey(hk, ks)
	assert(created)
	local sk, created = k:create_key'subkey'
	assert(created)
	sk:close()
	k:set('bla', 'sup?')
	k:remove'bla'
	k:rename_key('subkey', 'subkey1')
	k:remove_key'subkey1'
	k:close()
	RegDeleteKey(hk, ks)

end
