/* ═══════════════════════════════════════════════════════════════════
   YOUR MEDIA — js/your-media.js
   Fully local, zero-upload media player for Peace Life.
   Works as a VLC-style local player: plays straight from the File API.
   Nothing is persisted; all object URLs are revoked on cleanup.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     STATE
  ────────────────────────────────────────────── */
  let files         = [];          // Array of { file, name, type, objectURL, kind }
  let activeIndex   = -1;          // Currently playing index
  let isPlaying     = false;
  let isLooping     = false;
  let isShuffling   = false;
  let playedIndices = new Set();   // For shuffle history
  let autoHideTimer = null;        // Video controls auto-hide
  let isDraggingV   = false;       // Video seek drag state
  let isDraggingA   = false;       // Audio seek drag state

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let speedIndexV = 2; // Default 1×
  let speedIndexA = 2;

  /* Web Audio for visualizer */
  let audioCtx    = null;
  let analyser    = null;
  let mediaSource = null;
  let vizRaf      = null;

  /* ──────────────────────────────────────────────
     DOM REFS
  ────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  // Agreement
  const elModal     = $('ymAgreement');
  const elAgreeBtn  = $('ymAgreeBtn');

  // Zone
  const elDropzone  = $('ymDropzone');
  const elFileInput = $('ymFileInput');
  const elBrowseBtn = $('ymBrowseBtn');
  const elDropInner = $('ymDropInner');

  // Video player
  const elVideoWrap = $('ymVideoWrap');
  const elVideo     = $('ymVideo');
  const elVideoName = $('ymVideoName');
  const elVideoTap  = $('ymVideoTap');
  const elVCurrent  = $('ymVCurrent');
  const elVDuration = $('ymVDuration');
  const elVSeekWrap = $('ymVSeekWrap');
  const elVSeekFill = $('ymVSeekFill');
  const elVSeekThumb= $('ymVSeekThumb');
  const elVPlayBtn  = $('ymVPlayBtn');
  const elVPrevBtn  = $('ymVPrevBtn');
  const elVNextBtn  = $('ymVNextBtn');
  const elVLoopBtn  = $('ymVLoopBtn');
  const elVSpeedBtn = $('ymVSpeedBtn');
  const elVMuteBtn  = $('ymVMuteBtn');
  const elVVol      = $('ymVVol');
  const elVFSBtn    = $('ymVFSBtn');

  // Audio player
  const elAudioWrap = $('ymAudioWrap');
  const elAudio     = $('ymAudio');
  const elAudioName = $('ymAudioName');
  const elACurrent  = $('ymACurrent');
  const elADuration = $('ymADuration');
  const elASeekWrap = $('ymASeekWrap');
  const elASeekFill = $('ymASeekFill');
  const elASeekThumb= $('ymASeekThumb');
  const elAPlayBtn  = $('ymAPlayBtn');
  const elAPrevBtn  = $('ymAPrevBtn');
  const elANextBtn  = $('ymANextBtn');
  const elALoopBtn  = $('ymALoopBtn');
  const elAShuffleBtn=$('ymAShuffleBtn');
  const elAMuteBtn  = $('ymAMuteBtn');
  const elAVol      = $('ymAVol');
  const elASpeedBtn = $('ymASpeedBtn');

  // Queue
  const elQueue     = $('ymQueue');
  const elQueueList = $('ymQueueList');
  const elQueueCount= $('ymQueueCount');
  const elQueueAdd  = $('ymQueueAdd');

  // Viz
  const elCanvas    = $('ymVizCanvas');

  /* ──────────────────────────────────────────────
     HELPERS
  ────────────────────────────────────────────── */
  function fmtTime(s) {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${m}:${sec}`;
  }

  function fileKind(file) {
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    // Fallback by extension for types browsers may mis-detect
    const ext = file.name.split('.').pop().toLowerCase();
    if (['mp4','webm','mov','avi','mkv','ogv'].includes(ext)) return 'video';
    return 'audio';
  }

  function cleanName(filename) {
    return filename.replace(/\.[^/.]+$/, '');
  }

  function activeKind() {
    return activeIndex >= 0 ? files[activeIndex].kind : null;
  }

  function activeMedia() {
    return activeKind() === 'video' ? elVideo : elAudio;
  }

  /* ──────────────────────────────────────────────
     AGREEMENT MODAL
  ────────────────────────────────────────────── */
  function checkAgreement() {
    // sessionStorage: only valid for this browser session
    if (sessionStorage.getItem('ymAgreed') === '1') {
      elModal.classList.add('hidden');
    }
  }

  elAgreeBtn.addEventListener('click', () => {
    sessionStorage.setItem('ymAgreed', '1');
    elModal.classList.add('hidden');
  });

  /* ──────────────────────────────────────────────
     FILE INGESTION
  ────────────────────────────────────────────── */
  function ingestFiles(fileList) {
    const accepted = Array.from(fileList).filter(f =>
      f.type.startsWith('video/') ||
      f.type.startsWith('audio/') ||
      /\.(mp4|webm|mov|avi|mkv|ogv|mp3|wav|m4a|ogg|flac|aac)$/i.test(f.name)
    );
    if (!accepted.length) return;

    accepted.forEach(f => {
      const objectURL = URL.createObjectURL(f);
      files.push({
        file: f,
        name: cleanName(f.name),
        rawName: f.name,
        type: f.type,
        kind: fileKind(f),
        objectURL
      });
    });

    renderQueue();
    showQueueAndPlayer();

    // Auto-play first loaded file
    if (activeIndex < 0) {
      playAt(0);
    }
  }

  /* ──────────────────────────────────────────────
     SHOW/HIDE PLAYER PANELS
  ────────────────────────────────────────────── */
  function showQueueAndPlayer() {
    // Hide drop zone when files are loaded
    elDropInner.style.opacity = '0.3';
    elDropInner.style.pointerEvents = 'none';
    elDropzone.style.cursor = 'default';

    // Show queue
    elQueue.hidden = false;
    elQueue.setAttribute('aria-hidden', 'false');
  }

  function switchMode(kind) {
    if (kind === 'video') {
      elVideoWrap.hidden = false;
      elVideoWrap.setAttribute('aria-hidden', 'false');
      elAudioWrap.hidden = true;
      elAudioWrap.setAttribute('aria-hidden', 'true');
      stopViz();
    } else {
      elAudioWrap.hidden = false;
      elAudioWrap.setAttribute('aria-hidden', 'false');
      elVideoWrap.hidden = true;
      elVideoWrap.setAttribute('aria-hidden', 'true');
    }
  }

  /* ──────────────────────────────────────────────
     PLAYBACK
  ────────────────────────────────────────────── */
  function playAt(index) {
    if (index < 0 || index >= files.length) return;

    // Pause both media elements before switching
    elVideo.pause();
    elAudio.pause();
    stopViz();

    activeIndex = index;
    const item = files[index];
    switchMode(item.kind);

    if (item.kind === 'video') {
      elVideo.src = item.objectURL;
      elVideoName.textContent = item.name;
      elVideo.load();
      elVideo.play().catch(() => {});
      resetVideoControls();
      scheduleAutoHide();
    } else {
      elAudio.src = item.objectURL;
      elAudioName.textContent = item.name;
      elAudio.load();
      elAudio.play().catch(() => {});
      initViz();
    }

    updateQueueHighlight();
  }

  function togglePlay() {
    const media = activeMedia();
    if (!media || !media.src) return;
    if (media.paused) {
      media.play().catch(() => {});
    } else {
      media.pause();
    }
  }

  function nextTrack() {
    if (!files.length) return;
    if (isShuffling) {
      let next;
      if (playedIndices.size >= files.length) playedIndices.clear();
      do { next = Math.floor(Math.random() * files.length); }
      while (playedIndices.has(next) && files.length > 1);
      playedIndices.add(next);
      playAt(next);
    } else {
      playAt((activeIndex + 1) % files.length);
    }
  }

  function prevTrack() {
    if (!files.length) return;
    const media = activeMedia();
    // If more than 3 seconds in, restart current track
    if (media && media.currentTime > 3) {
      media.currentTime = 0;
      return;
    }
    playAt((activeIndex - 1 + files.length) % files.length);
  }

  function onEnded() {
    if (isLooping) {
      const media = activeMedia();
      if (media) { media.currentTime = 0; media.play().catch(() => {}); }
    } else {
      nextTrack();
    }
  }

  /* ──────────────────────────────────────────────
     SEEK
  ────────────────────────────────────────────── */
  function makeSeeked(wrapEl, fillEl, thumbEl, mediaEl, type) {
    function getX(e) {
      return e.touches ? e.touches[0].clientX : e.clientX;
    }

    function seek(e) {
      const rect = wrapEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (getX(e) - rect.left) / rect.width));
      if (mediaEl.duration) mediaEl.currentTime = ratio * mediaEl.duration;
      updateSeekFill(fillEl, thumbEl, ratio);
    }

    wrapEl.addEventListener('mousedown', e => {
      if (type === 'video') isDraggingV = true;
      else isDraggingA = true;
      wrapEl.classList.add('dragging');
      seek(e);
    });
    wrapEl.addEventListener('touchstart', e => {
      if (type === 'video') isDraggingV = true;
      else isDraggingA = true;
      wrapEl.classList.add('dragging');
      seek(e);
    }, { passive: true });

    document.addEventListener('mousemove', e => {
      const dragging = type === 'video' ? isDraggingV : isDraggingA;
      if (!dragging) return;
      seek(e);
    });
    document.addEventListener('touchmove', e => {
      const dragging = type === 'video' ? isDraggingV : isDraggingA;
      if (!dragging) return;
      seek(e);
    }, { passive: true });

    const stop = () => {
      if (type === 'video') isDraggingV = false;
      else isDraggingA = false;
      wrapEl.classList.remove('dragging');
    };
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);

    // Keyboard seek
    wrapEl.addEventListener('keydown', e => {
      if (!mediaEl.duration) return;
      if (e.key === 'ArrowRight') mediaEl.currentTime = Math.min(mediaEl.duration, mediaEl.currentTime + 5);
      if (e.key === 'ArrowLeft')  mediaEl.currentTime = Math.max(0, mediaEl.currentTime - 5);
    });
  }

  function updateSeekFill(fillEl, thumbEl, ratio) {
    const pct = (ratio * 100).toFixed(2) + '%';
    fillEl.style.width = pct;
    if (thumbEl) thumbEl.style.left = `calc(${pct} - 6px)`;
  }

  /* ──────────────────────────────────────────────
     VIDEO CONTROLS AUTO-HIDE
  ────────────────────────────────────────────── */
  function scheduleAutoHide() {
    clearTimeout(autoHideTimer);
    elVideoWrap.classList.remove('controls-hidden');
    autoHideTimer = setTimeout(() => {
      if (!elVideo.paused) elVideoWrap.classList.add('controls-hidden');
    }, 3200);
  }

  function revealVideoControls() {
    elVideoWrap.classList.remove('controls-hidden');
    scheduleAutoHide();
  }

  /* ──────────────────────────────────────────────
     LOOP / SHUFFLE
  ────────────────────────────────────────────── */
  function toggleLoopV() {
    isLooping = !isLooping;
    elVLoopBtn.classList.toggle('active', isLooping);
  }
  function toggleLoopA() {
    isLooping = !isLooping;
    elALoopBtn.classList.toggle('active', isLooping);
  }
  function toggleShuffle() {
    isShuffling = !isShuffling;
    playedIndices.clear();
    elAShuffleBtn.classList.toggle('active', isShuffling);
  }

  /* ──────────────────────────────────────────────
     SPEED
  ────────────────────────────────────────────── */
  function cycleSpeedV() {
    speedIndexV = (speedIndexV + 1) % SPEEDS.length;
    const s = SPEEDS[speedIndexV];
    elVideo.playbackRate = s;
    elVSpeedBtn.textContent = s === 1 ? '1×' : s + '×';
  }
  function cycleSpeedA() {
    speedIndexA = (speedIndexA + 1) % SPEEDS.length;
    const s = SPEEDS[speedIndexA];
    elAudio.playbackRate = s;
    elASpeedBtn.textContent = s === 1 ? '1×' : s + '×';
  }

  /* ──────────────────────────────────────────────
     VOLUME / MUTE
  ────────────────────────────────────────────── */
  function updateMuteIcon(mediaEl, btn) {
    if (!btn) return;
    if (mediaEl.muted || mediaEl.volume === 0) btn.textContent = '🔇';
    else if (mediaEl.volume < 0.4) btn.textContent = '🔉';
    else btn.textContent = '🔊';
  }

  function toggleMuteV() {
    elVideo.muted = !elVideo.muted;
    updateMuteIcon(elVideo, elVMuteBtn);
  }
  function toggleMuteA() {
    elAudio.muted = !elAudio.muted;
    updateMuteIcon(elAudio, elAMuteBtn);
  }

  /* ──────────────────────────────────────────────
     LANDSCAPE LOCK (mobile)
  ────────────────────────────────────────────── */
  function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
           window.innerWidth <= 768;
  }

  // YouTube-style: when user rotates to landscape, go fullscreen.
  // When they rotate back to portrait, exit fullscreen.
  function setupOrientationBehavior() {
    if (!isMobile()) return;
    window.addEventListener('orientationchange', onOrientationChange);
    // screen.orientation API (more reliable on Android)
    if (screen.orientation) {
      screen.orientation.addEventListener('change', onOrientationChange);
    }
  }

  function onOrientationChange() {
    if (activeKind() !== 'video' || elVideoWrap.hidden) return;
    const isLandscape = window.innerWidth > window.innerHeight ||
      (screen.orientation && screen.orientation.type.startsWith('landscape'));

    if (isLandscape) {
      // Rotated to landscape — go fullscreen (YouTube behaviour)
      if (!document.fullscreenElement && elVideoWrap.requestFullscreen) {
        elVideoWrap.requestFullscreen().catch(() => {});
      } else if (elVideo.webkitEnterFullscreen && !elVideo.webkitDisplayingFullscreen) {
        elVideo.webkitEnterFullscreen();
      }
    } else {
      // Rotated back to portrait — exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  /* ──────────────────────────────────────────────
     FULLSCREEN
  ────────────────────────────────────────────── */
  function toggleFS() {
    if (!document.fullscreenElement) {
      elVideoWrap.requestFullscreen().catch(() => {});
      elVFSBtn.textContent = '✕';
    } else {
      document.exitFullscreen();
      elVFSBtn.textContent = '⛶';
    }
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) elVFSBtn.textContent = '⛶';
  });

  /* ──────────────────────────────────────────────
     QUEUE RENDERING
  ────────────────────────────────────────────── */
  function renderQueue() {
    elQueueCount.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    elQueueList.innerHTML = '';
    files.forEach((item, i) => {
      const isActive = i === activeIndex;
      const li = document.createElement('div');
      li.className = 'ym-queue-item' + (isActive ? ' active' : '');
      li.setAttribute('role', 'listitem');
      li.setAttribute('aria-label', item.name);
      li.innerHTML = `
        <span class="ym-qi-num">${i + 1}</span>
        ${isActive ? `<span class="ym-qi-bars" aria-hidden="true"><span></span><span></span><span></span></span>` : `<span class="ym-qi-icon" aria-hidden="true">${item.kind === 'video' ? '🎬' : '🎵'}</span>`}
        <span class="ym-qi-name" title="${escHtml(item.rawName)}">${escHtml(item.name)}</span>
        <span class="ym-qi-type">${ext(item.rawName)}</span>
        <button class="ym-qi-remove" aria-label="Remove ${escHtml(item.name)}" data-idx="${i}" tabindex="0">✕</button>
      `;
      li.addEventListener('click', e => {
        if (e.target.classList.contains('ym-qi-remove')) return;
        playAt(i);
      });
      li.querySelector('.ym-qi-remove').addEventListener('click', e => {
        e.stopPropagation();
        removeFile(i);
      });
      elQueueList.appendChild(li);
    });
  }

  function updateQueueHighlight() {
    renderQueue();
  }

  function removeFile(index) {
    // Revoke the object URL to free memory
    URL.revokeObjectURL(files[index].objectURL);
    files.splice(index, 1);

    if (files.length === 0) {
      resetAll();
      return;
    }

    // Adjust active index
    if (activeIndex === index) {
      activeIndex = -1;
      if (index < files.length) playAt(index);
      else playAt(files.length - 1);
    } else if (activeIndex > index) {
      activeIndex--;
      updateQueueHighlight();
    } else {
      updateQueueHighlight();
    }

    renderQueue();
  }

  function resetAll() {
    elVideo.pause();
    elAudio.pause();
    elVideo.src = '';
    elAudio.src = '';
    activeIndex = -1;
    isPlaying = false;
    stopViz();
    elVideoWrap.hidden = true;
    elAudioWrap.hidden = true;
    elQueue.hidden = true;
    elDropInner.style.opacity = '';
    elDropInner.style.pointerEvents = '';
    elDropzone.style.cursor = '';
    renderQueue();
  }

  function resetVideoControls() {
    elVSeekFill.style.width = '0%';
    elVCurrent.textContent = '0:00';
    elVDuration.textContent = '0:00';
    elVPlayBtn.textContent = '⏸';
    elVPlayBtn.setAttribute('aria-label', 'Pause');
    speedIndexV = 2;
    elVSpeedBtn.textContent = '1×';
    elVideo.playbackRate = 1;
  }

  /* ──────────────────────────────────────────────
     VISUALIZER
  ────────────────────────────────────────────── */

  // Web Audio only allows ONE MediaElementSourceNode per HTMLMediaElement, ever.
  // We create the full chain (AudioContext → MediaElementSource → Analyser →
  // Destination) exactly once on first use and reuse it for every subsequent
  // audio track — only elAudio.src changes between tracks.
  let vizReady = false; // true once the chain has been built

  function ensureVizChain() {
    if (vizReady) return true; // chain already wired up — nothing to do
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      // createMediaElementSource — called ONCE for the lifetime of the page
      mediaSource = audioCtx.createMediaElementSource(elAudio);
      mediaSource.connect(analyser);
      analyser.connect(audioCtx.destination);

      vizReady = true;
      return true;
    } catch (e) {
      console.warn('[YM Viz] chain setup failed:', e.message);
      return false;
    }
  }

  function initViz() {
    if (!elCanvas) return;
    // Build the chain once; on subsequent calls this is a no-op
    if (!ensureVizChain()) return;

    // Resume context if it was suspended by the browser autoplay policy
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    elAudioWrap.classList.add('viz-active');
    if (!vizRaf) drawViz(); // only start the loop if not already running
  }

  function stopViz() {
    if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
    elAudioWrap.classList.remove('viz-active');
    if (elCanvas) {
      const ctx = elCanvas.getContext('2d');
      ctx.clearRect(0, 0, elCanvas.width, elCanvas.height);
    }
  }

  function drawViz() {
    if (!analyser || !elCanvas) return;
    const ctx = elCanvas.getContext('2d');

    function loop() {
      // If stopViz() was called, vizRaf is null — exit cleanly
      if (vizRaf === null) return;
      vizRaf = requestAnimationFrame(loop);
      const W = elCanvas.offsetWidth;
      const H = elCanvas.offsetHeight;
      if (elCanvas.width !== W || elCanvas.height !== H) {
        elCanvas.width  = W;
        elCanvas.height = H;
      }

      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);

      ctx.clearRect(0, 0, W, H);

      const barW = (W / bufLen) * 2.2;
      const barGap = 1.5;
      const usable = Math.floor(bufLen * 0.65);

      for (let i = 0; i < usable; i++) {
        const v    = data[i] / 255;
        const barH = v * H * 0.82;
        const x    = i * (barW + barGap);

        // Gradient per bar — green (peace) to gold
        const r = Math.round(74  + (232 - 74)  * v);
        const g = Math.round(222 + (201 - 222) * v);
        const b = Math.round(128 + (122 - 128) * v);

        ctx.fillStyle = `rgba(${r},${g},${b},${0.55 + v * 0.45})`;
        ctx.fillRect(x, H - barH, barW, barH);
      }
    }
    loop();
  }

  /* ──────────────────────────────────────────────
     PLAY/PAUSE BUTTON UI UPDATE
  ────────────────────────────────────────────── */
  function onPlayStateChange() {
    const media = activeMedia();
    if (!media) return;
    isPlaying = !media.paused;

    if (activeKind() === 'video') {
      elVPlayBtn.textContent = isPlaying ? '⏸' : '▶';
      elVPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    } else {
      elAPlayBtn.textContent = isPlaying ? '⏸' : '▶';
      elAPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }
  }

  /* ──────────────────────────────────────────────
     TIME UPDATE
  ────────────────────────────────────────────── */
  function onVideoTimeUpdate() {
    const media = elVideo;
    if (!media.duration) return;
    const ratio = media.currentTime / media.duration;
    elVCurrent.textContent  = fmtTime(media.currentTime);
    elVDuration.textContent = fmtTime(media.duration);
    elVSeekWrap.setAttribute('aria-valuenow', Math.round(ratio * 100));
    if (!isDraggingV) updateSeekFill(elVSeekFill, elVSeekThumb, ratio);
  }

  function onAudioTimeUpdate() {
    const media = elAudio;
    if (!media.duration) return;
    const ratio = media.currentTime / media.duration;
    elACurrent.textContent  = fmtTime(media.currentTime);
    elADuration.textContent = fmtTime(media.duration);
    elASeekWrap.setAttribute('aria-valuenow', Math.round(ratio * 100));
    if (!isDraggingA) updateSeekFill(elASeekFill, elASeekThumb, ratio);
  }

  /* ──────────────────────────────────────────────
     DROP ZONE DRAG & DROP
  ────────────────────────────────────────────── */
  function setupDragDrop() {
    const zone = elDropzone;

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files);
    });

    // File input change (browse)
    elFileInput.addEventListener('change', () => {
      if (elFileInput.files.length) ingestFiles(elFileInput.files);
      // Reset so same file can be re-selected
      elFileInput.value = '';
    });

    // Browse button — directly triggers the hidden file input
    elBrowseBtn.addEventListener('click', e => {
      e.stopPropagation();
      elFileInput.click();
    });

    // Add more files (queue button)
    if (elQueueAdd) {
      elQueueAdd.addEventListener('click', () => elFileInput.click());
    }
  }

  /* ──────────────────────────────────────────────
     KEYBOARD SHORTCUTS
  ────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        if (!e.shiftKey) { nextTrack(); } break;
      case 'ArrowLeft':
        if (!e.shiftKey) { prevTrack(); } break;
      case 'KeyL':
        if (activeKind() === 'video') toggleLoopV();
        else toggleLoopA();
        break;
      case 'KeyS': toggleShuffle(); break;
      case 'KeyF': if (activeKind() === 'video') toggleFS(); break;
      case 'KeyM':
        if (activeKind() === 'video') toggleMuteV();
        else toggleMuteA();
        break;
    }
  });

  /* ──────────────────────────────────────────────
     VIDEO MOUSE MOVE FOR CONTROL REVEAL
  ────────────────────────────────────────────── */
  if (elVideoWrap) {
    elVideoWrap.addEventListener('mousemove', revealVideoControls);
    elVideoWrap.addEventListener('touchstart', revealVideoControls, { passive: true });
  }

  /* ──────────────────────────────────────────────
     UTILITY
  ────────────────────────────────────────────── */
  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function ext(name) {
    return (name.split('.').pop() || '').toLowerCase();
  }

  /* ──────────────────────────────────────────────
     BIND ALL EVENTS
  ────────────────────────────────────────────── */
  function bindEvents() {
    // ── Video media events ──
    elVideo.addEventListener('play',       onPlayStateChange);
    elVideo.addEventListener('pause',      onPlayStateChange);
    elVideo.addEventListener('timeupdate', onVideoTimeUpdate);
    elVideo.addEventListener('ended',      onEnded);
    elVideo.addEventListener('loadedmetadata', () => {
      elVDuration.textContent = fmtTime(elVideo.duration);
    });

    // ── Audio media events ──
    elAudio.addEventListener('play',       onPlayStateChange);
    elAudio.addEventListener('pause',      onPlayStateChange);
    elAudio.addEventListener('timeupdate', onAudioTimeUpdate);
    elAudio.addEventListener('ended',      onEnded);
    elAudio.addEventListener('loadedmetadata', () => {
      elADuration.textContent = fmtTime(elAudio.duration);
    });

    // ── Video controls ──
    elVideoTap.addEventListener('click', () => { togglePlay(); revealVideoControls(); });
    elVPlayBtn.addEventListener('click', () => { togglePlay(); scheduleAutoHide(); });
    elVPrevBtn.addEventListener('click', prevTrack);
    elVNextBtn.addEventListener('click', nextTrack);
    elVLoopBtn.addEventListener('click', toggleLoopV);
    elVSpeedBtn.addEventListener('click', cycleSpeedV);
    elVMuteBtn.addEventListener('click', toggleMuteV);
    elVFSBtn.addEventListener('click', toggleFS);

    elVVol.addEventListener('input', () => {
      elVideo.volume = parseFloat(elVVol.value);
      updateMuteIcon(elVideo, elVMuteBtn);
    });

    // ── Audio controls ──
    elAPlayBtn.addEventListener('click', togglePlay);
    elAPrevBtn.addEventListener('click', prevTrack);
    elANextBtn.addEventListener('click', nextTrack);
    elALoopBtn.addEventListener('click', toggleLoopA);
    elAShuffleBtn.addEventListener('click', toggleShuffle);
    elASpeedBtn.addEventListener('click', cycleSpeedA);
    elAMuteBtn.addEventListener('click', toggleMuteA);

    elAVol.addEventListener('input', () => {
      elAudio.volume = parseFloat(elAVol.value);
      updateMuteIcon(elAudio, elAMuteBtn);
    });

    // ── Seek bars ──
    makeSeeked(elVSeekWrap, elVSeekFill, elVSeekThumb, elVideo, 'video');
    makeSeeked(elASeekWrap, elASeekFill, elASeekThumb, elAudio, 'audio');

    // ── Page visibility ── (pause when tab hidden, resume when visible)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        activeMedia()?.pause();
      } else {
        activeMedia()?.play().catch(() => {});
      }
    });

    // ── AudioContext resume on interaction (autoplay policy) ──
    document.addEventListener('click', () => {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: false });

    // ── Cleanup: revoke all object URLs on page unload ──
    window.addEventListener('beforeunload', () => {
      files.forEach(f => URL.revokeObjectURL(f.objectURL));
    });
  }

  /* ──────────────────────────────────────────────
     INIT
  ────────────────────────────────────────────── */
  function init() {
    checkAgreement();
    setupDragDrop();
    bindEvents();
    setupOrientationBehavior();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();