package io.github.viren070.aiostreams

import android.graphics.Rect
import android.os.Build
import android.view.Gravity
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout

class MiniPlayer(private val stage: FrameLayout) {
    private var rect: Rect? = null
    private var hidden = false
    private var pictureInPicture = false
    private var raised: SurfaceView? = null

    init {
        stage.setOnHierarchyChangeListener(object : ViewGroup.OnHierarchyChangeListener {
            override fun onChildViewAdded(parent: View, child: View) {
                stage.post { refresh() }
            }

            override fun onChildViewRemoved(parent: View, child: View) {
                if (raised?.let { it === child || !it.isAttachedToWindow } == true) raised = null
            }
        })
    }

    fun show(rect: Rect?, hidden: Boolean) {
        if (rect == this.rect && hidden == this.hidden) return
        this.rect = rect
        this.hidden = hidden
        refresh()
    }

    fun pictureInPicture(on: Boolean) {
        if (on == pictureInPicture) return
        pictureInPicture = on
        refresh()
    }

    private fun refresh() {
        val shown = rect.takeUnless { pictureInPicture }
        val params = stage.layoutParams as? FrameLayout.LayoutParams ?: return
        val width = shown?.width() ?: MATCH_PARENT
        val height = shown?.height() ?: MATCH_PARENT
        val left = shown?.left ?: 0
        val top = shown?.top ?: 0
        if (params.width != width || params.height != height || params.leftMargin != left || params.topMargin != top) {
            params.gravity = Gravity.TOP or Gravity.LEFT
            params.width = width
            params.height = height
            params.leftMargin = left
            params.topMargin = top
            stage.layoutParams = params
        }
        val target = if (rect != null && (pictureInPicture || !hidden)) firstSurface(stage) else null
        if (target === raised) return
        raised?.let { setOnTop(it, false) }
        target?.let { setOnTop(it, true) }
        raised = target
    }

    private fun firstSurface(view: View): SurfaceView? {
        if (view is SurfaceView) return view
        if (view !is ViewGroup) return null
        for (i in 0 until view.childCount) firstSurface(view.getChildAt(i))?.let { return it }
        return null
    }

    @Suppress("DEPRECATION")
    private fun setOnTop(view: SurfaceView, onTop: Boolean) {
        val parent = view.parent as? ViewGroup
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R || parent == null || !view.isAttachedToWindow) {
            view.setZOrderOnTop(onTop)
            return
        }
        val index = parent.indexOfChild(view)
        val params = view.layoutParams
        parent.removeView(view)
        view.setZOrderOnTop(onTop)
        parent.addView(view, index, params)
    }
}
