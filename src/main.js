import confetti from 'canvas-confetti';
import { PRESETS } from './presets.js';
import { OdometerRenderer } from './odometer.js';
import { VideoExporter } from './videoExporter.js';

const STORAGE_KEY_STATE = 'chrono_reel_current_state';
const STORAGE_KEY_PRESETS = 'chrono_reel_custom_presets';

// Timecode Helper Functions: "MM:SS.FF" (Frames 1-60 / 1-30 based on FPS)
export function secondsToTimecode(totalSec, fps = 60) {
  const safeSec = Math.max(0, totalSec || 0);
  const m = Math.floor(safeSec / 60);
  const s = Math.floor(safeSec % 60);
  const frac = safeSec - Math.floor(safeSec);
  const f = Math.min(fps, Math.max(1, Math.floor(frac * fps) + 1));
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`;
}

export function timecodeToSeconds(timecodeStr, fps = 60) {
  if (typeof timecodeStr === 'number') return Math.max(0, timecodeStr);
  if (!timecodeStr || typeof timecodeStr !== 'string') return 0;
  const str = timecodeStr.trim();
  const parts = str.split(/[:.]/);
  if (parts.length >= 3) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    const f = parseInt(parts[2], 10) || 1;
    const safeF = Math.max(1, Math.min(fps, f));
    return m * 60 + s + (safeF - 1) / fps;
  } else if (parts.length === 2) {
    const p1 = parseInt(parts[0], 10) || 0;
    const p2 = parseInt(parts[1], 10) || 0;
    return p1 * 60 + p2;
  }
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
}

// ============================================================================
// APPLICATION STATE
// ============================================================================
const DEFAULT_STATE = {
  // Video & Canvas Dimensions
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  fps: 60,
  duration: 5.0, // seconds, up to 300s (5 minutes)

  // Time Range
  startHour: 0,
  startMinute: 0,
  endHour: 23,
  endMinute: 59,

  // Digit Grouping: 2-Digit Paired Drums (00..23 : 00..59)
  digitGrouping: 'paired', // 'paired' or 'split'

  // Typography & Styling
  fontFamily: 'Unbounded',
  fontSize: 150,
  textColor: '#FFFFFF',
  glowColor: '#00F5FF',
  glowIntensity: 0.55,

  // Background & Frame
  bgType: 'transparent',
  bgColor: '#000000',
  frameStyle: 'frosted-glass',
  borderColor: 'rgba(0, 245, 255, 0.4)',

  // Animation & Motion Dynamics
  rollMode: 'ultra-smooth', // 'ultra-smooth' (screen-time normalized), 'continuous', 'glide'
  smoothness: 0.85,         // S-curve rollover fluidity (0.2 to 1.0)
  minuteStyle: 'match-hour', // 'match-hour' (exact clock-sync matching hour hand), 'interval-5m', 'interval-15m', 'smooth-paced'
  minuteSpeed: 1.0,         // Visual rolling speed for minutes (0.25 to 2.5)
  motionBlur: true,         // Shutter blur for rapid rolling
  timeFormat: '24h',
  showSeconds: false,
  secondsSpeed: 1.0,        // Visual movement speed for seconds drum (0.25 to 3.0)
  tagline: 'DAY IN MY LIFE',
  taglineColor: '#00F5FF',
  taglineFontFamily: '',     // '' = match digits font, or any custom font
  taglineFontSize: 28,       // px
  taglineLetterSpacing: 4,   // px
  taglineAnimStyle: 'dial',  // 'dial' (whole phrase dial roll), 'fade', 'static'
  taglinePosition: 'top',    // 'top' or 'bottom'
  showProgressBar: true,
  drumShadow: true,
  digitSpacing: -12,        // Negative font spacing (squeeze tight)
  colonStyle: 'pulse',
  scale: 1.0,
  offsetY: 0,

  // Timeline Mode & Keyframe Beat Stops (Vlog Chapters)
  timelineMode: 'continuous', // 'continuous' or 'keyframes'
  keyframeTransitionDuration: 1.0, // seconds for smooth roll
  keyframeTransitionPlacement: 'arrive', // 'arrive' (rolls before beat), 'centered', 'depart'
  keyframeSpinDynamic: 'kinetic', // 'kinetic' (matches hours), 'whir' (+1 lap), 'direct'
  minuteCadence: 'quarters', // 'quarters' (00, 15, 30, 45), 'tens', 'fives', 'targets-only', 'all', 'custom'
  customMilestones: '0, 15, 30, 45',
  keyframes: [
    {
      id: 'kf_1',
      videoTimeStr: '00:00.01',
      videoTimeSec: 0.0,
      hour: 7,
      minute: 0,
      tagline: 'WAKE UP'
    },
    {
      id: 'kf_2',
      videoTimeStr: '00:04.00',
      videoTimeSec: 4.0,
      hour: 9,
      minute: 30,
      tagline: 'GYM TIME'
    },
    {
      id: 'kf_3',
      videoTimeStr: '00:08.30',
      videoTimeSec: 8.5,
      hour: 13,
      minute: 15,
      tagline: 'LUNCH BREAK'
    },
    {
      id: 'kf_4',
      videoTimeStr: '00:13.00',
      videoTimeSec: 13.0,
      hour: 22,
      minute: 45,
      tagline: 'GOOD NIGHT'
    }
  ],

  // Playback State
  isPlaying: true,
  playbackProgress: 0.0,
  playbackSpeed: 1.0,
  isLooping: true,

  // Export State
  exportFormat: 'mp4',
  isExporting: false,
  lastExportedBlobUrl: null,
  lastExportedFilename: 'chrono-reel-timer.mp4'
};

const state = { ...DEFAULT_STATE };
let userCustomPresets = [];

// ============================================================================
// INITIALIZE RENDERER & EXPORTER
// ============================================================================
const canvas = document.getElementById('timer-canvas');
const renderer = new OdometerRenderer(canvas);
const exporter = new VideoExporter();

const thumbCanvas = document.getElementById('render-thumb-canvas');
const thumbCtx = thumbCanvas ? thumbCanvas.getContext('2d') : null;

// ============================================================================
// PREVIEW ANIMATION LOOP
// ============================================================================
let lastTimestamp = performance.now();

function animationLoop(timestamp) {
  const deltaSec = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  if (state.isPlaying && !state.isExporting) {
    const progressAdvance = (deltaSec * state.playbackSpeed) / Math.max(0.1, state.duration);
    state.playbackProgress += progressAdvance;

    if (state.playbackProgress >= 1.0) {
      if (state.isLooping) {
        state.playbackProgress = state.playbackProgress % 1.0;
      } else {
        state.playbackProgress = 1.0;
        state.isPlaying = false;
        updatePlayPauseUI();
      }
    }
    updateTimelineUI();
  }

  renderCurrentFrame();
  requestAnimationFrame(animationLoop);
}

function renderCurrentFrame() {
  renderer.render({
    progress: state.playbackProgress,
    duration: state.duration,
    startHour: state.startHour,
    startMinute: state.startMinute,
    endHour: state.endHour,
    endMinute: state.endMinute,
    digitGrouping: state.digitGrouping,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    textColor: state.textColor,
    glowColor: state.glowColor,
    glowIntensity: state.glowIntensity,
    bgType: state.bgType,
    bgColor: state.bgColor,
    frameStyle: state.frameStyle,
    borderColor: state.borderColor,
    rollMode: state.rollMode,
    smoothness: state.smoothness,
    minuteStyle: state.minuteStyle,
    minuteSpeed: state.minuteSpeed,
    motionBlur: state.motionBlur,
    timeFormat: state.timeFormat,
    showSeconds: state.showSeconds,
    secondsSpeed: state.secondsSpeed,
    tagline: state.tagline,
    taglineColor: state.taglineColor,
    taglineFontFamily: state.taglineFontFamily,
    taglineFontSize: state.taglineFontSize,
    taglineLetterSpacing: state.taglineLetterSpacing,
    taglineAnimStyle: state.taglineAnimStyle,
    taglinePosition: state.taglinePosition,
    showProgressBar: state.showProgressBar,
    drumShadow: state.drumShadow,
    digitSpacing: state.digitSpacing,
    colonStyle: state.colonStyle,
    scale: state.scale,
    offsetY: state.offsetY,
    timelineMode: state.timelineMode,
    keyframes: state.keyframes,
    keyframeTransitionDuration: state.keyframeTransitionDuration,
    keyframeTransitionPlacement: state.keyframeTransitionPlacement,
    keyframeSpinDynamic: state.keyframeSpinDynamic,
    minuteCadence: state.minuteCadence,
    customMilestones: state.customMilestones,
    fps: state.fps
  });
}

// ============================================================================
// LOCAL STORAGE PERSISTENCE
// ============================================================================
let saveTimeout = null;
function persistCurrentState() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const stateToSave = { ...state };
      delete stateToSave.isPlaying;
      delete stateToSave.playbackProgress;
      delete stateToSave.isExporting;
      delete stateToSave.lastExportedBlobUrl;
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(stateToSave));

      const badge = document.getElementById('storage-status-badge');
      if (badge) {
        badge.textContent = '💾 Saved';
        badge.style.opacity = '1';
        setTimeout(() => { badge.style.opacity = '0.7'; }, 1000);
      }
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  }, 350);
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATE);
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.assign(state, parsed);
      if (!Array.isArray(state.keyframes) || state.keyframes.length === 0) {
        state.keyframes = JSON.parse(JSON.stringify(DEFAULT_STATE.keyframes));
      }
      if (!state.timelineMode) {
        state.timelineMode = 'continuous';
      }
      if (typeof state.keyframeTransitionDuration !== 'number') {
        state.keyframeTransitionDuration = 1.0;
      }
      if (!state.keyframeTransitionPlacement) {
        state.keyframeTransitionPlacement = 'arrive';
      }
      if (!state.keyframeSpinDynamic) {
        state.keyframeSpinDynamic = 'kinetic';
      }
      if (!state.minuteCadence) {
        state.minuteCadence = 'quarters';
      }
      if (!state.customMilestones) {
        state.customMilestones = '0, 15, 30, 45';
      }
      if (typeof state.taglineFontSize !== 'number') {
        state.taglineFontSize = 28;
      }
      if (typeof state.taglineLetterSpacing !== 'number') {
        state.taglineLetterSpacing = 4;
      }
      if (!state.taglineAnimStyle) {
        state.taglineAnimStyle = 'dial';
      }
      if (!state.taglinePosition) {
        state.taglinePosition = 'top';
      }
    }
    const rawPresets = localStorage.getItem(STORAGE_KEY_PRESETS);
    if (rawPresets) {
      userCustomPresets = JSON.parse(rawPresets);
    }
  } catch (e) {
    console.warn('Storage load error:', e);
  }
}

// ============================================================================
// UI SYNC & HELPERS
// ============================================================================
function formatDurationDisplay(sec) {
  if (sec < 60) {
    return `${sec.toFixed(1)} seconds`;
  }
  const mins = Math.floor(sec / 60);
  const remainingSec = Math.round(sec % 60);
  return remainingSec === 0 ? `${mins} min` : `${mins}m ${remainingSec}s`;
}

function updateTimelineUI() {
  const slider = document.getElementById('timeline-slider');
  if (slider) {
    slider.value = Math.round(state.playbackProgress * 1000);
  }

  const trackGlow = document.getElementById('scrubber-track-glow');
  if (trackGlow) {
    trackGlow.style.width = `${state.playbackProgress * 100}%`;
  }

  const currentVideoSec = state.playbackProgress * state.duration;
  const timecodeEl = document.getElementById('timeline-timecode-display');
  if (timecodeEl) {
    timecodeEl.textContent = secondsToTimecode(currentVideoSec, state.fps);
  }

  const pad = (n) => (n || 0).toString().padStart(2, '0');
  const displayEl = document.getElementById('timeline-time-display');
  const endEl = document.getElementById('timeline-end-display');

  if (state.timelineMode === 'keyframes' && state.keyframes && state.keyframes.length > 0) {
    const kfInterp = renderer.calculateKeyframeInterpolation({
      progress: state.playbackProgress,
      duration: state.duration,
      keyframes: state.keyframes,
      transitionDuration: state.keyframeTransitionDuration,
      transitionPlacement: state.keyframeTransitionPlacement,
      spinDynamic: state.keyframeSpinDynamic,
      timeFormat: state.timeFormat,
      showSeconds: state.showSeconds,
      tagline: state.tagline,
      smoothness: state.smoothness,
      minuteCadence: state.minuteCadence,
      customMilestones: state.customMilestones
    });

    if (displayEl) {
      const h = Math.floor(kfInterp.hourVal);
      const m = Math.floor(kfInterp.minVal);
      displayEl.textContent = `${pad(h)}:${pad(m)}`;
    }

    if (endEl) {
      const sorted = [...state.keyframes].sort((a, b) => a.videoTimeSec - b.videoTimeSec);
      const lastKf = sorted[sorted.length - 1];
      endEl.textContent = `${pad(lastKf.hour)}:${pad(lastKf.minute)}`;
    }

  } else {
    const startSec = (state.startHour * 3600) + (state.startMinute * 60);
    const endSec = (state.endHour * 3600) + (state.endMinute * 60) + (state.showSeconds ? 59 : 0);
    const currentSec = startSec + state.playbackProgress * (endSec - startSec);

    const h = Math.floor(currentSec / 3600) % 24;
    const m = Math.floor((currentSec % 3600) / 60);
    const s = Math.floor(currentSec % 60);

    const timeStr = state.showSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;

    if (displayEl) displayEl.textContent = timeStr;
    if (endEl) endEl.textContent = `${pad(state.endHour)}:${pad(state.endMinute)}`;
  }
}

function updatePlayPauseUI() {
  const icon = document.getElementById('play-pause-icon');
  if (icon) {
    icon.textContent = state.isPlaying ? '⏸' : '▶';
  }
}

function updateAspectRatio(aspect) {
  state.aspectRatio = aspect;
  const stageWrapper = document.getElementById('canvas-stage-wrapper');
  const resLabel = document.getElementById('resolution-label');
  const exportAspectDisplay = document.getElementById('export-aspect-display');

  if (aspect === '9:16') {
    state.width = 1080;
    state.height = 1920;
    if (stageWrapper) stageWrapper.style.aspectRatio = '9 / 16';
    if (resLabel) resLabel.textContent = '1080 × 1920 (9:16 Reel/TikTok)';
    if (exportAspectDisplay) exportAspectDisplay.value = '9:16 Vertical Reel (1080×1920)';
  } else if (aspect === '1:1') {
    state.width = 1080;
    state.height = 1080;
    if (stageWrapper) stageWrapper.style.aspectRatio = '1 / 1';
    if (resLabel) resLabel.textContent = '1080 × 1080 (1:1 Square Feed)';
    if (exportAspectDisplay) exportAspectDisplay.value = '1:1 Square (1080×1080)';
  } else if (aspect === '16:9') {
    state.width = 1920;
    state.height = 1080;
    if (stageWrapper) stageWrapper.style.aspectRatio = '16 / 9';
    if (resLabel) resLabel.textContent = '1920 × 1080 (16:9 Landscape)';
    if (exportAspectDisplay) exportAspectDisplay.value = '16:9 Landscape (1920×1080)';
  }

  canvas.width = state.width;
  canvas.height = state.height;

  document.querySelectorAll('.aspect-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.aspect === aspect);
  });

  persistCurrentState();
}

function applyPreset(presetId) {
  let preset = userCustomPresets.find((p) => p.id === presetId);
  if (!preset) {
    preset = PRESETS.find((p) => p.id === presetId);
  }
  if (!preset) return;

  const cfg = preset.config;
  Object.assign(state, cfg);

  if (typeof document !== 'undefined' && document.fonts && cfg.fontFamily) {
    document.fonts.load(`150px "${cfg.fontFamily}"`).then(() => {
      renderCurrentFrame();
    }).catch(() => {});
  }

  syncInputsWithState();
  renderPresetButtons();
  persistCurrentState();
  renderCurrentFrame();
}

function syncInputsWithState() {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('select-font-family', state.fontFamily);
  setVal('slider-font-size', state.fontSize);
  document.getElementById('val-font-size').textContent = `${state.fontSize} px`;

  setVal('picker-text-color', state.textColor);
  document.getElementById('badge-text-color').textContent = state.textColor;

  setVal('picker-glow-color', state.glowColor);
  document.getElementById('badge-glow-color').textContent = state.glowColor;

  setVal('picker-tagline-color', state.taglineColor || state.textColor);
  document.getElementById('badge-tagline-color').textContent = state.taglineColor || state.textColor;

  setVal('slider-glow-intensity', state.glowIntensity);
  document.getElementById('val-glow-intensity').textContent = `${state.glowIntensity}`;

  setVal('select-digit-grouping', state.digitGrouping || 'paired');
  setVal('select-roll-mode', state.rollMode || 'ultra-smooth');

  setVal('select-minute-style', state.minuteStyle || 'match-hour');
  setVal('slider-minute-speed', state.minuteSpeed || 1.0);
  const minSpeedEl = document.getElementById('val-minute-speed');
  if (minSpeedEl) {
    const ms = state.minuteSpeed || 1.0;
    minSpeedEl.textContent = `${ms}× ${ms <= 0.5 ? '(Ultra Slow & Chill)' : ms <= 1.0 ? '(Cinematic Smooth)' : '(Brisk Flow)'}`;
  }
  document.querySelectorAll('[data-minspeed]').forEach((chip) => {
    chip.classList.toggle('active', parseFloat(chip.dataset.minspeed) === (state.minuteSpeed || 1.0));
  });

  setVal('slider-seconds-speed', state.secondsSpeed || 1.0);
  const secSpeedEl = document.getElementById('val-seconds-speed');
  if (secSpeedEl) {
    const ss = state.secondsSpeed || 1.0;
    secSpeedEl.textContent = `${ss}× ${ss <= 0.5 ? '(Slow & Relaxed)' : ss <= 1.0 ? '(Cinematic Smooth)' : '(Brisk Beat)'}`;
  }
  document.querySelectorAll('[data-secspeed]').forEach((chip) => {
    chip.classList.toggle('active', parseFloat(chip.dataset.secspeed) === (state.secondsSpeed || 1.0));
  });

  const secSpeedContainer = document.getElementById('seconds-speed-container');
  if (secSpeedContainer) {
    secSpeedContainer.style.display = state.showSeconds ? 'block' : 'none';
  }

  setVal('slider-smoothness', state.smoothness || 0.85);
  const valSmooth = document.getElementById('val-smoothness');
  if (valSmooth) {
    const s = state.smoothness || 0.85;
    valSmooth.textContent = s >= 0.8 ? `${s} (Butter Smooth)` : `${s} (Snappy)`;
  }

  const checkMotionBlur = document.getElementById('check-motion-blur');
  if (checkMotionBlur) checkMotionBlur.checked = !!state.motionBlur;

  setVal('select-time-format', state.timeFormat);
  document.getElementById('check-show-seconds').checked = state.showSeconds;
  document.getElementById('check-progress-bar').checked = state.showProgressBar;
  document.getElementById('check-drum-shadow').checked = state.drumShadow;

  setVal('input-tagline', state.tagline);
  setVal('select-colon-style', state.colonStyle);
  setVal('select-frame-style', state.frameStyle);
  setVal('picker-border-color', state.borderColor.startsWith('rgba') ? '#00F5FF' : state.borderColor);

  setVal('slider-digit-spacing', state.digitSpacing);
  const spacingEl = document.getElementById('val-digit-spacing');
  if (spacingEl) {
    const sp = state.digitSpacing;
    spacingEl.textContent = sp < 0 ? `${sp} px (Tight Squeeze)` : `${sp} px`;
  }

  setVal('slider-duration', state.duration);
  const durVal = document.getElementById('val-duration');
  if (durVal) durVal.textContent = formatDurationDisplay(state.duration);
  const durBadge = document.getElementById('duration-meta-badge');
  if (durBadge) durBadge.textContent = `${formatDurationDisplay(state.duration)} @ ${state.fps} FPS`;

  setVal('slider-scale', state.scale);
  document.getElementById('val-scale').textContent = `${state.scale.toFixed(2)}×`;

  setVal('slider-offset-y', state.offsetY);
  document.getElementById('val-offset-y').textContent = state.offsetY === 0 ? 'Center (0px)' : `${state.offsetY}px`;

  document.querySelectorAll('.bg-card-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.bg === state.bgType);
  });
  const solidRow = document.getElementById('solid-color-row');
  if (solidRow) {
    solidRow.style.display = state.bgType === 'solid' ? 'flex' : 'none';
  }

  // Sync Tagline Typography & Motion Controls
  setVal('select-tagline-font-family', state.taglineFontFamily || '');
  setVal('select-tagline-anim-style', state.taglineAnimStyle || 'dial');
  setVal('select-tagline-position', state.taglinePosition || 'top');
  setVal('slider-tagline-font-size', state.taglineFontSize || 28);
  const tagSizeEl = document.getElementById('val-tagline-font-size');
  if (tagSizeEl) tagSizeEl.textContent = `${state.taglineFontSize || 28} px`;
  setVal('slider-tagline-letter-spacing', state.taglineLetterSpacing || 4);
  const tagSpacEl = document.getElementById('val-tagline-letter-spacing');
  if (tagSpacEl) tagSpacEl.textContent = `${state.taglineLetterSpacing || 4} px`;

  // Sync Animation Mode (Continuous Flow vs Keyframe Beats)
  const isKeyframes = state.timelineMode === 'keyframes';
  const btnModeCont = document.getElementById('btn-mode-continuous');
  const btnModeKf = document.getElementById('btn-mode-keyframes');
  const cardCont = document.getElementById('card-continuous-time-range');
  const cardKf = document.getElementById('card-keyframes-manager');

  if (btnModeCont) btnModeCont.classList.toggle('active', !isKeyframes);
  if (btnModeKf) btnModeKf.classList.toggle('active', isKeyframes);
  if (cardCont) cardCont.style.display = isKeyframes ? 'none' : 'block';
  if (cardKf) cardKf.style.display = isKeyframes ? 'block' : 'none';

  setVal('slider-kf-trans-duration', state.keyframeTransitionDuration || 1.0);
  const valKfDur = document.getElementById('val-kf-trans-duration');
  if (valKfDur) {
    const dur = state.keyframeTransitionDuration || 1.0;
    valKfDur.textContent = `${dur.toFixed(1)}s (${dur <= 0.6 ? 'Snappy' : dur <= 1.2 ? 'Smooth' : 'Cinematic'})`;
  }
  setVal('select-kf-trans-placement', state.keyframeTransitionPlacement || 'arrive');
  setVal('select-kf-spin-dynamic', state.keyframeSpinDynamic || 'kinetic');
  setVal('select-kf-minute-cadence', state.minuteCadence || 'quarters');
  setVal('input-custom-milestones', state.customMilestones || '0, 15, 30, 45');
  const customBox = document.getElementById('custom-milestones-container');
  if (customBox) {
    customBox.style.display = state.minuteCadence === 'custom' ? 'block' : 'none';
  }

  renderKeyframeItems();
  renderTimelineKeyframePins();
}

// ============================================================================
// KEYFRAME BEATS RENDERERS
// ============================================================================
function renderKeyframeItems() {
  const container = document.getElementById('keyframe-items-container');
  if (!container) return;

  container.innerHTML = '';

  state.keyframes.forEach((kf, index) => {
    const card = document.createElement('div');
    card.className = 'kf-card';
    card.dataset.id = kf.id;

    const pad2 = (n) => (n || 0).toString().padStart(2, '0');
    const clockTimeVal = `${pad2(kf.hour)}:${pad2(kf.minute)}`;
    let disp12 = (kf.hour || 0) % 12;
    if (disp12 === 0) disp12 = 12;
    const ampm = (kf.hour || 0) >= 12 ? 'PM' : 'AM';
    const clock12Str = `${disp12}:${pad2(kf.minute)} ${ampm}`;

    card.innerHTML = `
      <div class="kf-card-header">
        <span class="kf-beat-badge">Beat #${index + 1}</span>
        <div class="kf-header-actions">
          <button type="button" class="kf-btn-icon kf-btn-seek" title="Seek video playhead to this beat">▶ Seek</button>
          ${state.keyframes.length > 1 ? `<button type="button" class="kf-btn-icon kf-btn-delete" title="Delete beat">✕</button>` : ''}
        </div>
      </div>

      <div class="kf-grid-inputs">
        <div class="kf-input-group">
          <label>Video Time (Min:Sec.Frames)</label>
          <div class="kf-timecode-wrap">
            <input type="text" class="kf-timecode-input" value="${kf.videoTimeStr || secondsToTimecode(kf.videoTimeSec, state.fps)}" placeholder="00:04.15" />
            <button type="button" class="btn-grab-playhead" title="Set to current playhead">📍 Now</button>
          </div>
          <span class="kf-sec-readout">${(kf.videoTimeSec || 0).toFixed(2)}s in video</span>
        </div>

        <div class="kf-input-group">
          <label>Stop Clock Time (${state.timeFormat === '12h' ? clock12Str : '24h'})</label>
          <input type="time" class="kf-clock-input" value="${clockTimeVal}" />
          <span class="kf-sec-readout">${clock12Str}</span>
        </div>
      </div>

      <div class="kf-input-group" style="margin-top: 4px;">
        <label>Scene Tagline / Label (Optional)</label>
        <input type="text" class="kf-tagline-input" value="${kf.tagline || ''}" placeholder="e.g. WAKE UP, GYM, LUNCH, STUDY" />
      </div>
    `;

    const timecodeInput = card.querySelector('.kf-timecode-input');
    const clockInput = card.querySelector('.kf-clock-input');
    const taglineInput = card.querySelector('.kf-tagline-input');
    const grabBtn = card.querySelector('.btn-grab-playhead');
    const seekBtn = card.querySelector('.kf-btn-seek');
    const deleteBtn = card.querySelector('.kf-btn-delete');

    timecodeInput.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      const sec = timecodeToSeconds(val, state.fps);
      kf.videoTimeSec = Math.max(0, Math.min(state.duration, sec));
      kf.videoTimeStr = secondsToTimecode(kf.videoTimeSec, state.fps);
      timecodeInput.value = kf.videoTimeStr;
      card.querySelector('.kf-sec-readout').textContent = `${kf.videoTimeSec.toFixed(2)}s in video`;
      renderTimelineKeyframePins();
      persistCurrentState();
      renderCurrentFrame();
    });

    grabBtn.addEventListener('click', () => {
      const curSec = state.playbackProgress * state.duration;
      kf.videoTimeSec = curSec;
      kf.videoTimeStr = secondsToTimecode(curSec, state.fps);
      timecodeInput.value = kf.videoTimeStr;
      card.querySelector('.kf-sec-readout').textContent = `${kf.videoTimeSec.toFixed(2)}s in video`;
      renderTimelineKeyframePins();
      persistCurrentState();
      renderCurrentFrame();
    });

    clockInput.addEventListener('change', (e) => {
      const [h, m] = e.target.value.split(':').map(Number);
      kf.hour = h || 0;
      kf.minute = m || 0;
      renderKeyframeItems();
      renderTimelineKeyframePins();
      persistCurrentState();
      renderCurrentFrame();
    });

    taglineInput.addEventListener('input', (e) => {
      kf.tagline = e.target.value;
      persistCurrentState();
      renderCurrentFrame();
    });

    seekBtn.addEventListener('click', () => {
      state.playbackProgress = Math.max(0, Math.min(1, (kf.videoTimeSec || 0) / Math.max(0.1, state.duration)));
      updateTimelineUI();
      renderCurrentFrame();
    });

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        state.keyframes = state.keyframes.filter(k => k.id !== kf.id);
        renderKeyframeItems();
        renderTimelineKeyframePins();
        persistCurrentState();
        renderCurrentFrame();
      });
    }

    container.appendChild(card);
  });
}

function renderTimelineKeyframePins() {
  const container = document.getElementById('timeline-keyframe-pins');
  if (!container) return;

  container.innerHTML = '';
  if (state.timelineMode !== 'keyframes') return;

  state.keyframes.forEach((kf, index) => {
    const pin = document.createElement('div');
    pin.className = 'kf-diamond-pin';
    const pct = Math.max(0, Math.min(100, ((kf.videoTimeSec || 0) / Math.max(0.1, state.duration)) * 100));
    pin.style.left = `${pct}%`;
    const pad2 = (n) => (n || 0).toString().padStart(2, '0');
    pin.title = `Beat #${index + 1}: ${kf.videoTimeStr || secondsToTimecode(kf.videoTimeSec, state.fps)} -> ${pad2(kf.hour)}:${pad2(kf.minute)}${kf.tagline ? ` (${kf.tagline})` : ''}`;

    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      state.playbackProgress = Math.max(0, Math.min(1, (kf.videoTimeSec || 0) / Math.max(0.1, state.duration)));
      updateTimelineUI();
      renderCurrentFrame();
    });

    container.appendChild(pin);
  });
}

// ============================================================================
// PRESET BUTTONS (BUILT-IN + USER CUSTOM)
// ============================================================================
function renderPresetButtons() {
  const container = document.getElementById('preset-buttons-container');
  if (!container) return;

  container.innerHTML = '';

  userCustomPresets.forEach((customPreset) => {
    const btn = document.createElement('div');
    btn.className = 'preset-pill user-preset';
    btn.dataset.id = customPreset.id;
    btn.innerHTML = `
      <span>⭐ ${customPreset.name}</span>
      <span class="delete-custom-preset" title="Delete custom preset">✕</span>
    `;

    btn.querySelector('span:first-child').addEventListener('click', (e) => {
      e.stopPropagation();
      applyPreset(customPreset.id);
    });

    btn.querySelector('.delete-custom-preset').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCustomPreset(customPreset.id);
    });

    container.appendChild(btn);
  });

  PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-pill';
    btn.dataset.id = preset.id;
    btn.innerHTML = `<span>${preset.name}</span>`;
    btn.title = preset.description;
    btn.addEventListener('click', () => applyPreset(preset.id));
    container.appendChild(btn);
  });
}

function saveCurrentAsCustomPreset(name) {
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  const id = 'custom_' + Date.now();

  const newPreset = {
    id,
    name: cleanName,
    isCustom: true,
    config: {
      digitGrouping: state.digitGrouping,
      fontFamily: state.fontFamily,
      fontSize: state.fontSize,
      textColor: state.textColor,
      glowColor: state.glowColor,
      glowIntensity: state.glowIntensity,
      bgType: state.bgType,
      bgColor: state.bgColor,
      frameStyle: state.frameStyle,
      borderColor: state.borderColor,
      rollMode: state.rollMode,
      smoothness: state.smoothness,
      minuteStyle: state.minuteStyle,
      minuteSpeed: state.minuteSpeed,
      motionBlur: state.motionBlur,
      timeFormat: state.timeFormat,
      showSeconds: state.showSeconds,
      secondsSpeed: state.secondsSpeed,
      tagline: state.tagline,
      taglineColor: state.taglineColor,
      taglineFontFamily: state.taglineFontFamily,
      taglineFontSize: state.taglineFontSize,
      taglineLetterSpacing: state.taglineLetterSpacing,
      taglineAnimStyle: state.taglineAnimStyle,
      taglinePosition: state.taglinePosition,
      drumShadow: state.drumShadow,
      digitSpacing: state.digitSpacing,
      colonStyle: state.colonStyle,
      timelineMode: state.timelineMode,
      keyframeTransitionDuration: state.keyframeTransitionDuration,
      keyframeTransitionPlacement: state.keyframeTransitionPlacement,
      keyframeSpinDynamic: state.keyframeSpinDynamic,
      minuteCadence: state.minuteCadence,
      customMilestones: state.customMilestones,
      keyframes: JSON.parse(JSON.stringify(state.keyframes))
    }
  };

  userCustomPresets.unshift(newPreset);
  localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(userCustomPresets));
  renderPresetButtons();

  try {
    confetti({ particleCount: 50, spread: 50, origin: { y: 0.2 } });
  } catch {}
}

function deleteCustomPreset(presetId) {
  userCustomPresets = userCustomPresets.filter((p) => p.id !== presetId);
  localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(userCustomPresets));
  renderPresetButtons();
  showToast('Preset deleted', 'info');
}

// ============================================================================
// TOAST NOTIFICATIONS & PRESET FILE EXPORT / IMPORT (DESKTOP & MOBILE)
// ============================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.innerHTML = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

function exportPresetToFile() {
  try {
    const safeTagline = (state.tagline || 'preset').trim();
    const exportData = {
      version: '1.0',
      appName: 'CHRONO_REEL',
      exportedAt: new Date().toISOString(),
      activePreset: {
        id: 'export_' + Date.now(),
        name: safeTagline || 'Custom Preset',
        config: {
          aspectRatio: state.aspectRatio,
          duration: state.duration,
          fps: state.fps,
          startHour: state.startHour,
          startMinute: state.startMinute,
          endHour: state.endHour,
          endMinute: state.endMinute,
          digitGrouping: state.digitGrouping,
          fontFamily: state.fontFamily,
          fontSize: state.fontSize,
          textColor: state.textColor,
          glowColor: state.glowColor,
          glowIntensity: state.glowIntensity,
          bgType: state.bgType,
          bgColor: state.bgColor,
          frameStyle: state.frameStyle,
          borderColor: state.borderColor,
          rollMode: state.rollMode,
          smoothness: state.smoothness,
          minuteStyle: state.minuteStyle,
          minuteSpeed: state.minuteSpeed,
          motionBlur: state.motionBlur,
          timeFormat: state.timeFormat,
          showSeconds: state.showSeconds,
          secondsSpeed: state.secondsSpeed,
          tagline: state.tagline,
          taglineColor: state.taglineColor,
          taglineFontFamily: state.taglineFontFamily,
          taglineFontSize: state.taglineFontSize,
          taglineLetterSpacing: state.taglineLetterSpacing,
          taglineAnimStyle: state.taglineAnimStyle,
          taglinePosition: state.taglinePosition,
          drumShadow: state.drumShadow,
          digitSpacing: state.digitSpacing,
          colonStyle: state.colonStyle,
          scale: state.scale,
          offsetY: state.offsetY,
          timelineMode: state.timelineMode,
          keyframeTransitionDuration: state.keyframeTransitionDuration,
          keyframeTransitionPlacement: state.keyframeTransitionPlacement,
          keyframeSpinDynamic: state.keyframeSpinDynamic,
          minuteCadence: state.minuteCadence,
          customMilestones: state.customMilestones,
          keyframes: JSON.parse(JSON.stringify(state.keyframes))
        }
      },
      userCustomPresets: JSON.parse(JSON.stringify(userCustomPresets))
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const safeFileBase = safeTagline.toLowerCase().replace(/[^a-z0-9_-]/gi, '_') || 'timer';
    const filename = `chrono-preset-${safeFileBase}.json`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 2500);

    showToast(`💾 Preset exported as <strong>${filename}</strong>! Ready to transfer to phone.`, 'success');
  } catch (err) {
    console.error('Export preset file failed:', err);
    showToast(`⚠️ Failed to export preset: ${err.message}`, 'error');
  }
}

function importPresetFromFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      let loadedConfig = null;

      if (parsed.activePreset && parsed.activePreset.config) {
        loadedConfig = parsed.activePreset.config;
      } else if (parsed.config) {
        loadedConfig = parsed.config;
      } else if (parsed.fontFamily || parsed.keyframes || parsed.tagline) {
        loadedConfig = parsed;
      }

      if (!loadedConfig) {
        throw new Error('Unrecognized preset file structure');
      }

      if (Array.isArray(parsed.userCustomPresets)) {
        parsed.userCustomPresets.forEach((p) => {
          if (!userCustomPresets.some((existing) => existing.id === p.id)) {
            userCustomPresets.push(p);
          }
        });
        localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(userCustomPresets));
        renderPresetButtons();
      }

      Object.assign(state, loadedConfig);

      if (typeof document !== 'undefined' && document.fonts) {
        const fontsToLoad = [state.fontFamily, state.taglineFontFamily].filter(Boolean);
        for (const f of fontsToLoad) {
          try {
            await document.fonts.load(`100px "${f}"`);
          } catch {}
        }
        try { await document.fonts.ready; } catch {}
      }

      syncInputsWithState();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();

      try {
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.25 } });
      } catch {}

      showToast(`📱 Preset successfully imported! All settings & vlog beats restored.`, 'success');
    } catch (err) {
      console.error('Import preset error:', err);
      showToast(`❌ Invalid preset file format: ${err.message}`, 'error');
    }
  };

  reader.onerror = () => {
    showToast(`❌ Error reading file`, 'error');
  };

  reader.readAsText(file);
}

// ============================================================================
// SETUP EVENT LISTENERS
// ============================================================================
function setupEventListeners() {
  document.querySelectorAll('.tab-btn').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panelId = tab.dataset.tab;
      const targetPanel = document.getElementById(panelId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  document.querySelectorAll('.aspect-btn').forEach((btn) => {
    btn.addEventListener('click', () => updateAspectRatio(btn.dataset.aspect));
  });

  const btnPlayPause = document.getElementById('btn-play-pause');
  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      state.isPlaying = !state.isPlaying;
      updatePlayPauseUI();
    });
  }

  const btnRestart = document.getElementById('btn-restart');
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      state.playbackProgress = 0.0;
      updateTimelineUI();
    });
  }

  const timelineSlider = document.getElementById('timeline-slider');
  if (timelineSlider) {
    timelineSlider.addEventListener('input', (e) => {
      state.playbackProgress = parseFloat(e.target.value) / 1000;
      updateTimelineUI();
    });
  }

  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.playbackSpeed = parseFloat(btn.dataset.speed);
    });
  });

  const btnLoop = document.getElementById('btn-loop-toggle');
  if (btnLoop) {
    btnLoop.addEventListener('click', () => {
      state.isLooping = !state.isLooping;
      btnLoop.classList.toggle('active', state.isLooping);
    });
  }

  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  if (btnToggleGrid) {
    btnToggleGrid.addEventListener('click', () => {
      const overlay = document.getElementById('safe-zone-overlay');
      if (overlay) {
        overlay.classList.toggle('visible');
        btnToggleGrid.classList.toggle('active', overlay.classList.contains('visible'));
      }
    });
  }

  const btnResetDefaults = document.getElementById('btn-reset-defaults');
  if (btnResetDefaults) {
    btnResetDefaults.addEventListener('click', () => {
      if (confirm('Reset all timer and style settings to defaults?')) {
        Object.assign(state, DEFAULT_STATE);
        localStorage.removeItem(STORAGE_KEY_STATE);
        syncInputsWithState();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      state.isPlaying = !state.isPlaying;
      updatePlayPauseUI();
    }
  });

  // Animation Mode Switching (Continuous Flow vs Keyframe Beat Stops)
  const btnModeCont = document.getElementById('btn-mode-continuous');
  const btnModeKf = document.getElementById('btn-mode-keyframes');

  if (btnModeCont) {
    btnModeCont.addEventListener('click', () => {
      state.timelineMode = 'continuous';
      syncInputsWithState();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  if (btnModeKf) {
    btnModeKf.addEventListener('click', () => {
      state.timelineMode = 'keyframes';
      syncInputsWithState();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  // Keyframe Beat Transition Duration & Placement
  const sliderKfDur = document.getElementById('slider-kf-trans-duration');
  const valKfDur = document.getElementById('val-kf-trans-duration');
  if (sliderKfDur) {
    sliderKfDur.addEventListener('input', (e) => {
      state.keyframeTransitionDuration = parseFloat(e.target.value);
      if (valKfDur) {
        valKfDur.textContent = `${state.keyframeTransitionDuration.toFixed(1)}s (${state.keyframeTransitionDuration <= 0.6 ? 'Snappy' : state.keyframeTransitionDuration <= 1.2 ? 'Smooth' : 'Cinematic'})`;
      }
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const selectKfPlacement = document.getElementById('select-kf-trans-placement');
  if (selectKfPlacement) {
    selectKfPlacement.addEventListener('change', (e) => {
      state.keyframeTransitionPlacement = e.target.value;
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const selectKfSpin = document.getElementById('select-kf-spin-dynamic');
  if (selectKfSpin) {
    selectKfSpin.addEventListener('change', (e) => {
      state.keyframeSpinDynamic = e.target.value;
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const selectKfCadence = document.getElementById('select-kf-minute-cadence');
  const customBoxEl = document.getElementById('custom-milestones-container');
  if (selectKfCadence) {
    selectKfCadence.addEventListener('change', (e) => {
      state.minuteCadence = e.target.value;
      if (customBoxEl) {
        customBoxEl.style.display = state.minuteCadence === 'custom' ? 'block' : 'none';
      }
      persistCurrentState();
      renderCurrentFrame();
      updateTimelineUI();
    });
  }

  const inputCustomMilestones = document.getElementById('input-custom-milestones');
  if (inputCustomMilestones) {
    inputCustomMilestones.addEventListener('input', (e) => {
      state.customMilestones = e.target.value;
      persistCurrentState();
      renderCurrentFrame();
      updateTimelineUI();
    });
  }

  // Add Keyframe Beat
  const btnAddKf = document.getElementById('btn-add-keyframe');
  if (btnAddKf) {
    btnAddKf.addEventListener('click', () => {
      const curSec = state.playbackProgress * state.duration;
      const id = 'kf_' + Date.now();

      let nextH = 12;
      let nextM = 0;
      if (state.keyframes.length > 0) {
        const last = state.keyframes[state.keyframes.length - 1];
        nextH = ((last.hour || 0) + 2) % 24;
        nextM = last.minute || 0;
      }

      state.keyframes.push({
        id,
        videoTimeStr: secondsToTimecode(curSec, state.fps),
        videoTimeSec: curSec,
        hour: nextH,
        minute: nextM,
        tagline: 'SCENE'
      });

      state.keyframes.sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0));

      renderKeyframeItems();
      renderTimelineKeyframePins();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  // Sort Keyframe Beats
  const btnSortKf = document.getElementById('btn-sort-keyframes');
  if (btnSortKf) {
    btnSortKf.addEventListener('click', () => {
      state.keyframes.sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0));
      renderKeyframeItems();
      renderTimelineKeyframePins();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  // Quick Vlog Templates
  const btnTplDiml = document.getElementById('btn-template-diml');
  if (btnTplDiml) {
    btnTplDiml.addEventListener('click', () => {
      const dur = state.duration;
      state.keyframes = [
        { id: 'kf_' + Date.now() + '_1', videoTimeSec: 0, videoTimeStr: secondsToTimecode(0, state.fps), hour: 6, minute: 30, tagline: 'WAKE UP' },
        { id: 'kf_' + Date.now() + '_2', videoTimeSec: dur * 0.25, videoTimeStr: secondsToTimecode(dur * 0.25, state.fps), hour: 9, minute: 0, tagline: 'WORKOUT' },
        { id: 'kf_' + Date.now() + '_3', videoTimeSec: dur * 0.50, videoTimeStr: secondsToTimecode(dur * 0.50, state.fps), hour: 13, minute: 15, tagline: 'LUNCH' },
        { id: 'kf_' + Date.now() + '_4', videoTimeSec: dur * 0.75, videoTimeStr: secondsToTimecode(dur * 0.75, state.fps), hour: 18, minute: 45, tagline: 'SUNSET' },
        { id: 'kf_' + Date.now() + '_5', videoTimeSec: dur, videoTimeStr: secondsToTimecode(dur, state.fps), hour: 23, minute: 0, tagline: 'NIGHT ROUTINE' }
      ];
      renderKeyframeItems();
      renderTimelineKeyframePins();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const btnTplQuick = document.getElementById('btn-template-quick');
  if (btnTplQuick) {
    btnTplQuick.addEventListener('click', () => {
      const dur = state.duration;
      state.keyframes = [
        { id: 'kf_' + Date.now() + '_1', videoTimeSec: 0, videoTimeStr: secondsToTimecode(0, state.fps), hour: 8, minute: 0, tagline: 'MORNING' },
        { id: 'kf_' + Date.now() + '_2', videoTimeSec: dur * 0.5, videoTimeStr: secondsToTimecode(dur * 0.5, state.fps), hour: 14, minute: 30, tagline: 'AFTERNOON' },
        { id: 'kf_' + Date.now() + '_3', videoTimeSec: dur, videoTimeStr: secondsToTimecode(dur, state.fps), hour: 21, minute: 0, tagline: 'EVENING' }
      ];
      renderKeyframeItems();
      renderTimelineKeyframePins();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const btnTplTravel = document.getElementById('btn-template-travel');
  if (btnTplTravel) {
    btnTplTravel.addEventListener('click', () => {
      const dur = state.duration;
      state.keyframes = [
        { id: 'kf_' + Date.now() + '_1', videoTimeSec: 0, videoTimeStr: secondsToTimecode(0, state.fps), hour: 5, minute: 15, tagline: 'DEPARTURE' },
        { id: 'kf_' + Date.now() + '_2', videoTimeSec: dur * 0.33, videoTimeStr: secondsToTimecode(dur * 0.33, state.fps), hour: 11, minute: 0, tagline: 'TOUCHDOWN' },
        { id: 'kf_' + Date.now() + '_3', videoTimeSec: dur * 0.66, videoTimeStr: secondsToTimecode(dur * 0.66, state.fps), hour: 16, minute: 30, tagline: 'HOTEL CHECKIN' },
        { id: 'kf_' + Date.now() + '_4', videoTimeSec: dur, videoTimeStr: secondsToTimecode(dur, state.fps), hour: 20, minute: 0, tagline: 'DINNER VIBES' }
      ];
      renderKeyframeItems();
      renderTimelineKeyframePins();
      updateTimelineUI();
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const startTimeInput = document.getElementById('input-start-time');
  const endTimeInput = document.getElementById('input-end-time');

  const updateTimeRange = () => {
    if (startTimeInput && startTimeInput.value) {
      const [h, m] = startTimeInput.value.split(':').map(Number);
      state.startHour = h || 0;
      state.startMinute = m || 0;
    }
    if (endTimeInput && endTimeInput.value) {
      const [h, m] = endTimeInput.value.split(':').map(Number);
      state.endHour = h || 0;
      state.endMinute = m || 0;
    }
    updateTimelineUI();
    persistCurrentState();
  };

  if (startTimeInput) startTimeInput.addEventListener('change', updateTimeRange);
  if (endTimeInput) endTimeInput.addEventListener('change', updateTimeRange);

  document.querySelectorAll('[data-range]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-range]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const [start, end] = chip.dataset.range.split('-');
      if (startTimeInput) startTimeInput.value = start;
      if (endTimeInput) endTimeInput.value = end;
      updateTimeRange();
    });
  });

  const sliderDuration = document.getElementById('slider-duration');
  const valDuration = document.getElementById('val-duration');
  const durationBadge = document.getElementById('duration-meta-badge');

  const updateDuration = (val) => {
    state.duration = parseFloat(val);
    if (valDuration) valDuration.textContent = formatDurationDisplay(state.duration);
    if (durationBadge) durationBadge.textContent = `${formatDurationDisplay(state.duration)} @ ${state.fps} FPS`;
    if (sliderDuration) sliderDuration.value = val;
    renderTimelineKeyframePins();
    persistCurrentState();
  };

  if (sliderDuration) {
    sliderDuration.addEventListener('input', (e) => updateDuration(e.target.value));
  }

  document.querySelectorAll('[data-duration]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-duration]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      updateDuration(chip.dataset.duration);
    });
  });

  // Digit Grouping (Paired 00..23 vs Split wheels)
  const selectDigitGrouping = document.getElementById('select-digit-grouping');
  if (selectDigitGrouping) {
    selectDigitGrouping.addEventListener('change', (e) => {
      state.digitGrouping = e.target.value;
      persistCurrentState();
    });
  }

  // Rolling Dynamics
  const selectRollMode = document.getElementById('select-roll-mode');
  if (selectRollMode) {
    selectRollMode.addEventListener('change', (e) => {
      state.rollMode = e.target.value;
      persistCurrentState();
    });
  }

  // Minute Pacing & Speed
  const selectMinuteStyle = document.getElementById('select-minute-style');
  if (selectMinuteStyle) {
    selectMinuteStyle.addEventListener('change', (e) => {
      state.minuteStyle = e.target.value;
      persistCurrentState();
    });
  }

  const sliderMinuteSpeed = document.getElementById('slider-minute-speed');
  const valMinuteSpeed = document.getElementById('val-minute-speed');
  const updateMinuteSpeed = (val) => {
    state.minuteSpeed = parseFloat(val);
    if (sliderMinuteSpeed) sliderMinuteSpeed.value = val;
    if (valMinuteSpeed) {
      valMinuteSpeed.textContent = `${state.minuteSpeed}× ${state.minuteSpeed <= 0.5 ? '(Ultra Slow & Chill)' : state.minuteSpeed <= 1.0 ? '(Cinematic Smooth)' : '(Brisk Flow)'}`;
    }
    document.querySelectorAll('[data-minspeed]').forEach((chip) => {
      chip.classList.toggle('active', parseFloat(chip.dataset.minspeed) === state.minuteSpeed);
    });
    persistCurrentState();
  };

  if (sliderMinuteSpeed) {
    sliderMinuteSpeed.addEventListener('input', (e) => updateMinuteSpeed(e.target.value));
  }

  document.querySelectorAll('[data-minspeed]').forEach((chip) => {
    chip.addEventListener('click', () => {
      updateMinuteSpeed(chip.dataset.minspeed);
    });
  });

  // Seconds Speed
  const sliderSecondsSpeed = document.getElementById('slider-seconds-speed');
  const valSecondsSpeed = document.getElementById('val-seconds-speed');
  const updateSecondsSpeed = (val) => {
    state.secondsSpeed = parseFloat(val);
    if (sliderSecondsSpeed) sliderSecondsSpeed.value = val;
    if (valSecondsSpeed) {
      valSecondsSpeed.textContent = `${state.secondsSpeed}× ${state.secondsSpeed <= 0.5 ? '(Slow & Relaxed)' : state.secondsSpeed <= 1.0 ? '(Cinematic Smooth)' : '(Brisk Beat)'}`;
    }
    document.querySelectorAll('[data-secspeed]').forEach((chip) => {
      chip.classList.toggle('active', parseFloat(chip.dataset.secspeed) === state.secondsSpeed);
    });
    persistCurrentState();
  };

  if (sliderSecondsSpeed) {
    sliderSecondsSpeed.addEventListener('input', (e) => updateSecondsSpeed(e.target.value));
  }

  document.querySelectorAll('[data-secspeed]').forEach((chip) => {
    chip.addEventListener('click', () => {
      updateSecondsSpeed(chip.dataset.secspeed);
    });
  });

  const sliderSmoothness = document.getElementById('slider-smoothness');
  const valSmoothness = document.getElementById('val-smoothness');
  if (sliderSmoothness) {
    sliderSmoothness.addEventListener('input', (e) => {
      state.smoothness = parseFloat(e.target.value);
      if (valSmoothness) {
        valSmoothness.textContent = state.smoothness >= 0.8
          ? `${state.smoothness} (Butter Smooth)`
          : `${state.smoothness} (Snappy)`;
      }
      persistCurrentState();
    });
  }

  const checkMotionBlur = document.getElementById('check-motion-blur');
  if (checkMotionBlur) {
    checkMotionBlur.addEventListener('change', (e) => {
      state.motionBlur = e.target.checked;
      persistCurrentState();
    });
  }

  const selectTimeFormat = document.getElementById('select-time-format');
  if (selectTimeFormat) {
    selectTimeFormat.addEventListener('change', (e) => {
      state.timeFormat = e.target.value;
      persistCurrentState();
    });
  }

  const checkShowSeconds = document.getElementById('check-show-seconds');
  if (checkShowSeconds) {
    checkShowSeconds.addEventListener('change', (e) => {
      state.showSeconds = e.target.checked;
      const secSpeedContainer = document.getElementById('seconds-speed-container');
      if (secSpeedContainer) {
        secSpeedContainer.style.display = state.showSeconds ? 'block' : 'none';
      }
      updateTimelineUI();
      persistCurrentState();
    });
  }

  const selectColonStyle = document.getElementById('select-colon-style');
  if (selectColonStyle) {
    selectColonStyle.addEventListener('change', (e) => {
      state.colonStyle = e.target.value;
      persistCurrentState();
    });
  }

  const inputTagline = document.getElementById('input-tagline');
  if (inputTagline) {
    inputTagline.addEventListener('input', (e) => {
      state.tagline = e.target.value;
      persistCurrentState();
    });
  }

  const checkProgressBar = document.getElementById('check-progress-bar');
  if (checkProgressBar) {
    checkProgressBar.addEventListener('change', (e) => {
      state.showProgressBar = e.target.checked;
      persistCurrentState();
    });
  }

  const sliderGlow = document.getElementById('slider-glow-intensity');
  const valGlow = document.getElementById('val-glow-intensity');
  if (sliderGlow) {
    sliderGlow.addEventListener('input', (e) => {
      state.glowIntensity = parseFloat(e.target.value);
      if (valGlow) valGlow.textContent = `${state.glowIntensity}`;
      persistCurrentState();
    });
  }

  const pickerGlowColor = document.getElementById('picker-glow-color');
  const badgeGlowColor = document.getElementById('badge-glow-color');
  if (pickerGlowColor) {
    pickerGlowColor.addEventListener('input', (e) => {
      state.glowColor = e.target.value;
      if (badgeGlowColor) badgeGlowColor.textContent = e.target.value;
      persistCurrentState();
    });
  }

  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const glow = btn.dataset.glow;
      const text = btn.dataset.text;
      state.glowColor = glow;
      state.textColor = text;
      state.taglineColor = text;

      if (pickerGlowColor) pickerGlowColor.value = glow;
      if (badgeGlowColor) badgeGlowColor.textContent = glow;

      const pickerTextColor = document.getElementById('picker-text-color');
      const badgeTextColor = document.getElementById('badge-text-color');
      if (pickerTextColor) pickerTextColor.value = text;
      if (badgeTextColor) badgeTextColor.textContent = text;
      persistCurrentState();
    });
  });

  const checkDrumShadow = document.getElementById('check-drum-shadow');
  if (checkDrumShadow) {
    checkDrumShadow.addEventListener('change', (e) => {
      state.drumShadow = e.target.checked;
      persistCurrentState();
    });
  }

  const selectFontFamily = document.getElementById('select-font-family');
  if (selectFontFamily) {
    selectFontFamily.addEventListener('change', async (e) => {
      state.fontFamily = e.target.value;
      if (typeof document !== 'undefined' && document.fonts) {
        try {
          await document.fonts.load(`150px "${state.fontFamily}"`);
          await document.fonts.ready;
        } catch {}
      }
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const pickerTextColor = document.getElementById('picker-text-color');
  const badgeTextColor = document.getElementById('badge-text-color');
  if (pickerTextColor) {
    pickerTextColor.addEventListener('input', (e) => {
      state.textColor = e.target.value;
      if (badgeTextColor) badgeTextColor.textContent = e.target.value;
      persistCurrentState();
    });
  }

  const pickerTaglineColor = document.getElementById('picker-tagline-color');
  const badgeTaglineColor = document.getElementById('badge-tagline-color');
  if (pickerTaglineColor) {
    pickerTaglineColor.addEventListener('input', (e) => {
      state.taglineColor = e.target.value;
      if (badgeTaglineColor) badgeTaglineColor.textContent = e.target.value;
      persistCurrentState();
    });
  }

  const sliderFontSize = document.getElementById('slider-font-size');
  const valFontSize = document.getElementById('val-font-size');
  if (sliderFontSize) {
    sliderFontSize.addEventListener('input', (e) => {
      state.fontSize = parseInt(e.target.value, 10);
      if (valFontSize) valFontSize.textContent = `${state.fontSize} px`;
      persistCurrentState();
    });
  }

  // Tagline Typography & Motion Listeners
  const selectTagFont = document.getElementById('select-tagline-font-family');
  if (selectTagFont) {
    selectTagFont.addEventListener('change', async (e) => {
      state.taglineFontFamily = e.target.value;
      if (state.taglineFontFamily && typeof document !== 'undefined' && document.fonts) {
        try {
          await document.fonts.load(`40px "${state.taglineFontFamily}"`);
          await document.fonts.ready;
        } catch {}
      }
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const selectTagAnim = document.getElementById('select-tagline-anim-style');
  if (selectTagAnim) {
    selectTagAnim.addEventListener('change', (e) => {
      state.taglineAnimStyle = e.target.value;
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const selectTagPos = document.getElementById('select-tagline-position');
  if (selectTagPos) {
    selectTagPos.addEventListener('change', (e) => {
      state.taglinePosition = e.target.value;
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const sliderTagFontSize = document.getElementById('slider-tagline-font-size');
  const valTagFontSize = document.getElementById('val-tagline-font-size');
  if (sliderTagFontSize) {
    sliderTagFontSize.addEventListener('input', (e) => {
      state.taglineFontSize = parseInt(e.target.value, 10);
      if (valTagFontSize) valTagFontSize.textContent = `${state.taglineFontSize} px`;
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const sliderTagSpacing = document.getElementById('slider-tagline-letter-spacing');
  const valTagSpacing = document.getElementById('val-tagline-letter-spacing');
  if (sliderTagSpacing) {
    sliderTagSpacing.addEventListener('input', (e) => {
      state.taglineLetterSpacing = parseInt(e.target.value, 10);
      if (valTagSpacing) valTagSpacing.textContent = `${state.taglineLetterSpacing} px`;
      persistCurrentState();
      renderCurrentFrame();
    });
  }

  const sliderDigitSpacing = document.getElementById('slider-digit-spacing');
  const valDigitSpacing = document.getElementById('val-digit-spacing');

  const updateSpacing = (val) => {
    state.digitSpacing = parseInt(val, 10);
    if (valDigitSpacing) {
      valDigitSpacing.textContent = state.digitSpacing < 0
        ? `${state.digitSpacing} px (Tight Squeeze)`
        : `${state.digitSpacing} px`;
    }
    if (sliderDigitSpacing) sliderDigitSpacing.value = val;
    persistCurrentState();
  };

  if (sliderDigitSpacing) {
    sliderDigitSpacing.addEventListener('input', (e) => updateSpacing(e.target.value));
  }

  document.querySelectorAll('[data-spacing]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-spacing]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      updateSpacing(chip.dataset.spacing);
    });
  });

  const sliderScale = document.getElementById('slider-scale');
  const valScale = document.getElementById('val-scale');
  if (sliderScale) {
    sliderScale.addEventListener('input', (e) => {
      state.scale = parseFloat(e.target.value);
      if (valScale) valScale.textContent = `${state.scale.toFixed(2)}×`;
      persistCurrentState();
    });
  }

  const sliderOffsetY = document.getElementById('slider-offset-y');
  const valOffsetY = document.getElementById('val-offset-y');
  if (sliderOffsetY) {
    sliderOffsetY.addEventListener('input', (e) => {
      state.offsetY = parseInt(e.target.value, 10);
      if (valOffsetY) valOffsetY.textContent = state.offsetY === 0 ? 'Center (0px)' : `${state.offsetY}px`;
      persistCurrentState();
    });
  }

  document.querySelectorAll('[data-offset]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-offset]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const offset = parseInt(chip.dataset.offset, 10);
      state.offsetY = offset;
      if (sliderOffsetY) sliderOffsetY.value = offset;
      if (valOffsetY) valOffsetY.textContent = offset === 0 ? 'Center (0px)' : `${offset}px`;
      persistCurrentState();
    });
  });

  document.querySelectorAll('.bg-card-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-card-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.bgType = btn.dataset.bg;
      const solidRow = document.getElementById('solid-color-row');
      if (solidRow) {
        solidRow.style.display = state.bgType === 'solid' ? 'flex' : 'none';
      }
      persistCurrentState();
    });
  });

  const pickerSolidBg = document.getElementById('picker-solid-bg');
  const badgeSolidBg = document.getElementById('badge-solid-bg');
  const solidPreviewThumb = document.getElementById('solid-preview-thumb');
  if (pickerSolidBg) {
    pickerSolidBg.addEventListener('input', (e) => {
      state.bgColor = e.target.value;
      if (badgeSolidBg) badgeSolidBg.textContent = e.target.value;
      if (solidPreviewThumb) solidPreviewThumb.style.backgroundColor = e.target.value;
      persistCurrentState();
    });
  }

  const selectFrameStyle = document.getElementById('select-frame-style');
  if (selectFrameStyle) {
    selectFrameStyle.addEventListener('change', (e) => {
      state.frameStyle = e.target.value;
      persistCurrentState();
    });
  }

  const pickerBorderColor = document.getElementById('picker-border-color');
  const badgeBorderColor = document.getElementById('badge-border-color');
  if (pickerBorderColor) {
    pickerBorderColor.addEventListener('input', (e) => {
      state.borderColor = e.target.value;
      if (badgeBorderColor) badgeBorderColor.textContent = e.target.value;
      persistCurrentState();
    });
  }

  document.querySelectorAll('.format-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.format-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      const input = card.querySelector('input');
      if (input) {
        input.checked = true;
        state.exportFormat = input.value;
      }
    });
  });

  const selectFps = document.getElementById('select-fps');
  if (selectFps) {
    selectFps.addEventListener('change', (e) => {
      state.fps = parseInt(e.target.value, 10);
      if (durationBadge) durationBadge.textContent = `${formatDurationDisplay(state.duration)} @ ${state.fps} FPS`;
    });
  }

  const headerExportBtn = document.getElementById('header-export-btn');
  const btnStartExport = document.getElementById('btn-start-export');
  if (headerExportBtn) headerExportBtn.addEventListener('click', triggerExport);
  if (btnStartExport) btnStartExport.addEventListener('click', triggerExport);

  const btnCancelExport = document.getElementById('btn-cancel-export');
  if (btnCancelExport) {
    btnCancelExport.addEventListener('click', () => {
      exporter.cancel();
      closeExportModal();
    });
  }

  const btnSavePresetHeader = document.getElementById('btn-save-current-preset');
  const modalSavePreset = document.getElementById('modal-save-preset');
  const inputPresetName = document.getElementById('input-custom-preset-name');
  const btnConfirmSave = document.getElementById('btn-confirm-save-preset');
  const btnCancelSave = document.getElementById('btn-cancel-save-preset');

  if (btnSavePresetHeader) {
    btnSavePresetHeader.addEventListener('click', () => {
      if (modalSavePreset) {
        modalSavePreset.classList.add('active');
        if (inputPresetName) {
          inputPresetName.value = '';
          inputPresetName.focus();
        }
      }
    });
  }

  if (btnCancelSave) {
    btnCancelSave.addEventListener('click', () => {
      if (modalSavePreset) modalSavePreset.classList.remove('active');
    });
  }

  if (btnConfirmSave) {
    btnConfirmSave.addEventListener('click', () => {
      if (inputPresetName && inputPresetName.value.trim()) {
        saveCurrentAsCustomPreset(inputPresetName.value);
        if (modalSavePreset) modalSavePreset.classList.remove('active');
      }
    });
  }

  // Preset File Export & Import Listeners
  const btnExportFile = document.getElementById('btn-export-preset-file');
  if (btnExportFile) {
    btnExportFile.addEventListener('click', exportPresetToFile);
  }

  const btnImportFile = document.getElementById('btn-import-preset-file');
  const inputPresetFile = document.getElementById('input-preset-file');
  if (btnImportFile && inputPresetFile) {
    btnImportFile.addEventListener('click', () => {
      inputPresetFile.value = '';
      inputPresetFile.click();
    });
    inputPresetFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importPresetFromFile(e.target.files[0]);
      }
    });
  }

  const btnCloseSuccess = document.getElementById('btn-close-success');
  if (btnCloseSuccess) btnCloseSuccess.addEventListener('click', closeSuccessModal);

  const btnDownloadAgain = document.getElementById('btn-download-again');
  if (btnDownloadAgain) {
    btnDownloadAgain.addEventListener('click', () => {
      if (state.lastExportedBlobUrl) {
        downloadBlob(state.lastExportedBlobUrl, state.lastExportedFilename);
      }
    });
  }
}

// ============================================================================
// VIDEO EXPORT WORKFLOW
// ============================================================================
async function triggerExport() {
  if (state.isExporting) return;
  state.isExporting = true;

  const modalExport = document.getElementById('modal-export');
  if (modalExport) modalExport.classList.add('active');

  const progressFill = document.getElementById('export-progress-fill');
  const statPercent = document.getElementById('export-stat-percent');
  const statFrames = document.getElementById('export-stat-frames');
  const statEta = document.getElementById('export-stat-eta');

  const totalFramesTarget = Math.round(state.duration * state.fps);

  if (progressFill) progressFill.style.width = '0%';
  if (statPercent) statPercent.textContent = '0%';
  if (statFrames) statFrames.textContent = `Frame 0 / ${totalFramesTarget}`;
  if (statEta) statEta.textContent = 'Initializing Encoder...';

  let exportBgType = state.bgType;
  if (state.exportFormat === 'greenscreen-mp4') {
    exportBgType = 'greenscreen';
  } else if (state.exportFormat === 'webm-alpha') {
    exportBgType = 'transparent';
  }

  const renderFrameFn = (progress, ctx, offscreenCanvas) => {
    const offscreenRenderer = new OdometerRenderer(offscreenCanvas);
    offscreenRenderer.render({
      progress,
      duration: state.duration,
      startHour: state.startHour,
      startMinute: state.startMinute,
      endHour: state.endHour,
      endMinute: state.endMinute,
      digitGrouping: state.digitGrouping,
      fontFamily: state.fontFamily,
      fontSize: state.fontSize,
      textColor: state.textColor,
      glowColor: state.glowColor,
      glowIntensity: state.glowIntensity,
      bgType: exportBgType,
      bgColor: state.bgColor,
      frameStyle: state.frameStyle,
      borderColor: state.borderColor,
      rollMode: state.rollMode,
      smoothness: state.smoothness,
      minuteStyle: state.minuteStyle,
      minuteSpeed: state.minuteSpeed,
      motionBlur: state.motionBlur,
      timeFormat: state.timeFormat,
      showSeconds: state.showSeconds,
      secondsSpeed: state.secondsSpeed,
      tagline: state.tagline,
      taglineColor: state.taglineColor,
      taglineFontFamily: state.taglineFontFamily,
      taglineFontSize: state.taglineFontSize,
      taglineLetterSpacing: state.taglineLetterSpacing,
      taglineAnimStyle: state.taglineAnimStyle,
      taglinePosition: state.taglinePosition,
      showProgressBar: state.showProgressBar,
      drumShadow: state.drumShadow,
      digitSpacing: state.digitSpacing,
      colonStyle: state.colonStyle,
      scale: state.scale,
      offsetY: state.offsetY,
      timelineMode: state.timelineMode,
      keyframes: state.keyframes,
      keyframeTransitionDuration: state.keyframeTransitionDuration,
      keyframeTransitionPlacement: state.keyframeTransitionPlacement,
      keyframeSpinDynamic: state.keyframeSpinDynamic,
      minuteCadence: state.minuteCadence,
      customMilestones: state.customMilestones,
      fps: state.fps
    });
  };

  try {
    const isWebM = state.exportFormat === 'webm-alpha';
    const videoBlob = await exporter.exportVideo({
      format: state.exportFormat,
      duration: state.duration,
      fps: state.fps,
      width: state.width,
      height: state.height,
      renderFrameFn,
      onProgress: ({ frame, totalFrames, percent, etaSeconds, canvas: offCanvas }) => {
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (statPercent) statPercent.textContent = `${percent}%`;
        if (statFrames) statFrames.textContent = `Frame ${frame} / ${totalFrames}`;

        let etaStr = 'Finalizing...';
        if (etaSeconds > 0) {
          if (etaSeconds >= 60) {
            const m = Math.floor(etaSeconds / 60);
            const s = etaSeconds % 60;
            etaStr = `ETA: ~${m}m ${s}s`;
          } else {
            etaStr = `ETA: ~${etaSeconds}s`;
          }
        }
        if (statEta) statEta.textContent = etaStr;

        if (thumbCtx && offCanvas) {
          thumbCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
          thumbCtx.drawImage(offCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
      }
    });

    closeExportModal();

    const ext = isWebM ? 'webm' : 'mp4';
    let filename;
    if (state.timelineMode === 'keyframes') {
      filename = `vlog-keyframes_${state.keyframes.length}beats_${Math.round(state.duration)}s.${ext}`;
    } else {
      const startStr = `${state.startHour.toString().padStart(2, '0')}-${state.startMinute.toString().padStart(2, '0')}`;
      const endStr = `${state.endHour.toString().padStart(2, '0')}-${state.endMinute.toString().padStart(2, '0')}`;
      filename = `day-in-my-life-timer_${startStr}_to_${endStr}_${Math.round(state.duration)}s.${ext}`;
    }

    state.lastExportedFilename = filename;
    state.lastExportedBlobUrl = URL.createObjectURL(videoBlob);

    downloadBlob(state.lastExportedBlobUrl, filename);
    showSuccessModal(state.lastExportedBlobUrl, filename);

  } catch (err) {
    console.error('Export error:', err);
    closeExportModal();
    if (err.message !== 'Export cancelled by user') {
      alert(`Export error: ${err.message || 'Rendering failed'}`);
    }
  } finally {
    state.isExporting = false;
  }
}

function closeExportModal() {
  const modalExport = document.getElementById('modal-export');
  if (modalExport) modalExport.classList.remove('active');
}

function showSuccessModal(blobUrl, filename) {
  const modalSuccess = document.getElementById('modal-success');
  const filenameBadge = document.getElementById('success-filename-badge');
  const videoPlayer = document.getElementById('success-video-player');

  if (filenameBadge) filenameBadge.textContent = `${filename} is ready!`;
  if (videoPlayer) {
    videoPlayer.src = blobUrl;
    videoPlayer.play().catch(() => {});
  }

  if (modalSuccess) modalSuccess.classList.add('active');

  try {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#00f5ff', '#ff007f', '#ffffff', '#ffb800']
    });
  } catch (e) {
    console.warn('Confetti error:', e);
  }
}

function closeSuccessModal() {
  const modalSuccess = document.getElementById('modal-success');
  if (modalSuccess) modalSuccess.classList.remove('active');
  const videoPlayer = document.getElementById('success-video-player');
  if (videoPlayer) {
    videoPlayer.pause();
    videoPlayer.src = '';
  }
}

function downloadBlob(blobUrl, filename) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ============================================================================
// BOOTSTRAP APPLICATION
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  loadPersistedState();
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(() => {
      renderCurrentFrame();
    }).catch(() => {});
  }
  updateAspectRatio(state.aspectRatio || '9:16');
  renderPresetButtons();
  setupEventListeners();
  syncInputsWithState();
  requestAnimationFrame(animationLoop);
});
