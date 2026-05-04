const screens = document.getElementById("screens");
const swipe = document.getElementById("swipe");

// عند الضغط على الشريط الأصفر
swipe.addEventListener("click", () => {
  screens.style.transform = "translateY(0%)";  
});

// دعم السحب للأعلى
let startY = 0;

document.addEventListener("touchstart", e => {
  startY = e.touches[0].clientY;
});

document.addEventListener("touchend", e => {
  let endY = e.changedTouches[0].clientY;
  let diff = startY - endY;

  if (diff > 50) {
    // السحب للأعلى → تسجيل الدخول
    screens.style.transform = "translateY(0%)";
  } else if (diff < -50) {
    // السحب للأسفل → العودة للترحيب
    screens.style.transform = "translateY(-50%)";
  }
});
const backArrow = document.getElementById("back-arrow");

backArrow.addEventListener("click", () => {
  screens.style.transform = "translateY(-50%)";
});
document.querySelectorAll("input").forEach(input => {
  input.addEventListener("input", () => {
    if (input.value.trim() !== "") {
      input.classList.add("has-value");
    } else {
      input.classList.remove("has-value");
    }
  });
});
