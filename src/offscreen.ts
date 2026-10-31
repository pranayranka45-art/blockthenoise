// Offscreen document: the only place an MV3 extension can play audio in the background.
// Streams are played with <audio>; noise tracks are generated with the Web Audio API.

import { BackgroundMessage, NoiseColor, OffscreenMessage, Track } from "./shared.js";

const NOISE_FADE_SECONDS = 0.05;

let audio: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let gain: GainNode | null = null;

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  handle(message)
    .then(() => sendResponse({ ok: true }))
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function handle(message: OffscreenMessage): Promise<void> {
  if (message.type === "play") await play(message.track, message.volume);
  if (message.type === "volume") setVolume(message.volume);
}

async function play(track: Track, volume: number): Promise<void> {
  stop();
  if (track.kind === "stream" && track.url) {
    audio = new Audio(track.url);
    audio.volume = volume;
    audio.addEventListener("error", () => reportError(`Stream "${track.name}" stopped or is unreachable.`));
    await audio.play();
  } else if (track.kind === "noise") {
    context = new AudioContext();
    gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(context.destination);
    const source = context.createBufferSource();
    source.buffer = makeNoise(context, track.noise ?? "brown");
    source.loop = true;
    source.loopEnd = source.buffer.duration - NOISE_FADE_SECONDS;
    source.connect(gain);
    source.start();
    await context.resume();
  }
}

function stop(): void {
  audio?.pause();
  audio = null;
  void context?.close();
  context = null;
  gain = null;
}

function setVolume(volume: number): void {
  if (audio) audio.volume = volume;
  if (gain) gain.gain.value = volume;
}

function makeNoise(ctx: AudioContext, color: NoiseColor): AudioBuffer {
  const seconds = 6;
  const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === "white") {
        data[i] = white * 0.25;
      } else if (color === "brown") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        // Paul Kellet's pink-noise filter.
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    // Blend the tail into the head; the loop ends before the tail, so the seam is continuous.
    const fade = Math.floor(ctx.sampleRate * NOISE_FADE_SECONDS);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[data.length - fade + i] * (1 - t);
    }
  }
  return buffer;
}

function reportError(message: string): void {
  const msg: BackgroundMessage = { target: "background", type: "music:error", message };
  void chrome.runtime.sendMessage(msg);
}
