// Drawing a picture with GL: its masks go up as alpha into an atlas, in as few uploads as a draw can do
// with, as a call costs some drivers far more than its bytes, and the GPU blends them over each other as
// tinted quads, in order. While it lasts, the store keeps masks nothing shows, as they'd still be on the
// GPU when shown again.
#pragma once

#include "masks.h"

typedef struct GlMasks GlMasks;

// Both with the context current. `small` for a device short of memory.
GlMasks *gl_masks_new(MaskStore *store, int small);
void gl_masks_free(GlMasks *gl);

// Clears the `width` by `height` window and draws the picture over it.
void gl_masks_draw(GlMasks *gl, Picture *picture, int width, int height);
