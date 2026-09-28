// ─────────────────────────────────────────────────────────────
// VIDEO OF THE RESEARCH SYSTEM
// After uploading the video to YouTube, paste ONLY its ID here.
// Example: for https://www.youtube.com/watch?v=AbC123xYz  ->  'AbC123xYz'
// (for a youtu.be/AbC123xYz link, the ID is also the part after the slash)
var SYSTEM_VIDEO_ID = '';
// ─────────────────────────────────────────────────────────────

(function () {
  // Mobile menu
  var btn = document.querySelector('.menu-btn');
  var links = document.getElementById('nav-links');
  if (btn && links) {
    btn.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Footer year
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // Replace the screenshot with the video once an ID is set
  if (SYSTEM_VIDEO_ID) {
    var slots = document.querySelectorAll('.video-slot');
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var img = slot.querySelector('img');
      var frame = document.createElement('div');
      frame.className = 'video-frame';
      frame.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(SYSTEM_VIDEO_ID) +
        '?rel=0" title="The research system in use" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
      if (img) slot.replaceChild(frame, img); else slot.insertBefore(frame, slot.firstChild);
      var cap = slot.querySelector('figcaption');
      if (cap) cap.textContent = 'The research system in use — recorded with the Logitech C270 USB webcam and 5500 K LED booth.';
    }
  }
})();