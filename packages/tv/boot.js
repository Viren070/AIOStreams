// Runs before the app, in syntax any TV runs: says when the TV is too old for
// the app, and shows what stopped the app starting, as a TV has no console.
(function () {
  var agent = navigator.userAgent;
  var chrome = /Chrome\/(\d+)/.exec(agent);
  var tizen = /Tizen (\d+)/.exec(agent);
  var old = chrome ? +chrome[1] < 94 : tizen ? +tizen[1] < 7 : false;
  var BACK = [8, 27, 461, 10009];
  var overlay = null;
  var failure = null;

  function started() {
    var root = document.getElementById('root');
    return !!root && root.childNodes.length > 0;
  }

  function exit() {
    var webos = window.webOSSystem || window.PalmSystem;
    if (webos) webos.platformBack();
    else if (window.tizen)
      window.tizen.application.getCurrentApplication().exit();
  }

  function close() {
    if (overlay) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function show(title, text, actions) {
    close();
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'padding:64px;background:#070707;color:#fff;font:28px/1.5 sans-serif;text-align:center';
    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:44px;font-weight:700;margin-bottom:24px';
    heading.textContent = title;
    var body = document.createElement('div');
    body.style.cssText =
      'max-width:1200px;margin-bottom:40px;color:#bbb;white-space:pre-wrap;word-break:break-word';
    body.textContent = text;
    var row = document.createElement('div');
    for (var i = 0; i < actions.length; i++) {
      var button = document.createElement('button');
      button.textContent = actions[i][0];
      button.onclick = actions[i][1];
      button.style.cssText =
        'margin:0 12px;padding:16px 40px;border-radius:999px;border:3px solid #fff;' +
        'background:transparent;color:#fff;font:inherit;outline:none';
      button.onfocus = function () {
        this.style.background = '#fff';
        this.style.color = '#000';
      };
      button.onblur = function () {
        this.style.background = 'transparent';
        this.style.color = '#fff';
      };
      row.appendChild(button);
    }
    overlay.appendChild(heading);
    overlay.appendChild(body);
    overlay.appendChild(row);
    document.body.appendChild(overlay);
    row.firstChild.focus();
  }

  function showFailure() {
    show('The app could not start', failure, [
      [
        'Retry',
        function () {
          location.reload();
        },
      ],
      ['Exit', exit],
    ]);
  }

  function fail(text) {
    if (failure || started()) return;
    failure = text;
    // A slip the app recovers from leaves it running.
    setTimeout(function () {
      if (!started() && !overlay) showFailure();
    }, 3000);
  }

  window.addEventListener(
    'error',
    function (e) {
      var el = e.target;
      if (el && (el.tagName === 'SCRIPT' || el.tagName === 'LINK'))
        fail('Could not load ' + (el.src || el.href));
      else if (e.message)
        fail(
          e.message +
            (e.filename
              ? '\n' + e.filename + ':' + e.lineno + ':' + e.colno
              : '')
        );
    },
    true
  );
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    fail(String((reason && (reason.stack || reason.message)) || reason));
  });

  // The app doesn't see keys while this is up.
  window.addEventListener(
    'keydown',
    function (e) {
      if (!overlay) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (BACK.indexOf(e.keyCode) >= 0) return exit();
      var buttons = overlay.getElementsByTagName('button');
      var at = Array.prototype.indexOf.call(buttons, document.activeElement);
      if (e.keyCode === 13) {
        if (at >= 0) buttons[at].click();
        return;
      }
      var step =
        e.keyCode === 37 || e.keyCode === 38
          ? -1
          : e.keyCode === 39 || e.keyCode === 40
            ? 1
            : 0;
      if (step)
        buttons[Math.max(0, Math.min(buttons.length - 1, at + step))].focus();
    },
    true
  );

  if (old)
    document.addEventListener('DOMContentLoaded', function () {
      show(
        'This TV is too old for this app',
        'The app needs a TV from 2023 or newer. It may still work here, with problems.',
        [
          [
            'Try anyway',
            function () {
              close();
              if (failure && !started()) showFailure();
            },
          ],
          ['Exit', exit],
        ]
      );
    });
})();
