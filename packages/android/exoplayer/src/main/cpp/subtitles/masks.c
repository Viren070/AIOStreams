#include "masks.h"

#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define BUCKETS 8192

struct MaskStore {
    pthread_mutex_t lock;
    Mask *buckets[BUCKETS];
    Mask *oldest, *newest;  // those nothing shows
    size_t kept, keep;
    atomic_size_t bytes;
    GpuPlace *retired;
    int retired_count, retired_cap;
};

MaskStore *masks_new(void) {
    MaskStore *store = calloc(1, sizeof(MaskStore));
    if (store) pthread_mutex_init(&store->lock, NULL);
    return store;
}

static unsigned bucket(uint32_t cache_id, const unsigned char *bitmap, int w, int h) {
    uint32_t hash = cache_id * 2654435761u ^ (uint32_t) (uintptr_t) bitmap * 40503u;
    return (hash ^ (uint32_t) w * 97u ^ (uint32_t) h) % BUCKETS;
}

static int same_view(const Mask *mask, const ASS_Image *image) {
    return mask->cache_id == image->cache_id && mask->bitmap == image->bitmap && mask->w == image->w &&
           mask->h == image->h && mask->stride == image->stride;
}

static size_t mask_bytes(const Mask *mask) { return (size_t) mask->w * mask->h; }

// Under the lock.
static void forget(MaskStore *store, Mask *mask) {
    if (mask->cache_id) {
        Mask **link = &store->buckets[bucket(mask->cache_id, mask->bitmap, mask->w, mask->h)];
        while (*link != mask) link = &(*link)->next;
        *link = mask->next;
    }
    if (mask->gpu.texture) {
        if (store->retired_count == store->retired_cap) {
            int cap = store->retired_cap ? store->retired_cap * 2 : 64;
            GpuPlace *grown = realloc(store->retired, cap * sizeof(GpuPlace));
            if (grown) {
                store->retired = grown;
                store->retired_cap = cap;
            }
        }
        // Without room the texture stays until its context goes.
        if (store->retired_count < store->retired_cap) store->retired[store->retired_count++] = mask->gpu;
    }
    free(mask->pixels);
    free(mask);
}

static void unkeep(MaskStore *store, Mask *mask) {
    *(mask->older ? &mask->older->newer : &store->oldest) = mask->newer;
    *(mask->newer ? &mask->newer->older : &store->newest) = mask->older;
    mask->older = mask->newer = NULL;
    store->kept -= mask_bytes(mask);
}

// Under the lock: the image's mask, found or made; a made one's pixels are copied once the lock is let go.
static Mask *take(MaskStore *store, const ASS_Image *image, int *made) {
    // An image with no cache id has no lasting bitmap, so its copy isn't shared.
    Mask **head = image->cache_id ? &store->buckets[bucket(image->cache_id, image->bitmap, image->w, image->h)] : NULL;
    for (Mask *mask = head ? *head : NULL; mask; mask = mask->next) {
        if (!same_view(mask, image)) continue;
        if (!mask->refs++) {
            unkeep(store, mask);
            atomic_fetch_add(&store->bytes, mask_bytes(mask));
        }
        return mask;
    }
    Mask *mask = calloc(1, sizeof(Mask));
    unsigned char *pixels = malloc((size_t) image->w * image->h);
    if (!mask || !pixels) {
        free(mask);
        free(pixels);
        return NULL;
    }
    *mask = (Mask) {
        .cache_id = image->cache_id, .bitmap = image->bitmap,
        .w = image->w, .h = image->h, .stride = image->stride, .refs = 1, .pixels = pixels,
    };
    if (head) {
        mask->next = *head;
        *head = mask;
    }
    atomic_fetch_add(&store->bytes, mask_bytes(mask));
    *made = 1;
    return mask;
}

// Under the lock.
static void trim(MaskStore *store) {
    while (store->kept > store->keep) {
        Mask *oldest = store->oldest;
        unkeep(store, oldest);
        forget(store, oldest);
    }
}

// Under the lock.
static void drop(MaskStore *store, Mask *mask) {
    if (--mask->refs) return;
    atomic_fetch_sub(&store->bytes, mask_bytes(mask));
    if (!mask->cache_id || !store->keep) {
        forget(store, mask);
        return;
    }
    *(store->newest ? &store->newest->newer : &store->oldest) = mask;
    mask->older = store->newest;
    store->newest = mask;
    store->kept += mask_bytes(mask);
    trim(store);
}

Picture *masks_picture(MaskStore *store, const ASS_Image *images) {
    int count = 0;
    for (const ASS_Image *image = images; image; image = image->next) count += image->w > 0 && image->h > 0;
    Picture *picture = malloc(sizeof(Picture) + count * sizeof(Placed));
    unsigned char *made = calloc(count ? count : 1, 1);
    if (!picture || !made) {
        free(picture);
        free(made);
        return NULL;
    }
    picture->refs = 1;
    picture->count = 0;
    int failed = 0;
    pthread_mutex_lock(&store->lock);
    for (const ASS_Image *image = images; image; image = image->next) {
        if (image->w <= 0 || image->h <= 0) continue;
        int fresh = 0;
        Mask *mask = take(store, image, &fresh);
        if (!mask) {
            failed = 1;
            break;
        }
        made[picture->count] = fresh;
        picture->placed[picture->count++] = (Placed) {mask, image->dst_x, image->dst_y, image->color};
    }
    pthread_mutex_unlock(&store->lock);

    // Only this thread makes masks, and nothing shows the made ones until the picture is handed on.
    int i = 0;
    for (const ASS_Image *image = images; image && i < picture->count; image = image->next) {
        if (image->w <= 0 || image->h <= 0) continue;
        if (made[i]) {
            unsigned char *pixels = picture->placed[i].mask->pixels;
            for (int y = 0; y < image->h; y++)
                memcpy(pixels + (size_t) y * image->w, image->bitmap + (size_t) y * image->stride, image->w);
        }
        i++;
    }
    free(made);
    atomic_fetch_add(&store->bytes, sizeof(Picture) + picture->count * sizeof(Placed));
    if (failed) {
        masks_release(store, picture);
        return NULL;
    }
    return picture;
}

void masks_release(MaskStore *store, Picture *picture) {
    if (!picture) return;
    pthread_mutex_lock(&store->lock);
    for (int i = 0; i < picture->count; i++) drop(store, picture->placed[i].mask);
    pthread_mutex_unlock(&store->lock);
    atomic_fetch_sub(&store->bytes, sizeof(Picture) + picture->count * sizeof(Placed));
    free(picture);
}

size_t masks_bytes(MaskStore *store) { return atomic_load(&store->bytes); }

void masks_keep(MaskStore *store, size_t bytes) {
    pthread_mutex_lock(&store->lock);
    store->keep = bytes;
    trim(store);
    pthread_mutex_unlock(&store->lock);
}

int masks_take_retired(MaskStore *store, GpuPlace *places, int max) {
    pthread_mutex_lock(&store->lock);
    int count = store->retired_count < max ? store->retired_count : max;
    if (count) {
        store->retired_count -= count;
        memcpy(places, store->retired + store->retired_count, count * sizeof(GpuPlace));
    }
    pthread_mutex_unlock(&store->lock);
    return count;
}

void masks_free(MaskStore *store) {
    if (!store) return;
    for (int i = 0; i < BUCKETS; i++) {
        for (Mask *mask = store->buckets[i], *next; mask; mask = next) {
            next = mask->next;
            free(mask->pixels);
            free(mask);
        }
    }
    free(store->retired);
    pthread_mutex_destroy(&store->lock);
    free(store);
}
