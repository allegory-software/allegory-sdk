--[[

	run_indir(dir, fn)                            run function in specified cwd

]]

function run_indir(dir, fn, ...)
	local cwd = cwd()
	chdir(dir)
	local function pass(ok, ...)
		chdir(cwd)
		if ok then return ... end
		error(..., 2)
	end
	return pass(pcall(fn, ...))
end
