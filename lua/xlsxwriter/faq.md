### Can XlsxWriter use an existing Excel file as a template?

No. Xlsxwriter is designed only as a file *writer*. It cannot read or modify
an existing Excel file.

### Why do my formulas show a zero result in some, non-Excel applications?

Due to wide range of possible formulas and interdependencies between
them `xlsxwriter` doesn\'t, and realistically cannot, calculate the
result of a formula when it is written to an XLSX file. Instead, it
stores the value 0 as the formula result. It then sets a global flag in
the XLSX file to say that all formulas and functions should be
recalculated when the file is opened.

This is the method recommended in the Excel documentation and in general
it works fine with spreadsheet applications. However, applications that
don\'t have a facility to calculate formulas, such as Excel Viewer, or
several mobile applications, will only display the 0 results.

If required, it is also possible to specify the calculated result of the
formula using the optional `value` parameter in
`write_formula()`{.interpreted-text role="func"}:

    worksheet:write_formula('A1', '=2+2', num_format, 4)

### Can I apply a format to a range of cells in one go?

Currently no. However, it is a planned features to allow cell formats
and data to be written separately.

### Is feature X supported or will it be supported?

All supported features are documented. In time the feature set should
expand to be the same as the [Python XlsxWriter](http://xlsxwriter.readthedocs.org) module.

### Is there an \"AutoFit\" option for columns?

Unfortunately, there is no way to specify \"AutoFit\" for a column in
the Excel file format. This feature is only available at runtime from
within Excel. It is possible to simulate \"AutoFit\" by tracking the
width of the data in the column as your write it.
