/* ═══════════════════════════════════════════════════════════════
   WORLD ENGINE — Shared immersive video player
   Used by: fantasy.html, dark.html, nostalgic.html, peace.html
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State
  let currentVideo = 0;
  let hlsInstance = null;
  let isLocked = false;
  let lockRevealTimer = null;

  // ── DOM refs (populated on DOMContentLoaded)
  let elVideo, elName, elPlayBtn, elLoader, elUnlockBtn, elFullBtn;

  // ── videoList must be defined BEFORE this script loads (in each world file)
  // window.WORLD_VIDEOS = [{src, name}, ...]

  function getVideos() {
    return window.WORLD_VIDEOS || [];
  }

  /* ──────────────────────────────────────────────
     LOADER
  ────────────────────────────────────────────── */
  function hideLoader() {
    if (!elLoader) return;
    elLoader.classList.add('hidden');
    setTimeout(function() { elLoader.style.display = 'none'; }, 800);
  }

  /* ──────────────────────────────────────────────
     HLS / VIDEO LOADING
  ────────────────────────────────────────────── */
  function loadVideo(index) {
    var videos = getVideos();
    if (!videos.length || !elVideo) return;

    var item = videos[index];

    // Destroy old HLS instance
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }

    // Update name display
    if (elName) elName.textContent = item.name;

    var src = item.src;

    if (src.endsWith('.m3u8')) {
      if (window.Hls && Hls.isSupported()) {
        hlsInstance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });
        hlsInstance.loadSource(src);
        hlsInstance.attachMedia(elVideo);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function() {
          elVideo.play().catch(function() {
            // Autoplay blocked — hide loader anyway so the UI is usable
            hideLoader();
          });
        });
        // Hide loader on first fragment loaded as well (failsafe)
        hlsInstance.on(Hls.Events.FRAG_LOADED, function() {
          hideLoader();
        });
        // Handle HLS errors gracefully
        hlsInstance.on(Hls.Events.ERROR, function(event, data) {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hlsInstance.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hlsInstance.recoverMediaError();
                break;
              default:
                // Unrecoverable — try next video
                nextVideo();
                break;
            }
          }
        });
      } else if (elVideo.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari / iOS)
        elVideo.src = src;
        elVideo.load();
        elVideo.play().catch(function() { hideLoader(); });
      } else {
        // HLS not supported at all
        hideLoader();
      }
    } else {
      elVideo.src = src;
      elVideo.load();
      elVideo.play().catch(function() { hideLoader(); });
    }

    updatePlayBtn();
  }

  /* ──────────────────────────────────────────────
     NAVIGATION
  ────────────────────────────────────────────── */
  function nextVideo() {
    var videos = getVideos();
    currentVideo = (currentVideo + 1) % videos.length;
    loadVideo(currentVideo);
  }

  function prevVideo() {
    var videos = getVideos();
    currentVideo = (currentVideo - 1 + videos.length) % videos.length;
    loadVideo(currentVideo);
  }

  /* ──────────────────────────────────────────────
     PLAY / PAUSE
  ────────────────────────────────────────────── */
  function togglePlay() {
    if (!elVideo) return;
    if (elVideo.paused) {
      elVideo.play().catch(function() {});
    } else {
      elVideo.pause();
    }
    updatePlayBtn();
  }

  function updatePlayBtn() {
    if (!elPlayBtn || !elVideo) return;
    elPlayBtn.textContent = elVideo.paused ? '▶' : '⏸';
    elPlayBtn.setAttribute('aria-label', elVideo.paused ? 'Play' : 'Pause');
  }

  /* ──────────────────────────────────────────────
     FULLSCREEN
  ────────────────────────────────────────────── */
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function() {});
      if (elFullBtn) elFullBtn.textContent = '🡽';
    } else {
      document.exitFullscreen();
      if (elFullBtn) elFullBtn.textContent = '⛶';
    }
  }

  /* ──────────────────────────────────────────────
     LOCK MODE
  ────────────────────────────────────────────── */
  function toggleLock() {
    isLocked = !isLocked;
    document.body.classList.toggle('locked', isLocked);

    var lockBtn = document.getElementById('lockBtn');
    if (lockBtn) lockBtn.textContent = isLocked ? '🔓' : '🔒';

    if (!isLocked && elUnlockBtn) {
      elUnlockBtn.classList.remove('show');
    }
  }

  function revealUnlock() {
    if (!isLocked || !elUnlockBtn) return;
    elUnlockBtn.classList.add('show');
    clearTimeout(lockRevealTimer);
    lockRevealTimer = setTimeout(function() {
      if (elUnlockBtn) elUnlockBtn.classList.remove('show');
    }, 3000);
  }

  /* ──────────────────────────────────────────────
     INIT
  ────────────────────────────────────────────── */
  function init() {
    elVideo     = document.getElementById('bgVideo');
    elName      = document.getElementById('videoName');
    elPlayBtn   = document.getElementById('playBtn');
    elLoader    = document.getElementById('loader');
    elUnlockBtn = document.getElementById('unlockBtn');
    elFullBtn   = document.getElementById('fullscreenBtn');

    if (!elVideo) return;

    // Hide loader when video starts playing
    elVideo.addEventListener('playing', hideLoader, { once: true });

    // Fallback: hide loader after 8 seconds regardless
    var loaderTimeout = setTimeout(hideLoader, 8000);
    elVideo.addEventListener('playing', function() {
      clearTimeout(loaderTimeout);
    }, { once: true });

    elVideo.addEventListener('play', updatePlayBtn);
    elVideo.addEventListener('pause', updatePlayBtn);
    elVideo.addEventListener('ended', nextVideo);

    // Touch / click on locked screen → reveal unlock button
    document.addEventListener('click', function(e) {
      if (isLocked && e.target.id !== 'unlockBtn') revealUnlock();
    });

    // Page visibility — pause when hidden, resume when visible
    document.addEventListener('visibilitychange', function() {
      if (!elVideo) return;
      if (document.hidden) {
        elVideo.pause();
      } else {
        elVideo.play().catch(function() {});
      }
    });

    // Load first video
    loadVideo(0);
  }

  /* ──────────────────────────────────────────────
     KEYBOARD CONTROLS
  ────────────────────────────────────────────── */
  document.addEventListener('keydown', function(e) {
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        nextVideo();
        break;
      case 'ArrowLeft':
        prevVideo();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'KeyL':
        toggleLock();
        break;
    }
  });

  /* ──────────────────────────────────────────────
     EXPOSE GLOBALS (for onclick handlers in HTML)
  ────────────────────────────────────────────── */
  window.nextVideo        = nextVideo;
  window.prevVideo        = prevVideo;
  window.togglePlay       = togglePlay;
  window.toggleFullscreen = toggleFullscreen;
  window.toggleLock       = toggleLock;

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();