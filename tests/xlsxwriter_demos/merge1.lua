----
--
-- A simple example of merging cells with the xlsxwriter Lua module.
--
-- Copyright 2014-2015, John McNamara, jmcnamara@cpan.org
--

local Workbook = require "xlsxwriter.workbook"

local workbook  = Workbook:new("merge1.xlsx")
local worksheet = workbook:add_worksheet()

-- Increase the cell size of the merged cells to highlight the formatting.
worksheet:set_column("B:D", 12)
worksheet:set_row(3, 30)
worksheet:set_row(6, 30)
worksheet:set_row(7, 30)

-- Create a format to use in the merged range.
merge_format = workbook:add_format({
    bold     = true,
    border   = 1,
    align    = "center",
    valign   = "vcenter",
    fg_color = "yellow"})

-- Merge 3 cells.
worksheet:merge_range("B4:D4", "Merged Range", merge_format)

-- Merge 3 cells over two rows.
worksheet:merge_range("B7:D8", "Merged Range", merge_format)

workbook:close()
