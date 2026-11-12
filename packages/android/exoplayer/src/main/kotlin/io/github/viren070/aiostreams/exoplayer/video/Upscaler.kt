package io.github.viren070.aiostreams.exoplayer.video

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES30
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.view.Surface
import android.view.SurfaceHolder
import io.github.viren070.aiostreams.logs.AppLog
import io.github.viren070.aiostreams.playback.UpscaleNetwork
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Draws the decoder's frames through the upscaling network to a window on its own thread. Each is shown
 * at the time ExoPlayer released it, which is ahead of when it shows, so the work doesn't delay it.
 */
internal class Upscaler(
    private val network: UpscaleNetwork,
    onReady: (Upscaler?) -> Unit,
    private val onTooSlow: () -> Unit,
) : SurfaceHolder.Callback {
    private val thread = HandlerThread("upscaler", Process.THREAD_PRIORITY_DISPLAY).apply { start() }
    private val handler = Handler(thread.looper)
    private val matrix = FloatArray(16)

    private lateinit var display: EGLDisplay
    private lateinit var config: EGLConfig
    private lateinit var context: EGLContext
    private lateinit var idle: EGLSurface
    private lateinit var texture: SurfaceTexture
    private var external = 0
    private var native = 0L

    private var window: EGLSurface? = null
    private var windowSurface: Surface? = null
    private var windowWidth = 0
    private var windowHeight = 0
    private var videoWidth = 0
    private var videoHeight = 0
    private var hasFrame = false
    private var frameRate = 0f

    private var frames = 0
    private var busyFrames = 0
    private var settling = SETTLE_FRAMES
    private var reported = false

    lateinit var input: Surface
        private set

    init {
        handler.post {
            val ok = runCatching { setUp() }.onFailure { AppLog.w(TAG, "couldn't set up", it) }.getOrDefault(false)
            if (!ok) quit()
            onReady(if (ok) this else null)
        }
    }

    private fun setUp(): Boolean {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        if (!EGL14.eglInitialize(display, version, 0, version, 1)) return false
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        EGL14.eglChooseConfig(display, CONFIG, 0, configs, 0, 1, count, 0)
        config = configs[0].takeIf { count[0] > 0 } ?: return false
        context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, CONTEXT, 0)
        if (context == EGL14.EGL_NO_CONTEXT) return false
        idle = EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
        if (!EGL14.eglMakeCurrent(display, idle, idle, context)) return false

        val steepen = network.steepen
        val fragments = buildList {
            add(LUMA)
            add(if (steepen != null) steepened(network.span, steepen) else SHUFFLE)
            add(compose(steepen?.span ?: network.span))
            add(PLAIN)
            add(CHANGE)
            add(GROW)
            add(MARK)
            add(REFRESH)
            add(RANGE)
            network.layers.forEachIndexed { i, layer -> add(layerShader(layer, i == 0)) }
        }
        val started = System.nanoTime()
        native = UpscalerNative.create(VERTEX, fragments.toTypedArray(), steepen != null)
        if (native == 0L) return false
        AppLog.i(TAG, "${GLES30.glGetString(GLES30.GL_RENDERER)}: ${fragments.size} programs in ${(System.nanoTime() - started) / 1_000_000} ms")

        val ids = IntArray(1)
        GLES30.glGenTextures(1, ids, 0)
        external = ids[0]
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, external)
        GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
        texture = SurfaceTexture(external)
        input = Surface(texture)
        texture.setOnFrameAvailableListener({
            runCatching { frame() }.onFailure {
                AppLog.w(TAG, "frame failed", it)
                tooSlow()
            }
        }, handler)
        return true
    }

    fun setVideoSize(width: Int, height: Int) = handler.post {
        if (width == videoWidth && height == videoHeight) return@post
        videoWidth = width
        videoHeight = height
        hasFrame = false
        texture.setDefaultBufferSize(width, height)
        if (!UpscalerNative.size(native, width, height)) {
            AppLog.w(TAG, "no room for ${width}x$height")
            tooSlow()
        }
        settle()
    }

    /** The rate the compositor should run the window at, as ExoPlayer asks of a window it holds. */
    fun setFrameRate(rate: Float) = handler.post {
        frameRate = rate
        applyFrameRate()
    }

    fun attach(holder: SurfaceHolder) {
        holder.addCallback(this)
        if (holder.surface?.isValid == true) {
            val size = holder.surfaceFrame
            setWindow(holder.surface, size.width(), size.height())
        }
    }

    fun detach(holder: SurfaceHolder) {
        holder.removeCallback(this)
        setWindow(null, 0, 0)
    }

    override fun surfaceCreated(holder: SurfaceHolder) = Unit

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) =
        setWindow(holder.surface, width, height)

    override fun surfaceDestroyed(holder: SurfaceHolder) = setWindow(null, 0, 0)

    /** Returns once done: a window must be let go of before the holder's callback returns, or before the decoder takes it. */
    private fun setWindow(surface: Surface?, width: Int, height: Int) {
        val done = CountDownLatch(1)
        handler.post {
            runCatching { useWindow(surface, width, height) }.onFailure { AppLog.w(TAG, "window failed", it) }
            done.countDown()
        }
        if (!done.await(WINDOW_WAIT_MS, TimeUnit.MILLISECONDS)) AppLog.w(TAG, "window change timed out")
    }

    private fun useWindow(surface: Surface?, width: Int, height: Int) {
        if (surface != windowSurface) {
            window?.let {
                EGL14.eglMakeCurrent(display, idle, idle, context)
                EGL14.eglDestroySurface(display, it)
            }
            window = null
            windowSurface = null
            if (surface != null) {
                val created = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
                if (created == EGL14.EGL_NO_SURFACE || created == null) {
                    AppLog.w(TAG, "no window: EGL error ${EGL14.eglGetError()}")
                    return tooSlow()
                }
                window = created
                windowSurface = surface
                EGL14.eglMakeCurrent(display, created, created, context)
                applyFrameRate()
            }
        }
        windowWidth = width
        windowHeight = height
        settle()
        // A paused video has no next frame to bring the new window its picture.
        if (window != null && hasFrame) draw(System.nanoTime())
    }

    private fun applyFrameRate() {
        val surface = windowSurface ?: return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                surface.setFrameRate(frameRate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, Surface.CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS)
            } else {
                surface.setFrameRate(frameRate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE)
            }
        }
    }

    private fun frame() {
        texture.updateTexImage()
        texture.getTransformMatrix(matrix)
        hasFrame = true
        if (window != null) draw(texture.timestamp)
    }

    private fun draw(shownAtNs: Long) {
        val current = window ?: return
        if (videoWidth == 0) return
        val useNetwork = windowHeight >= videoHeight * UpscaleNetwork.MIN_SCALE
        val busy = UpscalerNative.draw(native, external, matrix, windowWidth, windowHeight, useNetwork)
        EGLExt.eglPresentationTimeANDROID(display, current, shownAtNs)
        if (!EGL14.eglSwapBuffers(display, current)) {
            AppLog.w(TAG, "swap failed: EGL error ${EGL14.eglGetError()}")
            return tooSlow()
        }
        if (useNetwork) watch(busy)
    }

    private fun watch(busy: Boolean) {
        if (settling > 0) {
            settling--
            return
        }
        frames++
        if (busy) busyFrames++
        if (frames < WINDOW_FRAMES) return
        val tooMany = busyFrames * 100 >= frames * BUSY_PERCENT
        if (tooMany) AppLog.i(TAG, "${videoWidth}x$videoHeight: $busyFrames of $frames frames ran late")
        frames = 0
        busyFrames = 0
        if (tooMany) tooSlow()
    }

    private fun settle() {
        settling = SETTLE_FRAMES
        frames = 0
        busyFrames = 0
    }

    private fun tooSlow() {
        if (reported) return
        reported = true
        onTooSlow()
    }

    /** For another video, which has no frame to show yet and may suit this device better. */
    fun reset() = handler.post {
        reported = false
        hasFrame = false
        settle()
    }

    fun release() {
        handler.post {
            runCatching {
                EGL14.eglMakeCurrent(display, idle, idle, context)
                window?.let { EGL14.eglDestroySurface(display, it) }
                UpscalerNative.release(native)
                input.release()
                texture.release()
                EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                EGL14.eglDestroySurface(display, idle)
                EGL14.eglDestroyContext(display, context)
            }
            quit()
        }
    }

    private fun quit() {
        thread.quitSafely()
    }

    private fun layerShader(layer: UpscaleNetwork.Layer, first: Boolean) = buildString {
        append(LAYER_HEAD)
        append("void main(){vec4 r=vec4(${layer.bias.joinToString(",")});\n")
        for (y in 0..2) for (x in 0..2) {
            val tap = "textureOffset(t0,uv,ivec2(${(x - 1) * layer.step},${(y - 1) * layer.step}))"
            if (layer.isEmpty(y, x)) continue
            if (first) {
                append("r+=vec4(${layer.column(y, x, 0).joinToString(",")})*$tap.r;\n")
            } else {
                append("r+=mat4(${(0..3).joinToString(",") { c -> layer.column(y, x, c).joinToString(",") }})*$tap;\n")
            }
        }
        append("o=r;}\n")
    }

    private companion object {
        const val TAG = "upscaler"
        const val WINDOW_WAIT_MS = 2000L

        // The GPU's clock takes a moment to rise, so the first frames after a change don't count.
        const val SETTLE_FRAMES = 90
        const val WINDOW_FRAMES = 120
        const val BUSY_PERCENT = 20

        val CONFIG = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT, EGL14.EGL_NONE,
        )
        val CONTEXT = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE)

        const val VERTEX = "#version 300 es\nout highp vec2 uv;\n" +
            "void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n"

        const val HEAD = "#version 300 es\nprecision mediump float;\nprecision mediump sampler2D;\nin highp vec2 uv;\nout vec4 o;\n"
        const val LAYER_HEAD = HEAD + "uniform sampler2D t0;\n"
        const val EXTERNAL_HEAD = "#version 300 es\n#extension GL_OES_EGL_image_external_essl3 : require\n" +
            "precision mediump float;\nprecision mediump sampler2D;\nin highp vec2 uv;\nout vec4 o;\n" +
            "uniform mediump samplerExternalOES t0;\nuniform highp mat4 st;\n"

        // The network reads rows from the picture's top, and the transform's coordinates start at its bottom.
        const val LUMA = EXTERNAL_HEAD +
            "void main(){o=vec4(dot(texture(t0,(st*vec4(uv.x,1.-uv.y,0.,1.)).xy).rgb,vec3(.299,.587,.114)));}\n"
        const val TILE_HEAD = LAYER_HEAD + "uniform sampler2D t1;\n"
        const val SHUFFLE = TILE_HEAD +
            "void main(){highp ivec2 p=ivec2(gl_FragCoord.xy);if(texelFetch(t1,p>>5,0).r<.5)discard;" +
            "highp ivec2 f=p&1;o=vec4(texelFetch(t0,p>>1,0)[f.y*2+f.x]);}\n"

        // A tile is redone once its luma moved on average, or in any pixel by a lot, so grain alone doesn't.
        const val CHANGE = TILE_HEAD +
            "void main(){highp ivec2 s=textureSize(t0,0)-1;highp ivec2 a=ivec2(gl_FragCoord.xy)*16;highp float sum=0.;float most=0.;" +
            "for(int y=0;y<16;y++)for(int x=0;x<16;x++){highp ivec2 p=min(a+ivec2(x,y),s);" +
            "float d=abs(texelFetch(t0,p,0).r-texelFetch(t1,p,0).r);sum+=d;most=max(most,d);}" +
            "o=vec4(sum>256.*3./255.||most>40./255.?1.:0.);}\n"

        // The network reaches a pixel per layer, inside one tile, so the tiles around a changed one run too.
        const val GROW = LAYER_HEAD +
            "void main(){highp ivec2 p=ivec2(gl_FragCoord.xy);highp ivec2 s=textureSize(t0,0)-1;float m=0.;" +
            "for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)m=max(m,texelFetch(t0,clamp(p+ivec2(x,y),ivec2(0),s),0).r);o=vec4(m);}\n"
        const val MARK = LAYER_HEAD + "void main(){if(texelFetch(t0,ivec2(gl_FragCoord.xy)>>4,0).r<.5)discard;o=vec4(0.);}\n"
        const val REFRESH = TILE_HEAD +
            "void main(){highp ivec2 p=ivec2(gl_FragCoord.xy);if(texelFetch(t1,p>>4,0).r<.5)discard;o=texelFetch(t0,p,0);}\n"
        const val PLAIN = EXTERNAL_HEAD + "void main(){o=vec4(texture(t0,(st*vec4(uv,0.,1.)).xy).rgb,1.);}\n"

        const val RANGE = LAYER_HEAD +
            "void main(){highp ivec2 p=ivec2(gl_FragCoord.xy);highp ivec2 s=textureSize(t0,0)-1;float lo=1.;float hi=0.;" +
            "for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){float l=texelFetch(t0,clamp(p+ivec2(x,y),ivec2(0),s),0).r;" +
            "lo=min(lo,l);hi=max(hi,l);}o=vec4(lo,hi,0.,0.);}\n"

        fun steepened(networkSpan: Float, steepen: UpscaleNetwork.Steepen) = with(steepen) {
            TILE_HEAD + "uniform sampler2D t2;\nuniform sampler2D t3;\n" +
                "void main(){highp ivec2 p=ivec2(gl_FragCoord.xy);if(texelFetch(t1,p>>5,0).r<.5)discard;" +
                "highp ivec2 f=p&1;highp ivec2 q=p>>1;float e=(texelFetch(t0,q,0)[f.y*2+f.x]-.5)*$networkSpan;" +
                "highp vec2 size=vec2(textureSize(t2,0));float y=texture(t2,(vec2(p)+.5)/(2.*size)).r+e;" +
                "vec2 r=texelFetch(t3,q,0).rg;float gate=clamp((r.y-r.x-$low)/${high - low},0.,1.);" +
                "float mid=(r.x+r.y)*.5;float reach=max((r.y-r.x)*.5,1e-4);float t=clamp((y-mid)/reach,-4.,4.);" +
                "float s=mid+(reach+(t<0.?$darken:0.))*tanh($strength*t)*${1f / kotlin.math.tanh(strength)};" +
                "o=vec4((e+gate*(s-y))/$span+.5);}\n"
        }

        fun compose(span: Float) = EXTERNAL_HEAD + "uniform sampler2D t1;\n" +
            "void main(){vec3 c=texture(t0,(st*vec4(uv,0.,1.)).xy).rgb;" +
            "float e=texture(t1,vec2(uv.x,1.-uv.y)).r;o=vec4(c+(e-.5)*$span,1.);}\n"
    }
}

private object UpscalerNative {
    init {
        System.loadLibrary("aiostreams_upscaler")
    }

    @JvmStatic
    external fun create(vertex: String, fragments: Array<String>, steepen: Boolean): Long

    @JvmStatic
    external fun size(handle: Long, width: Int, height: Int): Boolean

    /** Returns whether the frame before this one was still being drawn. */
    @JvmStatic
    external fun draw(handle: Long, external: Int, matrix: FloatArray, width: Int, height: Int, network: Boolean): Boolean

    @JvmStatic
    external fun release(handle: Long)
}
