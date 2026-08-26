function tokenize_html() {
	let s = `<html>
<body>
</body>
</html>`

	let i = 0
	let n = s.length
	let c
	let t = 'data'
	let tokens = []
	function add(type, s) {
		tokens.push(type, s)
	}
	let states = {
		data: function() {
			if (c == '<')
				t = 'tag_open'
				i++
			} else {
				add('text', c)
				i++
			}
		},
		tag_open: function() {
			if (c == '/') {
				t = 'tag_close'
				i++
			} else if (c == '!') {
				t = 'pseudotag_open'
				i++
			} else if (/^[A-Za-z][A-Za-z0-9\-_:.]*/) {

			} else {
				t = 'data'
				add('text', '<')
				add('text', c)
				i++
			}
		},
	}

	while (i < n) {
		c = s[i]
		switch
	}

}
