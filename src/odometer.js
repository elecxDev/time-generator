/**
 * Odometer Canvas Rendering Engine
 * Supports:
 * 1. Paired 2-Digit Odometer Drums (00..23 : 00..59) — Prevents digit confusion & looks ultra-clean
 * 2. Ultra-Smooth Cinematic Flow (guaranteed non-snapping transitions regardless of clip duration)
 * 3. 4-Column Split Single-Wheel mode (classic mechanical odometer)
 * 4. Multi-layer Neon Illumination, Cylindrical Curvature, Negative Spacing, and Custom Frames.
 */

// Quintic S-Curve Easing: zero jerk, zero stiffness, organic mechanical roll
function quinticEase(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

// Build discrete milestone path between two minutes (e.g. 00 -> 15 -> 30 -> 45)
export function buildMilestonePath(mA, mB, laps = 0, baseMilestones = [0, 15, 30, 45]) {
  const normA = Math.round(mA || 0) % 60;
  const normB = Math.round(mB || 0) % 60;

  if (!baseMilestones || baseMilestones.length === 0) {
    if (normA === normB && laps === 0) return [normA];
    return [normA, normB];
  }

  const sortedMilestones = Array.from(new Set(baseMilestones))
    .map(n => Math.round(Number(n)))
    .filter(n => !isNaN(n) && n >= 0 && n < 60)
    .sort((a, b) => a - b);

  if (sortedMilestones.length === 0) {
    if (normA === normB && laps === 0) return [normA];
    return [normA, normB];
  }

  if (normA === normB && laps === 0) {
    return [normA];
  }

  const path = [normA];

  // Full gear laps
  for (let l = 0; l < laps; l++) {
    const last = path[path.length - 1];
    const forward = sortedMilestones.filter(m => m > last);
    const wrap = sortedMilestones.filter(m => m <= last);
    const circle = [...forward, ...wrap];
    for (const m of circle) {
      if (m !== path[path.length - 1]) {
        path.push(m);
      }
    }
  }

  // Final stretch to normB
  const last = path[path.length - 1];
  if (last !== normB || laps === 0) {
    if (normB >= last) {
      const intermediates = sortedMilestones.filter(m => m > last && m < normB);
      path.push(...intermediates);
    } else {
      const toTop = sortedMilestones.filter(m => m > last);
      const fromZero = sortedMilestones.filter(m => m < normB);
      path.push(...toTop, ...fromZero);
    }
    if (path[path.length - 1] !== normB) {
      path.push(normB);
    }
  }

  return path;
}

export class OdometerRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
  }

  /**
   * Main render function for a given normalized progress (0.0 to 1.0)
   */
  render({
    progress,
    duration = 5.0,          // Clip length in seconds
    startHour = 0,
    startMinute = 0,
    endHour = 23,
    endMinute = 59,
    digitGrouping = 'paired', // 'paired' (00..23 : 00..59) or 'split' (H1 H2 : M1 M2)
    fontFamily = 'Unbounded',
    fontSize = 150,
    textColor = '#FFFFFF',
    glowColor = '#00F5FF',
    glowIntensity = 0.6,
    bgType = 'transparent',
    bgColor = '#000000',
    frameStyle = 'frosted-glass',
    borderColor = 'rgba(0, 245, 255, 0.4)',
    rollMode = 'ultra-smooth', // 'ultra-smooth' (screen-time normalized), 'continuous', 'glide'
    smoothness = 0.85,         // S-curve rollover fluidity (0.2 to 1.0)
    minuteStyle = 'match-hour', // 'match-hour' (exact clock-sync matching hour hand), 'interval-5m', 'interval-15m', 'smooth-paced'
    minuteSpeed = 1.0,         // Visual rolling speed for minutes (0.25 to 2.5)
    motionBlur = true,         // Shutter blur during high-speed rolling
    timeFormat = '24h',        // '24h', '12h'
    showSeconds = false,
    secondsSpeed = 1.0,        // Visual movement speed for seconds drum (0.25 to 3.0)
    tagline = 'DAY IN MY LIFE',
    taglineColor = '#00F5FF',
    taglineFontFamily = '',    // Custom font or '' for match clock font
    taglineFontSize = null,    // Custom size or proportional default
    taglineLetterSpacing = 3,  // Tracking in px
    taglineAnimStyle = 'dial', // 'dial' (whole phrase dial roll), 'fade' (crossfade), 'static'
    taglinePosition = 'top',   // 'top', 'bottom'
    showProgressBar = true,
    drumShadow = true,
    digitSpacing = -10,        // Supports negative values (-40 to +60)
    colonStyle = 'pulse',      // 'steady', 'pulse', 'blink'
    scale = 1.0,
    offsetY = 0,
    timelineMode = 'continuous', // 'continuous' or 'keyframes'
    keyframes = [],              // Array of keyframe beat objects
    keyframeTransitionDuration = 1.0,
    keyframeTransitionPlacement = 'arrive', // 'arrive', 'centered', 'depart'
    keyframeSpinDynamic = 'kinetic',        // 'kinetic', 'whir', 'direct'
    minuteCadence = 'quarters',             // 'quarters' (00, 15, 30, 45), 'tens', 'fives', 'targets-only', 'all', 'custom'
    customMilestones = '0, 15, 30, 45'
  }) {
    const { canvas, ctx } = this;
    const width = canvas.width;
    const height = canvas.height;

    // 1. Clear Canvas or Draw Background
    ctx.clearRect(0, 0, width, height);

    if (bgType === 'solid') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === 'greenscreen') {
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === 'bluescreen') {
      ctx.fillStyle = '#0000FF';
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === 'black') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === 'cinema-dark') {
      const bgGrad = ctx.createRadialGradient(
        width / 2, height / 2, 50,
        width / 2, height / 2, Math.max(width, height) / 1.2
      );
      bgGrad.addColorStop(0, '#151922');
      bgGrad.addColorStop(0.6, '#090b10');
      bgGrad.addColorStop(1, '#030407');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Calculate Current Simulated Time or Keyframe Interpolation
    const clampedP = Math.max(0, Math.min(1, progress));
    let hoursRaw = 0;
    let minutesRaw = 0;
    let secondsRaw = 0;
    let fractionalSecond = 0;
    let isPM = false;
    let displayHour = 0;
    let currentTotalSec = 0;
    let activeTaglineText = tagline;
    let taglineAnim = null;
    let pairedPositions = null;
    let splitDrumPositions = null;

    if (timelineMode === 'keyframes' && keyframes && keyframes.length > 0) {
      const kfResult = this.calculateKeyframeInterpolation({
        progress: clampedP,
        duration,
        keyframes,
        transitionDuration: keyframeTransitionDuration,
        transitionPlacement: keyframeTransitionPlacement,
        spinDynamic: keyframeSpinDynamic,
        timeFormat,
        showSeconds,
        tagline,
        smoothness,
        minuteCadence,
        customMilestones
      });

      hoursRaw = kfResult.hoursRaw;
      minutesRaw = kfResult.minutesRaw;
      secondsRaw = kfResult.secondsRaw;
      displayHour = kfResult.displayHour;
      isPM = kfResult.isPM;
      activeTaglineText = kfResult.activeTagline;
      taglineAnim = kfResult.taglineAnim || { currentText: activeTaglineText, nextText: activeTaglineText, frac: 0, isSame: true };

      pairedPositions = {
        hourVal: kfResult.hourVal,
        minVal: kfResult.minVal,
        secVal: kfResult.secVal,
        minCustomPair: kfResult.minCustomPair
      };

      let m1, m2;
      if (kfResult.minCustomPair) {
        const cp = kfResult.minCustomPair;
        const curM1 = Math.floor(cp.currentNum / 10);
        const curM2 = cp.currentNum % 10;
        const nextM1 = Math.floor(cp.nextNum / 10);
        const nextM2 = cp.nextNum % 10;
        m1 = curM1 + cp.frac * (nextM1 - curM1);
        m2 = curM2 + cp.frac * (nextM2 - curM2);
      } else {
        m2 = kfResult.minVal % 10;
        m1 = Math.floor(kfResult.minVal / 10) % 6;
      }
      const h2 = (kfResult.hourVal % 10);
      const h1 = Math.floor(kfResult.hourVal / 10);
      splitDrumPositions = { h1, h2, m1, m2, s1: 0, s2: 0 };

    } else {
      const startTotalSec = (startHour * 3600) + (startMinute * 60);
      const endTotalSec = (endHour * 3600) + (endMinute * 60) + (showSeconds ? 59 : 0);
      currentTotalSec = startTotalSec + clampedP * (endTotalSec - startTotalSec);

      hoursRaw = Math.floor(currentTotalSec / 3600) % 24;
      minutesRaw = Math.floor((currentTotalSec % 3600) / 60);
      secondsRaw = Math.floor(currentTotalSec % 60);
      fractionalSecond = (currentTotalSec % 60) - secondsRaw;

      isPM = hoursRaw >= 12;
      displayHour = hoursRaw;
      if (timeFormat === '12h') {
        displayHour = hoursRaw % 12;
        if (displayHour === 0) displayHour = 12;
      }
      activeTaglineText = tagline;
      taglineAnim = { currentText: tagline, nextText: tagline, frac: 0, isSame: true };

      pairedPositions = this.calculatePairedDrumPositions({
        clampedProgress: clampedP,
        duration,
        currentTotalSec,
        startHour,
        startMinute,
        endHour,
        endMinute,
        displayHour,
        minutesRaw,
        secondsRaw,
        fractionalSecond,
        rollMode,
        smoothness,
        minuteStyle,
        minuteSpeed,
        showSeconds,
        secondsSpeed,
        timeFormat
      });

      splitDrumPositions = this.calculateSplitDrumPositions({
        clampedProgress: clampedP,
        duration,
        currentTotalSec,
        hoursRaw,
        displayHour,
        startHour,
        startMinute,
        endHour,
        endMinute,
        minutesRaw,
        secondsRaw,
        fractionalSecond,
        rollMode,
        smoothness,
        minuteStyle,
        minuteSpeed,
        showSeconds,
        secondsSpeed,
        timeFormat
      });
    }

    // 3. Dimensions & Layout
    ctx.save();
    ctx.translate(width / 2, height / 2 + offsetY);
    ctx.scale(scale, scale);

    const baseFontSize = fontSize;
    const isBroadFont = ['Unbounded', 'Syne', 'Kanit', 'Lexend Mega', 'Montserrat', 'Space Grotesk', 'Holly Berry Pop', 'HollyBerryPop'].includes(fontFamily);

    const colonWidth = baseFontSize * (isBroadFont ? 0.32 : 0.38);
    const slotHeight = baseFontSize * 1.35;
    const digitGap = digitSpacing;

    if (digitGrouping === 'paired') {
      // =======================================================================
      // MODE: PAIRED 2-DIGIT DRUMS (00..23 : 00..59) — RECOMMENDED
      // =======================================================================
      const pairWidth = baseFontSize * (isBroadFont ? 1.62 : 1.45);
      let pairCount = 2; // Hours pair + Minutes pair
      let colonCount = 1;
      if (showSeconds) {
        pairCount += 1;
        colonCount += 1;
      }
      const amPmWidth = (timeFormat === '12h') ? baseFontSize * 0.75 : 0;
      const totalContentWidth =
        (pairCount * pairWidth) +
        (colonCount * colonWidth) +
        ((pairCount + colonCount - 1) * digitGap) +
        (amPmWidth ? amPmWidth + digitGap * 2 : 0);

      const boxPaddingX = Math.max(26, baseFontSize * 0.45);
      const boxPaddingY = baseFontSize * 0.35;
      const boxWidth = totalContentWidth + boxPaddingX * 2;
      const boxHeight = slotHeight + boxPaddingY * 2;

      // Draw Housing
      this.drawFrameHousing({
        ctx,
        frameStyle,
        boxWidth,
        boxHeight,
        slotHeight,
        borderColor,
        glowColor,
        glowIntensity,
        textColor
      });

      // Tagline
      const hasTag = (taglineAnim && (taglineAnim.currentText || taglineAnim.nextText)) || (activeTaglineText && activeTaglineText.trim().length > 0);
      if (hasTag) {
        this.drawTagline({
          ctx,
          taglineAnim,
          text: activeTaglineText || '',
          boxWidth,
          boxHeight,
          baseFontSize,
          fontFamily,
          taglineFontFamily,
          taglineFontSize,
          taglineLetterSpacing,
          taglineAnimStyle,
          taglinePosition,
          color: taglineColor || textColor,
          glowColor,
          glowIntensity,
          motionBlur
        });
      }

      // Progress Bar
      if (showProgressBar) {
        this.drawProgressBar({
          ctx,
          progress: clampedP,
          boxWidth,
          boxHeight,
          baseFontSize,
          color: textColor,
          glowColor,
          glowIntensity
        });
      }

      let currentX = -totalContentWidth / 2;

      // 1. Draw Hours Pair (00 to 23 or 01 to 12)
      this.drawTwoDigitDrum({
        ctx,
        x: currentX + pairWidth / 2,
        y: 0,
        drumVal: pairedPositions.hourVal,
        maxVal: (timeFormat === '12h' ? 12 : 23),
        minVal: (timeFormat === '12h' ? 1 : 0),
        width: pairWidth,
        height: slotHeight,
        fontFamily,
        fontSize: baseFontSize,
        textColor,
        glowColor,
        glowIntensity,
        drumShadow,
        motionBlur
      });
      currentX += pairWidth + digitGap;

      // 2. Draw Colon
      this.drawColon({
        ctx,
        x: currentX + colonWidth / 2,
        y: 0,
        colonWidth,
        slotHeight,
        colonStyle,
        progress: clampedP,
        currentTotalSec,
        fontFamily,
        fontSize: baseFontSize,
        textColor,
        glowColor,
        glowIntensity
      });
      currentX += colonWidth + digitGap;

      // 3. Draw Minutes Pair (00 to 59 or Milestones)
      this.drawTwoDigitDrum({
        ctx,
        x: currentX + pairWidth / 2,
        y: 0,
        drumVal: pairedPositions.minVal,
        maxVal: 59,
        minVal: 0,
        width: pairWidth,
        height: slotHeight,
        fontFamily,
        fontSize: baseFontSize,
        textColor,
        glowColor,
        glowIntensity,
        drumShadow,
        motionBlur,
        customPair: pairedPositions.minCustomPair
      });
      currentX += pairWidth + digitGap;

      // 4. Optional Seconds Pair (00 to 59)
      if (showSeconds) {
        this.drawColon({
          ctx,
          x: currentX + colonWidth / 2,
          y: 0,
          colonWidth,
          slotHeight,
          colonStyle,
          progress: clampedP,
          currentTotalSec,
          fontFamily,
          fontSize: baseFontSize,
          textColor,
          glowColor,
          glowIntensity
        });
        currentX += colonWidth + digitGap;

        this.drawTwoDigitDrum({
          ctx,
          x: currentX + pairWidth / 2,
          y: 0,
          drumVal: pairedPositions.secVal,
          maxVal: 59,
          minVal: 0,
          width: pairWidth,
          height: slotHeight,
          fontFamily,
          fontSize: baseFontSize,
          textColor,
          glowColor,
          glowIntensity,
          drumShadow,
          motionBlur
        });
        currentX += pairWidth + digitGap;
      }

      // Optional AM / PM pill
      if (timeFormat === '12h') {
        currentX += digitGap;
        this.drawAmPmPill({
          ctx,
          x: currentX,
          y: 0,
          isPM,
          slotHeight,
          baseFontSize,
          fontFamily,
          textColor,
          glowColor,
          glowIntensity
        });
      }

    } else {
      // =======================================================================
      // MODE: 4-COLUMN SPLIT SINGLE WHEELS (H1 H2 : M1 M2)
      // =======================================================================
      const digitWidth = baseFontSize * (isBroadFont ? 0.78 : 0.68);
      let totalCols = 4;
      let colonCols = 1;
      if (showSeconds) {
        totalCols += 2;
        colonCols += 1;
      }
      const amPmWidth = (timeFormat === '12h') ? baseFontSize * 0.75 : 0;
      const totalContentWidth =
        (totalCols * digitWidth) +
        (colonCols * colonWidth) +
        ((totalCols + colonCols - 1) * digitGap) +
        (amPmWidth ? amPmWidth + digitGap * 2 : 0);

      const boxPaddingX = Math.max(24, baseFontSize * 0.45);
      const boxPaddingY = baseFontSize * 0.35;
      const boxWidth = totalContentWidth + boxPaddingX * 2;
      const boxHeight = slotHeight + boxPaddingY * 2;

      this.drawFrameHousing({
        ctx,
        frameStyle,
        boxWidth,
        boxHeight,
        slotHeight,
        borderColor,
        glowColor,
        glowIntensity,
        textColor
      });

      const hasTagSplit = (taglineAnim && (taglineAnim.currentText || taglineAnim.nextText)) || (activeTaglineText && activeTaglineText.trim().length > 0);
      if (hasTagSplit) {
        this.drawTagline({
          ctx,
          taglineAnim,
          text: activeTaglineText || '',
          boxWidth,
          boxHeight,
          baseFontSize,
          fontFamily,
          taglineFontFamily,
          taglineFontSize,
          taglineLetterSpacing,
          taglineAnimStyle,
          taglinePosition,
          color: taglineColor || textColor,
          glowColor,
          glowIntensity,
          motionBlur
        });
      }

      if (showProgressBar) {
        this.drawProgressBar({
          ctx,
          progress: clampedP,
          boxWidth,
          boxHeight,
          baseFontSize,
          color: textColor,
          glowColor,
          glowIntensity
        });
      }

      const drumPositions = splitDrumPositions || this.calculateSplitDrumPositions({
        clampedProgress: clampedP,
        duration,
        currentTotalSec,
        hoursRaw,
        displayHour,
        minutesRaw,
        secondsRaw,
        fractionalSecond,
        rollMode,
        smoothness,
        minuteStyle,
        minuteSpeed,
        showSeconds,
        secondsSpeed,
        timeFormat
      });

      let currentX = -totalContentWidth / 2;

      const renderCol = (drumVal, maxVal = 9) => {
        this.drawDigitDrum({
          ctx,
          x: currentX + digitWidth / 2,
          y: 0,
          drumVal,
          maxVal,
          width: digitWidth,
          height: slotHeight,
          fontFamily,
          fontSize: baseFontSize,
          textColor,
          glowColor,
          glowIntensity,
          drumShadow,
          motionBlur
        });
        currentX += digitWidth + digitGap;
      };

      const renderColon = () => {
        this.drawColon({
          ctx,
          x: currentX + colonWidth / 2,
          y: 0,
          colonWidth,
          slotHeight,
          colonStyle,
          progress: clampedP,
          currentTotalSec,
          fontFamily,
          fontSize: baseFontSize,
          textColor,
          glowColor,
          glowIntensity
        });
        currentX += colonWidth + digitGap;
      };

      renderCol(drumPositions.h1, timeFormat === '12h' ? 1 : 2);
      renderCol(drumPositions.h2, 9);
      renderColon();
      renderCol(drumPositions.m1, 5);
      renderCol(drumPositions.m2, 9);

      if (showSeconds) {
        renderColon();
        renderCol(drumPositions.s1, 5);
        renderCol(drumPositions.s2, 9);
      }

      if (timeFormat === '12h') {
        currentX += digitGap;
        this.drawAmPmPill({
          ctx,
          x: currentX,
          y: 0,
          isPM,
          slotHeight,
          baseFontSize,
          fontFamily,
          textColor,
          glowColor,
          glowIntensity
        });
      }
    }

    ctx.restore();
  }

  /**
   * Compute drum positions and state for KEYFRAME TIME BEATS (Vlog Chapter Stops)
   * Holds stably at specific times across the video, smoothly rolling between beats
   * using Quintic S-curve easing!
   */
  calculateKeyframeInterpolation({
    progress,
    duration,
    keyframes = [],
    transitionDuration = 1.0,
    transitionPlacement = 'arrive', // 'arrive' (rolls before beat), 'centered', 'depart' (rolls after beat)
    spinDynamic = 'kinetic',        // 'kinetic' (matches hours), 'whir' (+1 extra spin), 'direct'
    timeFormat = '24h',
    showSeconds = false,
    tagline = 'DAY IN MY LIFE',
    smoothness = 0.85,
    minuteCadence = 'quarters',     // 'quarters' (00, 15, 30, 45), 'tens', 'fives', 'targets-only', 'all', 'custom'
    customMilestones = '0, 15, 30, 45'
  }) {
    const clampedP = Math.max(0, Math.min(1, progress));
    const currentVideoSec = clampedP * duration;

    // Resolve milestone numbers array
    let baseMilestones = [0, 15, 30, 45];
    if (minuteCadence === 'quarters') {
      baseMilestones = [0, 15, 30, 45];
    } else if (minuteCadence === 'tens') {
      baseMilestones = [0, 10, 20, 30, 40, 50];
    } else if (minuteCadence === 'fives') {
      baseMilestones = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    } else if (minuteCadence === 'targets-only') {
      baseMilestones = [];
    } else if (minuteCadence === 'all') {
      baseMilestones = null;
    } else if (minuteCadence === 'custom') {
      if (typeof customMilestones === 'string') {
        baseMilestones = customMilestones.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      } else if (Array.isArray(customMilestones)) {
        baseMilestones = customMilestones;
      }
    }

    // Filter & sort keyframes by video time
    const sorted = (keyframes && Array.isArray(keyframes) && keyframes.length > 0)
      ? [...keyframes]
          .filter(k => k && typeof k.videoTimeSec === 'number')
          .sort((a, b) => a.videoTimeSec - b.videoTimeSec)
      : [];

    if (sorted.length === 0) {
      return {
        hourVal: 0,
        minVal: 0,
        secVal: 0,
        minCustomPair: null,
        activeTagline: tagline,
        hoursRaw: 0,
        minutesRaw: 0,
        secondsRaw: 0,
        displayHour: (timeFormat === '12h' ? 12 : 0),
        isPM: false
      };
    }

    if (sorted.length === 1) {
      const kf = sorted[0];
      const hour = kf.hour || 0;
      const minute = kf.minute || 0;
      let displayHour = hour % 24;
      const isPM = displayHour >= 12;
      if (timeFormat === '12h') {
        displayHour = displayHour % 12;
        if (displayHour === 0) displayHour = 12;
      }
      let minCustomPair = null;
      if (baseMilestones !== null) {
        minCustomPair = {
          currentNum: minute,
          nextNum: minute,
          prevNum: minute,
          frac: 0
        };
      }
      return {
        hourVal: (timeFormat === '12h' ? displayHour : hour),
        minVal: minute,
        secVal: 0,
        minCustomPair,
        activeTagline: kf.tagline || tagline,
        taglineAnim: {
          currentText: kf.tagline || tagline,
          nextText: kf.tagline || tagline,
          frac: 0,
          isSame: true
        },
        hoursRaw: hour,
        minutesRaw: minute,
        secondsRaw: 0,
        displayHour,
        isPM
      };
    }

    let activeHour = sorted[0].hour || 0;
    let activeMin = sorted[0].minute || 0;
    let activeTag = sorted[0].tagline || tagline;
    let taglineAnim = {
      currentText: activeTag,
      nextText: activeTag,
      frac: 0,
      isSame: true
    };
    let hourVal = activeHour;
    let minVal = activeMin;
    let secVal = 0;
    let minCustomPair = (baseMilestones !== null) ? {
      currentNum: activeMin,
      nextNum: activeMin,
      prevNum: activeMin,
      frac: 0
    } : null;
    let matched = false;

    // Evaluate each transition segment between keyframe i and i+1
    for (let i = 0; i < sorted.length - 1; i++) {
      const kA = sorted[i];
      const kB = sorted[i + 1];

      const tA = Math.max(0, kA.videoTimeSec || 0);
      const tB = Math.max(tA + 0.05, kB.videoTimeSec || (tA + 1));
      const deltaT = tB - tA;

      const effTransDur = Math.min(
        Math.max(0.2, transitionDuration || 1.0),
        deltaT * 0.95
      );

      let transStart = tB - effTransDur;
      let transEnd = tB;

      if (transitionPlacement === 'centered') {
        transStart = tB - effTransDur / 2;
        transEnd = tB + effTransDur / 2;
      } else if (transitionPlacement === 'depart') {
        transStart = tA;
        transEnd = tA + effTransDur;
      }

      // If playhead is before this transition window, hold stably at kA
      if (currentVideoSec < transStart) {
        activeHour = kA.hour || 0;
        activeMin = kA.minute || 0;
        activeTag = kA.tagline || tagline;
        taglineAnim = {
          currentText: activeTag,
          nextText: activeTag,
          frac: 0,
          isSame: true
        };
        hourVal = activeHour;
        minVal = activeMin;
        secVal = 0;
        if (baseMilestones !== null) {
          minCustomPair = {
            currentNum: activeMin,
            nextNum: activeMin,
            prevNum: activeMin,
            frac: 0
          };
        }
        matched = true;
        break;
      }

      // If playhead is within this transition window, smoothly roll from kA to kB
      if (currentVideoSec >= transStart && currentVideoSec <= transEnd) {
        const u = Math.max(0, Math.min(1, (currentVideoSec - transStart) / Math.max(0.001, transEnd - transStart)));
        const eased = quinticEase(u);

        const hA = kA.hour || 0;
        const mA = kA.minute || 0;
        const hB = kB.hour || 0;
        const mB = kB.minute || 0;

        // Calculate exact forward hour delta (e.g. 7 to 9 is exactly 2 hours)
        let deltaH = (hB >= hA) ? (hB - hA) : (hB + 24 - hA);

        // Calculate exact forward minute delta (e.g. 0 to 30 is 30 mins)
        let deltaM = (mB >= mA) ? (mB - mA) : (mB + 60 - mA);

        let hourDelta = deltaH;
        let minSpun = deltaM;

        if (spinDynamic === 'direct') {
          // Direct shortest flip to target digits
          hourDelta = deltaH;
          minSpun = deltaM;
        } else if (spinDynamic === 'whir') {
          // Energetic vlog whir with extra full rotations
          const laps = Math.min(2, deltaH) + 1;
          hourDelta = deltaH;
          minSpun = laps * 60 + deltaM;
        } else {
          // Default: kinetic odometer roll matching clock distance
          const laps = Math.min(2, deltaH);
          hourDelta = deltaH;
          minSpun = laps * 60 + deltaM;
        }

        const continuousH = hA + eased * deltaH;
        hourVal = continuousH % 24;
        secVal = 0;

        const isMinuteSame = (mA === mB);

        if (isMinuteSame) {
          // Minutes are identical (e.g. 18:30 to 19:30) — minute wheel stays rock-solid!
          // Zero rolling down, zero phantom laps, zero snap!
          minVal = mA;
          if (baseMilestones !== null) {
            minCustomPair = {
              currentNum: mA,
              nextNum: mA,
              prevNum: mA,
              frac: 0
            };
          } else {
            minCustomPair = null;
          }
        } else {
          // Minutes differ (e.g. 18:30 to 19:45, 07:00 to 09:30)
          if (baseMilestones !== null) {
            const effLaps = (spinDynamic === 'whir') ? Math.min(2, deltaH) + 1 : 0;
            const path = buildMilestonePath(mA, mB, effLaps, baseMilestones);
            if (path.length <= 1) {
              minCustomPair = {
                currentNum: mA,
                nextNum: mA,
                prevNum: mA,
                frac: 0
              };
              minVal = mA;
            } else {
              const totalSteps = path.length - 1;
              const stepFloat = eased * totalSteps;
              const stepIdx = Math.min(path.length - 2, Math.max(0, Math.floor(stepFloat)));
              const stepFrac = stepFloat - stepIdx;

              minCustomPair = {
                currentNum: path[stepIdx],
                nextNum: path[stepIdx + 1],
                prevNum: (stepIdx > 0) ? path[stepIdx - 1] : path[0],
                frac: stepFrac
              };
              minVal = path[Math.min(path.length - 1, Math.round(stepFloat))];
            }
          } else {
            const effSpun = (spinDynamic === 'whir') ? (Math.min(2, deltaH) + 1) * 60 + deltaM : deltaM;
            minVal = (mA + eased * effSpun) % 60;
            minCustomPair = null;
          }
        }

        const tagA = (kA.tagline !== undefined && kA.tagline !== null) ? kA.tagline : tagline;
        const tagB = (kB.tagline !== undefined && kB.tagline !== null) ? kB.tagline : tagline;
        const isTagSame = (tagA.trim().toUpperCase() === tagB.trim().toUpperCase());

        activeTag = (u < 0.5) ? tagA : tagB;
        taglineAnim = {
          currentText: tagA,
          nextText: tagB,
          frac: isTagSame ? 0 : eased,
          isSame: isTagSame
        };
        activeHour = Math.floor(continuousH) % 24;
        activeMin = Math.floor(minVal) % 60;
        matched = true;
        break;
      }
    }

    // If past all transitions, hold stably at the last keyframe
    if (!matched) {
      const kLast = sorted[sorted.length - 1];
      activeHour = kLast.hour || 0;
      activeMin = kLast.minute || 0;
      activeTag = kLast.tagline || tagline;
      taglineAnim = {
        currentText: activeTag,
        nextText: activeTag,
        frac: 0,
        isSame: true
      };
      hourVal = activeHour;
      minVal = activeMin;
      secVal = 0;
      if (baseMilestones !== null) {
        minCustomPair = {
          currentNum: activeMin,
          nextNum: activeMin,
          prevNum: activeMin,
          frac: 0
        };
      }
    }

    let isPM = (activeHour % 24) >= 12;
    let displayHour = activeHour % 24;
    if (timeFormat === '12h') {
      const intH = Math.floor(hourVal) % 24;
      const fracH = hourVal - Math.floor(hourVal);
      let base12 = intH % 12;
      if (base12 === 0) base12 = 12;
      displayHour = base12;
      hourVal = base12 + fracH;
    }

    return {
      hourVal,
      minVal,
      secVal,
      minCustomPair,
      activeTagline: activeTag,
      taglineAnim,
      hoursRaw: activeHour,
      minutesRaw: activeMin,
      secondsRaw: secVal,
      displayHour,
      isPM
    };
  }

  /**
   * Compute drum positions for PAIRED 2-DIGIT ODOMETER (00..23 : 00..59)
   * Solves the hour snapping issue: transitions are buttery-smooth and visible
   * regardless of clip length!
   */
  calculatePairedDrumPositions({
    clampedProgress,
    duration,
    currentTotalSec,
    startHour,
    startMinute = 0,
    endHour,
    endMinute = 0,
    displayHour,
    minutesRaw,
    secondsRaw,
    fractionalSecond,
    rollMode,
    smoothness = 0.85,
    minuteStyle = 'smooth-paced',
    minuteSpeed = 1.0,
    showSeconds,
    secondsSpeed = 1.0,
    timeFormat
  }) {
    const totalHours = Math.max(1, endHour - startHour);
    const hrContinuous = startHour + clampedProgress * totalHours;

    // 1. Calculate Hours Drum (00 to 23 or 01 to 12)
    let hourVal = 0;

    if (rollMode === 'glide') {
      hourVal = timeFormat === '12h'
        ? ((Math.floor(hrContinuous) % 12 === 0 ? 12 : Math.floor(hrContinuous) % 12) + (hrContinuous - Math.floor(hrContinuous)))
        : hrContinuous % 24;
    } else {
      const currentIntHour = Math.floor(hrContinuous);
      const fracInHour = hrContinuous - currentIntHour;

      const rollFraction = Math.max(0.4, Math.min(0.95, smoothness));
      const restFraction = 1.0 - rollFraction;

      let hourOffset = 0;
      if (fracInHour >= restFraction) {
        const u = (fracInHour - restFraction) / rollFraction;
        hourOffset = quinticEase(u);
      }

      if (timeFormat === '12h') {
        let base12 = currentIntHour % 12;
        if (base12 === 0) base12 = 12;
        hourVal = base12 + hourOffset;
      } else {
        hourVal = (currentIntHour + hourOffset) % 24;
      }
    }

    // 2. Calculate Minutes Drum (00 to 59) — MATCHES HOUR HAND PACE
    let minVal = 0;
    const secInMin = currentTotalSec % 60;
    const minFrac = secInMin / 60;
    const minContinuous = minutesRaw + minFrac;
    let minCustomPair = null;

    const isSingleHourSameMinute = (startMinute !== undefined && endMinute !== undefined && startMinute === endMinute && Math.abs(endHour - startHour) <= 1);

    if (isSingleHourSameMinute) {
      // Minutes are identical over a 1-hour span (e.g. 18:30 to 19:30) — minute hand stays fixed at 30!
      minVal = startMinute;
      minCustomPair = {
        currentNum: startMinute,
        nextNum: startMinute,
        prevNum: startMinute,
        frac: 0
      };
    } else if (minuteStyle === 'interval-5m') {
      // 5-Minute discrete flips (00, 05, 10, 15... 55)
      const qIdx = Math.floor(minutesRaw / 5) % 12;
      const fiveMinFrac = (minutesRaw % 5 + minFrac) / 5;
      const roll5 = fiveMinFrac >= 0.4 ? quinticEase((fiveMinFrac - 0.4) / 0.6) : 0;
      minCustomPair = {
        currentNum: qIdx * 5,
        nextNum: ((qIdx + 1) % 12) * 5,
        prevNum: ((qIdx - 1 + 12) % 12) * 5,
        frac: roll5
      };
      minVal = qIdx * 5;

    } else if (minuteStyle === 'interval-15m') {
      // 15-Minute discrete quarter flips (00, 15, 30, 45) — only milestones visible
      const qIdx = Math.floor(minutesRaw / 15) % 4;
      const fifteenMinFrac = (minutesRaw % 15 + minFrac) / 15;
      const roll15 = fifteenMinFrac >= 0.4 ? quinticEase((fifteenMinFrac - 0.4) / 0.6) : 0;
      minCustomPair = {
        currentNum: qIdx * 15,
        nextNum: ((qIdx + 1) % 4) * 15,
        prevNum: ((qIdx - 1 + 4) % 4) * 15,
        frac: roll15
      };
      minVal = qIdx * 15;

    } else if (minuteStyle === 'smooth-paced') {
      // Optional independent aesthetic speed (user controlled)
      const effMinSpeed = Math.max(0.1, minuteSpeed || 1.0);
      const digitsPerSec = 7.0 * effMinSpeed;
      const totalDigits = Math.max(2, duration * digitsPerSec);
      const continuousDigits = clampedProgress * totalDigits;

      if (rollMode === 'glide') {
        minVal = continuousDigits % 60;
      } else {
        const baseDigit = Math.floor(continuousDigits);
        const fracInDigit = continuousDigits - baseDigit;
        minVal = (baseDigit + quinticEase(fracInDigit)) % 60;
      }

    } else {
      // DEFAULT: 'match-hour' (Exact Clock-Sync Pace matching the Hour Hand)
      // Every 1 hour = exactly 1 full rotation of 00..59 minutes!
      // Each minute turns with organic zero-jerk Quintic S-Curve easing!
      if (rollMode === 'glide') {
        minVal = minContinuous % 60;
      } else {
        const baseM = Math.floor(minContinuous);
        const fracM = minContinuous - baseM;
        minVal = (baseM + quinticEase(fracM)) % 60;
      }
    }

    // 3. Calculate Seconds Drum (00 to 59) — SMOOTH & CALM
    let secVal = 0;
    if (showSeconds) {
      const effSecSpeed = Math.max(0.1, secondsSpeed || 1.0);
      const secDigitsPerSec = 8.5 * effSecSpeed;
      const totalSecDigits = Math.max(2, duration * secDigitsPerSec);
      const continuousSecDigits = clampedProgress * totalSecDigits;

      if (rollMode === 'glide') {
        secVal = continuousSecDigits % 60;
      } else {
        const baseSec = Math.floor(continuousSecDigits);
        const fracInSec = continuousSecDigits - baseSec;
        secVal = (baseSec + quinticEase(fracInSec)) % 60;
      }
    }

    return { hourVal, minVal, secVal, minCustomPair };
  }

  /**
   * Render an individual PAIRED 2-DIGIT drum (e.g., '00', '01' ... '23' or '59')
   * Displays two characters rolling together as a unified drum wheel!
   */
  drawTwoDigitDrum({
    ctx,
    x,
    y,
    drumVal,
    maxVal = 23,
    minVal = 0,
    width,
    height,
    fontFamily,
    fontSize,
    textColor,
    glowColor,
    glowIntensity,
    drumShadow,
    motionBlur,
    customPair = null
  }) {
    ctx.save();

    // Clip vertically to drum slot window
    ctx.beginPath();
    ctx.rect(x - width / 2 - 20, y - height / 2, width + 40, height);
    ctx.clip();

    let currentNum, nextNum, prevNum, frac;

    if (customPair) {
      currentNum = (customPair.currentNum !== undefined && !isNaN(customPair.currentNum)) ? customPair.currentNum : 0;
      nextNum = (customPair.nextNum !== undefined && !isNaN(customPair.nextNum)) ? customPair.nextNum : currentNum;
      prevNum = (customPair.prevNum !== undefined && !isNaN(customPair.prevNum)) ? customPair.prevNum : currentNum;
      frac = customPair.frac || 0;
    } else {
      const range = (maxVal - minVal) + 1;
      const offsetVal = drumVal - minVal;
      const baseIdx = Math.floor(offsetVal);
      frac = offsetVal - baseIdx;

      currentNum = minVal + ((baseIdx % range + range) % range);
      nextNum = minVal + (((baseIdx + 1) % range + range) % range);
      prevNum = minVal + (((baseIdx - 1) % range + range) % range);
    }

    const pad2 = (n) => Math.round(n).toString().padStart(2, '0');
    const rowHeight = fontSize * 1.08;

    const drawNumPair = (num, offsetFraction, blurPass = false, blurOffsetY = 0) => {
      const numY = y + offsetFraction * rowHeight + blurOffsetY;
      const distFromCenter = Math.abs(offsetFraction);
      const perspectiveScaleY = Math.max(0.72, 1 - distFromCenter * 0.2);
      const alpha = Math.max(0.18, 1 - distFromCenter * 0.65) * (blurPass ? 0.35 : 1.0);

      ctx.save();
      ctx.translate(x, numY);
      ctx.scale(1, perspectiveScaleY);

      ctx.font = `700 ${fontSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const str = pad2(num);

      if (glowIntensity > 0.05) {
        // Outer neon aura
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowIntensity * 32;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = glowColor;
        ctx.fillText(str, 0, 0);
        ctx.restore();

        // Mid neon aura
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowIntensity * 14;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = glowColor;
        ctx.fillText(str, 0, 0);
        ctx.restore();

        // Bright Core
        ctx.save();
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = glowIntensity * 4;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = textColor;
        ctx.fillText(str, 0, 0);
        ctx.restore();
      } else {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = textColor;
        ctx.fillText(str, 0, 0);
      }

      ctx.restore();
    };

    drawNumPair(prevNum, -1 - frac);
    drawNumPair(currentNum, -frac);
    drawNumPair(nextNum, 1 - frac);

    // Motion blur pass when rolling quickly
    if (motionBlur && frac > 0.05 && frac < 0.95) {
      drawNumPair(currentNum, -frac, true, -3);
      drawNumPair(currentNum, -frac, true, 3);
      drawNumPair(nextNum, 1 - frac, true, -3);
      drawNumPair(nextNum, 1 - frac, true, 3);
    }

    // Cylindrical drum shading
    if (drumShadow) {
      const grad = ctx.createLinearGradient(0, y - height / 2, 0, y + height / 2);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.84)');
      grad.addColorStop(0.2, 'rgba(0, 0, 0, 0.08)');
      grad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(0.8, 'rgba(0, 0, 0, 0.08)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.84)');

      ctx.fillStyle = grad;
      ctx.fillRect(x - width / 2 - 20, y - height / 2, width + 40, height);

      const centerGrad = ctx.createLinearGradient(0, y - height * 0.15, 0, y + height * 0.15);
      centerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      centerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
      centerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = centerGrad;
      ctx.fillRect(x - width / 2 - 20, y - height * 0.15, width + 40, height * 0.3);
    }

    ctx.restore();
  }

  /**
   * Split single-wheel calculation (H1 H2 : M1 M2)
   */
  calculateSplitDrumPositions({
    clampedProgress,
    duration,
    currentTotalSec,
    hoursRaw,
    displayHour,
    startHour,
    startMinute = 0,
    endHour,
    endMinute = 0,
    minutesRaw,
    secondsRaw,
    fractionalSecond,
    rollMode,
    smoothness = 0.85,
    minuteStyle = 'smooth-paced',
    minuteSpeed = 1.0,
    showSeconds,
    secondsSpeed = 1.0,
    timeFormat
  }) {
    // 1. Calculate Minutes Drum (m1, m2) — Smooth & Slower Flow
    let minVal = 0;
    const secInMin = currentTotalSec % 60;
    const minFrac = secInMin / 60;
    const minContinuous = minutesRaw + minFrac;

    const isSingleHourSameMinute = (startMinute !== undefined && endMinute !== undefined && startMinute === endMinute && Math.abs(endHour - startHour) <= 1);

    if (isSingleHourSameMinute) {
      minVal = startMinute;
    } else if (minuteStyle === 'interval-5m') {
      const fiveMinFrac = (minutesRaw % 5 + minFrac) / 5;
      const base5 = Math.floor(minutesRaw / 5) * 5;
      const roll5 = fiveMinFrac >= 0.35 ? quinticEase((fiveMinFrac - 0.35) / 0.65) * 5 : 0;
      minVal = (base5 + roll5) % 60;
    } else if (minuteStyle === 'interval-15m') {
      const fifteenMinFrac = (minutesRaw % 15 + minFrac) / 15;
      const base15 = Math.floor(minutesRaw / 15) * 15;
      const roll15 = fifteenMinFrac >= 0.35 ? quinticEase((fifteenMinFrac - 0.35) / 0.65) * 15 : 0;
      minVal = (base15 + roll15) % 60;
    } else if (minuteStyle === 'smooth-paced') {
      const effMinSpeed = Math.max(0.1, minuteSpeed || 1.0);
      const digitsPerSec = 7.0 * effMinSpeed;
      const totalDigits = Math.max(2, duration * digitsPerSec);
      const continuousDigits = clampedProgress * totalDigits;

      if (rollMode === 'glide') {
        minVal = continuousDigits % 60;
      } else {
        const baseDigit = Math.floor(continuousDigits);
        const fracInDigit = continuousDigits - baseDigit;
        minVal = (baseDigit + quinticEase(fracInDigit)) % 60;
      }
    } else {
      // DEFAULT: 'match-hour'
      if (rollMode === 'glide') {
        minVal = minContinuous % 60;
      } else {
        const baseM = Math.floor(minContinuous);
        const fracM = minContinuous - baseM;
        minVal = (baseM + quinticEase(fracM)) % 60;
      }
    }

    const m2 = minVal % 10;
    const m2Roll = m2 >= 8.5 ? quinticEase((m2 - 8.5) / 1.5) : 0;
    const m1 = (Math.floor(minVal / 10) + m2Roll) % 6;

    // 2. Calculate Seconds Drum (s1, s2)
    let s1 = 0, s2 = 0;
    if (showSeconds) {
      const effSecSpeed = Math.max(0.1, secondsSpeed || 1.0);
      const secDigitsPerSec = 8.5 * effSecSpeed;
      const totalSecDigits = Math.max(2, duration * secDigitsPerSec);
      const continuousSecDigits = clampedProgress * totalSecDigits;
      let secContinuous = 0;

      if (rollMode === 'glide') {
        secContinuous = continuousSecDigits % 60;
      } else {
        const baseSec = Math.floor(continuousSecDigits);
        const fracInSec = continuousSecDigits - baseSec;
        secContinuous = (baseSec + quinticEase(fracInSec)) % 60;
      }

      s2 = secContinuous % 10;
      const s2Roll = s2 >= 8.5 ? quinticEase((s2 - 8.5) / 1.5) : 0;
      s1 = (Math.floor(secContinuous / 10) + s2Roll) % 6;
    }

    // 3. Calculate Hours Drum (h1, h2)
    const hourCycle = minutesRaw + minFrac;
    const h2WindowStart = Math.max(50.0, 60.0 - (6.0 * smoothness + 2.0));
    const h2RollProgress = hourCycle >= h2WindowStart
      ? (hourCycle - h2WindowStart) / (60.0 - h2WindowStart)
      : 0;
    const h2RollOffset = quinticEase(h2RollProgress);
    const h2Base = displayHour % 10;
    const h2 = (h2Base + h2RollOffset) % 10;

    const h1Base = Math.floor(displayHour / 10);
    let h1RollOffset = 0;

    if (timeFormat === '24h') {
      const isHourTenRollover = (displayHour === 9 || displayHour === 19);
      if (isHourTenRollover && hourCycle >= h2WindowStart) {
        h1RollOffset = quinticEase(h2RollProgress);
      }
    } else {
      if (displayHour === 9 && hourCycle >= h2WindowStart) {
        h1RollOffset = quinticEase(h2RollProgress);
      } else if (displayHour === 12 && hourCycle >= h2WindowStart) {
        h1RollOffset = quinticEase(h2RollProgress);
      }
    }

    const h1 = h1Base + h1RollOffset;
    return { h1, h2, m1, m2, s1, s2 };
  }

  /**
   * Render an individual single-digit wheel (0 to 9)
   */
  drawDigitDrum({
    ctx,
    x,
    y,
    drumVal,
    maxVal = 9,
    width,
    height,
    fontFamily,
    fontSize,
    textColor,
    glowColor,
    glowIntensity,
    drumShadow,
    motionBlur
  }) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - width - 60, y - height / 2, width * 2 + 120, height);
    ctx.clip();

    const cycleCount = maxVal + 1;
    const baseDigit = Math.floor(drumVal) % cycleCount;
    const frac = drumVal - Math.floor(drumVal);

    const currentDigit = (baseDigit + cycleCount) % cycleCount;
    const nextDigit = (baseDigit + 1) % cycleCount;
    const prevDigit = (baseDigit - 1 + cycleCount) % cycleCount;

    const rowHeight = fontSize * 1.08;

    const drawDigit = (digitNumber, offsetFraction, blurPass = false, blurOffsetY = 0) => {
      const digitY = y + offsetFraction * rowHeight + blurOffsetY;
      const distFromCenter = Math.abs(offsetFraction);
      const perspectiveScaleY = Math.max(0.72, 1 - distFromCenter * 0.2);
      const alpha = Math.max(0.18, 1 - distFromCenter * 0.65) * (blurPass ? 0.35 : 1.0);

      ctx.save();
      ctx.translate(x, digitY);
      ctx.scale(1, perspectiveScaleY);

      ctx.font = `700 ${fontSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (glowIntensity > 0.05) {
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowIntensity * 32;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = glowColor;
        ctx.fillText(digitNumber.toString(), 0, 0);
        ctx.restore();

        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowIntensity * 14;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = glowColor;
        ctx.fillText(digitNumber.toString(), 0, 0);
        ctx.restore();

        ctx.save();
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = glowIntensity * 4;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = textColor;
        ctx.fillText(digitNumber.toString(), 0, 0);
        ctx.restore();
      } else {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = textColor;
        ctx.fillText(digitNumber.toString(), 0, 0);
      }

      ctx.restore();
    };

    drawDigit(prevDigit, -1 - frac);
    drawDigit(currentDigit, -frac);
    drawDigit(nextDigit, 1 - frac);

    if (motionBlur && frac > 0.05 && frac < 0.95) {
      drawDigit(currentDigit, -frac, true, -3);
      drawDigit(currentDigit, -frac, true, 3);
      drawDigit(nextDigit, 1 - frac, true, -3);
      drawDigit(nextDigit, 1 - frac, true, 3);
    }

    if (drumShadow) {
      const grad = ctx.createLinearGradient(0, y - height / 2, 0, y + height / 2);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.84)');
      grad.addColorStop(0.2, 'rgba(0, 0, 0, 0.08)');
      grad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(0.8, 'rgba(0, 0, 0, 0.08)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.84)');

      ctx.fillStyle = grad;
      ctx.fillRect(x - width - 40, y - height / 2, width * 2 + 80, height);

      const centerGrad = ctx.createLinearGradient(0, y - height * 0.15, 0, y + height * 0.15);
      centerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      centerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
      centerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = centerGrad;
      ctx.fillRect(x - width - 40, y - height * 0.15, width * 2 + 80, height * 0.3);
    }

    ctx.restore();
  }

  drawColon({
    ctx,
    x,
    y,
    colonWidth,
    slotHeight,
    colonStyle,
    progress,
    currentTotalSec,
    fontFamily,
    fontSize,
    textColor,
    glowColor,
    glowIntensity
  }) {
    ctx.save();

    let alpha = 1.0;
    if (colonStyle === 'blink') {
      const blinkCycle = (currentTotalSec * 2) % 2;
      alpha = blinkCycle < 1.0 ? 1.0 : 0.2;
    } else if (colonStyle === 'pulse') {
      alpha = 0.65 + 0.35 * Math.sin(currentTotalSec * Math.PI * 2);
    }

    ctx.font = `700 ${fontSize * 0.9}px "${fontFamily}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawColonText = (color, blur, opacity) => {
      ctx.save();
      ctx.globalAlpha = opacity;
      if (blur > 0) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = blur;
      }
      ctx.fillStyle = color;
      ctx.fillText(':', x, y - fontSize * 0.04);
      ctx.restore();
    };

    if (glowIntensity > 0.05) {
      drawColonText(glowColor, glowIntensity * 28, alpha * 0.7);
      drawColonText(glowColor, glowIntensity * 12, alpha * 0.9);
      drawColonText(textColor, glowIntensity * 3, alpha);
    } else {
      drawColonText(textColor, 0, alpha);
    }

    ctx.restore();
  }

  drawFrameHousing({
    ctx,
    frameStyle,
    boxWidth,
    boxHeight,
    slotHeight,
    borderColor,
    glowColor,
    glowIntensity,
    textColor
  }) {
    if (frameStyle === 'none') return;

    ctx.save();
    const radius = frameStyle === 'neon-capsule' || frameStyle === 'frosted-glass' ? 32 : 14;
    const x = -boxWidth / 2;
    const y = -boxHeight / 2;

    if (frameStyle === 'neon-capsule') {
      ctx.fillStyle = 'rgba(10, 14, 22, 0.72)';
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, radius);
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = borderColor;
      if (glowIntensity > 0.1) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowIntensity * 20;
      }
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, radius);
      ctx.stroke();

      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + boxWidth - radius, y);
      ctx.stroke();

    } else if (frameStyle === 'frosted-glass') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, radius);
      ctx.fill();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = borderColor;
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, radius);
      ctx.stroke();

    } else if (frameStyle === 'odometer-bezel') {
      ctx.fillStyle = '#0d1117';
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, 12);
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = borderColor;
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, 12);
      ctx.stroke();

      const screwOffset = 10;
      const screwRadius = 3;
      const corners = [
        [x + screwOffset, y + screwOffset],
        [x + boxWidth - screwOffset, y + screwOffset],
        [x + screwOffset, y + boxHeight - screwOffset],
        [x + boxWidth - screwOffset, y + boxHeight - screwOffset]
      ];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      corners.forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, screwRadius, 0, Math.PI * 2);
        ctx.fill();
      });

    } else if (frameStyle === 'minimal-pill') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, 50);
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = borderColor;
      this.drawRoundedRect(ctx, x, y, boxWidth, boxHeight, 50);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTagline({
    ctx,
    taglineAnim = null,
    text = '',
    boxWidth = 600,
    boxHeight = 200,
    baseFontSize = 150,
    fontFamily = 'Unbounded',
    taglineFontFamily = '',
    taglineFontSize = null,
    taglineLetterSpacing = 3,
    taglineAnimStyle = 'dial', // 'dial' (whole phrase dial roll), 'fade' (crossfade), 'static'
    taglinePosition = 'top',   // 'top', 'bottom'
    color = '#00F5FF',
    glowColor = '#00F5FF',
    glowIntensity = 0.5,
    motionBlur = true
  }) {
    const isAnim = taglineAnim && !taglineAnim.isSame && taglineAnimStyle !== 'static';
    const curText = (taglineAnim && taglineAnim.currentText ? taglineAnim.currentText : text).trim().toUpperCase();
    const nextText = (taglineAnim && taglineAnim.nextText ? taglineAnim.nextText : curText).trim().toUpperCase();

    if (!curText && !nextText) return;

    ctx.save();

    const effFont = (taglineFontFamily && taglineFontFamily.trim()) ? taglineFontFamily.trim() : fontFamily;
    const effFontSize = (typeof taglineFontSize === 'number' && taglineFontSize > 0)
      ? taglineFontSize
      : Math.max(18, Math.round(baseFontSize * 0.18));
    const effSpacing = `${typeof taglineLetterSpacing === 'number' ? taglineLetterSpacing : 3}px`;

    const isBottom = taglinePosition === 'bottom';
    const cy = isBottom ? (boxHeight / 2 + 18 + effFontSize * 0.8) : (-boxHeight / 2 - 18);
    const slotHeight = effFontSize * 1.5;

    const renderTextLine = (phrase, posY, alpha = 1.0, scaleY = 1.0, blurY = 0) => {
      if (!phrase || alpha <= 0.01) return;
      ctx.save();
      ctx.translate(0, posY + blurY);
      ctx.scale(1, scaleY);

      ctx.font = `700 ${effFontSize}px "${effFont}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = effSpacing;
      }

      if (glowIntensity > 0.05) {
        // Outer aura
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowIntensity * 16;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = glowColor;
        ctx.fillText(phrase, 0, 0);
        ctx.restore();

        // Core fill
        ctx.save();
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = glowIntensity * 4;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillText(phrase, 0, 0);
        ctx.restore();
      } else {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillText(phrase, 0, 0);
      }

      ctx.restore();
    };

    if (!isAnim) {
      // STATIC / SAME TEXT — ZERO ANIMATION, ROCK SOLID
      renderTextLine(curText, cy, 1.0, 1.0);
    } else {
      const frac = taglineAnim.frac || 0; // 0 to 1, quintic eased

      // Clip whole phrase slot so rolling barrel looks clean
      ctx.save();
      const clipWidth = Math.max(boxWidth + 120, 1000);
      ctx.beginPath();
      ctx.rect(-clipWidth / 2, cy - slotHeight / 2 - 8, clipWidth, slotHeight + 16);
      ctx.clip();

      if (taglineAnimStyle === 'fade') {
        // Smooth crossfade
        const alpha1 = Math.max(0, 1 - frac);
        const alpha2 = Math.max(0, frac);
        renderTextLine(curText, cy, alpha1, 1.0);
        renderTextLine(nextText, cy, alpha2, 1.0);
      } else {
        // 'dial' — WHOLE PHRASE DIAL-UP ROLL (Odometer Drum Wheel)
        // Current text rolls up and out
        const y1 = cy - frac * slotHeight;
        const dist1 = Math.abs(frac);
        const scale1 = Math.max(0.72, 1 - dist1 * 0.28);
        const alpha1 = Math.max(0, 1 - dist1 * 1.2);

        // Next text rolls up into place from below
        const y2 = cy + (1 - frac) * slotHeight;
        const dist2 = Math.abs(1 - frac);
        const scale2 = Math.max(0.72, 1 - dist2 * 0.28);
        const alpha2 = Math.max(0, 1 - dist2 * 1.2);

        renderTextLine(curText, y1, alpha1, scale1);
        renderTextLine(nextText, y2, alpha2, scale2);

        // Motion blur pass for quick snaps
        if (motionBlur && frac > 0.08 && frac < 0.92) {
          renderTextLine(curText, y1, alpha1 * 0.35, scale1, -2);
          renderTextLine(curText, y1, alpha1 * 0.35, scale1, 2);
          renderTextLine(nextText, y2, alpha2 * 0.35, scale2, -2);
          renderTextLine(nextText, y2, alpha2 * 0.35, scale2, 2);
        }

        // Drum barrel top & bottom soft vignette
        const grad = ctx.createLinearGradient(0, cy - slotHeight / 2 - 4, 0, cy + slotHeight / 2 + 4);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
        grad.addColorStop(0.2, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(0.8, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
        ctx.fillStyle = grad;
        ctx.fillRect(-clipWidth / 2, cy - slotHeight / 2 - 8, clipWidth, slotHeight + 16);
      }

      ctx.restore(); // restore clip
    }

    ctx.restore();
  }

  drawProgressBar({
    ctx,
    progress,
    boxWidth,
    boxHeight,
    baseFontSize,
    color,
    glowColor,
    glowIntensity
  }) {
    ctx.save();
    const barWidth = boxWidth * 0.88;
    const barHeight = Math.max(4, baseFontSize * 0.035);
    const x = -barWidth / 2;
    const y = boxHeight / 2 + 18;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    this.drawRoundedRect(ctx, x, y, barWidth, barHeight, barHeight / 2);
    ctx.fill();

    const filledWidth = Math.max(barHeight, barWidth * progress);
    if (glowIntensity > 0.1) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = glowIntensity * 10;
    }
    ctx.fillStyle = color;
    this.drawRoundedRect(ctx, x, y, filledWidth, barHeight, barHeight / 2);
    ctx.fill();

    ctx.restore();
  }

  drawAmPmPill({
    ctx,
    x,
    y,
    isPM,
    slotHeight,
    baseFontSize,
    fontFamily,
    textColor,
    glowColor,
    glowIntensity
  }) {
    ctx.save();
    const pillFontSize = baseFontSize * 0.22;
    const pillWidth = baseFontSize * 0.65;
    const pillHeight = slotHeight * 0.72;

    ctx.translate(x, y - pillHeight / 2);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    this.drawRoundedRect(ctx, 0, 0, pillWidth, pillHeight, 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, 0, 0, pillWidth, pillHeight, 10);
    ctx.stroke();

    ctx.font = `700 ${pillFontSize}px "${fontFamily}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const amActive = !isPM;
    const pmActive = isPM;

    ctx.save();
    ctx.globalAlpha = amActive ? 1.0 : 0.25;
    if (amActive && glowIntensity > 0.1) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = glowIntensity * 10;
    }
    ctx.fillStyle = amActive ? textColor : 'rgba(255, 255, 255, 0.4)';
    ctx.fillText('AM', pillWidth / 2, pillHeight * 0.3);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = pmActive ? 1.0 : 0.25;
    if (pmActive && glowIntensity > 0.1) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = glowIntensity * 10;
    }
    ctx.fillStyle = pmActive ? textColor : 'rgba(255, 255, 255, 0.4)';
    ctx.fillText('PM', pillWidth / 2, pillHeight * 0.7);
    ctx.restore();

    ctx.restore();
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
