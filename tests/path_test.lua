require'path'

--basename -------------------------------------------------------------------

local function test(s, s2)
	local s1 = basename(s, pl)
	print('basename', s, '->', s1)
	assert(s1 == s2)
end
test(''    , '')
test('/'   , '')
test('a'   , 'a')
test('a/'  , '')
test('/a'  , 'a')
test('a/b' , 'b')
test('a/b/', '')
test('a/b' , 'b')
test('a/b/', '')

--nameext --------------------------------------------------------------------

local function test(s, name2, ext2)
	local name1, ext1 = path_nameext(s, pl)
	print('nameext', s, '->', name1, ext1)
	assert(name1 == name2)
	assert(ext1 == ext2)
end

test('',             '', nil)
test('/',            '', nil)
test('a/',           '', nil)
test('/a/b/a',       'a', nil)
test('/a/b/a.',      'a', '') --invalid filename on Windows
test('/a/b/a.txt',   'a', 'txt')
test('/a/b/.bashrc', '.bashrc', nil)

--dirname --------------------------------------------------------------------

local function test(s, s2)
	local s1 = dirname(s, pl)
	print('dirname', s, '->', s1)
	assert(s1 == s2)
end

--empty rel path has no dir
test('', nil)

--current dir has no dir
test('.', nil)

--root has no dir
test('/', nil)

--dir is root
test('/b' , '/')
test('/aa', '/')

--dir is the current dir
test('a'  , '.')
test('aa' , '.')

--trailing slashes are stripped before computing
test('a/' , '.')
test('./' , nil)
test('/a/', '/')
test('a/b/', 'a')

--dir of non-empty filename
test('a/b'  , 'a')
test('aa/bb', 'aa')
test('a/b'  , 'a')

--normalize ------------------------------------------------------------------

local function test(name, input, dd, endsep, expected)
	local got = path_normalize(input, dd, endsep)
	printf('path_normalize %-20s %-6s, %-6s -> %-10s', input, dd, endsep, got)
	assert(got == expected)
end

-- Empty / trivial inputs
test('empty string',                      '',       false, nil,   '.')
test('empty string + dd',                 '',       true,  nil,   '.')
test('empty string + add sep',            '',       false, true,  './')
test('empty string + rm sep',             '',       false, false, '.')
test('empty string + dd + add sep',       '',       true,  true,  './')
test('dot',                               '.',      false, nil,   '.')
test('dot + dd',                          '.',      true,  nil,   '.')
test('dot slash',                         './',     false, nil,   './')
test('slash',                             '/',      false, nil,   '/')
test('slash + rm sep',                    '/',      false, false, '/')

-- Double slash removal
test('double slash',                      'a//b',       false, nil, 'a/b')
test('triple slash',                      'a///b',      false, nil, 'a/b')
test('leading double slash',              '//a',        false, nil, '/a')
test('trailing double slash',             'a//',        false, nil, 'a/')
test('all slashes',                       '///',        false, nil, '/')

-- Dot removal
test('mid dot',                           'a/./b',      false, nil, 'a/b')
test('multiple dots',                     'a/./././b',  false, nil, 'a/b')
test('leading dot slash',                 './a',        false, nil, 'a')
test('trailing slash dot',                'a/.',        false, nil, 'a')
test('root dot',                          '/.',         false, nil, '/')
test('root dot slash',                    '/./a',       false, nil, '/a')
test('dot slash alone preserved',         './',         false, nil, './')
test('complex dots',                      './a/./b/./c',false, nil, 'a/b/c')

-- Double dot removal (rm_double_dots = true)
test('simple dd',                         'a/b/..',     true, nil, 'a')
test('dd mid',                            'a/b/../c',   true, nil, 'a/c')
test('dd multi',                          'a/b/c/../../d', true, nil, 'a/d')
test('dd all relative',                   'a/..',       true, nil, '.')
test('dd all relative endsep',            'a/../',      true, nil, './')
test('dd leading dotdot kept',            '../a',       true, nil, '../a')
test('dd multiple leading dotdots',       '../../a',    true, nil, '../../a')
test('dd only dotdots',                   '../..',      true, nil, '../..')
test('dd abs simple',                     '/a/b/..',    true, nil, '/a')
test('dd abs to root',                    '/a/..',      true, nil, '/')
test('dd abs invalid above root',         '/a/../../b', true, nil, nil)
test('dd abs invalid direct',             '/../a',      true, nil, nil)
test('dd with dots and slashes',          'a/./b/../c', true, nil, 'a/c')
test('dd deep collapse',                  'a/b/c/../../../d', true, nil, 'd')

-- End separator handling
test('add endsep',                        'a/b',    false, true,  'a/b/')
test('add endsep already there',          'a/b/',   false, true,  'a/b/')
test('rm endsep',                         'a/b/',   false, false, 'a/b')
test('rm endsep already gone',            'a/b',    false, false, 'a/b')
test('rm endsep root unchanged',          '/',      false, false, '/')
test('add endsep root unchanged',         '/',      false, true,  '/')
test('add endsep + dd',                   'a/b/../c', true, true, 'a/c/')
test('rm endsep + dd',                    'a/b/../c/', true, false,'a/c')

-- Combined edge cases
test('complex 1',                         './/a/./b/../c/', true,  nil,   'a/c/')
test('complex 2',                         '/a/b/./../../c', true,  nil,   '/c')
test('complex 3',                         'a/b/c/../../..',  true,  nil,   '.')
test('just dot with add sep',             '.',       false, true,  './')
test('dotdot no dd flag',                 'a/../b',  false, nil,   'a/../b')

--rel ------------------------------------------------------------------------

local function test(s, pwd, s2)
	local s1 = relpath(s, pwd)
	print('rel', s, pwd, '->', s1)
	assert(s1 == s2)
end

test('/a/c',   '/a/b', '../c')
test('/a/b/c', '/a/b', 'c'   )

test('' ,  '',    nil     )
test('' ,  '.',   nil     )
test('' ,  'a',   nil     )
test('a',  '.',   '../a'  )
test('a/', '.',  '../a/'  )
test('a',  'b',  '../a'   )
test('a/', 'b',  '../a/'  )
test('a',  'b/', '../a'   )

test('a/b',    'a/c',   '../b'     ) --1 updir + non-empty
test('a/b/',   'a/c',   '../b/'    ) --1 updir + non-empty + endsep
test('a/b',    'a/b/c', '..'       ) --1 updir + empty
test('a/b/',   'a/b/c', '../'      ) --1 updir + empty + endsep
test('a/b/c',  'a/b',   'c'        ) --0 updirs + non-empty
test('a/b',    'a/b',   '.'        ) --0 updirs + empty
test('a/b/',   'a/b',   './'       ) --0 updirs + empty + endsep
test('a/b',    'a/c/d', '../../b'  ) --2 updirs + non-empty
test('a/b/',   'a/c/d', '../../b/' ) --2 updirs + non-empty + endsep
