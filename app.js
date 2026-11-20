const $ = id => document.getElementById(id);
const modelUrl = 'https://bakkot.github.io/demucs-js/htdemucs.onnx';
const modelKey = new URL('./models/htdemucs-v4.onnx', location.href).href;
const cacheName = 'mach-studio-models-v1';
const rate = 44100;
const names = {
  original: ['Bản gốc', '#c9b7ff'], vocals: ['Vocal', '#d1aeff'],
  drums: ['Trống', '#f6a980'], bass: ['Bass', '#83dfcb'], other: ['Nhạc cụ', '#9db8ff']
};
const state = {
  tracks: [], history: [], future: [], position: 0, speed: 1, playback: null,
  view: null, loop: false,
  busy: false, cached: false, modelFile: null
};
let context, decoder, fileName, original, worker, pending, download;
let cancelled = false;
const status = message => { $('status').textContent = message; };
const duration = () => state.tracks[0]?.buffer.duration ?? 0;
const cache = () => caches.open(cacheName);
// Demucs needs 44.1 kHz input. Let the live context use the output device's
// preferred rate and let Web Audio resample the tracks for playback.
const audio = () => context ??= new AudioContext({ latencyHint: 'playback' });
const decode = bytes => {
  decoder ??= new OfflineAudioContext(2, 1, rate);
  return decoder.decodeAudioData(bytes);
};
function time(seconds) {
  const tenths = Math.floor(seconds * 10);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
}
const viewRange = () => state.view ?? [0, duration()];
function selection() {
  if (!$('in').value || !$('out').value) return null;
  const start = Number($('in').value), end = Math.min(duration(), Number($('out').value));
  return start >= 0 && end > start ? [start, end] : null;
}
function refreshSelection() {
  const range = selection();
  const [start, end] = viewRange();
  const width = end - start || 1;
  const percent = t => Math.max(0, Math.min(100, (t - start) / width * 100));
  $('tracks').style.setProperty('--selection-start', (range ? percent(range[0]) : 0) + '%');
  $('tracks').style.setProperty('--selection-end', (range ? 100 - percent(range[1]) : 100) + '%');
  for (const id of ['loop','zoomRange','keep','cut','fadeIn','fadeOut']) $(id).disabled = !range;
  $('zoomAll').disabled = !state.view;
  if (!range) state.loop = false;
  $('loop').setAttribute('aria-pressed', state.loop);
}
function setBusy(busy) {
  state.busy = busy;
  $('file').disabled = $('modelFile').disabled = busy;
  $('split').disabled = busy || !original;
  $('clear').disabled = busy || (!state.cached && !state.modelFile);
}
async function showModel() {
  state.cached = Boolean(await cache().then(store => store.match(modelKey)).catch(() => null));
  $('modelStatus').textContent = state.modelFile
    ? 'Đang dùng ' + state.modelFile.name
    : state.cached ? 'Đã lưu HTDemucs trên thiết bị' : 'Chưa tải HTDemucs · khoảng 175 MB';
  setBusy(state.busy);
}
function newTrack(key, buffer) {
  return { key, buffer, gain: 1, pan: 0, eq: 0, mute: false, solo: false };
}
function redraw(resetRange = false) {
  const hasTracks = Boolean(duration());
  for (const id of ['play','stop','speed','reverse','export','seek','in','out','keep','cut']) {
    $(id).disabled = !hasTracks;
  }
  $('preset').disabled = state.tracks.length < 2;
  $('undo').disabled = !state.history.length;
  $('redo').disabled = !state.future.length;
  $('seek').max = duration();
  $('in').max = $('out').max = duration();
  if (resetRange) {
    state.view = null;
    state.loop = false;
    $('in').value = 0;
    $('out').value = duration().toFixed(3);
  }
  $('tracks').replaceChildren(...state.tracks.map(renderTrack));
  const [start, end] = viewRange();
  $('ruler').hidden = !hasTracks;
  $('ruler').replaceChildren(...Array.from({ length: 5 }, (_, index) => {
    const tick = document.createElement('span');
    tick.textContent = time(start + (end - start) * index / 4);
    return tick;
  }));
  if (!hasTracks) {
    const placeholder = document.createElement('p');
    placeholder.className = 'empty';
    placeholder.textContent = 'Chọn bài nhạc để xem waveform.';
    $('tracks').append(placeholder);
  }
  refreshSelection();
  drawPosition(state.position);
}
function drawPosition(position) {
  const length = duration();
  $('seek').value = position;
  $('time').value = time(position) + ' / ' + time(length);
  const [start, end] = viewRange();
  const visible = position >= start && position <= end && end > start;
  $('tracks').style.setProperty('--cursor', (visible ? (position - start) / (end - start) * 100 : -1) + '%');
}
function renderTrack(track) {
  const row = $('track').content.firstElementChild.cloneNode(true);
  const [label, color] = names[track.key];
  row.style.setProperty('--track', color);
  row.querySelector('.track-name').textContent = label;
  const canvas = row.querySelector('canvas');
  const pen = canvas.getContext('2d');
  const data = track.buffer.getChannelData(0);
  const [viewStart, viewEnd] = viewRange();
  const firstFrame = Math.min(data.length - 1, Math.floor(viewStart * track.buffer.sampleRate));
  const span = Math.max(1, Math.min(data.length, Math.ceil(viewEnd * track.buffer.sampleRate)) - firstFrame);
  pen.strokeStyle = color;
  pen.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const start = firstFrame + Math.floor(x / canvas.width * span);
    const end = Math.max(start + 1, firstFrame + Math.floor((x + 1) / canvas.width * span));
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
    pen.moveTo(x, 34 - peak * 32);
    pen.lineTo(x, 35 + peak * 32);
  }
  pen.stroke();
  let drag;
  function pointerTime(event) {
    const bounds = canvas.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return viewStart + fraction * (viewEnd - viewStart);
  }
  function selectTo(event) {
    const end = pointerTime(event);
    $('in').value = Math.min(drag.time, end).toFixed(3);
    $('out').value = Math.max(drag.time, end).toFixed(3);
    refreshSelection();
  }
  canvas.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { x: event.clientX, time: pointerTime(event), moved: false };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!drag || !event.isPrimary) return;
    drag.moved ||= Math.abs(event.clientX - drag.x) > 4;
    if (drag.moved) selectTo(event);
  };
  canvas.onpointerup = event => {
    if (!drag || !event.isPrimary) return;
    if (drag.moved) {
      selectTo(event);
      seek(Number($('in').value));
    } else seek(pointerTime(event));
    drag = null;
  };
  canvas.onlostpointercapture = () => { drag = null; };
  for (const control of row.querySelectorAll('[data-track]')) {
    const prop = control.dataset.track;
    control.setAttribute('aria-label', (control.closest('label')?.textContent.trim() || control.textContent) + ' ' + label);
    if (prop === 'wav') {
      control.onclick = () => exportAudio([track], track.key, true);
    } else if (control.tagName === 'BUTTON') {
      control.setAttribute('aria-pressed', track[prop]);
      control.onclick = () => {
        track[prop] = !track[prop];
        control.setAttribute('aria-pressed', track[prop]);
        updateMix();
      };
    } else {
      control.value = track[prop];
      control.oninput = () => { track[prop] = Number(control.value); updateMix(); };
    }
  }
  return row;
}
function connect(ctx, track, speed, destination = ctx.destination) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const pan = ctx.createStereoPanner();
  const gain = ctx.createGain();
  source.buffer = track.buffer;
  source.playbackRate.value = speed;
  filter.type = track.key === 'bass' ? 'lowshelf' : 'highshelf';
  filter.frequency.value = track.key === 'bass' ? 180 : 2400;
  source.connect(filter).connect(pan).connect(gain).connect(destination);
  return { source, filter, pan, gain, track };
}
function setMix(voices, tracks, isolated = false) {
  const solo = !isolated && tracks.some(track => track.solo);
  for (const { track, gain, filter, pan } of voices) {
    const audible = isolated || (!track.mute && (!solo || track.solo));
    gain.gain.value = audible ? track.gain : 0;
    filter.gain.value = track.eq;
    pan.pan.value = track.pan;
  }
}
function updateMix() {
  if (state.playback) setMix(state.playback.voices, state.tracks);
}
function playbackPosition(job) {
  const elapsed = job.start === null ? 0 : Math.max(0, context.currentTime - job.start) * job.speed;
  const position = job.offset + elapsed;
  if (!job.loop || position < job.loop[1]) return position;
  const [start, end] = job.loop;
  return start + (position - start) % (end - start);
}
function pause(reset = false) {
  const job = state.playback;
  state.playback = null;
  if (job) {
    state.position = Math.min(duration(), playbackPosition(job));
    context.removeEventListener('statechange', job.onStateChange);
    for (const { source, filter, pan, gain, started } of job.voices) {
      if (started) source.stop();
      source.disconnect();
      filter.disconnect();
      pan.disconnect();
      gain.disconnect();
    }
    job.output.disconnect();
  }
  if (reset) state.position = 0;
  $('play').textContent = 'Phát';
  drawPosition(state.position);
}
async function play() {
  if (!duration() || state.playback) return;
  if (state.position >= duration()) state.position = 0;
  const ctx = audio();
  const output = ctx.createGain();
  output.connect(ctx.destination);
  const voices = state.tracks.map(track => connect(ctx, track, state.speed, output));
  setMix(voices, state.tracks);
  const loop = state.loop ? selection() : null;
  if (loop && (state.position < loop[0] || state.position >= loop[1])) state.position = loop[0];
  const job = {
    voices, output, start: null, offset: state.position, speed: state.speed, loop,
    onStateChange() {
      if (state.playback === job && ctx.state !== 'running') {
        pause();
        status('Thiết bị âm thanh đã tạm dừng. Bấm Phát để tiếp tục.');
      }
    }
  };
  state.playback = job;
  $('play').textContent = 'Tạm dừng';
  try {
    await ctx.resume();
    if (state.playback !== job) return;
    job.start = ctx.currentTime + 0.05;
    for (const voice of voices) {
      if (loop) {
        voice.source.loop = true;
        [voice.source.loopStart, voice.source.loopEnd] = loop;
      }
      voice.source.start(job.start, job.offset);
      voice.started = true;
    }
    ctx.addEventListener('statechange', job.onStateChange);
    if (ctx.state !== 'running') return job.onStateChange();
    if ($('status').textContent.startsWith('Thiết bị âm thanh đã tạm dừng.')) status('');
  } catch (error) {
    if (state.playback !== job) return;
    pause();
    status('Không thể phát âm thanh: ' + error.message);
    return;
  }
  function tick() {
    if (state.playback !== job) return;
    const position = playbackPosition(job);
    if (position >= duration()) return pause(true);
    drawPosition(position);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function seek(position) {
  const playing = Boolean(state.playback);
  pause();
  state.position = Math.max(0, Math.min(position, duration()));
  drawPosition(state.position);
  if (playing && position < duration()) play();
}
function rangeEdit(kind) {
  const length = state.tracks[0].buffer.length;
  const start = Math.round(Number($('in').value) * rate);
  const end = Math.min(length, Math.round(Number($('out').value) * rate));
  if (kind !== 'reverse' && (!$('in').value || !$('out').value || start < 0 || end <= start || (kind === 'cut' && end - start >= length))) {
    return status('Chọn một khoảng hợp lệ và giữ lại ít nhất một phần bài nhạc.');
  }
  pause(true);
  let edited;
  try {
    edited = state.tracks.map(track => {
      const old = track.buffer;
      const frames = kind === 'keep' ? end - start : kind === 'cut' ? length - end + start : length;
      const next = audio().createBuffer(old.numberOfChannels, frames, rate);
      for (let ch = 0; ch < old.numberOfChannels; ch++) {
        const input = old.getChannelData(ch);
        const output = next.getChannelData(ch);
        if (kind === 'fadeIn' || kind === 'fadeOut') {
          output.set(input);
          for (let i = start; i < end; i++) {
            const fraction = (i - start) / Math.max(1, end - start - 1);
            output[i] *= kind === 'fadeIn' ? fraction : 1 - fraction;
          }
        } else if (kind === 'reverse') {
          output.set(input);
          output.reverse();
        } else if (kind === 'keep') {
          output.set(input.subarray(start, end));
        } else {
          output.set(input.subarray(0, start));
          output.set(input.subarray(end), start);
        }
      }
      return { ...track, buffer: next };
    });
  } catch (error) { return status('Không thể chỉnh đoạn: ' + error.message); }
  state.history.push(state.tracks);
  if (state.history.length > 5) state.history.shift();
  state.future = [];
  state.tracks = edited;
  redraw(true);
  status('');
}
async function exportAudio(tracks, suffix, isolated = false) {
  const speed = state.speed;
  const snapshot = tracks.map(track => ({ ...track }));
  try {
    const ctx = new OfflineAudioContext(2, Math.ceil(snapshot[0].buffer.length / speed), rate);
    const voices = snapshot.map(track => connect(ctx, track, speed));
    setMix(voices, snapshot, isolated);
    for (const { source } of voices) source.start();
    const buffer = await ctx.startRendering();
    const bytes = new ArrayBuffer(44 + buffer.length * 4);
    const view = new DataView(bytes);
    const ascii = (offset, word) => [...word].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
    ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i = 0; i < buffer.length; i++) {
      view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
      view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName + '-' + suffix + '.wav';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { status('Không thể xuất WAV: ' + error.message); }
}
function progress(message, fraction) {
  status(message);
  $('progress').hidden = false;
  if (Number.isFinite(fraction)) $('progress').value = fraction;
  else $('progress').removeAttribute('value');
}
function consent() {
  const dialog = $('consent');
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true });
    dialog.showModal();
  });
}
async function loadModel() {
  if (state.modelFile) return state.modelFile;
  const store = await cache().catch(() => null);
  const cached = await store?.match(modelKey);
  if (cached) return cached.blob();
  if (!await consent()) return null;
  void navigator.storage?.persist?.().catch(() => {});
  download = new AbortController();
  progress('Đang tải mô hình…');
  const response = await fetch(modelUrl, { signal: download.signal });
  if (!response.ok || !response.body) throw new Error('Không tải được mô hình (HTTP ' + response.status + ').');
  const size = Number(response.headers.get('Content-Length'));
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    progress('Đã tải ' + Math.round(loaded / 1e6) + ' MB', size ? Math.min(1, loaded / size) : undefined);
  }
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  if (store) {
    try {
      await store.put(modelKey, new Response(blob));
      state.cached = true;
    } catch {
      status('Trình duyệt không đủ chỗ lưu mô hình. Dùng tạm cho lần tách này.');
    }
  }
  return blob;
}
function runSeparation(modelBlob, buffer) {
  return new Promise((resolve, reject) => {
    pending = reject;
    worker = new Worker('./vendor/worker.js');
    worker.onerror = event => reject(new Error(event.message || 'Worker AI không khởi động được.'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'split progress') {
        progress('Đang tách nhạc · ' + data.step + '/' + data.total, data.total ? data.step / data.total : undefined);
      }
      if (data.type === 'split done') {
        if (data.error) reject(new Error(data.error.message || String(data.error)));
        else resolve(data.tracks);
      }
    };
    const channelData = [buffer.getChannelData(0).slice(), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice()];
    worker.postMessage({ type: 'split', id: 'stem-job', fileName, modelBlob, rawAudio: { channelData, sampleRate: rate } },
      channelData.map(channel => channel.buffer));
  });
}
$('split').onclick = async () => {
  if (state.busy || !original) return;
  cancelled = false;
  setBusy(true);
  $('cancel').hidden = false;
  try {
    const model = await loadModel();
    if (!model || cancelled) return;
    progress(navigator.gpu ? 'Đang khởi động mô hình…' : 'Đang khởi động mô hình. Chạy bằng CPU có thể lâu hơn…');
    const stems = await runSeparation(model, original);
    const tracks = ['vocals','drums','bass','other'].map(key => {
      const { channelData, sampleRate } = stems[key];
      const buffer = audio().createBuffer(channelData.length, channelData[0].length, sampleRate);
      channelData.forEach((channel, index) => {
        for (let i = 0; i < channel.length; i++) {
          if (!Number.isFinite(channel[i])) channel[i] = 0;
        }
        buffer.copyToChannel(channel, index);
      });
      return newTrack(key, buffer);
    });
    pause(true);
    state.history = [];
    state.future = [];
    state.tracks = tracks;
    $('preset').value = 'mix';
    redraw(true);
    status('Đã tách 4 lớp.');
  } catch (error) {
    status(cancelled ? 'Đã hủy tách.' : 'Tách nhạc gặp lỗi: ' + error.message);
  } finally {
    worker?.terminate();
    worker = pending = download = undefined;
    $('progress').hidden = $('cancel').hidden = true;
    setBusy(false);
    await showModel();
  }
};
$('cancel').onclick = () => {
  cancelled = true;
  download?.abort();
  worker?.terminate();
  pending?.(new Error('Đã hủy.'));
  status('Đã hủy tách.');
};
$('file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || state.busy) return;
  setBusy(true);
  status('Đang đọc bài nhạc…');
  try {
    const decoded = await decode(await file.arrayBuffer());
    pause(true);
    fileName = file.name.replace(/\.[^.]+$/, '');
    original = decoded;
    $('song').textContent = file.name;
    $('fileInfo').textContent = time(decoded.duration) + ' · ' + (decoded.numberOfChannels === 1 ? 'Mono' : 'Stereo');
    state.speed = 1;
    state.history = [];
    state.future = [];
    $('speed').value = '1';
    $('preset').value = 'mix';
    state.tracks = [newTrack('original', original)];
    redraw(true);
    status('');
  } catch { status('Trình duyệt không đọc được file nhạc này. Hãy thử MP3 hoặc WAV.'); }
  finally { setBusy(false); }
};
$('modelFile').onchange = async event => {
  if (event.target.files[0]) state.modelFile = event.target.files[0];
  event.target.value = '';
  await showModel();
};
$('clear').onclick = async () => {
  setBusy(true);
  try {
    if (state.cached) await (await cache()).delete(modelKey);
    state.modelFile = null;
    status('Đã bỏ mô hình đang dùng.');
  } catch (error) { status('Không xóa được mô hình: ' + error.message); }
  finally { state.busy = false; await showModel(); }
};
$('play').onclick = () => state.playback ? pause() : play();
$('stop').onclick = () => pause(true);
$('seek').oninput = event => seek(Number(event.target.value));
$('speed').onchange = event => {
  const wasPlaying = Boolean(state.playback);
  pause();
  state.speed = Number(event.target.value);
  if (wasPlaying) play();
};
$('preset').onchange = event => {
  const preset = event.target.value;
  for (const track of state.tracks) {
    track.mute = (preset === 'karaoke' && track.key === 'vocals') || (preset === 'vocal' && track.key !== 'vocals');
    track.solo = false;
    track.gain = preset === 'bass' && track.key === 'bass' ? 1.22 : 1;
    track.pan = 0;
    track.eq = preset === 'clarity' && track.key === 'vocals' ? 4 : 0;
  }
  updateMix();
  redraw();
};
$('keep').onclick = () => rangeEdit('keep');
$('cut').onclick = () => rangeEdit('cut');
$('reverse').onclick = () => rangeEdit('reverse');
$('fadeIn').onclick = () => rangeEdit('fadeIn');
$('fadeOut').onclick = () => rangeEdit('fadeOut');
function restoreEdit(from, to) {
  if (!from.length) return;
  pause(true);
  const current = state.tracks;
  to.push(current);
  state.tracks = from.pop().map((track, index) => ({ ...current[index], buffer: track.buffer }));
  redraw(true);
  status('');
}
$('undo').onclick = () => restoreEdit(state.history, state.future);
$('redo').onclick = () => restoreEdit(state.future, state.history);
$('loop').onclick = () => {
  state.loop = !state.loop;
  refreshSelection();
  if (state.playback) seek(playbackPosition(state.playback));
};
$('zoomRange').onclick = () => { state.view = selection(); redraw(); };
$('zoomAll').onclick = () => { state.view = null; redraw(); };
for (const id of ['in', 'out']) {
  $(id).oninput = refreshSelection;
  $(id).onchange = () => {
    if (state.playback && (state.loop || state.playback.loop)) seek(playbackPosition(state.playback));
  };
}
document.addEventListener('keydown', event => {
  if (event.repeat || event.target.closest('input, select, button, [contenteditable]') || $('consent').open) return;
  if (event.code === 'Space' && duration() && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    $('play').click();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    $(event.shiftKey ? 'redo' : 'undo').click();
  }
});
$('export').onclick = () => exportAudio(state.tracks, 'mix');
void showModel();
