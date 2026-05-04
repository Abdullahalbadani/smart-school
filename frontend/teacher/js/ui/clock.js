// teacher/ui/clock.js
(function () {
  "use strict";

  window.TeacherClock = {
    init() {
      const timeEl = $("clock-time");
      const dateEl = $("clock-date");
      if (!timeEl || !dateEl) return;

      function pad(n) {
        return n < 10 ? "0" + n : "" + n;
      }

      function tick() {
        const now = new Date();
        const h = pad(now.getHours());
        const m = pad(now.getMinutes());
        timeEl.textContent = h + ":" + m;

        const d = pad(now.getDate());
        const mo = pad(now.getMonth() + 1);
        const y = now.getFullYear();
        dateEl.textContent = d + "/" + mo + "/" + y;
      }

      tick();
      setInterval(tick, 1000);
    },
  };
})();
