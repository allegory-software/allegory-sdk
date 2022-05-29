pcall(require, "strict")
require"csv"

local errors = 0

local function testhandle(handle, correct_result)
  local result = {}
  for r in handle:lines() do
    if not r[1] then
      local r2 = {}
      for k, v in pairs(r) do r2[#r2+1] = k..":"..tostring(v) end
      table.sort(r2)
      r = r2
    end
    result[#result+1] = table.concat(r, ",")
  end

  handle:close()

  result = table.concat(result, "!\n").."!"
  if result ~= correct_result then
    io.stderr:write(
      ("Error reading '%s':\nExpected output:\n%s\n\nActual output:\n%s\n\n"):
      format(handle:name(), correct_result, result))
    errors = errors + 1
  return false
  end
  return true
end

local function test(filename, correct_result, parameters)
  filename = 'csv_test/'..filename
  parameters = parameters or {}
  for i = 1, 16 do
    parameters.buffer_size = i
    local f = csv_open(filename, parameters)
    local fileok = testhandle(f, correct_result)

    if fileok then
      f = io.open(filename, "r")
      local data = f:read("*a")
      f:close()

      f = csv_openstring(data, parameters)
      testhandle(f, correct_result)
    end
  end
end

test("embedded-newlines.csv", [[
embedded
newline,embedded
newline,embedded
newline!
embedded
newline,embedded
newline,embedded
newline!]])

test("embedded-quotes.csv", [[
embedded "quotes",embedded "quotes",embedded "quotes"!
embedded "quotes",embedded "quotes",embedded "quotes"!]])

test("header.csv", [[
alpha:ONE,bravo:two,charlie:3!
alpha:four,bravo:five,charlie:6!]], {header=true})

test("header.csv", [[
apple:one,charlie:30!
apple:four,charlie:60!]],
{ columns = {
  apple = { name = "ALPHA", transform = string.lower },
  charlie = { transform = function(x) return tonumber(x) * 10 end }}})

test("blank-line.csv", [[
this,file,ends,with,a,blank,line!]])

test("BOM.csv", [[
apple:one,charlie:30!
apple:four,charlie:60!]],
{ columns = {
  apple = { name = "ALPHA", transform = string.lower },
  charlie = { transform = function(x) return tonumber(x) * 10 end }}})

test("bars.txt", [[
there's a comma in this field, but no newline,embedded
newline,embedded
newline!
embedded
newline,embedded
newline,embedded
newline!]])


if errors == 0 then
  io.stdout:write("Passed\n")
elseif errors == 1 then
  io.stdout:write("1 error\n")
else
  io.stdout:write(("%d errors\n"):format(errors))
end

os.exit(errors)
