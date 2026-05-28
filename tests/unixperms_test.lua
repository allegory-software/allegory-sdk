require'unixperms'

local format = string.format
local function oct(s)
	return tonumber(s, 8)
end

local function test(s, octal, base, rel2)
	local m1, rel1 = unixperms_parse(s, base)
	local m2 = oct(octal)
	print(
		format('%-10s', s),
		unixperms_format(m1, 'l') .. ' ' .. unixperms_format(m1), rel1,
		unixperms_format(m2, 'l') .. ' ' .. unixperms_format(m2), rel2)
	assert(m1 == m2)
	assert(rel1 == rel2)
end

test('0666',  '0666', '0777', false)
test('0644',  '0644', '0777', false)

test('ux',    '0105', '0005', true)
test('uw',    '0205', '0005', true)
test('ur',    '0405', '0005', true)
test('urw',   '0605', '0005', true)
test('urwx',  '0705', '0005', true)

test('gx',    '0313', '0303', true)
test('gw',    '0323', '0303', true)
test('gr',    '0343', '0303', true)
test('grw',   '0363', '0303', true)
test('grwx',  '0373', '0303', true)

test('ox',    '0661', '0660', true)
test('ow',    '0662', '0660', true)
test('or',    '0664', '0660', true)
test('orw',   '0666', '0660', true)
test('orwx',  '0667', '0660', true)

test('x',     '0111', '0000', false)
test('w',     '0222', '0111', false)
test('r',     '0444', '0222', false)
test('rw',    '0666', '0333', false)
test('rwx',   '0777', '0444', false)

test('u-x',   '0675', '0775', true)
test('u-w',   '0575', '0775', true)
test('u-r',   '0375', '0775', true)
test('u-rw',  '0175', '0775', true)
test('u-rwx', '0075', '0775', true)

test('g-x',   '0261', '0271', true)
test('g-w',   '0251', '0271', true)
test('g-r',   '0231', '0271', true)
test('g-rw',  '0211', '0271', true)
test('g-rwx', '0201', '0271', true)

test('o-x',   '0126', '0127', true)
test('o-w',   '0125', '0127', true)
test('o-r',   '0123', '0127', true)
test('o-rw',  '0121', '0127', true)
test('o-rwx', '0120', '0127', true)

test('ugo+x',   '0333', '0222', true)
test('ugo+w',   '0333', '0111', true)
test('ugo+r',   '0555', '0111', true)
test('ugo+rw',  '0777', '0111', true)
test('ugo+rwx', '0777', '0000', true)
test('ugo+rwx', '0777', '0777', true)

test('u+x g-w o=rwx', '0157', '0070', true)

test('01000',  '01000', '00000', false)
test('02000',  '02000', '00000', false)
test('03000',  '03000', '00000', false)
test('04000',  '04000', '00000', false)
test('05000',  '05000', '00000', false)
test('06000',  '06000', '00000', false)
test('07000',  '07000', '00000', false)

test('t',      '01001', '00000', true)
test('T',      '01000', '00000', true)
test('xT',     '01111', '00000', false)
test('o=xT',   '01001', '00000', true)
test('o=xt',   '01001', '00000', true)
test('u=s',    '04100', '00000', true)
test('g=s',    '02010', '00000', true)
test('u=S',    '04000', '00000', true)
test('g=S',    '02000', '00000', true)
test('ug=S',   '06000', '00000', true)
test('o+x,+t', '01001', '00000', true)

test('01100',  '01100', '00000', false)
test('02010',  '02010', '00000', false)
test('03110',  '03110', '00000', false)

print(unixperms_format(oct'04100', 'l'))
print(unixperms_format(oct'04000', 'l'))
print(unixperms_format(oct'02010', 'l'))
print(unixperms_format(oct'02000', 'l'))
print(unixperms_format(oct'01001', 'l'))
print(unixperms_format(oct'01000', 'l'))
print(unixperms_format(oct'07111', 'l'))
print(unixperms_format(oct'07000', 'l'))

print'unixperms ok'
