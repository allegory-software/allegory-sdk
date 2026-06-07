--[[

	utf8proc binding: utf8 utitilties
	Written by Cosmin Apreutesei. Public Domain.

	Features:
		- utf8 compose/decompose
		- canonicalize compat chars
		- strip ignorables, control chars, combining chars (accents)
		- case-folding
		- NFD/NFC/NFKD/NFKC normalization
		- grapheme split
		- char-width
		- char classification
		- utf-8 to/from codepoints

	API:

]]

require'glue'
local C = ffi.load'utf8proc'

UTF8_NULLTERM   = shl(1,0)
UTF8_STABLE     = shl(1,1)
UTF8_COMPAT     = shl(1,2)
UTF8_COMPOSE    = shl(1,3)
UTF8_DECOMPOSE  = shl(1,4)
UTF8_IGNORE     = shl(1,5)
UTF8_REJECTNA   = shl(1,6)
UTF8_NLF2LS     = shl(1,7)
UTF8_NLF2PS     = shl(1,8)
UTF8_NLF2LF     = bor(UTF8_NLF2LS, UTF8_NLF2PS)
UTF8_STRIPCC    = shl(1,9)
UTF8_CASEFOLD   = shl(1,10)
UTF8_CHARBOUND  = shl(1,11)
UTF8_LUMP       = shl(1,12)
UTF8_STRIPMARK  = shl(1,13)
UTF8_STRIPNA    = shl(1,14)

UTF8_ERROR_NOMEM       = -1
UTF8_ERROR_OVERFLOW    = -2
UTF8_ERROR_INVALIDUTF8 = -3
UTF8_ERROR_NOTASSIGNED = -4
UTF8_ERROR_INVALIDOPTS = -5

UTF8_CATEGORY_CN  = 0
UTF8_CATEGORY_LU  = 1
UTF8_CATEGORY_LL  = 2
UTF8_CATEGORY_LT  = 3
UTF8_CATEGORY_LM  = 4
UTF8_CATEGORY_LO  = 5
UTF8_CATEGORY_MN  = 6
UTF8_CATEGORY_MC  = 7
UTF8_CATEGORY_ME  = 8
UTF8_CATEGORY_ND  = 9
UTF8_CATEGORY_NL = 10
UTF8_CATEGORY_NO = 11
UTF8_CATEGORY_PC = 12
UTF8_CATEGORY_PD = 13
UTF8_CATEGORY_PS = 14
UTF8_CATEGORY_PE = 15
UTF8_CATEGORY_PI = 16
UTF8_CATEGORY_PF = 17
UTF8_CATEGORY_PO = 18
UTF8_CATEGORY_SM = 19
UTF8_CATEGORY_SC = 20
UTF8_CATEGORY_SK = 21
UTF8_CATEGORY_SO = 22
UTF8_CATEGORY_ZS = 23
UTF8_CATEGORY_ZL = 24
UTF8_CATEGORY_ZP = 25
UTF8_CATEGORY_CC = 26
UTF8_CATEGORY_CF = 27
UTF8_CATEGORY_CS = 28
UTF8_CATEGORY_CO = 29

UTF8_BIDI_CLASS_L     = 1
UTF8_BIDI_CLASS_LRE   = 2
UTF8_BIDI_CLASS_LRO   = 3
UTF8_BIDI_CLASS_R     = 4
UTF8_BIDI_CLASS_AL    = 5
UTF8_BIDI_CLASS_RLE   = 6
UTF8_BIDI_CLASS_RLO   = 7
UTF8_BIDI_CLASS_PDF   = 8
UTF8_BIDI_CLASS_EN    = 9
UTF8_BIDI_CLASS_ES   = 10
UTF8_BIDI_CLASS_ET   = 11
UTF8_BIDI_CLASS_AN   = 12
UTF8_BIDI_CLASS_CS   = 13
UTF8_BIDI_CLASS_NSM  = 14
UTF8_BIDI_CLASS_BN   = 15
UTF8_BIDI_CLASS_B    = 16
UTF8_BIDI_CLASS_S    = 17
UTF8_BIDI_CLASS_WS   = 18
UTF8_BIDI_CLASS_ON   = 19
UTF8_BIDI_CLASS_LRI  = 20
UTF8_BIDI_CLASS_RLI  = 21
UTF8_BIDI_CLASS_FSI  = 22
UTF8_BIDI_CLASS_PDI  = 23

UTF8_DECOMP_TYPE_FONT      = 1
UTF8_DECOMP_TYPE_NOBREAK   = 2
UTF8_DECOMP_TYPE_INITIAL   = 3
UTF8_DECOMP_TYPE_MEDIAL    = 4
UTF8_DECOMP_TYPE_FINAL     = 5
UTF8_DECOMP_TYPE_ISOLATED  = 6
UTF8_DECOMP_TYPE_CIRCLE    = 7
UTF8_DECOMP_TYPE_SUPER     = 8
UTF8_DECOMP_TYPE_SUB       = 9
UTF8_DECOMP_TYPE_VERTICAL = 10
UTF8_DECOMP_TYPE_WIDE     = 11
UTF8_DECOMP_TYPE_NARROW   = 12
UTF8_DECOMP_TYPE_SMALL    = 13
UTF8_DECOMP_TYPE_SQUARE   = 14
UTF8_DECOMP_TYPE_FRACTION = 15
UTF8_DECOMP_TYPE_COMPAT   = 16

UTF8_BOUNDCLASS_START              =  0
UTF8_BOUNDCLASS_OTHER              =  1
UTF8_BOUNDCLASS_CR                 =  2
UTF8_BOUNDCLASS_LF                 =  3
UTF8_BOUNDCLASS_CONTROL            =  4
UTF8_BOUNDCLASS_EXTEND             =  5
UTF8_BOUNDCLASS_L                  =  6
UTF8_BOUNDCLASS_V                  =  7
UTF8_BOUNDCLASS_T                  =  8
UTF8_BOUNDCLASS_LV                 =  9
UTF8_BOUNDCLASS_LVT                = 10
UTF8_BOUNDCLASS_REGIONAL_INDICATOR = 11
UTF8_BOUNDCLASS_SPACINGMARK        = 12
UTF8_BOUNDCLASS_PREPEND            = 13
UTF8_BOUNDCLASS_ZWJ                = 14
UTF8_BOUNDCLASS_E_BASE             = 15
UTF8_BOUNDCLASS_E_MODIFIER         = 16
UTF8_BOUNDCLASS_GLUE_AFTER_ZWJ     = 17
UTF8_BOUNDCLASS_E_BASE_GAZ         = 18
UTF8_BOUNDCLASS_EXTENDED_PICTOGRAPHIC = 19
UTF8_BOUNDCLASS_E_ZWG              = 20

UTF8_INDIC_CONJUNCT_BREAK_NONE      = 0
UTF8_INDIC_CONJUNCT_BREAK_LINKER    = 1
UTF8_INDIC_CONJUNCT_BREAK_CONSONANT = 2
UTF8_INDIC_CONJUNCT_BREAK_EXTEND    = 3

cdef[[
typedef int32_t utf8proc_option_t;
typedef int16_t utf8proc_propval_t;

typedef struct utf8proc_property_struct {
  utf8proc_propval_t category;
  utf8proc_propval_t combining_class;
  utf8proc_propval_t bidi_class;
  utf8proc_propval_t decomp_type;
  uint16_t decomp_seqindex;
  uint16_t casefold_seqindex;
  uint16_t uppercase_seqindex;
  uint16_t lowercase_seqindex;
  uint16_t titlecase_seqindex;
  uint16_t comb_index:10;
  uint16_t comb_length:5;
  uint16_t comb_issecond:1;
  unsigned bidi_mirrored:1;
  unsigned comp_exclusion:1;
  unsigned ignorable:1;
  unsigned control_boundary:1;
  unsigned charwidth:2;
  unsigned ambiguous_width:1;
  unsigned pad:1;
  unsigned boundclass:6;
  unsigned indic_conjunct_break:2;
} utf8proc_property_t;

typedef int32_t (*utf8proc_custom_func)(int32_t codepoint, void *data);
extern const int8_t utf8proc_utf8class[256];
const char *utf8proc_version(void);
const char *utf8proc_unicode_version(void);
const char *utf8proc_errmsg(ptrdiff_t errcode);
ptrdiff_t utf8proc_iterate(const uint8_t *str, ptrdiff_t strlen, int32_t *codepoint_ref);
bool utf8proc_codepoint_valid(int32_t codepoint);
ptrdiff_t utf8proc_encode_char(int32_t codepoint, uint8_t *dst);
const utf8proc_property_t *utf8proc_get_property(int32_t codepoint);
ptrdiff_t utf8proc_decompose_char(
  int32_t codepoint, int32_t *dst, ptrdiff_t bufsize,
  utf8proc_option_t options, int *last_boundclass
);
ptrdiff_t utf8proc_decompose(
  const uint8_t *str, ptrdiff_t strlen,
  int32_t *buffer, ptrdiff_t bufsize, utf8proc_option_t options
);
ptrdiff_t utf8proc_decompose_custom(
  const uint8_t *str, ptrdiff_t strlen,
  int32_t *buffer, ptrdiff_t bufsize, utf8proc_option_t options,
  utf8proc_custom_func custom_func, void *custom_data
);
ptrdiff_t utf8proc_normalize_utf32(int32_t *buffer, ptrdiff_t length, utf8proc_option_t options);
ptrdiff_t utf8proc_reencode(int32_t *buffer, ptrdiff_t length, utf8proc_option_t options);
bool utf8proc_grapheme_break_stateful(int32_t codepoint1, int32_t codepoint2, int32_t *state);
bool utf8proc_grapheme_break(int32_t codepoint1, int32_t codepoint2);
int32_t utf8proc_tolower(int32_t c);
int32_t utf8proc_toupper(int32_t c);
int32_t utf8proc_totitle(int32_t c);
int utf8proc_islower(int32_t c);
int utf8proc_isupper(int32_t c);
int utf8proc_charwidth(int32_t codepoint);
bool utf8proc_charwidth_ambiguous(int32_t codepoint);
int32_t utf8proc_category(int32_t codepoint);
const char *utf8proc_category_string(int32_t codepoint);
ptrdiff_t utf8proc_map(const uint8_t *str, ptrdiff_t strlen,
	uint8_t **dstptr, utf8proc_option_t options
);
ptrdiff_t utf8proc_map_custom(
  const uint8_t *str, ptrdiff_t strlen, uint8_t **dstptr, utf8proc_option_t options,
  utf8proc_custom_func custom_func, void *custom_data
);
uint8_t *utf8proc_NFD(const uint8_t *str);
uint8_t *utf8proc_NFC(const uint8_t *str);
uint8_t *utf8proc_NFKD(const uint8_t *str);
uint8_t *utf8proc_NFKC(const uint8_t *str);
uint8_t *utf8proc_NFKC_Casefold(const uint8_t *str);
]]

-- const char *C.utf8proc_errmsg(ptrdiff_t errcode);

function utf8_unicode_version()
	return str(C.utf8proc_unicode_version())
end

local cp = new'int32_t[1]'
function utf8_codepoints(s, len)
	local p = cast(u8p, s)
	local sz = sz or #s
	return function()
		if sz <= 0 then return nil end
		local read_sz = C.utf8proc_iterate(p, sz, cp)
		if read_sz > 0 then
			p  = p  + read_sz
			sz = sz - read_sz
			return cp[0]
		else
			sz = 0
			return nil
		end
	end
end

function utf8_codepoint_valid(cp)
	return C.utf8proc_codepoint_valid(cp) == 1
end

function utf8_encode_char(cp, out)
	return C.utf8proc_encode_char(cp, out)
end

utf8_get_property    = C.utf8proc_get_property
utf8_decompose_char  = C.utf8proc_decompose_char
utf8_decompose       = C.utf8proc_decompose
utf8_normalize_utf32 = C.utf8proc_normalize_utf32
utf8_reencode        = C.utf8proc_reencode
utf8_grapheme_break_stateful = C.utf8proc_grapheme_break_stateful
utf8_grapheme_break  = C.utf8proc_grapheme_break
utf8_tolower         = C.utf8proc_tolower
utf8_toupper         = C.utf8proc_toupper
utf8_totitle         = C.utf8proc_totitle
utf8_islower         = C.utf8proc_islower
utf8_isupper         = C.utf8proc_isupper
utf8_charwidth       = C.utf8proc_charwidth
utf8_charwidth_ambiguous = C.utf8proc_charwidth_ambiguous
utf8_category        = C.utf8proc_category
utf8_category_string = function(cp) return str(C.utf8proc_category_string(cp)) end
utf8_NFD             = C.utf8proc_NFD
utf8_NFC             = C.utf8proc_NFC
utf8_NFKD            = C.utf8proc_NFKD
utf8_NFKC            = C.utf8proc_NFKC
utf8_NFKC_Casefold   = C.utf8proc_NFKC_Casefold
