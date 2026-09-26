/*

	UI field objects.
	Written by Cosmin Apreutesei. Public Domain.

Field attributes:

	identification:

		type           : for choosing a field preset: number, bool, etc.

	editing:

		readonly       : prevent editing.
		input_type     : input element type.
		to_input       : f(v) -> s   value as editable text.
		from_input     : f(s) -> v   editable text back to value (or undefined)

		enum_values    : enum type: 'v1 ...' | ['v1', ...]
		enum_labels    : enum type: {v->label}
		enum_info      : enum type: {v->info}

	validation:

		not_null       : don't allow null (false).
		required       : don't allow null (false).
		maxlen         : max text length (256).

		min            : min value (0).
		max            : max value (inf).
		decimals       : max number of decimals (0).
		scale          : number type: value is stored times this (1).

		validator_NAME : custom validation rule

	display:

		to_text        : f(v) -> s   plain text display value.
		align          : 'left'|'right'|'center'
		attr           : custom value for html attribute `field`, for styling
		null_text      : plain text display value for null
		empty_text     : plain text display value for ''

		magnitude          : filesize, count types: unit to pin to ('K', 'M', ...)
		magnitude_decimals : filesize, count types: decimals at that magnitude
		gray_min           : filesize type: below this, the value draws gray

		precision      : date, datetime, time, timeofday types

		duration_format: see duration() in glue.js

	slider:

		slider_min     : slider min, defaults to min.
		slider_max     : slider max, defaults to max.
		slider_markers : show markers (true).
		slider_scale_base : marker scale base (10).
		slider_scales  : marker scale multiples ([1, 2, 2.5, 5]).

*/

(function () {
"use strict"
const ui = window.ui

const {
	assign, assign_opt, noop, display_name, words, set,
	num, isnum, isstr, isbool, isarray, isobj, str, dec, repl,
	attr, assert, obj, map, empty_array, return_true,
	uniq_sorted, try_json_arg, warn,
	format_kbytes, format_kcount, format_date, parse_date,
	parse_timeofday, format_timeofday, format_duration, format_timeago, S,
} = glue

//// FIELD VALIDATORS --------------------------------------------------------

/*
We don't like abstractions around here but this one buys us many things:

- validation rules are: reusable, composable, and easy to write logic for.
- rules apply automatically, no need to specify which to apply where.
- a validator can depend on, i.e. require that other rules pass first.
- a validator can parse the input value so that subsequent rules operate
	on the parsed value, thus only having to parse the value once. also, parsing
	is part of validation to allow you to be specific about error message when
	parsing fails (i.e. tell the user in what way is their syntax wrong).
- null values are filtered automatically.
- result contains all the messages with `failed` and `checked` status on each.
- it makes no garbage on re-validation so you can validate huge lists fast.
- entire objects can be validated the same way simple values are, so it also
	works for validating ranges, db records, etc. as a unit.
- it's not that much code for all of that.

output:
	rules
	results
	value
	failed
	parse_failed
	first_failed_result
methods:
	validate([ev]) -> valid?

*/

ui.validation_rules = obj()

ui.add_validation_rule = function(rule) {
	ui.validation_rules[rule.name] = rule
}

ui.create_validator = function(e, own_rules = empty_array) {

	let rules = []
	let parse
	let results = []
	let checked = map()

	let validator = {
		results: results,
		rules: rules,
		triggered: false,
	}

	function add_rule(rule) {
		assert(checked.get(rule) !== false,
			'validation rule require cycle: {0}', rule.name)
		if (checked.get(rule))
			return true
		if (!(rule.applies && rule.applies(e)))
			return
		checked.set(rule, false) // means checking...
		rule.requires = words(rule.requires || '')
		for (let req_rule_name of rule.requires) {
			if (!add_global_rule(req_rule_name)) {
				checked.set(rule, true)
				return true
			}
		}
		if (rule.parse) {
			assert(!parse, 'duplicate validation rule with a parse')
			parse = rule.parse
		}
		rules.push(rule)
		checked.set(rule, true)
		return true
	}

	function add_global_rule(rule_name) {
		let rule = ui.validation_rules[rule_name]
		if (!rule) {
			warn('unknown validation rule', rule_name)
			return
		}
		return add_rule(rule)
	}

	for (let rule_name in ui.validation_rules)
		add_global_rule(rule_name)
	for (let rule of own_rules)
		add_rule(rule)

	validator.parse = function(v) {
		if (v == null) return null
		if (parse) return parse(e, v)
		if (isstr(v) && e.from_input) return e.from_input(v)
		return v
	}

	validator.validate = function(v) {
		v = validator.parse(v)
		let parse_failed = v === undefined
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
				if (ui.validation_rules[req_rule_name]._failed) {
					rule._failed = true
					continue
				}
			}
			let failed = !rule.validate(e, v)
			rule._checked = true
			rule._failed = failed
		}
		results.length = rules.length
		this.failed = false
		this.first_failed_result = null
		for (let i = 0, n = rules.length; i < n; i++) {
			let rule = rules[i]
			let result = attr(results, i)
			result.checked = rule._checked || false
			result.failed  = rule._failed || false
			result.rule    = rule
			result.error   = rule.error(e, v)
			result.rule_text = rule.rule(e)
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
		return !this.failed
	}

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

function add_scalar_rules(type) {

	ui.add_validation_rule({
		name     : 'min_'+type,
		requires : type,
		applies  : (e) => e.min != null,
		validate : (e, v) => v >= e.min,
		error    : (e, v) => S('validation_min_error',
			'{0} is smaller than {1}', e.label, field_value(e, e.min)),
		rule     : (e) => S('validation_min_rule',
			'{0} must be larger than or equal to {1}', e.label, field_value(e, e.min)),
	})

	ui.add_validation_rule({
		name     : 'max_'+type,
		requires : type,
		applies  : (e) => e.max != null,
		validate : (e, v) => v <= e.max,
		error    : (e, v) => S('validation_max_error',
			'{0} is larger than {1}', e.label, field_value(e, e.max)),
		rule     : (e) => S('validation_max_rule',
			'{0} must be smaller than or equal to {1}', e.label, field_value(e, e.max)),
	})

}

ui.add_validation_rule({
	name     : 'required',
	check_null: true,
	applies  : (e) => e.not_null || e.required,
	validate : (e, v) => v != null || e.has_server_default,
	error    : (e, v) => S('validation_empty_error', '{0} is required', e.label),
	rule     : (e) => S('validation_empty_rule'    , '{0} cannot be empty', e.label),
})

ui.add_validation_rule({
	name     : 'range_values_valid',
	applies  : (e) => e.is_range,
	validate : (e, v) => !e.invalid1 && !e.invalid2,
	error    : (e, v) => S('validation_range_values_valid_error', 'Range values are invalid'),
	rule     : (e) => S('validation_range_values_valid_rule' , 'Range values must be valid'),
})

ui.add_validation_rule({
	name     : 'positive_range',
	applies  : (e) => e.is_range,
	validate : (e, v) => e.value1 == null || e.value2 == null || e.value1 <= e.value2,
	error    : (e, v) => S('validation_positive_range_error', 'Range is negative'),
	rule     : (e) => S('validation_positive_range_rule' , 'Range must be positive'),
})

ui.add_validation_rule({
	name     : 'min_range',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.min_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 >= e.min_range,
	error    : (e, v) => S('validation_min_range_error', 'Range is too small'),
	rule     : (e) => S('validation_min_range_rule' ,
		'Range must be larger than or equal to {0}', field_value(e, e.min_range)),
})

ui.add_validation_rule({
	name     : 'max_range',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range,
	error    : (e, v) => S('validation_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_max_range_rule' ,
		'Range must be smaller than or equal to {0}', field_value(e, e.max_range)),
})

ui.add_validation_rule({
	name     : 'min_len',
	applies  : (e) => e.min_len != null,
	validate : (e, v) => v.length >= e.min_len,
	error    : (e, v) => S('validation_min_len_error',
		'{0} too short', e.label),
	rule     : (e) => S('validation_min_len_rule' ,
		'{0} must be at least {1} characters', e.label, e.min_len),
})

ui.add_validation_rule({
	name     : 'max_len',
	applies  : (e) => e.max_len != null,
	validate : (e, v) => v.length <= e.max_len,
	error    : (e, v) => S('validation_max_len_error',
		'{0} is too long', e.label),
	rule     : (e) => S('validation_max_len_rule' ,
		'{0} must be at most {1} characters', e.label, e.max_len),
})

let utf8_encoder = new TextEncoder()

ui.add_validation_rule({
	name     : 'maxlen',
	applies  : (e) => e.maxlen != null,
	validate : (e, v) => !isstr(v) || utf8_encoder.encode(v).length <= e.maxlen,
	error    : (e, v) => S('validation_maxlen_error',
		'{0} is too long', e.label),
	rule     : (e) => S('validation_maxlen_rule',
		'{0} must be at most {1} UTF-8 bytes', e.label, e.maxlen),
})

ui.add_validation_rule({
	name     : 'lower',
	applies  : (e) => e.conditions && e.conditions.includes('lower'),
	validate : (e, v) => /[a-z]/.test(v),
	error    : (e, v) => S('validation_lower_error',
		'{0} does not contain a lowercase letter', e.label),
	rule     : (e) => S('validation_lower_rule' ,
		'{0} must contain at least one lowercase letter', e.label),
})

ui.add_validation_rule({
	name     : 'upper',
	applies  : (e) => e.conditions && e.conditions.includes('upper'),
	validate : (e, v) => /[A-Z]/.test(v),
	error    : (e, v) => S('validation_upper_error',
		'{0} does not contain a uppercase letter', e.label),
	rule     : (e) => S('validation_upper_rule' ,
		'{0} must contain at least one uppercase letter', e.label),
})

ui.add_validation_rule({
	name     : 'digit',
	applies  : (e) => e.conditions && e.conditions.includes('digit'),
	validate : (e, v) => /[0-9]/.test(v),
	error    : (e, v) => S('validation_digit_error',
		'{0} does not contain a digit', e.label),
	rule     : (e) => S('validation_digit_rule' ,
		'{0} must contain at least one digit', e.label),
})

ui.add_validation_rule({
	name     : 'symbol',
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
ui.add_validation_rule({
	name     : 'min_score',
	applies  : (e) => e.min_score != null
		&& e.conditions && e.conditions.includes('min-score'),
	validate : (e, v) => (e.score ?? 0) >= e.min_score,
	error    : (e, v) => S('validation_min_score_error',
		'{0} is {1}', e.label,
			pass_score_errors[e.score] || S('password_score_unknwon', '... wait...')),
	rule     : (e) => S('validation_min_score_rule' ,
		'{0} must be {1}', e.label, pass_score_rules[e.min_score]),
})

ui.add_validation_rule({
	name     : 'date_min_range',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.min_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 >= e.min_range - 24 * 3600,
	error    : (e, v) => S('validation_date_min_range_error', 'Range is too small'),
	rule     : (e) => S('validation_date_min_range_rule' ,
		'Range must be larger than or equal to {0}', field_value(e, e.min_range)),
})

ui.add_validation_rule({
	name     : 'date_max_range',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range - 24 * 3600,
	error    : (e, v) => S('validation_date_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_date_max_range_rule' ,
		'Range must be smaller than or equal to {0}', field_value(e, e.max_range)),
})

ui.add_validation_rule({
	name     : 'value_known',
	applies  : (e) => !e.is_values && e.known_values,
	validate : (e, v) => e.known_values.has(v),
	error    : (e, v) => S('validation_value_known_error',
		'{0}: unknown value {1}', e.label, field_value(e, v)),
	rule     : (e) => S('validation_value_known_rule',
		'{0} must be a known value', e.label),
})

ui.add_validation_rule({
	name     : 'values',
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
ui.add_validation_rule({
	name     : 'values_known',
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

//// ALL FIELD TYPES ---------------------------------------------------------

let field_types      = ui.field_types      = {} // {TYPE->{K: V}}
let all_field_types  = ui.all_field_types  = {} // {K: V}
assign(all_field_types, {
	type: 'text',
	default: null,
	w: 100,
	min_w: 22,
	max_w: 2000,
	align: 'left',
	not_null: false,
	required: false,
	sortable: true,
	movable: true,
	groupable: true,
	maxlen: 256,
	null_text : S('null_text', ''),
	empty_text: S('empty_text', 'empty text'),
	builds_text: true,
	has_editor: true,
})

all_field_types.to_text = function(v) {
	return String(v)
}

// to_input(v) -> s, inverse of from_input(s) -> v. filesize, count and date
// override it: from_input() can't read back a magnitude suffix or a timeago text.
all_field_types.to_input = function(v) {
	return this.to_text(v)
}

//// TEXT --------------------------------------------------------------------

// the default type: all its behavior comes from all_field_types.
field_types.text = {}

//// PASSWORD ----------------------------------------------------------------

field_types.password = {input_type: 'password'}

//// NUMBER ------------------------------------------------------------------

let number = {align: 'right', decimals: 0, scale: 1, is_number: true}
field_types.number = number

number.from_input = function(s) {
	let x = num(s)
	return x != null ? x * this.scale : x
}

number.to_text = function(s) {
	let x = num(s)
	return x != null ? dec(x / this.scale, this.decimals) : s
}

number.to_input = function(s) {
	let x = num(s)
	return x != null ? str(x / this.scale) : s
}

ui.add_validation_rule({
	name     : 'number',
	applies  : (e) => e.is_number,
	parse    : (e, v) => isstr(v) ? e.from_input(v) : v,
	validate : (e, v) => isnum(v),
	error    : (e, v) => S('validation_num_error',
		'{0} is not a number' , e.label),
	rule     : (e) => S('validation_num_rule' ,
		'{0} must be a number', e.label),
})

add_scalar_rules('number')


//// FILESIZE ----------------------------------------------------------------

let filesize = assign({}, number)
field_types.filesize = filesize

// small means the value displays as 0 at this field's magnitude_decimals
// and magnitude, e.g. an 800-byte value forced to display in MB.
filesize.is_small = function(x) {
	if (x == null)
		return true
	let min = this.gray_min
	if (min != null)
		return x < min
	return num(this.to_text(x)) === 0
}

filesize.to_text = function(s) {
	let x = num(s)
	if (x == null)
		return s
	let mag = this.magnitude
	let dec = this.magnitude_decimals || 0
	return format_kbytes(x, dec, mag)
}

// from_input() doesn't read the magnitude suffix back.
filesize.to_input = number.to_text

filesize.scale_base = 1024
filesize.scales = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500]

//// COUNT -------------------------------------------------------------------

let count = assign({}, number)
field_types.count = count

count.to_text = function(s) {
	let x = num(s)
	if (x == null)
		return s
	let mag = this.magnitude
	let dec = this.magnitude_decimals || 0
	return format_kcount(x, dec, mag)
}

count.to_input = number.to_text

//// DATE --------------------------------------------------------------------

let date = {
	align: 'right',
	is_time: true,
	w: 80,
	precision: 'd',
	min: parse_date('1000-01-01 00:00:00', 'SQL'),
	max: parse_date('9999-12-31 23:59:59', 'SQL'),
	from_input: function(s) { return parse_date(s, null, true, this.precision) },
}
field_types.date = date

date.to_text = function(v) {
	if (!isnum(v)) // invalid
		return str(v)
	if (this.timeago)
		return format_timeago(v)
	return format_date(v, null, this.precision)
}

// timeago text doesn't parse back.
date.to_input = function(v) {
	if (!isnum(v)) // invalid
		return str(v)
	return format_date(v, null, this.precision)
}

let dt = assign({}, date, {precision: 'm', w: 140})
field_types.datetime = dt

//// TIME --------------------------------------------------------------------

let ts = assign({}, date)
field_types.time = ts

ts.has_time = true
ts.precision = 's'
ts.w = 160

ui.add_validation_rule({
	name     : 'time',
	applies  : (e) => e.is_time,
	parse    : (e, v) => isstr(v) ? e.from_input(v) : v,
	validate : return_true,
	error    : (e, v) => S('validation_time_error', '{0}: invalid date', e.label),
	rule     : (e) => S('validation_time_rule', '{0} must be a valid date'),
})

add_scalar_rules('time')


//// TIMEOFDAY (MYSQL TIME TYPE) ---------------------------------------------

let td = {
	align: 'center',
	is_timeofday: true,
	from_input: function(s) { return parse_timeofday(s, true, this.precision) },
}
field_types.timeofday = td

td.to_text = function(v) {
	if (!isnum(v)) // invalid
		return str(v)
	return format_timeofday(v, this.precision)
}

ui.add_validation_rule({
	name     : 'timeofday',
	applies  : (e) => e.is_timeofday,
	parse    : (e, v) => isstr(v) ? e.from_input(v) : v,
	validate : return_true,
	error    : (e, v) => S('validation_timeofday_error',
		'{0}: invalid time of day', e.label),
	rule     : (e) => S('validation_timeofday_rule',
		'{0} must be a valid time of day'),
})

add_scalar_rules('timeofday')


//// DURATION ----------------------------------------------------------------

let d = {align: 'right', is_duration: true}
field_types.duration = d

d.to_text = function(v) {
	if (!isnum(v)) return v // invalid
	return format_duration(v, this.duration_format)
}

//// BOOL --------------------------------------------------------------------

// no editor: the value is toggled by click and space, and the cell keeps
// building itself while an edit is carried through it.
let bool = {align: 'center', min_w: 20, w: 20, is_bool: true,
	builds_text: false, has_editor: false}
field_types.bool = bool

ui.add_validation_rule({
	name     : 'bool',
	applies  : (e) => e.is_bool,
	validate : (e, v) => isbool(v),
	error    : (e, v) => S('validation_bool_error',
		'{0} is not a boolean' , e.label),
	rule     : (e) => S('validation_bool_rule' ,
		'{0} must be a boolean', e.label),
})



let enm = {}
field_types.enum = enm

enm.to_text = function(v) {
	let s = this.enum_labels ? this.enum_labels[v] : undefined
	return s !== undefined ? s : v
}

//// TAGS --------------------------------------------------------------------

let tags = {}
field_types.tags = tags

tags.tags_format = 'words' // words | array

tags.to_text = function(v) {
	return isarray(v) ? v.join(' ') : v
}

//// COLOR -------------------------------------------------------------------

let color = {is_color: true}
field_types.color = color
color.builds_text = false

color.from_input = function(s) {
	return /^#[0-9a-f]{6}$/i.test(s) ? s : undefined
}

ui.add_validation_rule({
	name     : 'color',
	applies  : (e) => e.is_color,
	validate : return_true,
	error    : (e, v) => S('validation_color_error',
		'{0} is not #rrggbb', e.label),
	rule     : (e) => S('validation_color_rule',
		'{0} must be #rrggbb', e.label),
})

//// PERCENT -----------------------------------------------------------------

// 50% at the default scale of 100 is stored as 5000.
let percent = assign({}, number, {scale: 100, decimals: 2})
field_types.percent = percent

percent.to_text = function(p) {
	return isnum(p) ? dec(p / this.scale, this.decimals) + '%' : p
}

let icon = {align: 'center'}
field_types.icon = icon

//// COL ---------------------------------------------------------------------

let col = {}
field_types.col = col

//// PLACE (GOOGLE MAPS) -----------------------------------------------------

let place = {}
field_types.place = place

//// URL ---------------------------------------------------------------------

let url = {}
field_types.url = url

//// PHONE -------------------------------------------------------------------

let phone = {}
field_types.phone = phone

//// EMAIL -------------------------------------------------------------------

let email = {}
field_types.email = email

email.validator_email = {
	validate : (e, v) => v.includes('@'),
	error    : (e, v) => S('validation_error_email', 'Not a valid email.'),
	rule     : (e) => S('validation_rule_email', 'Email must be valid.'),
}

let btn = {align: 'center', readonly: true}
field_types.button = btn

//// SECRET_KEY, PUBLIC_KEY, PRIVATE_KEY -------------------------------------

// TODO: these want a mono-font editor: single-line for secret_key,
// multi-line for public_key and private_key.
field_types.secret_key  = {}
field_types.public_key  = {}
field_types.private_key = {}

//// create_field() ----------------------------------------------------------

ui.create_field = function(opt) {
	let field = assign_opt({}, all_field_types,
		field_types[opt?.type ?? 'text'], opt)
	field.label ??= display_name(field.name || field.type)
	if (field.enum_values != null)
		field.known_values = set(words(field.enum_values))
	let own_rules = []
	for (let k in field) {
		if (k.startsWith('validator_')) {
			let rule = assign({}, field[k])
			rule.name = k.replace(/^validator_/, '')
			own_rules.push(rule)
		}
	}
	field.validator = ui.create_validator(field, own_rules)
	if (field.min != null) field.min = field.validator.parse(field.min)
	if (field.max != null) field.max = field.validator.parse(field.max)
	return field
}

}())
