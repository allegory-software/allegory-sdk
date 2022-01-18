
## `local mustache = require'mustache'`

Mustache parser and renderer. Produces the exact same output as mustache.js
on the same template + cjson-encoded view.

Mustache is a HTML templating system. If you're new to mustache, see the
[mustache manual](https://mustache.github.io/mustache.5.html).

## Features

* syntax:
	* html-escaped values: `{{var}}`
	* unescaped values: `{{{var}}}` or `{{& var}}`
	* sections: `{{#var}} ... {{/var}}`
	* inverted sections: `{{^var}} ... {{/var}}`
	* comments: `{{! ... }}`
	* partials: `{{>name}}`
	* set delimiters: `{{=<% %>=}}`
	* scoped vars: `a.b.c` wherever `var` is expected.
* semantics:
	* compatible with mustache.js as to what constitutes a non-false value,
	in particular `''`, `0` and `'0'` are considered false.
	* compatibile with [cjson](cjson.md) as to what is considered an array
	and what is a hashmap, in particular sparse arrays that contain
	no other keys are seen as lists and their non-nil elements are iterated.
	* section lambdas `f(text, render)` and value lambdas `f()` are supported.
* rendering:
	* __passes all mustache.js tests.__
	* preserves the indentation of standalone partials.
	* escapes `&`, `>`, `<`, `"`, `'`, `/`, ` ` `, `=` like mustache.js.
* other:
	* error reporting with line and column number information.
	* dump tool for debugging compiled templates.
	* text position info for all tokens (can be used for syntax highlighting).


## API

### `mustache.render(template, [data], [partials], [write], [d1, d2], [escape_func]) -> s`

(Compile and) render a template. Args:

  * `template` - the template, in compiled or in string form.
  * `view` - the template view.
  * `partials` - either `{name -> template}` or `function(name) -> template`
  * `write` - a `function(s)` to output the rendered pieces to.
  * `d1, d2` - initial set delimiters.
  * `escape_func` - the escape function for `{{var}}` substitutions.

### `mustache.compile(template[, d1, d2]) -> template`

Compile a template to bytecode (if not already compiled).

### `mustache.dump(program, [d1, d2], [print])`

Dump the template bytecode (for debugging).
