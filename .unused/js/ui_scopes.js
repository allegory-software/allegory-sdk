//// SCOPES ------------------------------------------------------------------

/*

USER API

	ui.scope     ()
	ui.end_scope ()

WIDGET API

	ui.scope_set (k, v)
	ui.scope_get (k) -> v

*/

let scope_stack = []
let scope = null

function begin_scope() {
	scope_stack.push(scope)
	// scope creation is delayed to first call of scope_set().
	// TODO: could COW be faster here with deep scopes?
	// TODO: would parallel per-key stacks be faster here instead of one stack of maps?
	scope = null
}

function end_scope() {
	scope = scope_stack.pop()
}

function scope_get(k) {
	// look in current scope
	if (scope) {
		let v = scope[k]
		if (v !== undefined)
			return v
	}
	// look in parent scopes
	for (let i = scope_stack.length-1; i >= 0; i--) {
		let scope = scope_stack[i]
		if (scope) {
			let v = scope[k]
			if (v !== undefined)
				return v
		}
	}
}
ui.scope_get = scope_get

function scope_set(k, v) {
	scope = scope ?? obj()
	scope[k] = v
}
ui.scope_set = scope_set

function scope_stack_check() {
	assert(!scope_stack.length, 'scope not closed')
}

ui.scope = begin_scope
ui.end_scope = end_scope
