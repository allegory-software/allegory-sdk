
## `local decnumber = require'ldecnumber'`

Decimal arithmetic based on IBM's decNumber.

## Example

Single user billing system

```lua
local decnumber = require'ldecnumber'

local balance = decnumber.tonumber'0.00'

balance = balance + '0.01'
balance = balance + '1.25'
balance = balance - '1.12'

balance:isfinite() --> true
balance:isinfinite() --> false
balance:isnan() --> false

balance:tostring() --> '0.14'
```

## API

[ldecNumber docs here](https://htmlpreview.github.io/?https://github.com/tarantool/ldecnumber/blob/master/doc/ldecNumber.html)

[decNumber docs here](http://speleotrove.com/decimal/decnumber.html)

Two methods added: `dn:frompacked()` and `dn:topacked()` for working with
[tarantool](tarantool.md).
