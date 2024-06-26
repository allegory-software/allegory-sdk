
assert(package.loaded.proc)
assert(Windows, 'platform not Windows')

local proc = {type = 'process', debug_prefix = 'p'}
proc.__index = proc

--TODO: move relevant ctypes here and get rid of the winapi dependency
--(not worth it unless you are really really bored).
local winapi = require'winapi'
require'winapi.process'
require'winapi.thread'

function env(k, v)
	if k then
		if v ~= nil then
			winapi.SetEnvironmentVariable(k, v)
		else
			return winapi.GetEnvironmentVariable(k)
		end
	end
	local t = {}
	for i,s in ipairs(winapi.GetEnvironmentStrings()) do
		local k,v = s:match'^([^=]*)=(.*)'
		if k and k ~= '' then --the first two ones are internal and invalid.
			t[k] = v
		end
	end
	return t
end

local autokill_job

local error_classes = {
	[0x002] = 'not_found'     , --ERROR_FILE_NOT_FOUND
	[0x005] = 'access_denied' , --ERROR_ACCESS_DENIED
}

function _exec(cmd, env, dir, stdin, stdout, stderr, autokill, inherit_handles)

	inherit_handles = repl(inherit_handles, nil, true)

	if istab(cmd) then
		local t = {}
		t[1] = cmdline_quote_path_win(cmd[1])
		for i = 2, cmd.n or #cmd do
			if cmd[i] then --nil and false args are skipped. pass '' to inject empt args.
				t[#t+1] = cmdline_quote_arg_win(cmd[i])
			end
		end
		cmd = concat(t, ' ')
	end

	local inp_rf, inp_wf
	local out_rf, out_wf
	local err_rf, err_wf

	local self = setmetatable({cmd = cmd}, proc)

	local function close_all()
		if inp_rf then inp_rf:close() end
		if inp_wf then inp_wf:close() end
		if out_rf then out_rf:close() end
		if out_wf then out_wf:close() end
		if err_rf then err_rf:close() end
		if err_wf then err_wf:close() end
	end

	local si

	if stdin or stdout or stderr then

		--NOTE: there's no way to inherit only the std handles: all handles
		--declared inheritable in the parent process will be inherited!
		assert(inherit_handles)

		if stdin == true then
			inp_rf, inp_wf = try_pipe{
				async_read = false,
				read_inheritable = true,
			}
			if not inp_rf then
				local err = inp_wf; inp_wf = nil
				close_all()
				return nil, err
			end
			self.stdin = inp_wf
		elseif stdin then
			assert(stdin.type == 'pipe')
			stdin:set_inheritable(true)
			inp_rf = stdin
		end

		if stdout == true then
			out_rf, out_wf = try_pipe{
				async_write = false,
				write_inheritable = true,
			}
			if not out_rf then
				local err = out_wf; out_wf = nil
				close_all()
				return nil, err
			end
			self.stdout = out_rf
		elseif stdout then
			assert(stdout.type == 'pipe')
			stdout:set_inheritable(true)
			out_wf = stdout
		end

		if stderr == true then
			err_rf, err_wf = try_pipe{
				async_write = false,
				write_inheritable = true,
			}
			if not err_rf then
				local err = err_wf; err_wf = nil
				close_all()
				return nil, err
			end
			self.stderr = err_rf
		elseif stderr then
			assert(stderr.type == 'pipe')
			stderr:set_inheritable(true)
			err_wf = stderr
		end

		si = winapi.STARTUPINFO()
		si.hStdInput  = inp_rf and inp_rf.handle or winapi.GetStdHandle(winapi.STD_INPUT_HANDLE)
		si.hStdOutput = out_wf and out_wf.handle or winapi.GetStdHandle(winapi.STD_OUTPUT_HANDLE)
		si.hStdError  = err_wf and err_wf.handle or winapi.GetStdHandle(winapi.STD_ERROR_HANDLE)
		si.dwFlags = winapi.STARTF_USESTDHANDLES

	end

	if autokill and not autokill_job then
		autokill_job = winapi.CreateJobObject()
		local jeli = winapi.JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
		jeli.BasicLimitInformation.LimitFlags = winapi.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		winapi.SetInformationJobObject(autokill_job, winapi.C.JobObjectExtendedLimitInformation, jeli)
	end

	local is_in_job = autokill and winapi.IsProcessInJob(winapi.GetCurrentProcess(), nil)

	local pi, err, errcode = winapi.CreateProcess(
		cmd, env, dir, si, inherit_handles,
			autokill
				and bor(
					winapi.CREATE_SUSPENDED, --so we can add it to a job before it starts
					is_in_job and winapi.CREATE_BREAKAWAY_FROM_JOB or 0
				)
				or nil)

	if not pi then
		close_all()
		return nil, error_classes[errcode] or err
	end

	if autokill then
		winapi.AssignProcessToJobObject(autokill_job, pi.hProcess)
		winapi.ResumeThread(pi.hThread)
	end

	--Let the child process have the only handles to their pipe ends,
	--otherwise when the child process exits, the pipes will stay open on
	--account of us (the parent process) holding a handle to them.
	if inp_rf then inp_rf:close() end
	if out_wf then out_wf:close() end
	if err_wf then err_wf:close() end

	self.handle             = pi.hProcess
	self.main_thread_handle = pi.hThread
	self.pid                = pi.dwProcessId
	self.main_thread_id     = pi.dwThreadId

	log('', 'proc', 'exec', '%s %s', self, cmd)
	live(self, '%s', cmd)

	return self
end

function proc:forget()
	if self.stdin  then self.stdin :close() end
	if self.stdout then self.stdout:close() end
	if self.stderr then self.stderr:close() end
	if self.handle then
		assert(winapi.CloseHandle(self.handle))
		assert(winapi.CloseHandle(self.main_thread_handle))
		self.handle = false
		self.pid = false
		self.main_thread_handle = false
		self.main_thread_id = false
		live(self, nil)
	end
end

--compound the STILL_ACTIVE hack with another hack to signal killed status.
local EXIT_CODE_KILLED = winapi.STILL_ACTIVE + 1

function proc:kill()
	if not self.handle then
		return nil, 'forgotten'
	elseif self:status() == 'killed' then --otherwise we get "access denied".
		return nil, 'killed'
	end
	return winapi.TerminateProcess(self.handle, EXIT_CODE_KILLED)
end

function proc:exit_code()
	if self._exit_code then
		return self._exit_code
	elseif self._killed then
		return nil, 'killed'
	end
	if not self.handle then
		return nil, 'forgotten'
	end
	local exitcode = winapi.GetExitCodeProcess(self.handle)
	if not exitcode then
		return nil, 'active'
	end
	--save the exit status so we can forget the process.
	if exitcode == EXIT_CODE_KILLED then
		self._killed = true
	else
		self._exit_code = exitcode
	end
	return self:exit_code()
end

function proc:wait(expires, poll_interval)
	if not self.handle then
		return nil, 'forgotten'
	end
	while self:status() == 'active' and clock() < (expires or 1/0) do
		wait(poll_interval or .1)
	end
	local exit_code, err = self:exit_code()
	if exit_code then
		return exit_code
	else
		return nil, err
	end
end

function proc:status() --finished | killed | active | forgotten
	local code, err = self:exit_code()
	return code and 'finished' or err
end

function proc_info(pid)
	return {} --NYI
end

function proc:info()
	return procinfo(self.pid)
end

function os_info()
	return nil, 'NYI'
end
