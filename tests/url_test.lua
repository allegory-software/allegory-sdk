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
