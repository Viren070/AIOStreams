#pragma once

#include <GLES2/gl2.h>

// A linked program whose attributes are bound in order from 0; 0 when it doesn't compile or link.
GLuint gl_program(const char *vertex, const char *fragment, const char *const *attributes, int count);

// A texture of `format` that samples texel for pixel, bound.
GLuint gl_texture(GLenum format, int width, int height);
