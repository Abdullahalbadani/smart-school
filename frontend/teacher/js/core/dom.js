// teacher/core/dom.js
(function () {
  "use strict";
  if (window.$) return;
  window.$ = function (id) {
    return document.getElementById(id);
  };
})();
