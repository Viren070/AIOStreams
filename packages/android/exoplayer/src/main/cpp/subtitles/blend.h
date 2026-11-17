// Drawing a picture on the CPU: each mask's colour over what's below it, premultiplied.
#pragma once

#include <stdint.h>
#include "masks.h"

// Blends `placed` into `bits`, whose rows are `stride` pixels and whose first pixel is the frame's (`left`, `top`).
void blend(const Placed *placed, uint32_t *bits, int stride, int left, int top);
