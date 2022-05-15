--[[

	JPEG2000 decoding & encoding based on OpenJPEG.
	Written by Cosmin Apreutesei. Public Domain.

	openjpeg.open(buf, sz) -> d
	d:dest_size([stride]) -> sz
	d:decode(buf, sz, [stride])
	d:free()


]]

local ffi = require'ffi'
local C = ffi.load'charls'

ffi.cdef[[
typedef int           OPJ_BOOL;
typedef unsigned char OPJ_BYTE;

/**
 * JPEG 2000 Profiles, see Table A.10 from 15444-1 (updated in various AMD)
 * These values help choosing the RSIZ value for the J2K codestream.
 * The RSIZ value triggers various encoding options, as detailed in Table A.10.
 * If OPJ_PROFILE_PART2 is chosen, it has to be combined with one or more extensions
 * described hereunder.
 *   Example: rsiz = OPJ_PROFILE_PART2 | OPJ_EXTENSION_MCT;
 * For broadcast profiles, the OPJ_PROFILE value has to be combined with the targeted
 * mainlevel (3-0 LSB, value between 0 and 11):
 *   Example: rsiz = OPJ_PROFILE_BC_MULTI | 0x0005; (here mainlevel 5)
 * For IMF profiles, the OPJ_PROFILE value has to be combined with the targeted mainlevel
 * (3-0 LSB, value between 0 and 11) and sublevel (7-4 LSB, value between 0 and 9):
 *   Example: rsiz = OPJ_PROFILE_IMF_2K | 0x0040 | 0x0005; (here main 5 and sublevel 4)
 * */
enum {
	OPJ_PROFILE_NONE        = 0x0000, /** no profile, conform to 15444-1 */
	OPJ_PROFILE_0           = 0x0001, /** Profile 0 as described in 15444-1,Table A.45 */
	OPJ_PROFILE_1           = 0x0002, /** Profile 1 as described in 15444-1,Table A.45 */
	OPJ_PROFILE_PART2       = 0x8000, /** At least 1 extension defined in 15444-2 (Part-2) */
	OPJ_PROFILE_CINEMA_2K   = 0x0003, /** 2K cinema profile defined in 15444-1 AMD1 */
	OPJ_PROFILE_CINEMA_4K   = 0x0004, /** 4K cinema profile defined in 15444-1 AMD1 */
	OPJ_PROFILE_CINEMA_S2K  = 0x0005, /** Scalable 2K cinema profile defined in 15444-1 AMD2 */
	OPJ_PROFILE_CINEMA_S4K  = 0x0006, /** Scalable 4K cinema profile defined in 15444-1 AMD2 */
	OPJ_PROFILE_CINEMA_LTS  = 0x0007, /** Long term storage cinema profile defined in 15444-1 AMD2 */
	OPJ_PROFILE_BC_SINGLE   = 0x0100, /** Single Tile Broadcast profile defined in 15444-1 AMD3 */
	OPJ_PROFILE_BC_MULTI    = 0x0200, /** Multi Tile Broadcast profile defined in 15444-1 AMD3 */
	OPJ_PROFILE_BC_MULTI_R  = 0x0300, /** Multi Tile Reversible Broadcast profile defined in 15444-1 AMD3 */
	OPJ_PROFILE_IMF_2K      = 0x0400, /** 2K Single Tile Lossy IMF profile defined in 15444-1 AMD 8 */
	OPJ_PROFILE_IMF_4K      = 0x0500, /** 4K Single Tile Lossy IMF profile defined in 15444-1 AMD 8 */
	OPJ_PROFILE_IMF_8K      = 0x0600, /** 8K Single Tile Lossy IMF profile defined in 15444-1 AMD 8 */
	OPJ_PROFILE_IMF_2K_R    = 0x0700, /** 2K Single/Multi Tile Reversible IMF profile defined in 15444-1 AMD 8 */
	OPJ_PROFILE_IMF_4K_R    = 0x0800, /** 4K Single/Multi Tile Reversible IMF profile defined in 15444-1 AMD 8 */
	OPJ_PROFILE_IMF_8K_R    = 0x0900, /** 8K Single/Multi Tile Reversible IMF profile defined in 15444-1 AMD 8 */
};

// JPEG 2000 Part-2 extensions
enum {
	OPJ_EXTENSION_NONE = 0x0000, /** No Part-2 extension */
	OPJ_EXTENSION_MCT  = 0x0100,  /** Custom MCT support */
};

typedef enum PROG_ORDER {
    OPJ_PROG_UNKNOWN = -1,  /**< place-holder */
    OPJ_LRCP = 0,           /**< layer-resolution-component-precinct order */
    OPJ_RLCP = 1,           /**< resolution-layer-component-precinct order */
    OPJ_RPCL = 2,           /**< resolution-precinct-component-layer order */
    OPJ_PCRL = 3,           /**< precinct-component-resolution-layer order */
    OPJ_CPRL = 4            /**< component-precinct-resolution-layer order */
} OPJ_PROG_ORDER;

typedef enum COLOR_SPACE {
    OPJ_CLRSPC_UNKNOWN = -1,    /**< not supported by the library */
    OPJ_CLRSPC_UNSPECIFIED = 0, /**< not specified in the codestream */
    OPJ_CLRSPC_SRGB = 1,        /**< sRGB */
    OPJ_CLRSPC_GRAY = 2,        /**< grayscale */
    OPJ_CLRSPC_SYCC = 3,        /**< YUV */
    OPJ_CLRSPC_EYCC = 4,        /**< e-YCC */
    OPJ_CLRSPC_CMYK = 5         /**< CMYK */
} OPJ_COLOR_SPACE;

typedef enum CODEC_FORMAT {
    OPJ_CODEC_UNKNOWN = -1, /**< place-holder */
    OPJ_CODEC_J2K  = 0,     /**< JPEG-2000 codestream : read/write */
    OPJ_CODEC_JPT  = 1,     /**< JPT-stream (JPEG 2000, JPIP) : read only */
    OPJ_CODEC_JP2  = 2,     /**< JP2 file format : read/write */
    OPJ_CODEC_JPP  = 3,     /**< JPP-stream (JPEG 2000, JPIP) : to be coded */
    OPJ_CODEC_JPX  = 4      /**< JPX file format (JPEG 2000 Part-2) : to be coded */
} OPJ_CODEC_FORMAT;

// Progression order changes
typedef struct opj_poc {
    /** Resolution num start, Component num start, given by POC */
    uint32_t resno0, compno0;
    /** Layer num end,Resolution num end, Component num end, given by POC */
    uint32_t layno1, resno1, compno1;
    /** Layer num start,Precinct num start, Precinct num end */
    uint32_t layno0, precno0, precno1;
    /** Progression order enum*/
    OPJ_PROG_ORDER prg1, prg;
    /** Progression order string*/
    char progorder[5];
    /** Tile number (starting at 1) */
    uint32_t tile;
    /** Start and end values for Tile width and height*/
    int32_t tx0, tx1, ty0, ty1;
    /** Start value, initialised in pi_initialise_encode*/
    uint32_t layS, resS, compS, prcS;
    /** End value, initialised in pi_initialise_encode */
    uint32_t layE, resE, compE, prcE;
    /** Start and end values of Tile width and height, initialised in pi_initialise_encode*/
    uint32_t txS, txE, tyS, tyE, dx, dy;
    /** Temporary values for Tile parts, initialised in pi_create_encode */
    uint32_t lay_t, res_t, comp_t, prc_t, tx0_t, ty0_t;
} opj_poc_t;

enum {
	OPJ_J2K_MAXRLVLS = 33,                     /**< Number of maximum resolution level authorized */
	OPJ_J2K_MAXBANDS = (3*OPJ_J2K_MAXRLVLS-2), /**< Number of maximum sub-band linked to number of resolution level */
	OPJ_PATH_LEN     = 4096,                   /**< Maximum allowed size for filenames */
	JPWL_MAX_NO_TILESPECS = 16,                /**< Maximum number of tile parts expected by JPWL: increase at your will */
	JPWL_MAX_NO_PACKSPECS = 16, /**< Maximum number of packet parts expected by JPWL: increase at your will */
};

/**
 * Compression parameters
 * */
typedef struct opj_cparameters {
    /** size of tile: tile_size_on = false (not in argument) or = true (in argument) */
    OPJ_BOOL tile_size_on;
    /** XTOsiz */
    int cp_tx0;
    /** YTOsiz */
    int cp_ty0;
    /** XTsiz */
    int cp_tdx;
    /** YTsiz */
    int cp_tdy;
    /** allocation by rate/distortion */
    int cp_disto_alloc;
    /** allocation by fixed layer */
    int cp_fixed_alloc;
    /** add fixed_quality */
    int cp_fixed_quality;
    /** fixed layer */
    int *cp_matrice;
    /** comment for coding */
    char *cp_comment;
    /** csty : coding style */
    int csty;
    /** progression order (default OPJ_LRCP) */
    OPJ_PROG_ORDER prog_order;
    /** progression order changes */
    opj_poc_t POC[32];
    /** number of progression order changes (POC), default to 0 */
    uint32_t numpocs;
    /** number of layers */
    int tcp_numlayers;
    /** rates of layers - might be subsequently limited by the max_cs_size field.
     * Should be decreasing. 1 can be
     * used as last value to indicate the last layer is lossless. */
    float tcp_rates[100];
    /** different psnr for successive layers. Should be increasing. 0 can be
     * used as last value to indicate the last layer is lossless. */
    float tcp_distoratio[100];
    /** number of resolutions */
    int numresolution;
    /** initial code block width, default to 64 */
    int cblockw_init;
    /** initial code block height, default to 64 */
    int cblockh_init;
    /** mode switch (cblk_style) */
    int mode;
    /** 1 : use the irreversible DWT 9-7, 0 : use lossless compression (default) */
    int irreversible;
    /** region of interest: affected component in [0..3], -1 means no ROI */
    int roi_compno;
    /** region of interest: upshift value */
    int roi_shift;
    /* number of precinct size specifications */
    int res_spec;
    /** initial precinct width */
    int prcw_init[OPJ_J2K_MAXRLVLS];
    /** initial precinct height */
    int prch_init[OPJ_J2K_MAXRLVLS];

    /**@name command line encoder parameters (not used inside the library) */
    /*@{*/
    /** input file name */
    char infile[OPJ_PATH_LEN];
    /** output file name */
    char outfile[OPJ_PATH_LEN];
    /** DEPRECATED. Index generation is now handled with the opj_encode_with_info() function. Set to NULL */
    int index_on;
    /** DEPRECATED. Index generation is now handled with the opj_encode_with_info() function. Set to NULL */
    char index[OPJ_PATH_LEN];
    /** subimage encoding: origin image offset in x direction */
    int image_offset_x0;
    /** subimage encoding: origin image offset in y direction */
    int image_offset_y0;
    /** subsampling value for dx */
    int subsampling_dx;
    /** subsampling value for dy */
    int subsampling_dy;
    /** input file format 0: PGX, 1: PxM, 2: BMP 3:TIF*/
    int decod_format;
    /** output file format 0: J2K, 1: JP2, 2: JPT */
    int cod_format;
    /*@}*/

    /* UniPG>> */ /* NOT YET USED IN THE V2 VERSION OF OPENJPEG */
    /**@name JPWL encoding parameters */
    /*@{*/
    /** enables writing of EPC in MH, thus activating JPWL */
    OPJ_BOOL jpwl_epc_on;
    /** error protection method for MH (0,1,16,32,37-128) */
    int jpwl_hprot_MH;
    /** tile number of header protection specification (>=0) */
    int jpwl_hprot_TPH_tileno[JPWL_MAX_NO_TILESPECS];
    /** error protection methods for TPHs (0,1,16,32,37-128) */
    int jpwl_hprot_TPH[JPWL_MAX_NO_TILESPECS];
    /** tile number of packet protection specification (>=0) */
    int jpwl_pprot_tileno[JPWL_MAX_NO_PACKSPECS];
    /** packet number of packet protection specification (>=0) */
    int jpwl_pprot_packno[JPWL_MAX_NO_PACKSPECS];
    /** error protection methods for packets (0,1,16,32,37-128) */
    int jpwl_pprot[JPWL_MAX_NO_PACKSPECS];
    /** enables writing of ESD, (0=no/1/2 bytes) */
    int jpwl_sens_size;
    /** sensitivity addressing size (0=auto/2/4 bytes) */
    int jpwl_sens_addr;
    /** sensitivity range (0-3) */
    int jpwl_sens_range;
    /** sensitivity method for MH (-1=no,0-7) */
    int jpwl_sens_MH;
    /** tile number of sensitivity specification (>=0) */
    int jpwl_sens_TPH_tileno[JPWL_MAX_NO_TILESPECS];
    /** sensitivity methods for TPHs (-1=no,0-7) */
    int jpwl_sens_TPH[JPWL_MAX_NO_TILESPECS];
    /*@}*/
    /* <<UniPG */

    /**
     * DEPRECATED: use RSIZ, OPJ_PROFILE_* and MAX_COMP_SIZE instead
     * Digital Cinema compliance 0-not compliant, 1-compliant
     * */
    enum cp_cinema;
    /**
     * Maximum size (in bytes) for each component.
     * If == 0, component size limitation is not considered
     * */
    int max_comp_size;
    /**
     * DEPRECATED: use RSIZ, OPJ_PROFILE_* and OPJ_EXTENSION_* instead
     * Profile name
     * */
    enum cp_rsiz;
    /** Tile part generation*/
    char tp_on;
    /** Flag for Tile part generation*/
    char tp_flag;
    /** MCT (multiple component transform) */
    char tcp_mct;
    /** Enable JPIP indexing*/
    OPJ_BOOL jpip_on;
    /** Naive implementation of MCT restricted to a single reversible array based
        encoding without offset concerning all the components. */
    void * mct_data;
    /**
     * Maximum size (in bytes) for the whole codestream.
     * If == 0, codestream size limitation is not considered
     * If it does not comply with tcp_rates, max_cs_size prevails
     * and a warning is issued.
     * */
    int max_cs_size;
    /** RSIZ value
        To be used to combine OPJ_PROFILE_*, OPJ_EXTENSION_* and (sub)levels values. */
    uint16_t rsiz;
} opj_cparameters_t;

enum {
	OPJ_DPARAMETERS_IGNORE_PCLR_CMAP_CDEF_FLAG = 0x0001,
	OPJ_DPARAMETERS_DUMP_FLAG                  = 0x0002,
};

/**
 * Decompression parameters
 * */
typedef struct opj_dparameters {
    /**
    Set the number of highest resolution levels to be discarded.
    The image resolution is effectively divided by 2 to the power of the number of discarded levels.
    The reduce factor is limited by the smallest total number of decomposition levels among tiles.
    if != 0, then original dimension divided by 2^(reduce);
    if == 0 or not used, image is decoded to the full resolution
    */
    uint32_t cp_reduce;
    /**
    Set the maximum number of quality layers to decode.
    If there are less quality layers than the specified number, all the quality layers are decoded.
    if != 0, then only the first "layer" layers are decoded;
    if == 0 or not used, all the quality layers are decoded
    */
    uint32_t cp_layer;

    /**@name command line decoder parameters (not used inside the library) */
    /*@{*/
    /** input file name */
    char infile[OPJ_PATH_LEN];
    /** output file name */
    char outfile[OPJ_PATH_LEN];
    /** input file format 0: J2K, 1: JP2, 2: JPT */
    int decod_format;
    /** output file format 0: PGX, 1: PxM, 2: BMP */
    int cod_format;

    /** Decoding area left boundary */
    uint32_t DA_x0;
    /** Decoding area right boundary */
    uint32_t DA_x1;
    /** Decoding area up boundary */
    uint32_t DA_y0;
    /** Decoding area bottom boundary */
    uint32_t DA_y1;
    /** Verbose mode */
    OPJ_BOOL m_verbose;

    /** tile number of the decoded tile */
    uint32_t tile_index;
    /** Nb of tile to decode */
    uint32_t nb_tile_to_decode;

    /*@}*/

    /* UniPG>> */ /* NOT YET USED IN THE V2 VERSION OF OPENJPEG */
    /**@name JPWL decoding parameters */
    /*@{*/
    /** activates the JPWL correction capabilities */
    OPJ_BOOL jpwl_correct;
    /** expected number of components */
    int jpwl_exp_comps;
    /** maximum number of tiles */
    int jpwl_max_tiles;
    /*@}*/
    /* <<UniPG */

    unsigned int flags;

} opj_dparameters_t;


typedef void* opj_codec_t;

/*
==========================================================
   I/O stream typedef definitions
==========================================================
*/

enum {
	OPJ_STREAM_READ = 0,
	OPJ_STREAM_WRITE = 1
};

typedef void * opj_stream_t;

typedef struct opj_image_comp {
    /** XRsiz: horizontal separation of a sample of ith component with respect to the reference grid */
    uint32_t dx;
    /** YRsiz: vertical separation of a sample of ith component with respect to the reference grid */
    uint32_t dy;
    /** data width */
    uint32_t w;
    /** data height */
    uint32_t h;
    /** x component offset compared to the whole image */
    uint32_t x0;
    /** y component offset compared to the whole image */
    uint32_t y0;
    /** precision: number of bits per component per pixel */
    uint32_t prec;
    /** obsolete: use prec instead */
    uint32_t bpp;
    /** signed (1) / unsigned (0) */
    uint32_t sgnd;
    /** number of decoded resolution */
    uint32_t resno_decoded;
    /** number of division by 2 of the out image compared to the original size of image */
    uint32_t factor;
    /** image component data */
    int32_t *data;
    /** alpha channel */
    uint16_t alpha;
} opj_image_comp_t;

typedef struct opj_image {
    /** XOsiz: horizontal offset from the origin of the reference grid to the left side of the image area */
    uint32_t x0;
    /** YOsiz: vertical offset from the origin of the reference grid to the top side of the image area */
    uint32_t y0;
    /** Xsiz: width of the reference grid */
    uint32_t x1;
    /** Ysiz: height of the reference grid */
    uint32_t y1;
    /** number of components in the image */
    uint32_t numcomps;
    /** color space: sRGB, Greyscale or YUV */
    OPJ_COLOR_SPACE color_space;
    /** image components */
    opj_image_comp_t *comps;
    /** 'restricted' ICC profile */
    OPJ_BYTE *icc_profile_buf;
    /** size of ICC profile */
    uint32_t icc_profile_len;
} opj_image_t;

typedef struct opj_image_comptparm {
    /** XRsiz: horizontal separation of a sample of ith component with respect to the reference grid */
    uint32_t dx;
    /** YRsiz: vertical separation of a sample of ith component with respect to the reference grid */
    uint32_t dy;
    /** data width */
    uint32_t w;
    /** data height */
    uint32_t h;
    /** x component offset compared to the whole image */
    uint32_t x0;
    /** y component offset compared to the whole image */
    uint32_t y0;
    /** precision: number of bits per component per pixel */
    uint32_t prec;
    /** obsolete: use prec instead */
    uint32_t bpp;
    /** signed (1) / unsigned (0) */
    uint32_t sgnd;
} opj_image_cmptparm_t;

opj_image_t* opj_image_create(uint32_t numcmpts, opj_image_cmptparm_t *cmptparms, OPJ_COLOR_SPACE clrspc);
void opj_image_destroy(opj_image_t *image);
opj_image_t* opj_image_tile_create(uint32_t numcmpts, opj_image_cmptparm_t *cmptparms, OPJ_COLOR_SPACE clrspc);
void* opj_image_data_alloc(size_t size);
void opj_image_data_free(void* ptr);

opj_stream_t* opj_stream_create(size_t p_buffer_size, OPJ_BOOL p_is_input);
void opj_stream_destroy(opj_stream_t* p_stream);

opj_codec_t* opj_create_decompress(OPJ_CODEC_FORMAT format);
void opj_destroy_codec(opj_codec_t * p_codec);
OPJ_BOOL opj_end_decompress(opj_codec_t *p_codec, opj_stream_t *p_stream);
void opj_set_default_decoder_parameters(opj_dparameters_t *parameters);
OPJ_BOOL opj_setup_decoder(opj_codec_t *p_codec, opj_dparameters_t *parameters);
OPJ_BOOL opj_decoder_set_strict_mode(opj_codec_t *p_codec, OPJ_BOOL strict);
OPJ_BOOL opj_codec_set_threads(opj_codec_t *p_codec, int num_threads);
OPJ_BOOL opj_read_header(opj_stream_t *p_stream, opj_codec_t *p_codec, opj_image_t **p_image);
OPJ_BOOL opj_decode(opj_codec_t *p_decompressor, opj_stream_t *p_stream, opj_image_t *p_image);

/**
 * Set the resolution factor of the decoded image
 * @param   p_codec         the jpeg2000 codec.
 * @param   res_factor      resolution factor to set
 *
 * @return                  true if success, otherwise false
 */
OPJ_BOOL opj_set_decoded_resolution_factor(
    opj_codec_t *p_codec, uint32_t res_factor);

/**
 * Writes a tile with the given data.
 *
 * @param   p_codec             the jpeg2000 codec.
 * @param   p_tile_index        the index of the tile to write. At the moment, the tiles must be written from 0 to n-1 in sequence.
 * @param   p_data              pointer to the data to write. Data is arranged in sequence, data_comp0, then data_comp1, then ... NO INTERLEAVING should be set.
 * @param   p_data_size         this value os used to make sure the data being written is correct. The size must be equal to the sum for each component of
 *                              tile_width * tile_height * component_size. component_size can be 1,2 or 4 bytes, depending on the precision of the given component.
 * @param   p_stream            the stream to write data to.
 *
 * @return  true if the data could be written.
 */
OPJ_BOOL opj_write_tile(opj_codec_t *p_codec,
        uint32_t p_tile_index,
        OPJ_BYTE * p_data,
        uint32_t p_data_size,
        opj_stream_t *p_stream);

/**
 * Reads a tile header. This function is compulsory and allows one to know
 the size of the tile that will be decoded.
 * The user may need to refer to the image got by opj_read_header to understand
 the size being taken by the tile.
 *
 * @param   p_codec         the jpeg2000 codec.
 * @param   p_tile_index    pointer to a value that will hold the index of the tile being decoded, in case of success.
 * @param   p_data_size     pointer to a value that will hold the maximum size of the decoded data, in case of success. In case
 *                          of truncated codestreams, the actual number of bytes decoded may be lower. The computation of the size is the same
 *                          as depicted in opj_write_tile.
 * @param   p_tile_x0       pointer to a value that will hold the x0 pos of the tile (in the image).
 * @param   p_tile_y0       pointer to a value that will hold the y0 pos of the tile (in the image).
 * @param   p_tile_x1       pointer to a value that will hold the x1 pos of the tile (in the image).
 * @param   p_tile_y1       pointer to a value that will hold the y1 pos of the tile (in the image).
 * @param   p_nb_comps      pointer to a value that will hold the number of components in the tile.
 * @param   p_should_go_on  pointer to a boolean that will hold the fact that the decoding should go on. In case the
 *                          codestream is over at the time of the call, the value will be set to false. The user should then stop
 *                          the decoding.
 * @param   p_stream        the stream to decode.
 * @return  true            if the tile header could be decoded. In case the decoding should end, the returned value is still true.
 *                          returning false may be the result of a shortage of memory or an internal error.
 */
OPJ_BOOL opj_read_tile_header(opj_codec_t *p_codec,
        opj_stream_t * p_stream,
        uint32_t * p_tile_index,
        uint32_t * p_data_size,
        int32_t * p_tile_x0, int32_t * p_tile_y0,
        int32_t * p_tile_x1, int32_t * p_tile_y1,
        uint32_t * p_nb_comps,
        OPJ_BOOL * p_should_go_on);

/**
 * Reads a tile data. This function is compulsory and allows one to decode tile data.
 opj_read_tile_header should be called before.
 * The user may need to refer to the image got by opj_read_header to understand
 the size being taken by the tile.
 *
 * Note: opj_decode_tile_data() should not be used together with opj_set_decoded_components().
 *
 * @param   p_codec         the jpeg2000 codec.
 * @param   p_tile_index    the index of the tile being decoded, this should be the value set by opj_read_tile_header.
 * @param   p_data          pointer to a memory block that will hold the decoded data.
 * @param   p_data_size     size of p_data. p_data_size should be bigger or equal to the value set by opj_read_tile_header.
 * @param   p_stream        the stream to decode.
 *
 * @return  true            if the data could be decoded.
 */
OPJ_BOOL opj_decode_tile_data(opj_codec_t *p_codec,
        uint32_t p_tile_index,
        OPJ_BYTE * p_data,
        uint32_t p_data_size,
        opj_stream_t *p_stream);

opj_codec_t* opj_create_compress(OPJ_CODEC_FORMAT format);
void opj_set_default_encoder_parameters(opj_cparameters_t *parameters);
OPJ_BOOL opj_setup_encoder(opj_codec_t *p_codec, opj_cparameters_t *parameters, opj_image_t *image);
OPJ_BOOL opj_encoder_set_extra_options(opj_codec_t *p_codec, const char* const* p_options);
OPJ_BOOL opj_start_compress(opj_codec_t *p_codec, opj_image_t * p_image, opj_stream_t *p_stream);
OPJ_BOOL opj_end_compress(opj_codec_t *p_codec, opj_stream_t *p_stream);
OPJ_BOOL opj_encode(opj_codec_t *p_codec, opj_stream_t *p_stream);

]]

local M = {}

local decoder = {}

function decoder.open(buf, sz)
	FORMAT = (CODEC_J2K | CODEC_JP2 )

opj_dparameters_t parameters;
opj_image_t *image;
opj_dinfo_t *dinfo;
unsigned char *buf;
long buf_len;

opj_set_default_decoder_parameters(parameters);
dinfo = C.opj_create_decompress(CODEC_J2K + CODEC_JP2)
C.opj_setup_decoder(dinfo, &parameters);

cio = opj_cio_open((opj_common_ptr)dinfo, buf, buf_len);

image = opj_decode(dinfo, cio);

--[==[
'opj_decode()' fills image->comps[0-3].data, if the file is a valid
J2K/JP2 file. If it is not, then 'image' should be NULL.

What is in a file/image depends on the

typedef enum COLOR_SPACE {
CLRSPC_UNKNOWN = -1, /**< not supported by the library */
CLRSPC_UNSPECIFIED = 0, /**< not specified in the codestream */
CLRSPC_SRGB = 1, /**< sRGB */
CLRSPC_GRAY = 2, /**< grayscale */
CLRSPC_SYCC = 3 /**< YUV */
} OPJ_COLOR_SPACE;

returned in the 'image->color_space' ( see openjpeg.h ).

An image may have up to four channels:

image->numcomps == 1 : GRAY image
image->numcomps == 2 : GRAY_ALPHA image
image->numcomps == 3 : sRGB image or sYCC image
image->numcomps == 4 : sRGB_ALPHA image

if(dinfo)
{
mj2_destroy_decompress(movie);
}

return M
]==]
