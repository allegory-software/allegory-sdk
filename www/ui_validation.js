/* validators & validation rules ---------------------------------------------

We don't like abstractions around here but this one buys us many things:

  - validation rules are: reusable, composable, and easy to write logic for.
  - rules apply automatically, no need to specify which to apply where.
  - a validator can depend on, i.e. require that other rules pass first.
  - a validator can parse the input value so that subsequent rules operate
    on the parsed value, thus only having to parse the value once.
  - null values are filtered automatically.
  - result contains all the messages with `failed` and `checked` status on each.
  - it makes no garbage on re-validation so you can validate huge lists fast.
  - entire objects can be validated the same way simple values are, so it also
    works for validating ranges, db records, etc. as a unit.
  - it's not that much code for all of that.

input:
	parent_validator
output:
	rules
	triggered
	results
	value
	failed
	parse_failed
	first_failed_result
methods:
	prop_changed(prop) -> needs_revalidation?
	validate([ev]) -> valid?
	effectively_failed()

*/

(function () {
"use strict"
const G = window
const ui = G.ui

const {
	isstr, repl,
	property,
	assert,
	obj, map,
	wordset,
	empty_array,
	return_true,
	words, uniq_sorted, try_json_arg,
	assign,
	announce,
	S,
} = glue


let global_rules = obj()
G.validation_rules = global_rules

let global_rule_props = obj()

function fix_rule(rule) {
	rule.applies = rule.applies || return_true
	rule. props = wordset(rule. props)
	rule.vprops = wordset(rule.vprops)
	rule.requires = words(rule.requires) || empty_array
}

G.add_validation_rule = function(rule) {
	fix_rule(rule)
	global_rules[rule.name] = rule
	assign(global_rule_props, rule.props)
	announce('validation_rules_changed')
}

G.create_validator = function(e) {

	let rules_invalid = true
	let rules = []
	let own_rules = []
	let own_rule_props = obj()
	let rule_vprops = obj()
	let parse
	let results = []
	let checked = map()

	let validator = {
		results: results,
		rules: rules,
		triggered: false,
	}

	function add_rule(rule) {
		assert(checked.get(rule) !== false, 'validation rule require cycle: {0}', rule.name)
		if (checked.get(rule))
			return true
		if (!rule.applies(e))
			return
		checked.set(rule, false) // means checking...
		for (let req_rule_name of rule.requires) {
			if (!add_global_rule(req_rule_name)) {
				checked.set(rule, true)
				return true
			}
		}
		rules.push(rule)
		assign(rule_vprops, rule.vprops)
		checked.set(rule, true)
		if (!parse)
			parse = rule.parse
		return true
	}

	function add_global_rule(rule_name) {
		let rule = global_rules[rule_name]
		if (!rule) {
			warn('unknown validation rule', rule_name)
			return
		}
		return add_rule(rule)
	}

	validator.invalidate = function() {
		rules_invalid = true
	}

	validator.add_rule = function(rule) {
		fix_rule(rule)
		own_rules.push(rule)
		assign(own_rule_props, rule.props)
		rules_invalid = true
	}

	validator.prop_changed = function(prop) {
		if (!prop || global_rule_props[prop] || own_rule_props[prop]) {
			rules.clear()
			for (let k in rule_vprops)
				rule_vprops[k] = null
			checked.clear()
			rules_invalid = true
			return true
		}
		return rules_invalid || rule_vprops[prop] || !rules.len
	}

	function update_rules() {
		if (!rules_invalid)
			return
		for (let rule_name in global_rules)
			add_global_rule(rule_name)
		for (let rule of own_rules)
			add_rule(rule)
		rules_invalid = false
	}

	validator.parse = function(v) {
		update_rules()
		if (v == null) return null
		return parse ? parse(e, v) : v
	}

	validator.validate = function(v, announce_results) {
		announce_results = announce_results != false
		update_rules()
		let parse_failed
		for (let rule of rules) {
			if (parse_failed) {
				rule._failed = true
				continue // if parse failed, subsequent rules cannot run!
			}
			if (rule._failed)
				continue
			if (rule._checked)
				continue
			if (v == null && !rule.check_null)
				continue
			for (let req_rule_name of rule.requires) {
				if (global_rules[req_rule_name]._failed) {
					rule._failed = true
					continue
				}
			}
			let parse = rule.parse
			if (parse) {
				assert(parse_failed == null)
				v = parse(e, v)
				parse_failed = v === undefined
			}
			let failed = parse_failed || !rule.validate(e, v)
			rule._checked = true
			rule._failed = failed
		}
		results.len = rules.len
		this.failed = false
		this.first_failed_result = null
		for (let i = 0, n = rules.len; i < n; i++) {
			let rule = rules[i]
			let result = attr(results, i)
			result.checked = rule._checked || false
			result.failed  = rule._failed || false
			result.rule    = rule
			if (announce_results) {
				result.error     = rule.error(e, v)
				result.rule_text = rule.rule (e)
			}
			if (rule._failed && !this.failed) {
				this.failed = true
				this.first_failed_result = result
			}
			// clean up scratch pad.
			rule._checked = null
			rule._failed  = null
		}
		this.parse_failed = parse_failed
		this.value = repl(v, undefined, null)
		if (announce_results)
			e.announce('validate', this)
		this.triggered = true
		return !this.failed
	}

	property(validator, 'effectively_failed', function() {
		let e = this
		assert(e.triggered)
		if (e.failed)
			return true
		e = e.parent_validator
		if (!e)
			return false
		return e.effectively_failed
	})

	return validator
}

// NOTE: this must work with values that are unparsed and invalid!
function field_value(e, v) {
	if (e.draw) return e.draw(v) ?? '' // field renders itself
	if (v == null) return S('null', 'null')
	if (isstr(v)) return v // string or failed to parse, show as is.
	if (e.to_text) return e.to_text(v)
	return str(v)
}

add_validation_rule({
	name     : 'required',
	check_null: true,
	props    : 'not_null required',
	vprops   : 'input_value',
	applies  : (e) => e.not_null || e.required,
	validate : (e, v) => v != null || e.has_server_default,
	error    : (e, v) => S('validation_empty_error', '{0} is required', e.label),
	rule     : (e) => S('validation_empty_rule'    , '{0} cannot be empty', e.label),
})

// NOTE: empty string converts to `true` even when setting the value from JS!
// This is so that a html attr without value becomes `true`.
add_validation_rule({
	name     : 'bool',
	vprops   : 'input_value',
	applies  : (e) => e.is_bool,
	parse    : (e, v) => isbool(v) ? v : bool_attr(v),
	validate : (e, v) => isbool(v),
	error    : (e, v) => S('validation_bool_error',
		'{0} is not a boolean' , e.label),
	rule     : (e) => S('validation_bool_rule' ,
		'{0} must be a boolean', e.label),
})

add_validation_rule({
	name     : 'number',
	vprops   : 'input_value',
	applies  : (e) => e.is_number,
	parse    : (e, v) => isstr(v) ? num(v) : v,
	validate : (e, v) => isnum(v),
	error    : (e, v) => S('validation_num_error',
		'{0} is not a number' , e.label),
	rule     : (e) => S('validation_num_rule' ,
		'{0} must be a number', e.label),
})

function add_scalar_rules(type) {

	add_validation_rule({
		name     : 'min_'+type,
		requires : type,
		props    : 'min',
		vprops   : 'input_value',
		applies  : (e) => e.min != null,
		validate : (e, v) => v >= e.min,
		error    : (e, v) => S('validation_min_error',
			'{0} is smaller than {1}', e.label, field_value(e, e.min)),
		rule     : (e) => S('validation_min_rule',
			'{0} must be larger than or equal to {1}', e.label, field_value(e, e.min)),
	})

	add_validation_rule({
		name     : 'max_'+type,
		requires : type,
		props    : 'max',
		vprops   : 'input_value',
		applies  : (e) => e.max != null,
		validate : (e, v) => v <= e.max,
		error    : (e, v) => S('validation_max_error',
			'{0} is larger than {1}', e.label, field_value(e, e.max)),
		rule     : (e) => S('validation_max_rule',
			'{0} must be smaller than or equal to {1}', e.label, field_value(e, e.max)),
	})

}

add_scalar_rules('number')

add_validation_rule({
	name     : 'checked_value',
	props    : 'checked_value unchecked_value',
	vprops   : 'input_value',
	applies  : (e) => e.checked_value !== undefined || e.unchecked_value !== undefined,
	validate : (e, v) => v == e.checked_value || v == e.unchecked_value,
	error    : (e, v) => S('validation_checked_value_error',
		'{0} is not {1} or {2}' , e.label, e.checked_value, e.unchecked_value),
	rule     : (e) => S('validation_checked_value_rule' ,
		'{0} must be {1} or {2}', e.label, e.checked_value, e.unchecked_value),
})

add_validation_rule({
	name     : 'range_values_valid',
	vprops   : 'invalid1 invalid2',
	applies  : (e) => e.is_range,
	validate : (e, v) => !e.invalid1 && !e.invalid2,
	error    : (e, v) => S('validation_range_values_valid_error', 'Range values are invalid'),
	rule     : (e) => S('validation_range_values_valid_rule' , 'Range values must be valid'),
})

add_validation_rule({
	name     : 'positive_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range,
	validate : (e, v) => e.value1 == null || e.value2 == null || e.value1 <= e.value2,
	error    : (e, v) => S('validation_positive_range_error', 'Range is negative'),
	rule     : (e) => S('validation_positive_range_rule' , 'Range must be positive'),
})

add_validation_rule({
	name     : 'min_range',
	props    : 'min_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.min_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 >= e.min_range,
	error    : (e, v) => S('validation_min_range_error', 'Range is too small'),
	rule     : (e) => S('validation_min_range_rule' ,
		'Range must be larger than or equal to {0}', field_value(e, e.min_range)),
})

add_validation_rule({
	name     : 'max_range',
	props    : 'max_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range,
	error    : (e, v) => S('validation_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_max_range_rule' ,
		'Range must be smaller than or equal to {0}', field_value(e, e.max_range)),
})

add_validation_rule({
	name     : 'min_len',
	props    : 'min_len',
	vprops   : 'input_value',
	applies  : (e) => e.min_len != null,
	validate : (e, v) => v.length >= e.min_len,
	error    : (e, v) => S('validation_min_len_error',
		'{0} too short', e.label),
	rule     : (e) => S('validation_min_len_rule' ,
		'{0} must be at least {1} characters', e.label, e.min_len),
})

add_validation_rule({
	name     : 'max_len',
	props    : 'max_len',
	vprops   : 'input_value',
	applies  : (e) => e.max_len != null,
	validate : (e, v) => v.length <= e.max_len,
	error    : (e, v) => S('validation_max_len_error',
		'{0} is too long', e.label),
	rule     : (e) => S('validation_max_len_rule' ,
		'{0} must be at most {1} characters', e.label, e.max_len),
})

let utf8_encoder = new TextEncoder()

add_validation_rule({
	name     : 'maxlen',
	props    : 'maxlen',
	vprops   : 'input_value',
	applies  : (e) => e.maxlen != null,
	validate : (e, v) => !isstr(v) || utf8_encoder.encode(v).length <= e.maxlen,
	error    : (e, v) => S('validation_maxlen_error',
		'{0} is too long', e.label),
	rule     : (e) => S('validation_maxlen_rule',
		'{0} must be at most {1} UTF-8 bytes', e.label, e.maxlen),
})

add_validation_rule({
	name     : 'lower',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('lower'),
	validate : (e, v) => /[a-z]/.test(v),
	error    : (e, v) => S('validation_lower_error',
		'{0} does not contain a lowercase letter', e.label),
	rule     : (e) => S('validation_lower_rule' ,
		'{0} must contain at least one lowercase letter', e.label),
})

add_validation_rule({
	name     : 'upper',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('upper'),
	validate : (e, v) => /[A-Z]/.test(v),
	error    : (e, v) => S('validation_upper_error',
		'{0} does not contain a uppercase letter', e.label),
	rule     : (e) => S('validation_upper_rule' ,
		'{0} must contain at least one uppercase letter', e.label),
})

add_validation_rule({
	name     : 'digit',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('digit'),
	validate : (e, v) => /[0-9]/.test(v),
	error    : (e, v) => S('validation_digit_error',
		'{0} does not contain a digit', e.label),
	rule     : (e) => S('validation_digit_rule' ,
		'{0} must contain at least one digit', e.label),
})

add_validation_rule({
	name     : 'symbol',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('symbol'),
	validate : (e, v) => /[^A-Za-z0-9]/.test(v),
	error    : (e, v) => S('validation_symbol_error',
		'{0} does not contain a symbol', e.label),
	rule     : (e) => S('validation_symbol_rule' ,
		'{0} must contain at least one symbol', e.label),
})

let pass_score_errors = [
	S('password_score_error_0', 'extremely easy to guess'),
	S('password_score_error_1', 'very easy to guess'),
	S('password_score_error_2', 'easy to guess'),
	S('password_score_error_3', 'not hard enough to guess'),
]
let pass_score_rules = [
	S('password_score_rule_0', 'extremely easy to guess'),
	S('password_score_rule_1', 'very easy to guess'),
	S('password_score_rule_2', 'easy to guess'),
	S('password_score_rule_3', 'hard to guess'),
	S('password_score_rule_4', 'impossible to guess'),
]
add_validation_rule({
	name     : 'min_score',
	props    : 'conditions min_score',
	vprops   : 'input_value',
	applies  : (e) => e.min_score != null
		&& e.conditions && e.conditions.includes('min-score'),
	validate : (e, v) => (e.score ?? 0) >= e.min_score,
	error    : (e, v) => S('validation_min_score_error',
		'{0} is {1}', e.label,
			pass_score_errors[e.score] || S('password_score_unknwon', '... wait...')),
	rule     : (e) => S('validation_min_score_rule' ,
		'{0} must be {1}', e.label, pass_score_rules[e.min_score]),
})

add_validation_rule({
	name     : 'time',
	vprops   : 'input_value',
	applies  : (e) => e.is_time,
	parse    : (e, v) => parse_date(v, 'SQL', true, e.precision),
	validate : return_true,
	error    : (e, v) => S('validation_time_error', '{0}: invalid date', e.label),
	rule     : (e) => S('validation_time_rule', '{0} must be a valid date'),
})

add_scalar_rules('time')

add_validation_rule({
	name     : 'timeofday',
	vprops   : 'input_value',
	applies  : (e) => e.is_timeofday,
	parse    : (e, v) => parse_timeofday(v, true, e.precision),
	validate : return_true,
	error    : (e, v) => S('validation_timeofday_error',
		'{0}: invalid time of day', e.label),
	rule     : (e) => S('validation_timeofday_rule',
		'{0} must be a valid time of day'),
})

add_scalar_rules('timeofday')

add_validation_rule({
	name     : 'date_min_range',
	props    : 'date_min_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.min_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 >= e.min_range - 24 * 3600,
	error    : (e, v) => S('validation_date_min_range_error', 'Range is too small'),
	rule     : (e) => S('validation_date_min_range_rule' ,
		'Range must be larger than or equal to {0}', field_value(e, e.min_range)),
})

add_validation_rule({
	name     : 'date_max_range',
	props    : 'date_max_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range - 24 * 3600,
	error    : (e, v) => S('validation_date_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_date_max_range_rule' ,
		'Range must be smaller than or equal to {0}', field_value(e, e.max_range)),
})

add_validation_rule({
	name     : 'value_known',
	props    : 'known_values',
	vprops   : 'input_value',
	applies  : (e) => !e.is_values && e.known_values,
	validate : (e, v) => e.known_values.has(v),
	error    : (e, v) => S('validation_value_known_error',
		'{0}: unknown value {1}', e.label, field_value(e, v)),
	rule     : (e) => S('validation_value_known_rule',
		'{0} must be a known value', e.label),
})

add_validation_rule({
	name     : 'values',
	vprops   : 'input_value',
	applies  : (e) => e.is_values,
	parse    : (e, v) => {
		v = isstr(v) ? (v.trim().startsWith('[') ? try_json_arg(v) : words(v)) : v
		return uniq_sorted(v.sort())
	},
	validate : return_true,
	error    : (e, v) => S('validation_values_error',
		'{0}: invalid values list', e.label),
	rule     : (e) => S('validation_values_rule',
		'{0} must be a valid values list', e.label),
})

function invalid_values(e, v) {
	if (v == null)
		return 'null'
	let a = []
	for (let s of v)
		if (!e.known_values.has(s))
			a.push(s)
	return a.join(', ')
}
add_validation_rule({
	name     : 'values_known',
	props    : 'known_values',
	vprops   : 'input_value',
	requires : 'values',
	applies  : (e) => e.known_values,
	validate : (e, v) => {
		for (let s of v)
			if (!e.known_values.has(s))
				return false
		return true
	},
	error    : (e, v) => S('validation_values_known_error',
		'{0}: unknown values: {1}', e.label, invalid_values(e, v)),
	rule     : (e) => S('validation_values_known_rule',
		'{0} must contain only known values', e.label),
})

}()) // module function
