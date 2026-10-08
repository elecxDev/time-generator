/**
 * Video Exporter Engine
 * Supports:
 * 1. High-Performance Frame-Accurate H.264 MP4 via WebCodecs + mp4-muxer
 * 2. High-Capacity Encoding up to 5 minutes (300 seconds) with bounded memory queue
 * 3. Transparent WebM (VP9 with Alpha) for direct alpha overlay
 * 4. MediaRecorder MP4/WebM fallback
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export class VideoExporter {
  constructor() {
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
  }

  async canUseWebCodecs(width, height, fps) {
    if (typeof window.VideoEncoder === 'undefined') return false;
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: 'avc1.4d002a', // H.264 Main Profile
        width,
        height,
        bitrate: 12_000_000,
        framerate: fps
      });
      return !!support.supported;
    } catch {
      return false;
    }
  }

  async exportVideo({
    format = 'mp4',
    duration = 5,
    fps = 60,
    width = 1080,
    height = 1920,
    renderFrameFn,
    onProgress
  }) {
    this.isCancelled = false;
    const totalFrames = Math.max(1, Math.round(duration * fps));

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d', { alpha: true });
    if (typeof document !== 'undefined' && document.fonts) {
      try {
        await document.fonts.ready;
      } catch (err) {
        console.warn('Font readiness check:', err);
      }
    }

    const supportsWebCodecs = await this.canUseWebCodecs(width, height, fps);

    if (format === 'mp4' || format === 'greenscreen-mp4') {
      if (supportsWebCodecs) {
        return await this.exportWebCodecsMP4({
          exportCanvas,
          exportCtx,
          width,
          height,
          fps,
          totalFrames,
          renderFrameFn,
          onProgress
        });
      } else {
        return await this.exportMediaRecorder({
          exportCanvas,
          exportCtx,
          width,
          height,
          fps,
          totalFrames,
          duration,
          renderFrameFn,
          onProgress,
          preferMp4: true
        });
      }
    } else {
      return await this.exportTransparentWebM({
        exportCanvas,
        exportCtx,
        width,
        height,
        fps,
        totalFrames,
        duration,
        renderFrameFn,
        onProgress
      });
    }
  }

  async exportWebCodecsMP4({
    exportCanvas,
    exportCtx,
    width,
    height,
    fps,
    totalFrames,
    renderFrameFn,
    onProgress
  }) {
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error('VideoEncoder error:', e);
        encoderError = e;
      }
    });

    await encoder.configure({
      codec: 'avc1.4d002a',
      width,
      height,
      bitrate: 14_000_000,
      framerate: fps
    });

    const startTime = performance.now();

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (this.isCancelled) {
        encoder.close();
        throw new Error('Export cancelled by user');
      }

      if (encoderError) {
        throw encoderError;
      }

      // Memory Management: prevent hardware buffer overload on long videos (up to 5 min)
      while (encoder.encodeQueueSize > 20) {
        await new Promise((r) => setTimeout(r, 12));
      }

      const progress = totalFrames === 1 ? 1 : frameIndex / (totalFrames - 1);
      renderFrameFn(progress, exportCtx, exportCanvas);

      const timestampMicros = Math.round(frameIndex * (1_000_000 / fps));
      const videoFrame = new VideoFrame(exportCanvas, {
        timestamp: timestampMicros,
        duration: Math.round(1_000_000 / fps)
      });

      const isKeyFrame = frameIndex % (fps * 2) === 0;
      encoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Yield event loop
      if (frameIndex % 6 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      const elapsed = (performance.now() - startTime) / 1000;
      const percent = Math.round(((frameIndex + 1) / totalFrames) * 100);
      const framesDone = frameIndex + 1;
      const rate = framesDone / elapsed;
      const remainingFrames = totalFrames - framesDone;
      const etaSeconds = rate > 0 ? Math.ceil(remainingFrames / rate) : 0;

      if (onProgress) {
        onProgress({
          frame: framesDone,
          totalFrames,
          percent,
          etaSeconds,
          canvas: exportCanvas
        });
      }
    }

    await encoder.flush();
    muxer.finalize();
    encoder.close();

    const buffer = muxer.target.buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  }

  async exportTransparentWebM({
    exportCanvas,
    exportCtx,
    width,
    height,
    fps,
    totalFrames,
    duration,
    renderFrameFn,
    onProgress
  }) {
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    const stream = exportCanvas.captureStream(fps);
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 16_000_000
    });

    const recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    return new Promise(async (resolve, reject) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        resolve(blob);
      };
      mediaRecorder.onerror = (e) => reject(e);

      mediaRecorder.start();

      const startTime = performance.now();
      const frameInterval = 1000 / fps;

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (this.isCancelled) {
          mediaRecorder.stop();
          return reject(new Error('Export cancelled by user'));
        }

        const progress = totalFrames === 1 ? 1 : frameIndex / (totalFrames - 1);
        renderFrameFn(progress, exportCtx, exportCanvas);

        const elapsed = (performance.now() - startTime) / 1000;
        const percent = Math.round(((frameIndex + 1) / totalFrames) * 100);
        const etaSeconds = Math.max(0, Math.ceil(duration - elapsed));

        if (onProgress) {
          onProgress({
            frame: frameIndex + 1,
            totalFrames,
            percent,
            etaSeconds,
            canvas: exportCanvas
          });
        }

        await new Promise((r) => setTimeout(r, frameInterval));
      }

      mediaRecorder.stop();
    });
  }

  async exportMediaRecorder({
    exportCanvas,
    exportCtx,
    width,
    height,
    fps,
    totalFrames,
    duration,
    renderFrameFn,
    onProgress,
    preferMp4 = true
  }) {
    let mimeType = 'video/webm';
    if (preferMp4 && MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      mimeType = 'video/webm;codecs=vp9';
    }

    const stream = exportCanvas.captureStream(fps);
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 14_000_000
    });

    const recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    return new Promise(async (resolve, reject) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        resolve(blob);
      };
      mediaRecorder.onerror = (e) => reject(e);

      mediaRecorder.start();

      const startTime = performance.now();
      const frameInterval = 1000 / fps;

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (this.isCancelled) {
          mediaRecorder.stop();
          return reject(new Error('Export cancelled by user'));
        }

        const progress = totalFrames === 1 ? 1 : frameIndex / (totalFrames - 1);
        renderFrameFn(progress, exportCtx, exportCanvas);

        const elapsed = (performance.now() - startTime) / 1000;
        const percent = Math.round(((frameIndex + 1) / totalFrames) * 100);
        const etaSeconds = Math.max(0, Math.ceil(duration - elapsed));

        if (onProgress) {
          onProgress({
            frame: frameIndex + 1,
            totalFrames,
            percent,
            etaSeconds,
            canvas: exportCanvas
          });
        }

        await new Promise((r) => setTimeout(r, frameInterval));
      }

      mediaRecorder.stop();
    });
  }
}
