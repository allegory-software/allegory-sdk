--[==[

	Language, Country and Currency support.
	Written by Cosmin Apreutesei. Public Domain.

LANG/COUNTRY/CURRENCY API

	lang([k])                          get current lang or lang property
	setlang(lang)                      set current lang
	default_lang()                     get default lang
	langs -> {lang->row}               langs table

	currency([k])                      get current currency or currency property
	setcurrency(currency)              set current currency
	default_currency()                 get default currency
	currencies -> {currency->row}      currencies table

	country([k])                       get current country or country property
	setcountry(country)                set current country
	default_country()                  get default country
	countries -> {country->row}        countries table

DATE & TIME FORMATTING

	date('*d[t][s]', [t], [country]) -> s      format date/time for (current) country
	duration(s, ['approx[+s]'|'long']) -> s    format a duration in seconds
	timeago([utc, ]t[, from_t]) -> s           format relative time
	timeofday(['s']) -> s                      format time of day
	week_start([country]) -> n                 week start in country; 0=Sunday

LANG/COUNTRY/CURRENCY DB SCHEMA

	lang_schema()

MULTI-LANG STRINGS IN SOURCE CODE

USING
	S(id, en_s, ...) -> s              get Lua string in current language
	Sf(id, en_s) -> f(...) -> s        create a getter for a string in current language
	S_for(ext, id, en_s, ...) -> s     get Lua/JS/HTML string in current language
TRANSLATING
	S_texts(lang, ext) -> {id->s}      get translated strings
	S_texts_update(lang, ext, id, s)   update a translated string
	S_texts_save()                     save translated strings that were updated
COLLECTING
	S_ids                              S-id in-memory database
	S_ids_add_id(ext, file, id, en_s)  add an S-id manually
	S_ids_add_lua(file, s)             parse Lua code for S() calls

TODO:
	- decimal separators for rare languages.
	- date formats.
	- week days in all languages (both abbreviated and normal form).

]==]

require'glue'
require'sock'   --[own]threadenv()
require'fs'     --load(), save()
require'query'  --$lang() etc. macros
require'schema' --lang_schema()

--lang, country, currency API ------------------------------------------------

--https://en.wikipedia.org/wiki/Languages_used_on_the_Internet
--https://meta.wikimedia.org/wiki/Template:List_of_language_names_ordered_by_code
local lang_cols = {'lang', 'rtl', 'en_name', 'name', 'decimal_separator', 'thousands_separator'}
local lang_rows = {
	{'en', false, 'English'    , 'English',          '.', ',', true},
	{'ru', false, 'Russian'    , 'Русский',          ',', '.', false},
	{'tr', false, 'Turkish'    , 'Türkçe',           ',', '.', false},
	{'es', false, 'Spanish'    , 'Español',          ',', '.', false},
	{'fa', true , 'Persian'    , 'فارسی',              '٫' , '٬', false},
	{'fr', false, 'French'     , 'Français',         ',', '.', false},
	{'de', false, 'German'     , 'Deutsch',          ',', '.', false},
	{'ja', false, 'Japanese'   , '日本語',             '.', ',', false},
	{'vi', false, 'Vietnamese' , 'Việtnam',          ',', '.', false},
	{'zh', false, 'Chinese'    , '中文',              '.', ',', false},
	{'ar', true , 'Arabic'     , 'العربية',              '٫‎' , '٬', false},
	{'pt', false, 'Portuguese' , 'Português',        ',', '.', false},
	{'el', false, 'Greek'      , 'Ελληνικά',         ',', '.', false},
	{'it', false, 'Italian'    , 'Italiano',         ',', '.', false},
	{'id', false, 'Indonesian' , 'Bahasa Indonesia', ',', '.', false},
	{'uk', false, 'Ukrainian'  , 'Українська',       ',', '.', false},
	{'pl', false, 'Polish'     , 'Polski',           ',', '.', false},
	{'nl', false, 'Dutch'      , 'Nederlands',       ',', '.', false},
	{'ko', false, 'Korean'     , '한국어',            '.', ',', false},
	{'he', true , 'Hebrew'     , 'עברית',            '.', ',', false},
	{'th', false, 'Thai'       , 'ไทย',                '.', ',', false},
	{'cs', false, 'Czech'      , 'Česky',            ',', '.', false},
	{'ro', false, 'Romanian'   , 'Română',           ',', '.', false},
	{'sv', false, 'Swedish'    , 'Svenska',          ',', '.', false},
	{'sr', false, 'Serbian'    , 'Српски',           ',', '.', false},
	{'hu', false, 'Hungarian'  , 'Magyar',           ',', '.', false},
	{'da', false, 'Danish'     , 'Dansk',            ',', '.', false},
	{'bg', false, 'Bulgarian'  , 'Български',        ',', '.', false},
	{'fi', false, 'Finnish'    , 'Suomi',            ',', '.', false},
	{'sk', false, 'Slovak'     , 'Slovenčina',       ',', '.', false},
	{'hr', false, 'Croatian'   , 'Hrvatski',         ',', '.', false},
	{'hi', false, 'Hindi'      , 'हिन्दी',               '.', ',', false},
	{'lt', false, 'Lithuanian' , 'Lietuvių',         ',', '.', false},
	{'no', false, 'Norwegian'  , 'Norsk',            ',', '.', false},
	{'sl', false, 'Slovenian'  , 'Slovenščina',      ',', '.', false},
	{'ms', false, 'Malay'      , 'Bahasa Melayu',    '.', ',', false},
	{'ca', false, 'Catalan'    , 'Català',           '.', ',', false},
	{'sq', false, 'Albanian'   , 'Shqip',            '.', ',', false},
	--less spoken but official languages
	--TODO: separators, see https://en.wikipedia.org/wiki/Decimal_separator
	{'am', false, 'Amharic'    , 'አማርኛ',            '.', ',', false},
	{'as', false, 'Assamese'   , 'অসমীয়া',           '.', ',', false},
	{'az', false, 'Azerbaijani', 'آذربايجان',           '.', ',', false},
	{'be', false, 'Belarusian' , 'Беларуская',       '.', ',', false},
	{'bi', false, 'Bislama'    , 'Bislama',          '.', ',', false},
	{'bn', false, 'Bengali'    , 'বাংলা',             '.', ',', false},
	{'bs', false, 'Bosnian'    , 'Bosanski',         '.', ',', false},
	{'dv', true , 'Divehi'     , 'ދިވެހިބަސް',           '.', ',', false},
	{'dz', false, 'Dzongkha'   , 'ཇོང་ཁ',                '.', ',', false},
	{'et', false, 'Estonian'   , 'Eesti',            '.', ',', false},
	{'fo', false, 'Faroese'    , 'Føroyskt',         '.', ',', false},
	{'hy', false, 'Armenian'   , 'Հայերեն',          '.', ',', false},
	{'is', false, 'Icelandic'  , 'Íslenska',         '.', ',', false},
	{'ka', false, 'Georgian'   , 'ქართული',        '.', ',', false},
	{'kk', false, 'Kazakh'     , 'Қазақша',          '.', ',', false},
	{'kl', false, 'Greenlandic', 'Kalaallisut',      '.', ',', false},
	{'km', false, 'Cambodian'  , 'ភាសាខ្មែរ',           '.', ',', false},
	{'ky', false, 'Kirghiz'    , 'Кыргызча',         '.', ',', false},
	{'lb', false, 'Luxembourgish', 'Lëtzebuergesch', '.', ',', false},
	{'lo', false, 'Laotian'    , 'ລາວ',              '.', ',', false},
	{'lv', false, 'Latvian'    , 'Latviešu',         '.', ',', false},
	{'mg', false, 'Malagasy'   , 'Malagasy',         '.', ',', false},
	{'mi', false, 'Māori'      , 'Māori',            '.', ',', false},
	{'mk', false, 'Macedonian' , 'Македонски',       '.', ',', false},
	{'mn', false, 'Mongolian'  , 'Монгол',           '.', ',', false},
	{'mt', false, 'Maltese'    , 'Malti',            '.', ',', false},
	{'my', false, 'Burmese'    , 'Myanmasa',         '.', ',', false},
	{'na', false, 'Nauruan'    , 'Dorerin Naoero',   '.', ',', false},
	{'ne', false, 'Nepali'     , 'नेपाली',              '.', ',', false},
	{'rw', false, 'Rwandi'     , 'Kinyarwandi',      '.', ',', false},
	{'si', false, 'Sinhalese'  , 'සිංහල',            '.', ',', false},
	{'sm', false, 'Samoan'     , 'Gagana Samoa',     '.', ',', false},
	{'so', false, 'Somalia'    , 'Soomaaliga',       '.', ',', false},
	{'sw', false, 'Swahili'    , 'Kiswahili',        '.', ',', false},
	{'tg', false, 'Tajik'      , 'Тоҷикӣ',           '.', ',', false},
	{'ti', false, 'Tigrinya'   , 'ትግርኛ',            '.', ',', false},
	{'tk', false, 'Turkmen'    , 'تركمن',             '.', ',', false},
	{'uz', false, 'Uzbek'      , 'Ўзбек',            '.', ',', false},
}

--https://en.wikipedia.org/wiki/List_of_circulating_currencies
local currency_cols = {'currency', 'decimals', 'en_name', 'symbol'}
local currency_rows = {
	{'AED', 2, 'United Arab Emirates dirham'             , 'د.إ'},
	{'AFN', 2, 'Afghan afghani'                          , '؋'},
	{'ALL', 2, 'Albanian lek'                            , 'L'},
	{'AMD', 2, 'Armenian dram'                           , '֏'},
	{'ANG', 2, 'Netherlands Antillean guilder'           , 'ƒ'},
	{'AOA', 2, 'Angolan kwanza'                          , 'Kz'},
	{'ARS', 2, 'Argentine peso'                          , '$'},
	{'AUD', 2, 'Australian dollar'                       , '$'},
	{'AWG', 2, 'Aruban florin'                           , 'ƒ'},
	{'AZN', 2, 'Azerbaijani manat'                       , '₼'},
	{'BAM', 2, 'Bosnia and Herzegovina convertible mark' , 'KM'},
	{'BBD', 2, 'Barbadian dollar'                        , '$'},
	{'BDT', 2, 'Bangladeshi taka'                        , '৳'},
	{'BGN', 2, 'Bulgarian lev'                           , 'лв'},
	{'BHD', 3, 'Bahraini dinar'                          , '.د.ب'},
	{'BIF', 0, 'Burundian franc'                         , 'Fr'},
	{'BMD', 2, 'Bermudian dollar'                        , '$'},
	{'BND', 2, 'Brunei dollar'                           , '$'},
	{'BOB', 2, 'Bolivian boliviano'                      , 'Bs'},
	{'BRL', 2, 'Brazilian real'                          , 'R$'},
	{'BSD', 2, 'Bahamian dollar'                         , '$'},
	{'BTN', 2, 'Bhutanese ngultrum'                      , 'Nu'},
	{'BWP', 2, 'Botswana pula'                           , 'P'},
	{'BYN', 0, 'Belarusian ruble'                        , 'Br'},
	{'BZD', 2, 'Belize dollar'                           , '$'},
	{'CAD', 2, 'Canadian dollar'                         , '$'},
	{'CDF', 2, 'Congolese franc'                         , 'Fr'},
	{'CHF', 2, 'Swiss franc'                             , 'Fr'},
	{'CKD', 2, 'Cook Islands dollar'                     , '$'},
	{'CLP', 0, 'Chilean peso'                            , '$'},
	{'CNY', 2, 'Chinese yuan'                            , '¥'},
	{'COP', 2, 'Colombian peso'                          , '$'},
	{'CRC', 2, 'Costa Rican colón'                       , '₡'},
	{'CUP', 2, 'Cuban peso'                              , '$'},
	{'CVE', 0, 'Cape Verdean escudo'                     , '$'},
	{'CZK', 2, 'Czech koruna'                            , 'Kč'},
	{'DJF', 0, 'Djiboutian franc'                        , 'Fr'},
	{'DKK', 2, 'Danish krone'                            , 'kr'},
	{'DOP', 2, 'Dominican peso'                          , 'RD$'},
	{'DZD', 2, 'Algerian dinar'                          , 'د.ج'},
	{'EGP', 2, 'Egyptian pound'                          , 'ج.م'},
	{'ERN', 2, 'Eritrean nakfa'                          , 'Nfk'},
	{'ETB', 2, 'Ethiopian birr'                          , 'Br'},
	{'EUR', 2, 'Euro'                                    , '€'},
	{'FJD', 2, 'Fijian dollar'                           , '$'},
	{'FKP', 2, 'Falkland Islands pound'                  , '£'},
	{'FOK', 2, 'Faroese króna'                           , 'kr'},
	{'GBP', 2, 'British pound'                           , '£'},
	{'GEL', 2, 'Georgian lari'                           , '₾'},
	{'GGP', 2, 'Guernsey pound'                          , '£'},
	{'GHS', 2, 'Ghanaian cedi'                           , '₵'},
	{'GIP', 2, 'Gibraltar pound'                         , '£'},
	{'GMD', 2, 'Gambian dalasi'                          , 'D'},
	{'GNF', 0, 'Guinean franc'                           , 'Fr'},
	{'GTQ', 2, 'Guatemalan quetzal'                      , 'Q'},
	{'GYD', 2, 'Guyanese dollar'                         , '$'},
	{'HKD', 2, 'Hong Kong dollar'                        , '$'},
	{'HNL', 2, 'Honduran lempira'                        , 'L'},
	{'HRK', 2, 'Croatian kuna'                           , 'kn'},
	{'HTG', 2, 'Haitian gourde'                          , 'G'},
	{'HUF', 2, 'Hungarian forint'                        , 'Ft'},
	{'IDR', 2, 'Indonesian rupiah'                       , 'Rp'},
	{'ILS', 2, 'Israeli new shekel'                      , '₪'},
	{'IMP', 2, 'Manx pound'                              , '£'},
	{'INR', 2, 'Indian rupee'                            , '₹'},
	{'IQD', 3, 'Iraqi dinar'                             , 'ع.د'},
	{'IRR', 0, 'Iranian rial'                            , '﷼'},
	{'ISK', 0, 'Icelandic króna'                         , 'kr'},
	{'JEP', 2, 'Jersey pound'                            , '£'},
	{'JMD', 2, 'Jamaican dollar'                         , '$'},
	{'JOD', 3, 'Jordanian dinar'                         , 'د.ا'},
	{'JPY', 0, 'Japanese yen'                            , '¥'},
	{'KES', 2, 'Kenyan shilling'                         , 'Sh'},
	{'KGS', 2, 'Kyrgyzstani som'                         , 'с'},
	{'KHR', 2, 'Cambodian riel'                          , '៛'},
	{'KID', 2, 'Kiribati dollar'                         , '$'},
	{'KMF', 0, 'Comorian franc'                          , 'Fr'},
	{'KPW', 0, 'North Korean won'                        , '₩'},
	{'KRW', 0, 'South Korean won'                        , '₩'},
	{'KWD', 3, 'Kuwaiti dinar'                           , 'د.ك'},
	{'KYD', 2, 'Cayman Islands dollar'                   , '$'},
	{'KZT', 2, 'Kazakhstani tenge'                       , '₸'},
	{'LAK', 0, 'Lao kip'                                 , '₭'},
	{'LBP', 0, 'Lebanese pound'                          , 'ل.ل'},
	{'LKR', 2, 'Sri Lankan rupee'                        , 'Rs'},
	{'LRD', 2, 'Liberian dollar'                         , '$'},
	{'LSL', 2, 'Lesotho loti'                            , 'L'},
	{'LYD', 3, 'Libyan dinar'                            , 'ل.د'},
	{'MAD', 2, 'Moroccan dirham'                         , 'د.م'},
	{'MDL', 2, 'Moldovan leu'                            , 'L'},
	{'MGA', 0, 'Malagasy ariary'                         , 'Ar'},
	{'MKD', 0, 'Macedonian denar'                        , 'ден'},
	{'MMK', 0, 'Burmese kyat'                            , 'Ks'},
	{'MNT', 2, 'Mongolian tögrög'                        , '₮'},
	{'MOP', 2, 'Macanese pataca'                         , 'MOP$'},
	{'MRU', 0, 'Mauritanian ouguiya'                     , 'UM'},
	{'MUR', 2, 'Mauritian rupee'                         , '₨'},
	{'MVR', 2, 'Maldivian rufiyaa'                       , '.ރ'},
	{'MWK', 2, 'Malawian kwacha'                         , 'MK'},
	{'MXN', 2, 'Mexican peso'                            , '$'},
	{'MYR', 2, 'Malaysian ringgit'                       , 'RM'},
	{'MZN', 2, 'Mozambican metical'                      , 'MT'},
	{'NAD', 2, 'Namibian dollar'                         , '$'},
	{'NGN', 2, 'Nigerian naira'                          , '₦'},
	{'NIO', 2, 'Nicaraguan córdoba'                      , 'C$'},
	{'NOK', 2, 'Norwegian krone'                         , 'kr'},
	{'NPR', 2, 'Nepalese rupee'                          , 'रू'},
	{'NZD', 2, 'New Zealand dollar'                      , '$'},
	{'OMR', 3, 'Omani rial'                              , 'ر.ع'},
	{'PAB', 2, 'Panamanian balboa'                       , 'B/.'},
	{'PEN', 2, 'Peruvian sol'                            , 'S/.'},
	{'PGK', 2, 'Papua New Guinean kina'                  , 'K'},
	{'PHP', 2, 'Philippine peso'                         , '₱'},
	{'PKR', 2, 'Pakistani rupee'                         , '₨'},
	{'PLN', 2, 'Polish złoty'                            , 'zł'},
	{'PND', 2, 'Pitcairn Islands dollar'                 , '$'},
	{'PRB', 2, 'Transnistrian ruble'                     , 'р'},
	{'PYG', 0, 'Paraguayan guaraní'                      , '₲'},
	{'QAR', 2, 'Qatari riyal'                            , 'ر.ق'},
	{'RON', 2, 'Romanian leu'                            , 'lei'},
	{'RSD', 2, 'Serbian dinar'                           , 'дин'},
	{'RUB', 2, 'Russian ruble'                           , '₽'},
	{'RWF', 0, 'Rwandan franc'                           , 'Fr'},
	{'SAR', 2, 'Saudi riyal'                             , '﷼'},
	{'SBD', 2, 'Solomon Islands dollar'                  , '$'},
	{'SCR', 2, 'Seychellois rupee'                       , '₨'},
	{'SDG', 2, 'Sudanese pound'                          , 'ج.س'},
	{'SEK', 2, 'Swedish krona'                           , 'kr'},
	{'SGD', 2, 'Singapore dollar'                        , '$'},
	{'SHP', 2, 'Saint Helena pound'                      , '£'},
	{'SLL', 0, 'Sierra Leonean leone'                    , 'Le'},
	{'SLS', 2, 'Somaliland shilling'                     , 'Sl'},
	{'SOS', 2, 'Somali shilling'                         , 'Sh'},
	{'SRD', 2, 'Surinamese dollar'                       , '$'},
	{'SSP', 2, 'South Sudanese pound'                    , '£'},
	{'STN', 0, 'São Tomé and Príncipe dobra'             , 'Db'},
	{'SYP', 2, 'Syrian pound'                            , '£'},
	{'SZL', 2, 'Swazi lilangeni'                         , 'L'},
	{'THB', 2, 'Thai baht'                               , '฿'},
	{'TJS', 2, 'Tajikistani somoni'                      , 'с'},
	{'TMT', 2, 'Turkmenistan manat'                      , 'm'},
	{'TND', 3, 'Tunisian dinar'                          , 'د.ت'},
	{'TOP', 2, 'Tongan paʻanga'                           , 'T$'},
	{'TRY', 2, 'Turkish lira'                            , '₺'},
	{'TTD', 2, 'Trinidad and Tobago dollar'              , '$'},
	{'TVD', 2, 'Tuvaluan dollar'                         , '$'},
	{'TWD', 2, 'New Taiwan dollar'                       , '$'},
	{'TZS', 2, 'Tanzanian shilling'                      , 'Sh'},
	{'UAH', 2, 'Ukrainian hryvnia'                       , '₴'},
	{'UGX', 2, 'Ugandan shilling'                        , 'Sh'},
	{'USD', 2, 'United States dollar'                    , '$'},
	{'UYU', 2, 'Uruguayan peso'                          , '$'},
	{'UZS', 2, 'Uzbekistani soʻm'                         , 'Sʻ'},
	{'VES', 2, 'Venezuelan bolívar soberano'             , 'Bs'},
	{'VND', 0, 'Vietnamese đồng'                         , '₫'},
	{'VUV', 0, 'Vanuatu vatu'                            , 'Vt'},
	{'WST', 2, 'Samoan tālā'                             , 'T'},
	{'XAF', 0, 'Central African CFA franc'               , 'Fr'},
	{'XCD', 2, 'Eastern Caribbean dollar'                , '$'},
	{'XOF', 0, 'West African CFA franc'                  , 'Fr'},
	{'XPF', 0, 'CFP franc'                               , '₣'},
	{'YER', 2, 'Yemeni rial'                             , '﷼'},
	{'ZAR', 2, 'South African rand'                      , 'R'},
	{'ZMW', 2, 'Zambian kwacha'                          , 'ZK'},
	{'VEB', 0, 'Venezuelan bolívar'                      , 'BsD'},
}

--https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes
--https://wiki.openstreetmap.org/wiki/Nominatim/Country_Codes
--https://unece.org/fileadmin/DAM/cefact/recommendations/bkup_htm/cocucod1.htm
--TODO: date formats, see https://www.ibm.com/docs/en/db2/11.5?topic=considerations-date-time-formats-by-territory-code
local country_cols = {'country', 'lang', 'currency', 'imperial_system', 'week_start_offset', 'date_format', 'en_name'}
local country_rows = {
	{'AD', 'ca', 'EUR', false,  1, 'dd-mm-yyyy', 'Andorra'},
	{'AE', 'ar', 'AED', false, -1, 'dd-mm-yyyy', 'United Arab Emirates'},
	{'AF', 'fa', 'AFN', false, -1, 'dd-mm-yyyy', 'Afghanistan'},
	{'AG', 'en', 'XCD', false,  0, 'dd-mm-yyyy', 'Antigua and Barbuda'},
	{'AI', 'en', 'XCD', false,  1, 'dd-mm-yyyy', 'Anguilla'},
	{'AL', 'sq', 'ALL', false,  1, 'dd-mm-yyyy', 'Albania'},
	{'AM', 'hy', 'AMD', false,  1, 'dd-mm-yyyy', 'Armenia'},
	{'AO', 'pt', 'AOA', false,  1, 'dd-mm-yyyy', 'Angola'},
	{'AQ', 'en', null , false,  1, 'dd-mm-yyyy', 'Antarctica'},
	{'AR', 'es', 'ARS', false,  1, 'dd-mm-yyyy', 'Argentina'},
	{'AS', 'en', 'USD', false,  0, 'dd-mm-yyyy', 'American Samoa'},
	{'AT', 'de', 'EUR', false,  1, 'dd-mm-yyyy', 'Austria'},
	{'AU', 'en', 'AUD', false,  0, 'dd-mm-yyyy', 'Australia'},
	{'AW', 'nl', 'AWG', false,  1, 'dd-mm-yyyy', 'Aruba'},
	{'AX', 'sv', null , false,  1, 'dd-mm-yyyy', 'Åland Islands'},
	{'AZ', 'az', 'AZN', false,  1, 'dd-mm-yyyy', 'Azerbaijan'},
	{'BA', 'bs', 'BAM', false,  1, 'dd-mm-yyyy', 'Bosnia and Herzegovina'},
	{'BB', 'en', 'BBD', false,  1, 'dd-mm-yyyy', 'Barbados'},
	{'BD', 'bn', 'BDT', false,  0, 'dd-mm-yyyy', 'Bangladesh'},
	{'BE', 'nl', 'EUR', false,  1, 'dd-mm-yyyy', 'Belgium'},
	{'BF', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Burkina Faso'},
	{'BG', 'bg', 'BGN', false,  1, 'dd-mm-yyyy', 'Bulgaria'},
	{'BH', 'ar', 'BHD', false,  1, 'dd-mm-yyyy', 'Bahrain'},
	{'BI', 'fr', 'BIF', false,  1, 'dd-mm-yyyy', 'Burundi'},
	{'BJ', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Benin'},
	{'BL', 'fr', null , false,  1, 'dd-mm-yyyy', 'Saint Barthélemy'},
	{'BM', 'en', 'BMD', false,  1, 'dd-mm-yyyy', 'Bermuda'},
	{'BN', 'ms', 'BND', false,  1, 'dd-mm-yyyy', 'Brunei Darussalam'},
	{'BO', 'es', 'BOB', false,  1, 'dd-mm-yyyy', 'Bolivia'},
	{'BQ', 'nl', null , false,  1, 'dd-mm-yyyy', 'Bonaire'},
	{'BR', 'pt', 'BRL', false,  0, 'dd-mm-yyyy', 'Brazil'},
	{'BS', 'en', 'BSD', false,  0, 'dd-mm-yyyy', 'Bahamas'},
	{'BT', 'dz', 'INR', false,  0, 'dd-mm-yyyy', 'Bhutan'},
	{'BV', 'no', 'NOK', false,  1, 'dd-mm-yyyy', 'Bouvet Island'},
	{'BW', 'en', 'BWP', false,  0, 'dd-mm-yyyy', 'Botswana'},
	{'BY', 'be', 'BYN', false,  1, 'dd-mm-yyyy', 'Belarus'},
	{'BZ', 'en', 'BZD', false,  0, 'dd-mm-yyyy', 'Belize'},
	{'CA', 'en', 'CAD', false,  0, 'dd-mm-yyyy', 'Canada'},
	{'CC', 'en', 'AUD', false,  1, 'dd-mm-yyyy', 'Cocos Islands'},
	{'CD', 'fr', 'CDF', false,  1, 'dd-mm-yyyy', 'Congo, the Democratic Republic of the'},
	{'CF', 'fr', 'XAF', false,  1, 'dd-mm-yyyy', 'Central African Republic'},
	{'CG', 'fr', 'XAF', false,  1, 'dd-mm-yyyy', 'Congo'},
	{'CH', 'de', 'CHF', false,  1, 'dd-mm-yyyy', 'Switzerland'},
	{'CI', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Côte d\'Ivoire'},
	{'CK', 'en', 'NZD', false,  1, 'dd-mm-yyyy', 'Cook Islands'},
	{'CL', 'es', 'CLP', false,  1, 'dd-mm-yyyy', 'Chile'},
	{'CM', 'fr', 'XAF', false,  1, 'dd-mm-yyyy', 'Cameroon'},
	{'CN', 'zh', 'CNY', false,  0, 'dd-mm-yyyy', 'China'},
	{'CO', 'es', 'COP', false,  0, 'dd-mm-yyyy', 'Colombia'},
	{'CR', 'es', 'CRC', false,  1, 'dd-mm-yyyy', 'Costa Rica'},
	{'CU', 'es', 'CUP', false,  1, 'dd-mm-yyyy', 'Cuba'},
	{'CV', 'pt', 'CVE', false,  1, 'dd-mm-yyyy', 'Cape Verde'},
	{'CW', 'nl', 'ANG', false,  1, 'dd-mm-yyyy', 'Curaçao'},
	{'CX', 'en', 'AUD', false,  1, 'dd-mm-yyyy', 'Christmas Island'},
	{'CY', 'el', 'EUR', false,  1, 'dd-mm-yyyy', 'Cyprus'},
	{'CZ', 'cs', 'CZK', false,  1, 'dd-mm-yyyy', 'Czech Republic'},
	{'DE', 'de', 'EUR', false,  1, 'dd-mm-yyyy', 'Germany'},
	{'DJ', 'fr', 'DJF', false, -1, 'dd-mm-yyyy', 'Djibouti'},
	{'DK', 'da', 'DKK', false,  1, 'dd-mm-yyyy', 'Denmark'},
	{'DM', 'en', 'XCD', false,  0, 'dd-mm-yyyy', 'Dominica'},
	{'DO', 'es', 'DOP', false,  0, 'dd-mm-yyyy', 'Dominican Republic'},
	{'DZ', 'ar', 'DZD', false, -1, 'dd-mm-yyyy', 'Algeria'},
	{'EC', 'es', 'USD', false,  1, 'dd-mm-yyyy', 'Ecuador'},
	{'EE', 'et', 'EUR', false,  1, 'dd-mm-yyyy', 'Estonia'},
	{'EG', 'ar', 'EGP', false, -1, 'dd-mm-yyyy', 'Egypt'},
	{'EH', 'ar', 'MAD', false,  1, 'dd-mm-yyyy', 'Western Sahara'},
	{'ER', 'ti', 'ERN', false,  1, 'dd-mm-yyyy', 'Eritrea'},
	{'ES', 'as', 'EUR', false,  1, 'dd-mm-yyyy', 'Spain'},
	{'ET', 'am', 'ETB', false,  0, 'dd-mm-yyyy', 'Ethiopia'},
	{'FI', 'fi', 'EUR', false,  1, 'dd-mm-yyyy', 'Finland'},
	{'FJ', 'en', 'FJD', false,  1, 'dd-mm-yyyy', 'Fiji'},
	{'FK', 'en', 'FKP', false,  1, 'dd-mm-yyyy', 'Falkland Islands'},
	{'FM', 'en', 'USD', false,  1, 'dd-mm-yyyy', 'Micronesia'},
	{'FO', 'fo', 'FOK', false,  1, 'dd-mm-yyyy', 'Faroe Islands'},
	{'FR', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'France'},
	{'GA', 'fr', 'XAF', false,  1, 'dd-mm-yyyy', 'Gabon'},
	{'GB', 'en', 'GBP', false,  1, 'dd-mm-yyyy', 'United Kingdom'},
	{'GD', 'en', 'XCD', false,  1, 'dd-mm-yyyy', 'Grenada'},
	{'GE', 'ka', 'GEL', false,  1, 'dd-mm-yyyy', 'Georgia'},
	{'GF', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'French Guiana'},
	{'GG', 'en', 'GBP', false,  1, 'dd-mm-yyyy', 'Guernsey'},
	{'GH', 'en', 'GHS', false,  1, 'dd-mm-yyyy', 'Ghana'},
	{'GI', 'en', 'GIP', false,  1, 'dd-mm-yyyy', 'Gibraltar'},
	{'GL', 'kl', 'DKK', false,  1, 'dd-mm-yyyy', 'Greenland'},
	{'GM', 'en', 'GMD', false,  1, 'dd-mm-yyyy', 'Gambia'},
	{'GN', 'fr', 'GNF', false,  1, 'dd-mm-yyyy', 'Guinea'},
	{'GP', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'Guadeloupe'},
	{'GQ', 'es', 'XAF', false,  1, 'dd-mm-yyyy', 'Equatorial Guinea'},
	{'GR', 'el', 'EUR', false,  1, 'dd-mm-yyyy', 'Greece'},
	{'GS', 'en', null , false,  1, 'dd-mm-yyyy', 'South Georgia and the South Sandwich Islands'},
	{'GT', 'es', 'GTQ', false,  0, 'dd-mm-yyyy', 'Guatemala'},
	{'GU', 'en', 'USD', false,  0, 'dd-mm-yyyy', 'Guam'},
	{'GW', 'pt', 'XOF', false,  1, 'dd-mm-yyyy', 'Guinea-Bissau'},
	{'GY', 'en', 'GYD', false,  1, 'dd-mm-yyyy', 'Guyana'},
	{'HK', 'zh', 'HKD', false,  0, 'dd-mm-yyyy', 'Hong Kong'},
	{'HM', 'en', 'AUD', false,  1, 'dd-mm-yyyy', 'Heard Island and McDonald Islands'},
	{'HN', 'es', 'HNL', false,  0, 'dd-mm-yyyy', 'Honduras'},
	{'HR', 'hr', 'HRK', false,  1, 'dd-mm-yyyy', 'Croatia'},
	{'HT', 'fr', 'HTG', false,  1, 'dd-mm-yyyy', 'Haiti'},
	{'HU', 'hu', 'HUF', false,  1, 'dd-mm-yyyy', 'Hungary'},
	{'ID', 'id', 'IDR', false,  0, 'dd-mm-yyyy', 'Indonesia'},
	{'IE', 'en', 'EUR', false,  1, 'dd-mm-yyyy', 'Ireland'},
	{'IL', 'he', 'ILS', false,  0, 'dd-mm-yyyy', 'Israel'},
	{'IM', 'en', 'GBP', false,  1, 'dd-mm-yyyy', 'Isle of Man'},
	{'IN', 'hi', 'INR', false,  0, 'dd-mm-yyyy', 'India'},
	{'IO', 'en', 'USD', false,  1, 'dd-mm-yyyy', 'British Indian Ocean Territory'},
	{'IQ', 'ar', 'IQD', false, -1, 'dd-mm-yyyy', 'Iraq'},
	{'IR', 'fa', 'IRR', false, -1, 'dd-mm-yyyy', 'Iran'},
	{'IS', 'is', 'ISK', false,  1, 'dd-mm-yyyy', 'Iceland'},
	{'IT', 'it', 'EUR', false,  1, 'dd-mm-yyyy', 'Italy'},
	{'JE', 'en', 'GBP', false,  1, 'dd-mm-yyyy', 'Jersey'},
	{'JM', 'en', 'JMD', false,  0, 'dd-mm-yyyy', 'Jamaica'},
	{'JO', 'ar', 'JOD', false, -1, 'dd-mm-yyyy', 'Jordan'},
	{'JP', 'ja', 'JPY', false,  0, 'dd-mm-yyyy', 'Japan'},
	{'KE', 'sw', 'KES', false,  0, 'dd-mm-yyyy', 'Kenya'},
	{'KG', 'ky', 'KGS', false,  1, 'dd-mm-yyyy', 'Kyrgyzstan'},
	{'KH', 'km', 'KHR', false,  0, 'dd-mm-yyyy', 'Cambodia'},
	{'KI', 'en', 'AUD', false,  1, 'dd-mm-yyyy', 'Kiribati'},
	{'KM', 'ar', 'KMF', false,  1, 'dd-mm-yyyy', 'Comoros'},
	{'KN', 'en', 'XCD', false,  1, 'dd-mm-yyyy', 'Saint Kitts and Nevis'},
	{'KP', 'ko', 'KPW', false,  1, 'dd-mm-yyyy', 'Korea, North'},
	{'KR', 'ko', 'KRW', false,  0, 'dd-mm-yyyy', 'Korea, South'},
	{'KW', 'ar', 'KWD', false, -1, 'dd-mm-yyyy', 'Kuwait'},
	{'KY', 'en', 'KYD', false,  1, 'dd-mm-yyyy', 'Cayman Islands'},
	{'KZ', 'kk', 'KZT', false,  1, 'dd-mm-yyyy', 'Kazakhstan'},
	{'LA', 'lo', 'LAK', false,  0, 'dd-mm-yyyy', 'Lao'},
	{'LB', 'ar', 'LBP', false,  1, 'dd-mm-yyyy', 'Lebanon'},
	{'LC', 'en', 'XCD', false,  1, 'dd-mm-yyyy', 'Saint Lucia'},
	{'LI', 'de', 'CHF', false,  1, 'dd-mm-yyyy', 'Liechtenstein'},
	{'LK', 'si', 'LKR', false,  1, 'dd-mm-yyyy', 'Sri Lanka'},
	{'LR', 'en', 'LRD', true ,  1, 'dd-mm-yyyy', 'Liberia'},
	{'LS', 'en', 'ZAR', false,  1, 'dd-mm-yyyy', 'Lesotho'},
	{'LT', 'lt', 'EUR', false,  1, 'dd-mm-yyyy', 'Lithuania'},
	{'LU', 'lb', 'EUR', false,  1, 'dd-mm-yyyy', 'Luxembourg'},
	{'LV', 'lv', 'EUR', false,  1, 'dd-mm-yyyy', 'Latvia'},
	{'LY', 'ar', 'LYD', false, -1, 'dd-mm-yyyy', 'Libya'},
	{'MA', 'fr', 'MAD', false,  1, 'dd-mm-yyyy', 'Morocco'},
	{'MC', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'Monaco'},
	{'MD', 'ro', 'MDL', false,  1, 'dd-mm-yyyy', 'Moldova'},
	{'ME', 'sr', 'EUR', false,  1, 'dd-mm-yyyy', 'Montenegro'},
	{'MF', 'fr', null , false,  1, 'dd-mm-yyyy', 'Saint Martin (French part}'},
	{'MG', 'mg', 'MGA', false,  1, 'dd-mm-yyyy', 'Madagascar'},
	{'MH', 'en', 'USD', false,  0, 'dd-mm-yyyy', 'Marshall Islands'},
	{'MK', 'mk', 'MKD', false,  1, 'dd-mm-yyyy', 'Macedonia'},
	{'ML', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Mali'},
	{'MM', 'my', 'MMK', true ,  0, 'dd-mm-yyyy', 'Myanmar'},
	{'MN', 'mn', 'MNT', false,  1, 'dd-mm-yyyy', 'Mongolia'},
	{'MO', 'zh', 'MOP', false,  0, 'dd-mm-yyyy', 'Macao'},
	{'MP', 'en', 'USD', false,  1, 'dd-mm-yyyy', 'Northern Mariana Islands'},
	{'MQ', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'Martinique'},
	{'MR', 'ar', 'MRU', false,  1, 'dd-mm-yyyy', 'Mauritania'},
	{'MS', 'en', 'XCD', false,  1, 'dd-mm-yyyy', 'Montserrat'},
	{'MT', 'mt', 'EUR', false,  0, 'dd-mm-yyyy', 'Malta'},
	{'MU', 'en', 'MUR', false,  1, 'dd-mm-yyyy', 'Mauritius'},
	{'MV', 'dv', 'MVR', false, -2, 'dd-mm-yyyy', 'Maldives'},
	{'MW', 'en', 'MWK', false,  1, 'dd-mm-yyyy', 'Malawi'},
	{'MX', 'es', 'MXN', false,  0, 'dd-mm-yyyy', 'Mexico'},
	{'MY', 'ms', 'MYR', false,  1, 'dd-mm-yyyy', 'Malaysia'},
	{'MZ', 'pt', 'MZN', false,  0, 'dd-mm-yyyy', 'Mozambique'},
	{'NA', 'en', 'ZAR', false,  1, 'dd-mm-yyyy', 'Namibia'},
	{'NC', 'fr', 'XPF', false,  1, 'dd-mm-yyyy', 'New Caledonia'},
	{'NE', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Niger'},
	{'NF', 'en', 'AUD', false,  1, 'dd-mm-yyyy', 'Norfolk Island'},
	{'NG', 'en', 'NGN', false,  1, 'dd-mm-yyyy', 'Nigeria'},
	{'NI', 'es', 'NIO', false,  0, 'dd-mm-yyyy', 'Nicaragua'},
	{'NL', 'nl', 'EUR', false,  1, 'dd-mm-yyyy', 'Netherlands'},
	{'NO', 'no', 'NOK', false,  1, 'dd-mm-yyyy', 'Norway'},
	{'NP', 'ne', 'NPR', false,  0, 'dd-mm-yyyy', 'Nepal'},
	{'NR', 'na', 'AUD', false,  1, 'dd-mm-yyyy', 'Nauru'},
	{'NU', 'en', 'NZD', false,  1, 'dd-mm-yyyy', 'Niue'},
	{'NZ', 'mi', 'NZD', false,  1, 'dd-mm-yyyy', 'New Zealand'},
	{'OM', 'ar', 'OMR', false, -1, 'dd-mm-yyyy', 'Oman'},
	{'PA', 'es', 'USD', false,  0, 'dd-mm-yyyy', 'Panama'},
	{'PE', 'es', 'PEN', false,  0, 'dd-mm-yyyy', 'Peru'},
	{'PF', 'fr', 'XPF', false,  1, 'dd-mm-yyyy', 'French Polynesia'},
	{'PG', 'en', 'PGK', false,  1, 'dd-mm-yyyy', 'Papua New Guinea'},
	{'PH', 'en', 'PHP', false,  0, 'dd-mm-yyyy', 'Philippines'},
	{'PK', 'en', 'PKR', false,  0, 'dd-mm-yyyy', 'Pakistan'},
	{'PL', 'pl', 'PLN', false,  1, 'dd-mm-yyyy', 'Poland'},
	{'PM', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'Saint Pierre and Miquelon'},
	{'PN', 'en', 'NZD', false,  1, 'dd-mm-yyyy', 'Pitcairn'},
	{'PR', 'es', 'USD', false,  0, 'dd-mm-yyyy', 'Puerto Rico'},
	{'PS', 'ar', null , false,  1, 'dd-mm-yyyy', 'Palestine'},
	{'PT', 'pt', 'EUR', false,  0, 'dd-mm-yyyy', 'Portugal'},
	{'PW', 'en', 'USD', false,  1, 'dd-mm-yyyy', 'Palau'},
	{'PY', 'es', 'PYG', false,  0, 'dd-mm-yyyy', 'Paraguay'},
	{'QA', 'ar', 'QAR', false, -1, 'dd-mm-yyyy', 'Qatar'},
	{'RE', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'Réunion'},
	{'RO', 'ro', 'RON', false,  1, 'dd-mm-yyyy', 'Romania'},
	{'RS', 'sr', 'RSD', false,  1, 'dd-mm-yyyy', 'Serbia'},
	{'RU', 'ru', 'RUB', false,  1, 'dd-mm-yyyy', 'Russian Federation'},
	{'RW', 'rw', 'RWF', false,  1, 'dd-mm-yyyy', 'Rwanda'},
	{'SA', 'ar', 'SAR', false,  0, 'dd-mm-yyyy', 'Saudi Arabia'},
	{'SB', 'en', 'SBD', false,  1, 'dd-mm-yyyy', 'Solomon Islands'},
	{'SC', 'fr', 'SCR', false,  1, 'dd-mm-yyyy', 'Seychelles'},
	{'SD', 'ar', 'SDG', false, -1, 'dd-mm-yyyy', 'Sudan'},
	{'SE', 'sv', 'SEK', false,  1, 'dd-mm-yyyy', 'Sweden'},
	{'SG', 'zh', 'BND', false,  0, 'dd-mm-yyyy', 'Singapore'},
	{'SH', 'en', 'SHP', false,  1, 'dd-mm-yyyy', 'Saint Helena'},
	{'SI', 'sl', 'EUR', false,  1, 'dd-mm-yyyy', 'Slovenia'},
	{'SJ', 'no', 'NOK', false,  1, 'dd-mm-yyyy', 'Svalbard and Jan Mayen'},
	{'SK', 'sk', 'EUR', false,  1, 'dd-mm-yyyy', 'Slovakia'},
	{'SL', 'en', 'SLL', false,  1, 'dd-mm-yyyy', 'Sierra Leone'},
	{'SM', 'it', 'EUR', false,  1, 'dd-mm-yyyy', 'San Marino'},
	{'SN', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Senegal'},
	{'SO', 'so', 'SOS', false,  1, 'dd-mm-yyyy', 'Somalia'},
	{'SR', 'nl', 'SRD', false,  1, 'dd-mm-yyyy', 'Suriname'},
	{'SS', 'en', 'SSP', false,  1, 'dd-mm-yyyy', 'South Sudan'},
	{'ST', 'pt', 'STN', false,  1, 'dd-mm-yyyy', 'Sao Tome and Principe'},
	{'SV', 'es', 'USD', false,  0, 'dd-mm-yyyy', 'El Salvador'},
	{'SX', 'nl', null , false,  1, 'dd-mm-yyyy', 'Sint Maarten (Dutch part}'},
	{'SY', 'ar', 'SYP', false, -1, 'dd-mm-yyyy', 'Syria'},
	{'SZ', 'en', 'SZL', false,  1, 'dd-mm-yyyy', 'Swaziland'},
	{'TC', 'en', 'USD', false,  1, 'dd-mm-yyyy', 'Turks and Caicos Islands'},
	{'TD', 'fr', 'XAF', false,  1, 'dd-mm-yyyy', 'Chad'},
	{'TF', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'French Southern Territories'},
	{'TG', 'fr', 'XOF', false,  1, 'dd-mm-yyyy', 'Togo'},
	{'TH', 'th', 'THB', false,  0, 'dd-mm-yyyy', 'Thailand'},
	{'TJ', 'tg', 'TJS', false,  1, 'dd-mm-yyyy', 'Tajikistan'},
	{'TK', 'tk', 'NZD', false,  1, 'dd-mm-yyyy', 'Tokelau'},
	{'TL', 'pt', 'USD', false,  1, 'dd-mm-yyyy', 'Timor-Leste'},
	{'TM', 'tk', 'TMT', false,  1, 'dd-mm-yyyy', 'Turkmenistan'},
	{'TN', 'ar', 'TND', false,  1, 'dd-mm-yyyy', 'Tunisia'},
	{'TO', 'en', 'TOP', false,  1, 'dd-mm-yyyy', 'Tonga'},
	{'TR', 'tr', 'TRY', false,  1, 'dd-mm-yyyy', 'Turkey'},
	{'TT', 'en', 'TTD', false,  0, 'dd-mm-yyyy', 'Trinidad and Tobago'},
	{'TV', 'en', 'AUD', false,  1, 'dd-mm-yyyy', 'Tuvalu'},
	{'TW', 'zh', 'TWD', false,  0, 'dd-mm-yyyy', 'Taiwan'},
	{'TZ', 'sw', 'TZS', false,  1, 'dd-mm-yyyy', 'Tanzania'},
	{'UA', 'uk', 'UAH', false,  1, 'dd-mm-yyyy', 'Ukraine'},
	{'UG', 'en', 'UGX', false,  1, 'dd-mm-yyyy', 'Uganda'},
	{'UM', 'en', 'USD', false,  0, 'dd-mm-yyyy', 'United States Minor Outlying Islands'},
	{'US', 'en', 'USD', true ,  0, 'mm-dd-yyyy', 'United States'},
	{'UY', 'es', 'UYU', false,  1, 'dd-mm-yyyy', 'Uruguay'},
	{'UZ', 'uz', 'UZS', false,  1, 'dd-mm-yyyy', 'Uzbekistan'},
	{'VA', 'it', 'EUR', false,  1, 'dd-mm-yyyy', 'Vatican'},
	{'VC', 'en', 'XCD', false,  1, 'dd-mm-yyyy', 'Saint Vincent and the Grenadines'},
	{'VE', 'es', 'VEB', false,  0, 'dd-mm-yyyy', 'Venezuela'},
	{'VG', 'en', 'USD', false,  1, 'dd-mm-yyyy', 'Virgin Islands, British'},
	{'VI', 'en', 'USD', false,  0, 'dd-mm-yyyy', 'Virgin Islands, U.S.'},
	{'VN', 'vi', 'VND', false,  1, 'dd-mm-yyyy', 'Viet Nam'},
	{'VU', 'bi', 'VUV', false,  1, 'dd-mm-yyyy', 'Vanuatu'},
	{'WF', 'fr', 'XPF', false,  1, 'dd-mm-yyyy', 'Wallis and Futuna'},
	{'WS', 'sm', 'WST', false,  0, 'dd-mm-yyyy', 'Samoa'},
	{'YE', 'ar', 'YER', false,  0, 'dd-mm-yyyy', 'Yemen'},
	{'YT', 'fr', 'EUR', false,  1, 'dd-mm-yyyy', 'Mayotte'},
	{'ZA', 'en', 'ZAR', false,  0, 'dd-mm-yyyy', 'South Africa'},
	{'ZM', 'en', 'ZMW', false,  1, 'dd-mm-yyyy', 'Zambia'},
	{'ZW', 'en',  null, false,  0, 'dd-mm-yyyy', 'Zimbabwe'},
}

local function mkapi(name, names, rows, cols, default_val)
	local t = {}
	for i,row in ipairs(rows) do
		t[row[1]] = row
	end
	local default_name = 'default_'..name
	local function default()
		return config(default_name, default_val)
	end
	local private_name = '_'..name
	local function get(k)
		local te = threadenv()
		local v = te and te[private_name] or default()
		if not k then return v end
		local t = assert(t[v])
		local v = t[assert(cols[v])]
		assert(v ~= nil)
		return v
	end
	local function set(v)
		if not v or not t[v] then return end --missing or invalid value: ignore.
		ownthreadenv()[private_name] = v
	end
	_G[names] = t
	_G[name] = get
	_G['set'..name] = set
	_G['default_'..name] = default
	qmacro[name] = function()
		return sqlval(get())
	end
	qmacro[default_name] = function()
		return sqlval(default())
	end
end
mkapi('lang'     , 'langs'      , lang_rows     , lang_cols     , 'en' )
mkapi('currency' , 'currencies' , currency_rows , currency_cols , 'USD')
mkapi('country'  , 'cuntries'   , country_rows  , country_cols  , 'US' )

function multilang() return config('multilang', true) end

--database schema ------------------------------------------------------------

function lang_schema()

	tables.lang = {
		lang                , lang, pk,
		rtl                 , bool0,
		en_name             , name, not_null, uk(en_name),
		name                , name, not_null, uk(name),
		decimal_separator   , {str, maxlen = 4, size = 16, utf8_bin, not_null, default ','},
		thousands_separator , {str, maxlen = 4, size = 16, utf8_bin, not_null, default '.'},
		supported           , bool0,
	}

	tables.lang.rows = lang_rows

	tables.currency = {
		currency    , currency, not_null, pk,
		decimals    , int16, not_null,
		en_name     , name, not_null, uk(currency, en_name),
		symbol      , name,
	}

	tables.currency.rows = currency_rows

	tables.country = {
		country     , country, not_null, pk,
		lang        , lang, not_null, fk,
		currency    , currency, fk,
		imperial_system, bool0,
		week_start_offset, int8, not_null, --Sun:0, Mon:1, Sat:-1, Fri:-2
		date_format , {str, size = 10, maxlen = 10, ascii_bin, not_null},
		en_name     , name, not_null,
	}

	tables.country.name_col = 'en_name'

	tables.country.rows = country_rows

end

--multi-language strings in source code --------------------------------------

S_ids = {} --{['EXT:ID']->{files=,en_s}}

function S_ids_add_id(ext, file, id, en_s)
	local ext_id = ext..':'..id
	local t = S_ids[ext_id]
	if not t then
		t = {files = {[file] = true}, en_s = en_s}
		S_ids[ext_id] = t
	else
		t.files[file] = true
	end
end

function S_ids_add_lua(file, s)
	for id, en_s in s:gmatch"[^%w_]Sf?%(%s*'([%w_]+)'%s*,%s*'(.-)'%s*[,%)]" do
		S_ids_add_id('lua', file, id, en_s)
	end
end

--using a different file for js strings so that strings.js only sends
--js strings to the client for client-side translation.
local function S_texts_file(lang, ext)
	return varpath(format('%s-s-%s%s.lua', scriptname, lang,
		ext == 'lua' and '' or '-'..ext))
end

local function S_texts_file_load(file)
	if not exists(file) then return end
	return eval_file(file)
end

S_texts = memoize(function(lang, ext)
	local sdk_file = indir(exedir(), '..', '..',
		format('s-%s%s.lua', lang, ext == 'lua' and '' or '-'..ext))
	local app_file = S_texts_file(lang, ext)
	return update({},
		S_texts_file_load(sdk_file),
		S_texts_file_load(app_file))
end)

local to_update = {}

function S_texts_update(lang, ext, id, s)
	S_texts(lang, ext)[id] = s
	attr(to_update, ext)[lang] = true
end

function S_texts_save()
	for ext, langs in pairs(to_update) do
		for lang in pairs(langs) do
			pp_save(S_texts_file(lang, ext), S_texts(lang, ext))
			langs[lang] = nil
		end
	end
end

function S_for(ext, id, en_s)
	return
		S_texts(lang(), ext)[id]
		or S_texts(default_lang(), ext)[id]
		or en_s
end

function S(id, en_s)
	return S_for('lua', id, en_s)
end

function Sf(id, en_s)
	return function()
		return S_for('lua', id, en_s)
	end
end

--date & time formatting -----------------------------------------------------

local
	os_date, floor, format, now, type =
	os.date, floor, format, now, type

function timeofday(t, precision)
	local h = floor(t / 3600) % 24
	local m = floor(t / 60) % 60
	local s = t % 60
	return format(precision == 's' and '%02d:%02d:%02d' or '%02d:%02d', h, m, s)
end

--extended os_date with '*d[t][s]' formatting based on current thread's country.
function date(fmt, t, country1)
	t = t or now()
	if fmt == '*t' or fmt == '!*t' then
		local d = os_date(fmt, t)
		d.sec = d.sec + t - floor(t) --increase accuracy in d.sec
		return d
	elseif
		   fmt == '*d'   or fmt == '!*d'
		or fmt == '*dt'  or fmt == '!*dt'
		or fmt == '*dts' or fmt == '!*dts'
	then --format based on current settings
		local utc =
				fmt == '!*d'
			or fmt == '!*dt'
			or fmt == '!*dts'
		local d = os_date(utc and '!*t' or '*t', t)
		local s = country(country1, 'date_format')
			:gsub('dd'  , _('%02d', d.day))
			:gsub('mm'  , _('%02d', d.month))
			:gsub('yyyy', _('%04d', d.year))
			:gsub('yy'  , _('%02d', d.year))
		if fmt == '*dt' or fmt == '!*dt' then
			s = s .. ' ' .. _('%02d:%02d', d.hour, d.min)
		elseif fmt == '*dts' or fmt == '!*dts' then
			s = s .. ' ' .. _('%02d:%02d:%02d', d.hour, d.min, d.sec)
		end
	else --format based on strftime()
		return os_date(fmt, t)
	end
end

do
local t = {}
function duration(s, fmt) -- approx[+s] | long | nil
	if fmt == 'approx' then
		if s > 2 * 365 * 24 * 3600 then
			return format(S('n_years', '%d years'), floor(s / (365 * 24 * 3600)))
		elseif s > 2 * 30.5 * 24 * 3600 then
			return format(S('n_months', '%d months'), floor(s / (30.5 * 24 * 3600)))
		elseif s > 1.5 * 24 * 3600 then
			return format(S('n_days', '%d days'), floor(s / (24 * 3600)))
		elseif s > 2 * 3600 then
			return format(S('n_hours', '%d hours'), floor(s / 3600))
		elseif s > 2 * 60 then
			return format(S('n_minutes', '%d minutes'), floor(s / 60))
		elseif s > 60 then
			return S('one_minute', '1 minute')
		elseif fmt == 'approx+s' then
			return format(S('n_seconds', '%d seconds'), s)
		else
			return S('seconds', 'seconds')
		end
	else
		local d = floor(s / (24 * 3600))
		local s = s - d * 24 * 3600
		local h = floor(s / 3600)
		local s = s - h * 3600
		local m = floor(s / 60)
		local s = s - m * 60
		if fmt == 'long' then
			for i=#t,1,-1 do t[i]=nil end
			local i=1
			if d ~= 0            then t[i] = d; t[i+1] = d > 1 and S'days'    or S'day'   ; i=i+2 end
			if h ~= 0            then t[i] = h; t[i+1] = h > 1 and S'hours'   or S'hour'  ; i=i+2 end
			if m ~= 0            then t[i] = m; t[i+1] = m > 1 and S'minutes' or S'minute'; i=i+2 end
			if s ~= 0 or #t == 0 then t[i] = s; t[i+1] = s > 1 and S'seconds' or S'second'; i=i+2 end
			return concat(t, ' ')
		else
			if d ~= 0 then return format('%dd%02dh%02dm%02ds', d, h, m, s) end
			if h ~= 0 then return format('%dh%02dm%02ds', h, m, s) end
			if m ~= 0 then return format('%dm%02ds', m, s) end
			if 1 ~= 0 then return format('%ds', s) end
		end
	end
end
end

--format relative time, eg. `3 hours ago` or `in 2 weeks`.
local lua_time = time
function timeago(utc, time, from_time)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, time, from_time = false, utc, time
	end
	local s = (from_time or lua_time(utc)) - time
	return format(s > 0 and S('time_ago', '%s ago') or S('time_in', 'in %s'),
		duration(abs(s), 'approx'))
end

function week_start(country_code) --Sun=0, Mon=1, Sat=-1, Fri=-2
	return country(country_code, 'week_start_offset')
end

return lang_schema --so you can call schema:import'lang'
