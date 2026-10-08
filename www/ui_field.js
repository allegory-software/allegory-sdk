/*

	UI field objects.
	Written by Cosmin Apreutesei. Public Domain.

Field attributes (* = client-only):

	REQUIRED
		name           : for identification and referencing.
		type           : for choosing a field definition: number, bool, etc.
	STORAGE
	*	col_storage    : see "column storage" below.
	DISPLAY
		align          : 'left'|'right'|'center'
		null_text      : plain text display value for null
		empty_text     : plain text display value for ''
	*	to_text        : f(v) -> s   plain text display value.
	EDITING
		readonly       : prevent editing.
		not_null       : don't allow null (false).
	*	to_input       : f(v) -> s   value as editable text.
	*	from_input     : f(s) -> v   editable text back to value (or undefined)
	*	input_type     : input element type.
	*	validator_NAME : custom validation rule
	TEXT
		maxlen         : max text length (256).
		sort_collation : 'ai_ci' or 'list\0ITEM1\0ITEM2...'
	NUMBER
		min            : min value (0).
		max            : max value (inf).
		decimals       : max number of decimals (0).
		scale          : number type: value is stored times this (1).
		slider_min     : slider min, defaults to min.
		slider_max     : slider max, defaults to max.
		slider_markers : show markers (true).
		slider_scale_base : marker scale base (10).
		slider_scales  : marker scale multiples ([1, 2, 2.5, 5]).
	ENUM
		enum_values    : enum type: ['v1', ...]
		enum_labels    : enum type: {v->label}
		enum_info      : enum type: {v->info}
	DATE/TIME/TIMEOFDAY
		precision      : date, datetime, time, timeofday types
	DURATION
		duration_format: see duration() in glue.js
	FILESIZE
		magnitude          : filesize, count types: unit to pin to ('K', 'M', ...)
		magnitude_decimals : filesize, count types: decimals at that magnitude
		gray_min           : filesize type: below this, the value draws gray

NOTE: use obj() instead of {} for maps to prevent map['constructor'].

*/

(function () {
"use strict"
const ui = window.ui

const {
	assign, assign_opt, noop, display_name, words, set,
	num, isnum, isstr, isbool, isarray, isobj, str, dec, repl, utf8_len, floor,
	assert, obj, map, empty_array, empty, return_true,
	warn, warn_if,
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
- result contains all the messages (none if with_messages is false) with
  `failed` and `checked` status on each.
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
	validate(v, [with_messages]) -> valid?

*/

ui.validation_rules = obj()

ui.add_validation_rule = function(rule) {
	ui.validation_rules[rule.name] = rule
}

ui.create_validator = function(e, own_rules = empty_array, no_global_rules) {

	let rules = []
	let parse_rule
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
		if (rule.applies && !rule.applies(e))
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
			assert(!parse_rule, 'duplicate validation rule with a parse')
			parse_rule = rule
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

	if (!no_global_rules)
		for (let rule_name in ui.validation_rules)
			add_global_rule(rule_name)
	for (let rule of own_rules)
		add_rule(rule)
	for (let rule of rules) {
		let result = obj()
		result.checked = false
		result.failed = false
		result.rule = rule
		result.error = null
		result.rule_text = null
		results.push(result)
	}
	let required_results = rules.map(rule => rule.requires.length
		? rule.requires.map(name =>
			results[rules.indexOf(ui.validation_rules[name])])
		: empty_array)

	validator.parse = function(v) {
		if (v == null) return null
		if (parse_rule) return parse_rule.parse(e, v)
		return v
	}

	validator.validate = function(v, with_messages) {
		let first_failed_result = null
		let parse_failed = false
		next_rule: for (let i = 0, n = results.length; i < n; i++) {
			let result = results[i]
			let rule = result.rule
			result.checked = false
			result.failed = false
			result.error = null
			result.rule_text = null
			if (v == null && !rule.check_null)
				continue
			for (let req_result of required_results[i]) {
				if (!req_result?.checked || req_result.failed)
					continue next_rule
			}
			let failed
			if (rule == parse_rule) {
				v = rule.parse(e, v)
				parse_failed = v === undefined
				failed = parse_failed || !rule.validate(e, v)
			} else {
				failed = !rule.validate(e, v)
			}
			result.checked = true
			result.failed = failed
			if (failed && !first_failed_result)
				first_failed_result = result
		}
		this.failed = !!first_failed_result
		this.first_failed_result = first_failed_result
		let has_messages = with_messages != false
			&& (with_messages != 'failed' || this.failed)
		if (has_messages)
			for (let result of results) {
				let rule = result.rule
				result.error = rule.error(e, v)
				result.rule_text = rule.rule(e)
			}
		this.parse_failed = parse_failed
		this.value = repl(v, undefined, null)
		return !this.failed
	}

	return validator
}

// NOTE: this must work with values that are unparsed and invalid!
function field_value(e, v) {
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
			'{0} is < {1}', e.label, field_value(e, e.min)),
		rule     : (e) => S('validation_min_rule',
			'{0} must be >= {1}', e.label, field_value(e, e.min)),
	})

	ui.add_validation_rule({
		name     : 'max_'+type,
		requires : type,
		applies  : (e) => e.max != null,
		validate : (e, v) => v <= e.max,
		error    : (e, v) => S('validation_max_error',
			'{0} is > {1}', e.label, field_value(e, e.max)),
		rule     : (e) => S('validation_max_rule',
			'{0} must be <= {1}', e.label, field_value(e, e.max)),
	})

}

ui.add_validation_rule({
	name     : 'required',
	check_null: true,
	applies  : (e) => e.not_null,
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
		'Range must be >= {0}', field_value(e, e.min_range)),
})

ui.add_validation_rule({
	name     : 'max_range',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range,
	error    : (e, v) => S('validation_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_max_range_rule' ,
		'Range must be < or equal {0}', field_value(e, e.max_range)),
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

ui.add_validation_rule({
	name     : 'maxlen',
	applies  : (e) => e.maxlen != null,
	validate : (e, v) => !isstr(v) || v.length <= e.maxlen
		&& (v.length * 3 <= e.maxlen || utf8_len(v) <= e.maxlen),
	error    : (e, v) => S('validation_maxlen_error',
		'{0} is too long', e.label),
	rule     : (e) => S('validation_maxlen_rule',
		'{0} must be at most {1} bytes', e.label, e.maxlen),
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
		'Range must be >= {0}', field_value(e, e.min_range)),
})

ui.add_validation_rule({
	name     : 'date_max_range',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range - 24 * 3600,
	error    : (e, v) => S('validation_date_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_date_max_range_rule' ,
		'Range must be <= {0}', field_value(e, e.max_range)),
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
	name     : 'values_known',
	applies  : (e) => e.is_values,
	validate : (e, v) => v === (v & ((1 << e.enum_values.length) - 1)),
	error    : (e, v) => S('validation_values_known_error',
		'{0}: unknown values: {1}', e.label, field_value(e, v)),
	rule     : (e) => S('validation_values_known_rule',
		'{0} must contain only known values', e.label),
})

//// COLUMN STORAGE ----------------------------------------------------------

/*

Efficient storage for one column of values, using typed arrays for scalars
and JS arrays for strings.

	load_col(col_vals, cap) -> col   load rowset col_vals
	grow_col(col, cap) -> col        grow col array
	get(col, ri) -> v                get col val
	set(col, ri, v)                  set col val
	write_sort_keys(col, ris, n, field, keys0, keys1) -> word_n
		radix sort keys of the rows ris[0..n), as 1 or 2 Uint32 words per row:
		the least significant word in keys0, the other one in keys1.
	compare_cell(col, ri, v) -> -1|0|1            sort comparator
	copy_changed(col, ris, src_col, src_is, n, changed_ks) -> count
		for k in [0..n): where src_col[src_is[k]] differs from col[ris[k]],
		copy it there and put k in changed_ks. src_col is made by load_col().
		null comes first in sort key order.

*/

function compare_vals(v1, v2) {
	return v1 !== v2 ? (v1 < v2 ? -1 : 1) : 0
}

let base_collator_compare

function grow_typed_col(col, cap) {
	let col1 = new col.constructor(cap)
	col1.set(col)
	return col1
}

// two NaNs are two f64 nulls: the same value. for other values the NaN test
// is always false, so this function serves all three storages.
function copy_changed(col, ris, src_col, src_is, n, changed_ks) {
	let changed_n = 0
	for (let k = 0; k < n; k++) {
		let ri = ris[k]
		let v0 = col[ri]
		let v = src_col[src_is[k]]
		if (v0 !== v && (v0 === v0 || v === v)) {
			col[ri] = v
			changed_ks[changed_n++] = k
		}
	}
	return changed_n
}

let array_storage = {
	load_col: (vals, cap) => vals,
	grow_col: (col, cap) => col, // a JS array grows on its own
	get     : (col, ri) => col[ri],
	set     : (col, ri, v) => { col[ri] = v },
	// key: the value's rank among the distinct values; null is key 0. 1 word.
	write_sort_keys: function(col, ris, n, field, keys0) {
		let ranks = map() // {v -> rank}
		let vals = [] // distinct non-null values
		for (let i = 0; i < n; i++) {
			let v = col[ris[i]]
			if (v != null && !ranks.has(v)) {
				ranks.set(v, 0)
				vals.push(v)
			}
		}
		if (field.sort_collation == 'ai_ci') {
			base_collator_compare ??= new Intl.Collator(undefined,
				{sensitivity: 'base'}).compare
			vals.sort(base_collator_compare)
			let rank = 0
			for (let i = 0; i < vals.length; i++) {
				if (i == 0 || base_collator_compare(
					vals[i - 1], vals[i]) != 0)
					rank++
				ranks.set(vals[i], rank)
			}
		} else if (field.sort_collation?.startsWith('list\0')) {
			let items = field.sort_collation.slice(5).split('\0')
			let item_ranks = map() // {listed value -> rank}
			for (let i = 0; i < items.length; i++)
				item_ranks.set(items[i], i + 1)
			let unlisted_vals = []
			for (let v of vals) {
				if (item_ranks.has(v))
					ranks.set(v, item_ranks.get(v))
				else
					unlisted_vals.push(v)
			}
			unlisted_vals.sort(compare_vals)
			for (let i = 0; i < unlisted_vals.length; i++)
				ranks.set(unlisted_vals[i], items.length + i + 1)
		} else {
			vals.sort(compare_vals)
			for (let rank = 0; rank < vals.length; rank++)
				ranks.set(vals[rank], rank + 1)
		}
		for (let i = 0; i < n; i++) {
			let v = col[ris[i]]
			keys0[i] = v == null ? 0 : ranks.get(v)
		}
		return 1
	},
	compare_cell: function(col, ri, v) {
		let v1 = col[ri]
		if (v1 == null)
			return v == null ? 0 : -1
		if (v == null)
			return 1
		return compare_vals(v1, v)
	},
	copy_changed: copy_changed,
}

// null is NaN: JSON numbers are never NaN.
let f64_storage = {
	load_col: function(vals, cap) {
		let col = new Float64Array(cap)
		for (let ri = 0; ri < vals.length; ri++) {
			let v = vals[ri]
			col[ri] = v == null ? NaN : v
		}
		return col
	},
	grow_col: grow_typed_col,
	get: function(col, ri) {
		let v = col[ri]
		return v !== v ? null : v
	},
	set: function(col, ri, v) {
		col[ri] = v == null ? NaN : v
	},
	// key: the double's bits made unsigned-sortable (negative: flip all bits;
	// positive: flip the sign bit); 0 for null. 2 words.
	write_sort_keys: function(col, ris, n, field, keys0, keys1) {
		let bits = new Uint32Array(col.buffer, col.byteOffset, col.length * 2)
		for (let i = 0; i < n; i++) {
			let ri = ris[i]
			let lo_word = bits[2 * ri] // little endian: low word first
			let hi_word = bits[2 * ri + 1]
			if (col[ri] !== col[ri]) {
				keys0[i] = 0
				keys1[i] = 0
			} else if (hi_word & 0x80000000) {
				keys0[i] = ~lo_word
				keys1[i] = ~hi_word
			} else {
				keys0[i] = lo_word
				keys1[i] = hi_word | 0x80000000
			}
		}
		return 2
	},
	compare_cell: function(col, ri, v) {
		let v1 = col[ri]
		if (v1 !== v1)
			return v == null ? 0 : -1
		if (v == null)
			return 1
		return compare_vals(v1, v)
	},
	copy_changed: copy_changed,
}

// 0: false, 1: true, 2: null.
let bool_storage = {
	load_col: function(vals, cap) {
		let col = new Uint8Array(cap)
		for (let ri = 0; ri < vals.length; ri++) {
			let v = vals[ri]
			col[ri] = v == null ? 2 : v ? 1 : 0
		}
		return col
	},
	grow_col: grow_typed_col,
	get: function(col, ri) {
		let v = col[ri]
		return v == 2 ? null : v == 1
	},
	set: function(col, ri, v) {
		col[ri] = v == null ? 2 : v ? 1 : 0
	},
	// key: 0 for null, 1 for false, 2 for true. 1 word.
	write_sort_keys: function(col, ris, n, field, keys0) {
		for (let i = 0; i < n; i++) {
			let v = col[ris[i]]
			keys0[i] = v == 2 ? 0 : v + 1
		}
		return 1
	},
	compare_cell: function(col, ri, v) {
		let v1 = col[ri]
		let key1 = v1 == 2 ? 0 : v1 + 1
		let key2 = v == null ? 0 : v ? 2 : 1
		return compare_vals(key1, key2)
	},
	copy_changed: copy_changed,
}

//// ALL FIELD TYPES ---------------------------------------------------------

function check_field_options(field, checks, nav_id) {
	for (let k in checks)
		if (warn_if(!checks[k](field[k]), nav_id,
			'field:', field.name, 'invalid option:', k, field[k]))
			return false
	return true
}

function allow_null(check) {
	return v => v == null || check(v)
}

let optional_bool = allow_null(isbool)
let optional_num = allow_null(isnum)
let optional_str = allow_null(isstr)
let optional_obj = allow_null(isobj)
let field_config_checks = {
	name: optional_str,
	label: optional_str,
	info: optional_str,
	internal: optional_bool,
	hidden: optional_bool,
	readonly: optional_bool,
	nosave: optional_bool,
	not_null: optional_bool,
	has_server_default: optional_bool,
	sortable: optional_bool,
	min: optional_num,
	max: optional_num,
	sort_collation: v => v == null || isstr(v)
		&& (v == 'ai_ci' || v.startsWith('list\0')),
	null_text: optional_str,
	empty_text: optional_str,
	align: v => v == null || v == 'left' || v == 'right' || v == 'center',
	enum_values: allow_null(v => isarray(v) || isstr(v)),
	maxlen: allow_null(v => isnum(v) && v >= 0 && v == floor(v)),
	w: optional_num,
	min_w: optional_num,
	max_w: optional_num,
}

let field_types      = ui.field_types      = obj() // {TYPE->{K: V}}
let all_field_types  = ui.all_field_types  = obj() // {K: V}
assign(all_field_types, {
	type: 'text',
	control: 'input',
	build_input: ui.build_input,
	default: null,
	w: 8,
	min_w: 2,
	max_w: 154,
	align: 'left',
	not_null: false,
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

// to_input(v) -> s (format), inverse of from_input(s) -> v (parse).
all_field_types.to_input = function(v) {
	return this.to_text(v)
}

all_field_types.check_config = function(nav_id) {
	return check_field_options(this, this.config_checks ?? empty, nav_id)
}

all_field_types.col_storage = array_storage

//// TEXT --------------------------------------------------------------------

// the default type: all its behavior comes from all_field_types.
field_types.text = {}

//// PASSWORD ----------------------------------------------------------------

field_types.password = {input_type: 'password', control: 'password_input'}

//// NUMBER ------------------------------------------------------------------

let number = {align: 'right', decimals: 0, scale: 1, is_number: true,
	col_storage: f64_storage}
field_types.number = number

function check_integer(v, min_val, max_val) {
	return isnum(v) && v >= min_val && v <= max_val && v == floor(v)
}

number.config_checks = {
	decimals: v => v == null || check_integer(v, 0, 6),
	scale: v => check_integer(v, 1, 1e6),
	slider_min: optional_num,
	slider_max: optional_num,
	slider_markers: optional_bool,
	slider_scale_base: optional_num,
	slider_scales: allow_null(v => isarray(v) && v.every(isnum)),
}

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
	return x != null ? dec(x / this.scale, this.decimals) : s
}

let number_re = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/

ui.add_validation_rule({
	name     : 'number',
	applies  : (e) => e.is_number,
	parse    : (e, v) => !isstr(v) ? v
		: number_re.test(v) ? e.from_input(v) : undefined,
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

let magnitudes = set(words('K M G T P E'))
filesize.config_checks = assign({}, number.config_checks, {
	magnitude_decimals: v => v == null || check_integer(v, 0, 3),
	magnitude: v => v == null || magnitudes.has(v),
	gray_min: optional_num,
})

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

count.config_checks = filesize.config_checks

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
	control: 'date_input',
	align: 'right',
	is_time: true,
	w: 6,
	precision: 'd',
	min: parse_date('1000-01-01 00:00:00', 'SQL'),
	max: parse_date('9999-12-31 23:59:59', 'SQL'),
	from_input: function(s) { return parse_date(s, null, true, this.precision) },
	col_storage: f64_storage,
}
field_types.date = date

let date_precisions = set(words('d m s ms'))
date.config_checks = {
	precision: v => v == null || date_precisions.has(v),
	timeago: optional_bool,
}

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

let dt = assign({}, date, {precision: 'm', w: 11})
field_types.datetime = dt

//// TIME --------------------------------------------------------------------

let ts = assign({}, date)
field_types.time = ts

ts.has_time = true
ts.precision = 's'
ts.w = 12

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
	col_storage: f64_storage,
}
field_types.timeofday = td

let timeofday_precisions = set(words('m s ms'))
td.config_checks = {
	precision: v => v == null || timeofday_precisions.has(v),
}

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

let d = {align: 'right', is_duration: true, col_storage: f64_storage}
field_types.duration = d

let duration_formats = set(words('approx approx+s long'))
d.config_checks = {
	duration_format: v => v == null || duration_formats.has(v),
}

d.to_text = function(v) {
	if (!isnum(v)) return v // invalid
	return format_duration(v, this.duration_format)
}

//// BOOL --------------------------------------------------------------------

// no editor: the value is toggled by click and space, and the cell keeps
// building itself while an edit is carried through it.
let bool = {align: 'center', min_w: 2, w: 2, is_bool: true,
	builds_text: false, has_editor: false, control: 'checkbox',
	col_storage: bool_storage}
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

let enm = {control: 'enum_input'}
field_types.enum = enm

enm.config_checks = {
	enum_values: v => v != null,
	enum_labels: optional_obj,
	enum_info: optional_obj,
}

enm.to_text = function(v) {
	let s = this.enum_labels ? this.enum_labels[v] : undefined
	return s !== undefined ? s : v
}

enm.enum_items = function() {
	return this.enum_values
}

let enum_list = {is_values: true, control: 'enum_toggle',
	col_storage: f64_storage}
field_types.enum_list = enum_list

enum_list.config_checks = {
	enum_values: v => isarray(v) && v.length <= 31,
	enum_labels: optional_obj,
	enum_info: optional_obj,
}

enum_list.to_text = function(v) {
	this.value_texts ??= new Map()
	let s = this.value_texts.get(v)
	if (s === undefined) {
		let texts = []
		for (let i = 0; i < 31; i++)
			if (v & (1 << i))
				texts.push(i < this.enum_values.length
					? enm.to_text.call(this, this.enum_values[i]) : i)
		s = texts.join(', ')
		this.value_texts.set(v, s)
	}
	return s
}

enum_list.enum_items = function() {
	assert(this.enum_values.length <= 31,
		this.label, ': enum_list with more than 31 enum_values')
	return this.item_masks ??= this.enum_values.map((v, i) => 1 << i)
}

enum_list.has_item = function(v, item) {
	return (v & item) != 0
}

enum_list.toggle_item = function(v, item) {
	return (v ^ item) || (this.not_null ? v : null)
}

//// TAGS --------------------------------------------------------------------

let tags = {}
field_types.tags = tags

tags.tags_format = 'words' // words | array

tags.to_text = function(v) {
	return isarray(v) ? v.join(' ') : v
}

//// COLOR -------------------------------------------------------------------

let color = {is_color: true, control: 'color_input'}
field_types.color = color
color.builds_text = false

color.from_input = function(s) {
	return /^#[0-9a-f]{6}$/i.test(s) ? s : undefined
}

ui.add_validation_rule({
	name     : 'color',
	applies  : (e) => e.is_color,
	parse    : (e, v) => isstr(v) ? e.from_input(v) : v,
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

ui.create_field = function(opt, nav_id = '') {
	let type = opt?.type ?? 'text'
	if (warn_if(!opt.name, nav_id, 'unnamed field'))
		return null
	if (warn_if(!field_types[type], nav_id, 'field:', opt.name, 'unknown type:', type))
		return null
	let field_type = field_types[type]
	let field = assign_opt({}, all_field_types, field_type, opt)
	field.label ??= display_name(field.name)
	if (!check_field_options(field, field_config_checks, nav_id))
		return null
	if (field.enum_values != null) {
		field.enum_values = words(field.enum_values)
		field.known_values = set(field.enum_values)
	}
	if (!field.check_config(nav_id))
		return null
	let own_rules = []
	for (let k in field) {
		if (k.startsWith('validator_')) {
			let rule = assign({}, field[k])
			rule.name = k.replace(/^validator_/, '')
			own_rules.push(rule)
		}
	}
	field.validator = ui.create_validator(field, own_rules)
	return field
}

}())
