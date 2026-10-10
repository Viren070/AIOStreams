cmake_minimum_required(VERSION 3.22.1)
project(aiostreams_exoplayer C)

# ass/ holds libass's public headers, 0.17.4 as libmpv carries it; the library is loaded from libmpv.
add_library(aiostreams_ass SHARED ass_surface.c)
target_compile_options(aiostreams_ass PRIVATE -O3 -Wall)
target_link_libraries(aiostreams_ass PRIVATE android dl log)

add_library(aiostreams_dolby_vision SHARED dolby_vision.c)
target_compile_options(aiostreams_dolby_vision PRIVATE -O3 -Wall)
target_link_libraries(aiostreams_dolby_vision PRIVATE dl)
