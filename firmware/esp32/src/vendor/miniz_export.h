#pragma once
#define MINIZ_EXPORT

// ESP32 ROM exports another miniz ABI under these names. Keep our pinned
// decompressor and its state allocation together instead of resolving to ROM.
#define tinfl_decompress casa_tinfl_decompress
#define tinfl_decompress_mem_to_mem casa_tinfl_decompress_mem_to_mem
#define tinfl_decompress_mem_to_heap casa_tinfl_decompress_mem_to_heap
#define tinfl_decompress_mem_to_callback casa_tinfl_decompress_mem_to_callback
#define tinfl_decompressor_alloc casa_tinfl_decompressor_alloc
#define tinfl_decompressor_free casa_tinfl_decompressor_free
