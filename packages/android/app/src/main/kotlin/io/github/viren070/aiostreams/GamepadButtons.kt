package io.github.viren070.aiostreams

import android.view.InputDevice
import android.view.KeyEvent

/**
 * A controller's buttons, by the page's names, sent as they go down and up. The page never asks the
 * web view for gamepads, which would poll every joystick device from then on, some remotes among
 * them; sticks and d-pads reach it as arrow keys.
 */
class GamepadButtons(private val send: (input: String, down: Boolean) -> Unit) {
    /** False for a key that isn't a controller's button. */
    fun handle(event: KeyEvent): Boolean {
        if (!event.isFromSource(InputDevice.SOURCE_GAMEPAD)) return false
        val input = NAMES[event.keyCode] ?: return false
        when (event.action) {
            KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) send(input, true)
            KeyEvent.ACTION_UP -> send(input, false)
        }
        return true
    }

    private companion object {
        val NAMES = mapOf(
            KeyEvent.KEYCODE_BUTTON_A to "GamepadA",
            KeyEvent.KEYCODE_BUTTON_B to "GamepadB",
            KeyEvent.KEYCODE_BUTTON_X to "GamepadX",
            KeyEvent.KEYCODE_BUTTON_Y to "GamepadY",
            KeyEvent.KEYCODE_BUTTON_L1 to "GamepadLB",
            KeyEvent.KEYCODE_BUTTON_R1 to "GamepadRB",
            KeyEvent.KEYCODE_BUTTON_L2 to "GamepadLT",
            KeyEvent.KEYCODE_BUTTON_R2 to "GamepadRT",
            KeyEvent.KEYCODE_BUTTON_SELECT to "GamepadView",
            KeyEvent.KEYCODE_BUTTON_START to "GamepadMenu",
            KeyEvent.KEYCODE_BUTTON_THUMBL to "GamepadLS",
            KeyEvent.KEYCODE_BUTTON_THUMBR to "GamepadRS",
        )
    }
}
