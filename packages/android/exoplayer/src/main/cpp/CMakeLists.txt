cmake_minimum_required(VERSION 3.22.1)
project(aiostreams_exoplayer C)

# ass/ holds the public headers of the libass linked into libmpv.so, which the library is loaded from.
add_library(aiostreams_ass SHARED ass_surface.c)
target_compile_options(aiostreams_ass PRIVATE -O3 -Wall)
target_link_libraries(aiostreams_ass PRIVATE android dl log EGL GLESv2)

add_library(aiostreams_dolby_vision SHARED dolby_vision.c)
target_compile_options(aiostreams_dolby_vision PRIVATE -O3 -Wall)
target_link_libraries(aiostreams_dolby_vision PRIVATE dl)

add_library(aiostreams_stream_cache SHARED stream_cache.c)
target_compile_options(aiostreams_stream_cache PRIVATE -O3 -Wall)

add_library(aiostreams_sound SHARED sound_shaper.c)
target_compile_options(aiostreams_sound PRIVATE -O3 -Wall)
target_link_libraries(aiostreams_sound PRIVATE m)
