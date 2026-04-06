
ui.load_font('mono', 'fonts/jetbrains-mono-nl-regular.woff2')

code = '<h1>Hello World!</h1>'

ui.main = function() {

	ui.code_edit('code_edit1', {code: code})

}
