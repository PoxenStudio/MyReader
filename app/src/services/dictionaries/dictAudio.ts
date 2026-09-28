/**
 * 发音播放（嵌入阅读器）：把词典词条里的发音点击变成内联播放。
 *
 * 移植自 mydict 的 iframe_bootstrap.js（django-mdict 同款的 libspeex-js 方案）。
 * 词条里的发音有两种形态：
 *   - 千篇系：`<a data-mp3="https://…mp3">`，靠词典自带的脚本播——本模块拦截后
 *     代播（词条自带的 `<script>` 在阅读器里从不执行）。
 *   - NHK 发音词典等：`<a href="/dict-res/N/res/SPX/x.spx">`（`sound://` 改写产物），
 *     浏览器原生解不了 Speex，走 libspeex-js 解成 WAV 再播。
 *
 * 解码器（3 个 JS，~314KB）在第一次播 spx 时才懒加载，来自阅读器自己的
 * `/vendor/speex/`——不依赖词典服务端有没有这份资源。
 */

const SPEEX_SCRIPTS = [
  '/vendor/speex/bitstring.min.js',
  '/vendor/speex/pcmdata.min.js',
  '/vendor/speex/speex.min.js',
];

/** 绑定标记：外链处理看到它就跳过，避免同一发音点击被绑定两次。 */
export const AUDIO_BOUND = 'dictAudioBound';

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|spx)(?:[?#].*)?$/i;
const SPX_EXT_RE = /\.spx(?:[?#].*)?$/i;

interface SpeexHeader {
  rate: number;
  mode: number;
  nb_channels: number;
}

interface SpeexDecoder {
  decode(bitstream: unknown, segments: unknown): number[];
}

interface SpeexGlobal {
  parseHeader(frame: unknown): SpeexHeader;
  new (options: { quality: number; mode: number; rate: number }): SpeexDecoder;
  util: { str2ab(str: string): ArrayBuffer };
}

interface PcmDataGlobal {
  encode(options: {
    sampleRate: number;
    channelCount: number;
    bytesPerSample: number;
    data: number[];
  }): string;
}

interface OggGlobal {
  new (
    data: string,
    options: { file: boolean },
  ): {
    demux(): void;
    frames: unknown[];
    bitstream(): unknown;
    segments: unknown;
  };
}

const globals = (): {
  Ogg: OggGlobal;
  Speex: SpeexGlobal;
  PCMData: PcmDataGlobal;
} => window as unknown as { Ogg: OggGlobal; Speex: SpeexGlobal; PCMData: PcmDataGlobal };

let decoderLoader: Promise<void> | null = null;

/** libspeex-js 的 3 个脚本懒加载一次；失败允许下次重试。 */
const loadSpeexDecoder = (): Promise<void> => {
  if (decoderLoader) return decoderLoader;
  decoderLoader = new Promise<void>((resolve, reject) => {
    let loaded = 0;
    for (const src of SPEEX_SCRIPTS) {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => {
        loaded += 1;
        if (loaded === SPEEX_SCRIPTS.length) resolve();
      };
      el.onerror = () => {
        decoderLoader = null; // 允许下次重试
        reject(new Error(`解码器脚本加载失败: ${src}`));
      };
      document.head.appendChild(el);
    }
  });
  return decoderLoader;
};

/** 大数组逐块转二进制字符串（Speex 解码器的输入形态）。 */
const binaryString = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, [
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    ]);
  }
  return out;
};

/** 解码规则与 django-mdict 的 mdict.js 一致（含那条经验修正：双声道时采样率
 * 减半，否则 NHK 的 32kHz 双声道 spx 会播放过快）。 */
const decodeSpeex = (bytes: Uint8Array): Blob => {
  const { Ogg, Speex, PCMData } = globals();
  const ogg = new Ogg(binaryString(bytes), { file: true });
  ogg.demux();
  const header = Speex.parseHeader(ogg.frames[0]);
  if (header.nb_channels === 2) header.rate = header.rate / 2;
  const spx = new Speex({ quality: 8, mode: header.mode, rate: header.rate });
  const wave = PCMData.encode({
    sampleRate: header.rate,
    channelCount: header.nb_channels,
    bytesPerSample: 2,
    data: spx.decode(ogg.bitstream(), ogg.segments),
  });
  return new Blob([Speex.util.str2ab(wave)], { type: 'audio/wav' });
};

let audioEl: HTMLAudioElement | null = null;

const ensureAudioEl = (): HTMLAudioElement => {
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.setAttribute('data-dict-player', '1');
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
  }
  return audioEl;
};

/** spx 解码结果按 URL 缓存：同一个词反复点不重复解码。 */
const decodedBlobs = new Map<string, string>();

const setDecodedSource = (el: HTMLAudioElement, blob: Blob): void => {
  const owner = el as HTMLAudioElement & { __dictBlobUrl?: string };
  if (owner.__dictBlobUrl) URL.revokeObjectURL(owner.__dictBlobUrl);
  owner.__dictBlobUrl = URL.createObjectURL(blob);
  el.src = owner.__dictBlobUrl;
};

const playSpeexDecoded = (
  el: HTMLAudioElement,
  spxUrl: string,
  fail: (message: string) => void,
  succeed?: () => void,
): void => {
  const decode = async (): Promise<void> => {
    await loadSpeexDecoder();
    const cached = decodedBlobs.get(spxUrl);
    if (cached) {
      el.src = cached;
    } else {
      const resp = await fetch(spxUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = decodeSpeex(new Uint8Array(await resp.arrayBuffer()));
      const url = URL.createObjectURL(blob);
      decodedBlobs.set(spxUrl, url);
      setDecodedSource(el, blob);
    }
    await el.play();
    succeed?.();
  };
  decode().catch((error: unknown) => {
    fail(error instanceof Error ? error.message : String(error));
  });
};

/** `.spx` 原生放不了：候选顺序为同名 .mp3 → .opus → 原 .spx（mydict 的规则）。 */
export const audioCandidates = (url: string): string[] => {
  if (!SPX_EXT_RE.test(url)) return [url];
  return [url.replace(SPX_EXT_RE, '.mp3'), url.replace(SPX_EXT_RE, '.opus'), url];
};

/** 播放一个音频 URL；全部候选失败时调 `fail`，成功起播时调 `succeed`（调用方据此提示）。 */
const playAudio = (url: string, fail: (message: string) => void, succeed?: () => void): void => {
  const candidates = audioCandidates(url);
  let index = 0;
  const attempt = (): void => {
    if (index >= candidates.length) {
      fail('no playable audio');
      return;
    }
    const current = candidates[index++]!;
    const el = ensureAudioEl();
    // 404 的候选会同时触发 error 事件与 play() 的 reject，两边各推进一次会
    // 跳级——每次 attempt 只许推进一次。
    let advanced = false;
    const advance = (): void => {
      if (advanced) return;
      advanced = true;
      attempt();
    };
    // 走到原 .spx 这一步：原生放不了，交给 JS 解码。先摘掉上一个候选挂的
    // onerror，否则解码结果播放失败时会再触发一次 attempt，重复上报。
    if (SPX_EXT_RE.test(current)) {
      el.onerror = null;
      playSpeexDecoded(el, current, fail, succeed);
      return;
    }
    el.onerror = advance;
    el.src = current;
    const played = el.play();
    if (played) {
      void played.then(() => succeed?.()).catch(() => {});
      void played.catch(advance);
    }
  };
  attempt();
};

/**
 * Bind click handlers that turn pronunciation anchors into inline playback.
 *
 * 两种来源：`<a data-mp3="…">`（千篇自带的远程 mp3）与 `<a href="…spx/mp3">`
 * （`sound://` 改写产物）。都改成停掉之前的播放、就地出声——现在的行为是把
 * 用户带到音频文件本身（新标签页打不开 spx，词条整个被换掉）。
 *
 * `resolve` 把词条里的资源路径（/dict-res/…）换成可取回的 URL（已含
 * 绝对化/中继逻辑，见 buildMyDictResourceUrl）。
 */
export const wireDictAudio = (
  root: HTMLElement,
  resolve: (resourcePath: string) => string,
  onFail?: (message: string) => void,
  onSuccess?: () => void,
): void => {
  const play = (url: string): void => {
    playAudio(
      url,
      (message) => {
        console.warn('发音播放失败', url, message);
        onFail?.(message);
      },
      onSuccess,
    );
  };

  // `<a href="….mp3/.spx/…">`：sound:// 改写产物与词条自带的音频链接
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!AUDIO_EXT_RE.test(href)) continue;
    anchor.dataset[AUDIO_BOUND] = '1';
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      play(resolve(href));
    });
  }
  // 千篇的发音按钮：data-mp3 属性（href 是 "#" 或不存在），远程 CDN mp3
  for (const el of root.querySelectorAll<HTMLElement>('[data-mp3]')) {
    const url = el.getAttribute('data-mp3') ?? '';
    if (!url) continue;
    el.dataset[AUDIO_BOUND] = '1';
    el.addEventListener('click', (event) => {
      event.preventDefault();
      play(url);
    });
  }
};
