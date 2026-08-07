--[[

	MDBX incremental backup.
	Written by Cosmin Apreutesei. Public Domain.

API
	db:backup(destination_file[, base_backup_file])
	mdbx_restore(source_file, destination_file[, base_backup_file])

AS SCRIPT
	luajit mdbx_backup.lua backup DB_FILE BACKUP_FILE [BASE_BACKUP_FILE]
	luajit mdbx_backup.lua restore BACKUP_FILE DB_FILE [BASE_BACKUP_FILE]

]]

require'mdbx'
require'fs'
require'pbuffer'
require'proc'
require'blake3'

local
	assertf, assert, band, memcmp, min, num =
	assertf, assert, bit.band, memcmp, min, num

local Db = mdbx_db
local MAGIC = 'MDBXDIFF'
local VERSION = 1
local HASH_SIZE = 32 --bytes
local MAX_RUN_PAGES = 256
local COPY_BUF_SIZE = 64 * 1024^2
local mdbx_copy_file = indir(exedir(), 'mdbx_copy')

local function open_snapshot(file)
	local p = exec{
		cmd = {mdbx_copy_file, '-q', '-n', file},
		stdout = true,
		autokill = true,
	}
	return p, pbuffer{f = p.stdout}
end

local function finish_snapshot(p)
	p.stdout:close()
	local code, err = p:wait()
	assertf(code == 0, 'mdbx_copy failed: %s', err or code)
	p:forget()
end

local function buffer_reader(pb, finish, digest)
	local len
	return function()
		if len then
			pb:skip(len)
			len = nil
		end
		if pb:have(1) then
			local p
			p, len = pb:ref()
			if digest then digest:update(p, len) end
			return p, len
		end
		finish()
		return nil, 0
	end
end

local function validate_db(file)
	local db = mdbx_open(file, {readonly = true})
	local ok, problem_count = db:check()
	assertf(ok, 'restored database has %d problems', problem_count)
	db:close()
	rmfile(file..'-lck', false)
end

local function write_buffer(write, out)
	local p, len = out:ref()
	assert(write(p, len))
	out:reset()
end

local function backup_full(db, backup_file)
	local p, pb = open_snapshot(db.file)
	save(backup_file, buffer_reader(pb, function()
		finish_snapshot(p)
	end))
end

local function backup_incremental(db, backup_file, base_backup_file,
		page_size)
	local base = must_open(base_backup_file)
	assertf(base:size() % page_size == 0,
		'full backup size is not a multiple of its page size')
	local base_pb = pbuffer{f = base}
	local snapshot, current = open_snapshot(db.file)
	local write = file_saver(backup_file)
	local out = pbuffer()
	local changed_pages = pbuffer()
	local base_digest = blake3_state()
	local current_digest = blake3_state()
	local zero_page = u8a(page_size)
	local page = 0
	local run_first
	local run_count = 0

	local function flush_run()
		if run_count == 0 then return end
		out:put_u8(1):put_u64_le(run_first):put_u32_le(run_count)
		local p, len = changed_pages:ref()
		out:putdata(p, len)
		changed_pages:reset()
		run_first = nil
		run_count = 0
		if #out >= COPY_BUF_SIZE then write_buffer(write, out) end
	end

	out:putdata(MAGIC):put_u8(VERSION):put_u32_le(page_size)
	while current:have(1) do
		current:need(page_size)
		local current_page = current:ref()
		current_digest:update(current_page, page_size)
		local has_base_page = base_pb:have(1)
		local base_page = zero_page
		if has_base_page then
			base_pb:need(page_size)
			base_page = base_pb:ref()
			base_digest:update(base_page, page_size)
		end
		if memcmp(current_page, base_page, page_size) ~= 0 then
			run_first = run_first or page
			changed_pages:putdata(current_page, page_size)
			run_count = run_count + 1
			if run_count == MAX_RUN_PAGES then flush_run() end
		else
			flush_run()
		end
		current:skip(page_size)
		if has_base_page then base_pb:skip(page_size) end
		page = page + 1
	end
	flush_run()
	finish_snapshot(snapshot)
	while base_pb:have(1) do
		local p, len = base_pb:ref()
		base_digest:update(p, len)
		base_pb:skip(len)
	end
	base:close()
	out:put_u8(0):put_u64_le(page * page_size)
	out:putdata(base_digest:finalize())
	out:putdata(current_digest:finalize())
	write_buffer(write, out)
	assert(write(nil, 0))
end

function Db:backup(backup_file, base_backup_file)
	assert(self.env, 'closed')
	assert(not self.txn, 'in transaction')
	assertf(abspath(backup_file) ~= abspath(self.file),
		'backup path is the database path')
	if base_backup_file then
		assertf(abspath(backup_file) ~= abspath(base_backup_file),
			'incremental backup path is the full backup path')
		assertf(abspath(base_backup_file) ~= abspath(self.file),
			'full backup path is the database path')
		local stat = new'MDBX_stat'
		self:checkz('db_stat', mdbx.mdbx_env_stat_ex(
			self.env, nil, stat, sizeof(stat)))
		backup_incremental(self, backup_file, base_backup_file,
			tonumber(stat.psize))
	else
		backup_full(self, backup_file)
	end
	return true
end

local function read_delta(delta, out, delta_size)
	delta:need(#MAGIC + 5)
	assertf(delta:get(#MAGIC) == MAGIC, 'invalid incremental backup')
	assertf(delta:get_u8() == VERSION,
		'unsupported incremental backup version')
	local page_size = tonumber(delta:get_u32_le())
	assertf(page_size >= 256 and page_size <= 65536
		and band(page_size, page_size - 1) == 0,
		'invalid incremental backup page size')
	local max_run_pages = math.floor(delta_size / page_size)
	local next_page = 0
	while true do
		delta:need(1)
		local tag = delta:get_u8()
		if tag == 0 then
			delta:need(8 + HASH_SIZE * 2)
			local final_size = num(delta:get_u64_le())
			local base_hash = delta:get(HASH_SIZE)
			local current_hash = delta:get(HASH_SIZE)
			assertf(final_size % page_size == 0,
				'invalid incremental backup size')
			assertf(next_page <= final_size / page_size,
				'incremental backup writes past its final size')
			assertf(not delta:have(1),
				'trailing incremental backup data')
			return page_size, final_size, base_hash, current_hash
		elseif tag == 1 then
			delta:need(12)
			local first_page = num(delta:get_u64_le())
			local page_count = tonumber(delta:get_u32_le())
			assertf(page_count > 0 and page_count <= max_run_pages,
				'invalid incremental backup run size')
			assertf(first_page >= next_page,
				'overlapping incremental backup runs')
			next_page = first_page + page_count
			out:seek('set', first_page * page_size)
			while page_count > 0 do
				local n = min(page_count, MAX_RUN_PAGES)
				local size = n * page_size
				delta:need(size)
				local p = delta:ref()
				out:write(p, size)
				delta:skip(size)
				page_count = page_count - n
			end
		else
			assertf(false, 'invalid incremental backup record')
		end
	end
end

local function restore_full(backup_file, db_file)
	local stage = db_file..'~restore'
	local backup = must_open(backup_file)
	local pb = pbuffer{f = backup}
	save(stage, buffer_reader(pb, function() backup:close() end))
	validate_db(stage)
	rename(stage, db_file, nil, true)
end

local function restore_incremental(backup_file, db_file, base_backup_file)
	local stage = db_file..'~restore'
	local base = must_open(base_backup_file)
	local base_size = base:size()
	local base_digest = blake3_state()
	local base_pb = pbuffer{f = base}
	save(stage, buffer_reader(base_pb, function() base:close() end,
		base_digest))
	local out = must_open(stage, 'r+')
	local delta_file = must_open(backup_file)
	local delta = pbuffer{f = delta_file}
	local page_size, final_size, base_hash, current_hash =
		read_delta(delta, out, delta_file:size())
	assertf(base_size % page_size == 0,
		'full backup size is not a multiple of its page size')
	assertf(base_digest:finalize() == base_hash,
		'incremental backup has a different full backup')
	out:truncate(final_size)
	out:sync()
	out:close()
	delta_file:close()
	local digest = blake3_state()
	local restored = must_open(stage)
	local restored_pb = pbuffer{f = restored}
	while restored_pb:have(1) do
		local p, len = restored_pb:ref()
		digest:update(p, len)
		restored_pb:skip(len)
	end
	restored:close()
	assertf(digest:finalize() == current_hash,
		'incremental backup contents are damaged')
	validate_db(stage)
	rename(stage, db_file, nil, true)
end

function mdbx_restore(backup_file, db_file, base_backup_file)
	assertf(abspath(backup_file) ~= abspath(db_file),
		'backup path is the database path')
	if base_backup_file then
		restore_incremental(backup_file, db_file, base_backup_file)
	else
		restore_full(backup_file, db_file)
	end
	return true
end

if not package.loaded.mdbx_backup then
	local command, source_file, destination_file, base_backup_file = ...
	assert((command == 'backup' or command == 'restore')
		and source_file and destination_file,
		'\nUsage:\n\n'..
		'  luajit mdbx_backup.lua backup DB_FILE BACKUP_FILE [BASE_BACKUP_FILE]\n'..
		'  luajit mdbx_backup.lua restore BACKUP_FILE DB_FILE [BASE_BACKUP_FILE]\n'
	)
	run(function()
		if command == 'backup' then
			local db, err = mdbx_open(source_file, {readonly = true})
			assertf(not err, 'cannot open database: %s', err)
			db:backup(destination_file, base_backup_file)
			db:close()
		else
			mdbx_restore(source_file, destination_file, base_backup_file)
		end
	end)
end
