require'unit'
require'url'
require'glue'

test(url_escape('some&some=other', '&='), 'some%26some%3dother')
test(url_format{scheme = 'http', host = 'dude.com', path = '/', fragment = 'top'}, 'http://dude.com/#top')
test(url_format{scheme = 'http', host = 'dude.com', path = '//../.'}, 'http://dude.com//../.')
test(url_format{scheme = 'http', host = 'dude.com', query = 'a=1&b=2 3'}, 'http://dude.com?a=1&b=2+3')
test(url_format{scheme = 'http', host = 'dude.com', args = {b='2 3',a='1'}}, 'http://dude.com?a=1&b=2+3')
test(url_format{scheme = 'http', host = 'dude.com', path = '/redirect',
		args={a='1',url='http://dude.com/redirect?a=1&url=http://dude.com/redirect?a=1&url=https://dude.com/'}},
	'http://dude.com/redirect?a=1&url=http%3a%2f%2fdude.com%2fredirect%3fa=1%26url=http%3a%2f%2fdude.com%2fredirect%3fa=1%26url=https%3a%2f%2fdude.com%2f')

local function revtest(s, t, missing_t, missing_pt)
	local pt = url_parse(s)
	local s2 = url_format(pt)
	update(t, missing_t)
	update(pt, missing_pt)
	test(pt, t)
	test(s2, s)
end
revtest('', {})
revtest('foo', {path='foo',segments={'foo'}})
revtest(':', {scheme=''})
revtest('s:', {scheme='s'})
revtest('//', {host=''})
revtest('//:', {host='',port=''})
revtest('//@', {user='',host=''})
revtest('//:@', {user='',pass='',host=''})
revtest('//h', {host='h'})
revtest('//u@h', {user='u',host='h'})
revtest('//u:@h', {user='u',pass='',host='h'})
revtest('//:p@h', {user='',pass='p',host='h'})
revtest('//[::1]', {host='::1'})
revtest('//[::1]:8080', {host='::1',port='8080'})
revtest('s://u:p@[::1]:8080/path', {scheme='s',user='u',pass='p',host='::1',port='8080',path='/path',segments={'','path'}})
revtest('/', {path='/',segments={'',''}})
revtest(':/', {scheme='',path='/',segments={'',''}})
revtest('s:', {scheme='s'})
revtest(':relative/path', {scheme='',path='relative/path',segments={'relative','path'}})
revtest('://:@#', {scheme='',user='',pass='',host='',query='',fragment='',args={}}, nil, {query='', args={}})
revtest('://:@?#', {scheme='',user='',pass='',host='',query='',fragment='',args={['']=true}}, {args={['']=true,'',true}})
revtest('://:@/#', {scheme='',user='',pass='',host='',path='/',query='',fragment='',args={},segments={'',''}}, nil, {query='',args={}})
revtest('s://u:p@h/p?q=#f', {scheme='s',user='u',pass='p',host='h',path='/p',query='q=',fragment='f',args={q=''},segments={'','p'}}, {args={q='','q',''}})
revtest('?q=', {query='q=',args={q=''}}, {args={q='','q',''}})
revtest('#f', {fragment='f'})
revtest('?q=&q#f', {query='q=&q',args={'q','','q',true},fragment='f'}, {args={q=true,'q','','q',true}})

test(url_parse'?a=1&b=2&c=&d&f=hidden&f=visible&g=a=1%26b=2', {
				query='a=1&b=2&c=&d&f=hidden&f=visible&g=a=1&b=2',
				args={a='1',b='2',c='',d=true,f='visible',g='a=1&b=2',
					'a','1','b','2','c','','d',true,'f','hidden','f','visible','g','a=1&b=2'}})
test(url_parse'http://user:pass@host/a/b?x=1&y=2&z&w=#fragment',
				{scheme='http',user='user',pass='pass',host='host',path='/a/b',query='x=1&y=2&z&w=',fragment='fragment',
				args={x='1',y='2',z=true,w='','x','1','y','2','z',true,'w',''},segments={'','a','b'}})

--url_resolve tests (RFC 3986 Section 5.4 examples)
local base = 'http://a/b/c/d;p?q'

--normal examples
test(url_format(url_resolve(base, 'g:h')),           'g:h')
test(url_format(url_resolve(base, 'g')),             'http://a/b/c/g')
test(url_format(url_resolve(base, './g')),            'http://a/b/c/g')
test(url_format(url_resolve(base, 'g/')),             'http://a/b/c/g/')
test(url_format(url_resolve(base, '/g')),             'http://a/g')
test(url_format(url_resolve(base, '//g')),            'http://g')
test(url_format(url_resolve(base, '?y')),             'http://a/b/c/d;p?y')
test(url_format(url_resolve(base, 'g?y')),            'http://a/b/c/g?y')
test(url_format(url_resolve(base, '#s')),             'http://a/b/c/d;p?q#s')
test(url_format(url_resolve(base, 'g#s')),            'http://a/b/c/g#s')
test(url_format(url_resolve(base, 'g?y#s')),          'http://a/b/c/g?y#s')
test(url_format(url_resolve(base, ';x')),             'http://a/b/c/;x')
test(url_format(url_resolve(base, 'g;x')),            'http://a/b/c/g;x')
test(url_format(url_resolve(base, 'g;x?y#s')),        'http://a/b/c/g;x?y#s')
test(url_format(url_resolve(base, '')),               'http://a/b/c/d;p?q')
test(url_format(url_resolve(base, '.')),              'http://a/b/c/')
test(url_format(url_resolve(base, './')),             'http://a/b/c/')
test(url_format(url_resolve(base, '..')),             'http://a/b/')
test(url_format(url_resolve(base, '../')),            'http://a/b/')
test(url_format(url_resolve(base, '../g')),           'http://a/b/g')
test(url_format(url_resolve(base, '../..')),          'http://a/')
test(url_format(url_resolve(base, '../../')),         'http://a/')
test(url_format(url_resolve(base, '../../g')),        'http://a/g')

--abnormal examples
test(url_format(url_resolve(base, '../../../g')),     'http://a/g')
test(url_format(url_resolve(base, '../../../../g')),  'http://a/g')
test(url_format(url_resolve(base, '/./g')),           'http://a/g')
test(url_format(url_resolve(base, '/../g')),          'http://a/g')
test(url_format(url_resolve(base, 'g.')),             'http://a/b/c/g.')
test(url_format(url_resolve(base, '.g')),             'http://a/b/c/.g')
test(url_format(url_resolve(base, 'g..')),            'http://a/b/c/g..')
test(url_format(url_resolve(base, '..g')),            'http://a/b/c/..g')

print'url ok'
