
// arena for small (< 100 elements) arrays, maps and sets to keep gc low.
// note: for larger arrays the heap is far more efficient, esp. if all the
// elements have the same type.

arena = function() {

	let arena = {}
	let a = []
	let alen = 0

	arena.clear = function() {
		for (let i = 0; i < alen; i++)
			a[i] = undefined
		alen = 0
	}

	arena.add = function(v) {
		a[alen++] = v
		return alen-1
	}

	arena.get = function(i) {
		return a[i]
	}

	arena.arr = function(len, est_len) {
		let i = alen
		let cap = nextpow2(max(len, est_len ?? 0))
		this.add(len)
		this.add(cap)
		for (let j = 0; j < cap; j++)
			this.add(undefined)
		return i
	}

	arena.arr_len      = function(i) { return a[i] }
	arena.arr_capacity = function(i) { return a[i+1] }

	arena.arr_setlen = function(i, len, est_len) {
		let len0 = a[i]
		let cap0 = a[i+1]
		if (len > cap0) {
			let i0 = i
			if (i0+2+len0 == alen) { // last in arena, expand arena
				let cap = nextpow2(max(len, est_len ?? 0))
				alen += cap - cap0 // expand arena
				a[i+1] = cap // update capacity
			} else {
				i = this.arr(len, est_len) // realloc
				for (let j = 0; j < len0; j++) // copy contents
					a[i+2+j] = a[i0+2+j]
				return i
			}
		} else if (len < len0) { // shrink
			for (let j = 1 + len0; j > len; j--) // clear surplus
				a[i+j] = undefined
		}
		a[i] = len
		return i
	}

	arena.arr_expand = function(i, n) {
		return this.arr_setlen(i, this.arr_len(i) + n)
	}

	arena.arr_get = function(i, at) {
		return a[i+2+at]
	}

	arena.arr_find = function(i, v) {
		let n = this.arr_len(i)
		if (n > 50) pr('arr_find slow', n)
		for (let j = 0; j < n; j++)
			if (a[i+2+j] === v)
				return j
	}

	let default_cmp = function(a, b) { return a - b; }

	arena.arr_binsearch = function(i, v, cmp) {
		cmp ??= default_cmp
		let m = 0
		let n = this.arr_len(i) - 1
		while (m <= n) {
			let k = (n + m) >> 1
			let r = cmp(v, this.arr_get(i, k))
			if (r > 0) {
				m = k + 1
			} else if(r < 0) {
				n = k - 1
			} else {
				return k
			}
		}
		return ~m
	}

	function partition_sort(low, high, cmp) {
		if (low >= high) return

		cmp ??= default_cmp
		let pivot = a[high]
		let left = low

		for (let right = low; right < high; right++) {
			if (cmp(a[right], pivot) < 0) {
				[a[left], a[right]] = [a[right], a[left]] // swap
				left++
			}
		}
		[a[left], a[high]] = [a[high], a[left]] // swap pivot into place

		partition_sort(low, left - 1, cmp)
		partition_sort(left + 1, high, cmp)
	}
	arena.arr_sort = function(i, cmp) {
		partition_sort(i+2, i+2+this.arr_len(i)-1, cmp)
	}

	arena.arr_set = function(i, at, v) {
		assert(at >= 0, 'invalid index ', at)
		assert(at < this.arr_len(i), 'invalid index ', at)
		a[i+2+at] = v
	}

	arena.arr_push = function(i, ...args) {
		let len0 = this.arr_len(i)
		i = this.arr_expand(i, args.length)
		for (let j = 0; j < args.length; j++)
			this.arr_set(i, len0 + j, args[j])
		return i
	}

	arena.map = function(est_len) {
		return this.arr(0, (est_len ?? 0) * 2)
	}

	arena.map_size = function(i) {
		return this.arr_len(i) / 2
	}

	arena.map_find = function(i, k) {
		let n = this.arr_len(i)
		if (n > 100) pr('map_find slow', n)
		for (let j = 0; j < n; j += 2) {
			if (this.arr_get(i, j) === k)
				return j
		}
	}

	arena.map_get = function(i, k) {
		let j = this.map_find(i, k)
		if (j == null) return
		return this.arr_get(i, j+1)
	}

	arena.map_set = function(i, k, v) {
		let j = this.map_find(i, k)
		if (j != null)  {
			this.arr_set(i, j+1, v)
		} else {
			i = this.arr_expand(i, 2)
			let n = this.arr_len(i)
			this.arr_set(i, n-2, k)
			this.arr_set(i, n-1, v)
		}
		return i
	}

	arena.map_keys = function*(i) {
		let n = this.arr_len(i)
		for (let j = 0; j < n; j += 2)
			yield this.arr_get(i, j)
	}

	arena.map_values = function*(i) {
		let n = this.arr_len(i)
		for (let j = 0; j < n; j += 2)
			yield this.arr_get(i, j+1)
	}

	arena.map_entries = function*(i) {
		let n = this.arr_len(i)
		for (let j = 0; j < n; j += 2)
			yield [this.arr_get(i, j), this.arr_get(i, j+1)]
	}

	arena.set = function(est_len) {
		return this.arr(0, est_len)
	}

	arena.set_has = function(i, v) {
		return this.arr_find(i, v) != null
	}

	arena.set_add = function(i, v) {
		return this.set_has(i, v) ? i : this.arr_push(i, v)
	}

	arena.set_size = function(i) {
		return this.arr_len(i)
	}

	return arena
}

arena_test = function() {

ar = arena()

// simple values
let t = {}
let ti = ar.add(t)
assert(ar.get(ti) == t)

// dyn arrays
a = ar.arr(5, 10)
assert(ar.arr_len(a) == 5)
for (let i = 0; i < 5; i++)
	ar.arr_set(a, i, i)
for (let i = 100; i >= 1; i--)
	a = ar.arr_push(a, i)
ar.arr_sort(a)
for (let i = 1, n = ar.arr_len(a); i < n; i++)
	assert(ar.arr_get(a, i-1) <= ar.arr_get(a, i))
assert(ar.arr_len(a) == 5 + 100)
assert(ar.arr_capacity(a) == nextpow2(100))
assert(a == 1) // not reallocated
assert(ar.arr_binsearch(a, 50) == 54)

// maps
m = ar.map()
m = ar.map_set(m, 'a', 3)
m = ar.map_set(m, 'b', 5)
m = ar.map_set(m, 'a', 7)
assert(ar.map_size(m) == 2)
{
let a = []
let b = ['a', 7, 'b', 5]
for (let [k, v] of ar.map_entries(m)) a.push(k, v)
for (let i = 0; i < 4; i++) assert(a[i] == b[i])
}

// sets
s = ar.set()
s = ar.set_add(s, 'a')
s = ar.set_add(s, 'b')
s = ar.set_add(s, 'a')
assert( ar.set_size(s) == 2)
assert( ar.set_has(s, 'a'))
assert( ar.set_has(s, 'b'))
assert(!ar.set_has(s, 'c'))

pr('arena tests passed')
}

if (0)
arena_test()

function benchmark() {
	let n = 1000 // array size; 4mil/sec on i3-4170
	let a = []; for (let i = 0; i < n; i++) a[i] = i
	let m = map(); for (let i = 0; i < n; i++) m.set(i, i)
	let v = n - 2

	console.time('arr')
	assert(a.indexOf(v) == v) // O(n)
	console.timeEnd('arr')

	console.time('map')
	assert(m.get(v) == v) // O(1)
	console.timeEnd('map')
}

if (0)
for (let i = 1; i <= 3; i++)
	benchmark()

