
## `local xlsxwriter = require'xlsxwriter'`

Excel XLSX file generator for Excel 2007+.

### Features

* High degree of fidelity with files produced by Excel.
* Can write very large files with semi-constant memory.
* Full formatting.
* Merged cells.
* Worksheet setup methods.
* Defined names.
* Document properties.

### Limitations

It can only create **new files**. It cannot read or modify existing files.

## Example

```lua
local Workbook = require "xlsxwriter.workbook"

local workbook  = Workbook:new("demo.xlsx")
local worksheet = workbook:add_worksheet()

-- Widen the first column to make the text clearer.
worksheet:set_column("A:A", 20)

-- Add a bold format to use to highlight cells.
local bold = workbook:add_format({bold = true})

-- Write some simple text.
worksheet:write("A1", "Hello")

-- Text with formatting.
worksheet:write("A2", "World", bold)

-- Write some numbers, with row/column notation.
worksheet:write(2, 0, 123)
worksheet:write(3, 0, 123.456)

workbook:close()
```

## Documentation

Full documentation in the [lua/xlswriter](../..//tree/dev/lua/xlswriter) folder.
