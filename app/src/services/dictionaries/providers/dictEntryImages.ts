/**
 * 词条图片交互：词典自管的「缩略图 ⇄ 大图」展开 + 大图幻灯片查看器。
 *
 * 从 MyDict 浏览器扩展（myreader-extension 的 render/expandable.js + images.js +
 * lightbox.js）移植回来——扩展当年就是从这里（网页版 iframe_bootstrap.js 的点击分流
 * 算法）移植出去的，词典面板渲染器一直没接图片交互，表现为：
 *   - 広辞苑的括号图标、牛津的拓展图只能看不能点；
 *   - 扫描版词典（辞海）整页大图缩在卡片宽度里，小字没法读。
 *
 * 血泪教训（网页版/扩展同款）：**不能依赖 event.target 是 <img>**。真实鼠标点击命中的
 * 往往是悬停放大镜角标（.ox-enlarge-label）、<a> 或容器本身。所以监听挂**捕获阶段**、
 * 按容器分流：
 *
 *   - 第10版：`#ox-enlarge`（或 a.topic）里可见图是 fullsize = 展开态 → 拦掉词典的
 *     「缩回去」改弹幻灯片；可见图是 thumb = 收起态 → 原地展开；
 *   - 第9版：`.big_pic` = 展开态 → 幻灯片；`.pic_thumb` = 收起态 → 原地展开；
 *   - 其余裸 <img>（无链接包裹、渲染尺寸 ≥160px）→ 幻灯片；链接包裹的图交给链接逻辑。
 *
 * 与扩展版的差异：挂载点直接是 document.body（自家应用，没有反悬浮广告样式表，
 * 不需要「免疫内联样式」）；文案不进 i18n（与扩展一致用中文，词典场景下足够）。
 */

const IMAGE_MIN_SIZE = 160;
const WHEEL_SENSITIVITY = 0.0015; // 单次滚轮缩放步长；deltaY 量级跨设备差异大，用指数保证手感一致
const MIN_ZOOM = 0.5; // 相对「适应视口」的缩放上下限
const MAX_ZOOM = 20;
const DRAG_THRESHOLD = 4; // 超过才算拖动，否则松手会被当成「点了空白」而退出

const COLLAPSE_BTN_CSS = [
  'display: inline-block',
  'margin: 2px 0 6px',
  'padding: 1px 10px',
  'font: 12px/1.7 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  'border: 1px solid rgba(127, 127, 127, 0.55)',
  'border-radius: 10px',
  'background: rgba(127, 127, 127, 0.14)',
  'color: inherit',
  'cursor: pointer',
  'user-select: none',
].join(';');

const LIGHTBOX_CSS = `
  :host { all: initial; }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    overflow: hidden;
    /* 默认浅色：扫描版词典整页图多为白底，深色遮罩会淹没内容；右下角按钮可切深色 */
    background: #f2f2f2;
    touch-action: none;
    cursor: grab;
  }
  .overlay.dark { background: #0a0a0a; }
  .overlay.dragging { cursor: grabbing; }
  .overlay img {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    max-width: none;
    user-select: none;
    -webkit-user-drag: none;
    cursor: grab;
  }
  .overlay.dragging img { cursor: grabbing; }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 72px;
    border: none;
    border-radius: 10px;
    /* 半透明深色胶囊：浅色/深色两种背景下都清晰（白色半透明在浅色态会隐形） */
    background: rgba(0, 0, 0, 0.45);
    color: #f2f5f4;
    font-size: 30px;
    line-height: 1;
    cursor: pointer;
  }
  .nav:hover { background: rgba(0, 0, 0, 0.65); }
  .nav.prev { left: 16px; }
  .nav.next { right: 16px; }
  .nav[hidden] { display: none; }
  .hint {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 4px 12px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.5);
    color: #f2f5f4;
    font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    pointer-events: none;
    white-space: nowrap;
  }
  .hint[hidden] { display: none; }
  /* 右下角背景切换：hint 靠左居中，本按钮靠右，同高不冲突 */
  .bg-toggle {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 2;
    padding: 4px 12px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.45);
    color: #f2f5f4;
    font: 12px/1.6 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    cursor: pointer;
  }
  .bg-toggle:hover { background: rgba(0, 0, 0, 0.65); }
`;

/* ------------------------------ 展开与收起 ------------------------------ */

/** 容器里当前有布局盒的 img；全隐藏返回 null（收起态/展开态的判定依据）。 */
const visibleImageIn = (container: Element): HTMLImageElement | null => {
  for (const img of container.querySelectorAll<HTMLImageElement>('img')) {
    if (img.getBoundingClientRect().width > 0) return img;
  }
  return null;
};

/** oald10.css 把 .thumb 和 .fullsize 都 display:none 了（网页版靠词条 JS 初始化显示
 *  缩略图，这里词条脚本被剥掉）——接线时用内联 !important 恢复网页版的可见状态。 */
const forceInitialVisibility = (root: HTMLElement) => {
  for (const thumb of root.querySelectorAll<HTMLImageElement>('img.thumb')) {
    thumb.style.setProperty('display', 'block', 'important');
    thumb.style.cursor = 'pointer';
    let full: Element | null = thumb.previousElementSibling;
    for (
      let hop = 0;
      full && hop < 3 && !(full instanceof HTMLImageElement && full.classList.contains('fullsize'));
      hop += 1
    ) {
      full = full.previousElementSibling;
    }
    if (full instanceof HTMLImageElement && full.classList.contains('fullsize')) {
      full.style.setProperty('display', 'none', 'important');
    }
  }
};

/** 展开后挂在图旁的「收起」按钮；点击收回缩略图（两个结构共用）。 */
const ensureCollapseBtn = (anchor: Element, collapse: () => void) => {
  let btn: HTMLButtonElement;
  const existing = anchor.nextElementSibling;
  if (existing instanceof HTMLButtonElement && existing.dataset['mydictCollapse']) {
    btn = existing;
  } else {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '收起';
    btn.title = '收起拓展图';
    btn.dataset['mydictCollapse'] = '1';
    btn.style.cssText = COLLAPSE_BTN_CSS;
    anchor.after(btn);
  }
  btn.hidden = false;
  btn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    btn.hidden = true;
    collapse();
  };
};

/** 第10版：容器内 thumb ⇄ fullsize。 */
const expandTopic = (ox: HTMLElement) => {
  const thumb = ox.querySelector<HTMLImageElement>('img.thumb');
  const full = ox.querySelector<HTMLImageElement>('img.fullsize');
  if (!thumb || !full) return;
  thumb.style.setProperty('display', 'none', 'important');
  full.style.setProperty('display', 'block', 'important');
  ensureCollapseBtn(full, () => {
    full.style.setProperty('display', 'none', 'important');
    thumb.style.setProperty('display', 'block', 'important');
  });
};

/** 第9版：pic_thumb ⇄ big_pic。 */
const expand9 = (thumbBox: HTMLElement, bigBox: HTMLElement) => {
  thumbBox.style.display = 'none';
  bigBox.style.setProperty('display', 'block', 'important');
  ensureCollapseBtn(bigBox, () => {
    bigBox.style.setProperty('display', 'none', 'important');
    thumbBox.style.display = '';
  });
};

/* ------------------------------ 幻灯片查看器 ------------------------------ */

interface LightboxInstance {
  host: HTMLDivElement;
  open: (urls: string[], index: number, alt?: string) => void;
  close: () => void;
  readonly isOpen: boolean;
}

let lightboxInstance: (LightboxInstance & { onClose?: () => void }) | null = null;

const createLightbox = (): LightboxInstance & { onClose?: () => void } => {
  const host = document.createElement('div');
  host.setAttribute('data-dict-lightbox', '');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = LIGHTBOX_CSS;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const img = document.createElement('img');
  img.draggable = false;
  overlay.appendChild(img);
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'nav prev';
  prevBtn.title = '上一张（←）';
  prevBtn.textContent = '‹';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'nav next';
  nextBtn.title = '下一张（→）';
  nextBtn.textContent = '›';
  const hint = document.createElement('p');
  hint.className = 'hint';
  // 背景手动切换（与桌面端 mydict-desktop/ui-viewer.ts 同款）：默认浅色
  // #f2f2f2——扫描版词典整页图多为白底，默认深色遮罩会淹没内容。
  const bgBtn = document.createElement('button');
  bgBtn.type = 'button';
  bgBtn.className = 'bg-toggle';
  overlay.appendChild(bgBtn);
  overlay.append(prevBtn, nextBtn, hint);
  shadow.append(style, overlay);

  let urls: string[] = [];
  let index = 0;
  let isOpen = false;
  let fitScale = 1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let moved = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let offsetStartX = 0;
  let offsetStartY = 0;
  let bgDark = false; // 默认浅色（与桌面端一致）；不持久化，行为与桌面端对齐

  /** 应用当前背景态并同步按钮文案：文案提示的是「点下去会切到什么」。 */
  const applyBg = () => {
    overlay.classList.toggle('dark', bgDark);
    bgBtn.textContent = bgDark ? '☀ 浅色背景' : '🌙 深色背景';
  };
  applyBg();

  /** 让整张图完整可见并居中；缩放上下限都相对这个基准。 */
  const fitToViewport = () => {
    const naturalWidth = img.naturalWidth || 1;
    const naturalHeight = img.naturalHeight || 1;
    const viewWidth = overlay.clientWidth || window.innerWidth;
    const viewHeight = overlay.clientHeight || window.innerHeight;
    fitScale = Math.min(viewWidth / naturalWidth, viewHeight / naturalHeight);
    scale = fitScale;
    offsetX = (viewWidth - naturalWidth * fitScale) / 2;
    offsetY = (viewHeight - naturalHeight * fitScale) / 2;
    applyTransform();
  };

  const applyTransform = () => {
    img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  const clampScale = (next: number) => {
    const low = Math.max(fitScale * MIN_ZOOM, 0.01);
    return Math.min(Math.max(next, low), fitScale * MAX_ZOOM);
  };

  /** 缩放锚定光标：保持光标下的图片坐标点不动，否则想看的细节会跑出视口。 */
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const next = clampScale(scale * Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
    const ratio = next / scale;
    offsetX = pointerX - (pointerX - offsetX) * ratio;
    offsetY = pointerY - (pointerY - offsetY) * ratio;
    scale = next;
    applyTransform();
  };

  const onPointerDown = (event: PointerEvent) => {
    // 翻页按钮上的按下不能开拖：setPointerCapture 会把后续指针事件转给遮罩，
    // 按钮就收不到 click 了
    if (event.target !== overlay && event.target !== img) return;
    dragging = true;
    moved = 0;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    offsetStartX = offsetX;
    offsetStartY = offsetY;
    overlay.classList.add('dragging');
    overlay.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - pointerStartX;
    const dy = event.clientY - pointerStartY;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    offsetX = offsetStartX + dx;
    offsetY = offsetStartY + dy;
    applyTransform();
  };

  const onPointerUp = () => {
    dragging = false;
    overlay.classList.remove('dragging');
  };

  /** 只有点在图片以外的空白、且刚才没在拖动时才退出。 */
  const onOverlayClick = (event: MouseEvent) => {
    if (moved > DRAG_THRESHOLD) return;
    if (event.target === overlay) close();
  };

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= urls.length) return;
    open(urls, next);
  };

  // window 捕获阶段拦 Esc / ←/→：词典弹窗自己的关闭逻辑收不到这些键，
  // 灯箱开着时 Esc 只关灯箱、不关弹窗。
  const onKeydown = (event: KeyboardEvent) => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopImmediatePropagation();
      go(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  const render = () => {
    const hasSiblings = urls.length > 1;
    prevBtn.hidden = !hasSiblings || index <= 0;
    nextBtn.hidden = !hasSiblings || index >= urls.length - 1;
    hint.hidden = false;
    hint.textContent = `${hasSiblings ? `${index + 1} / ${urls.length} · ` : ''}滚轮缩放 · 拖动移动${
      hasSiblings ? ' · ← → 翻页' : ''
    } · Esc 或点空白处退出`;
  };

  const open = (nextUrls: string[], nextIndex: number, alt = '') => {
    urls = nextUrls;
    index = nextIndex;
    isOpen = true;
    host.style.setProperty('display', 'block', 'important');
    img.alt = alt;
    img.src = urls[index] ?? '';
    render();
    if (!img.complete) fitToViewport(); // 尺寸未知的先按视口适配，onLoad 再精确 fit
  };

  const close = () => {
    isOpen = false;
    host.style.setProperty('display', 'none', 'important');
    img.removeAttribute('src');
  };

  img.addEventListener('load', fitToViewport);
  img.addEventListener('error', () => {
    hint.textContent = '图片加载失败';
  });
  overlay.addEventListener('wheel', onWheel, { passive: false });
  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('click', onOverlayClick);
  // 按钮上的按下/点击都不能冒泡到遮罩：否则会被当成「点空白」或开启拖动
  bgBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
  bgBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    bgDark = !bgDark;
    applyBg();
  });
  prevBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
  nextBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
  prevBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    go(-1);
  });
  nextBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    go(1);
  });
  window.addEventListener('keydown', onKeydown, true);

  return {
    host,
    open,
    close,
    get isOpen() {
      return isOpen;
    },
  };
};

/** 打开大图查看器（已开着就复用）。挂到 body 上，独立于弹窗/面板的生命周期。 */
export const openDictLightbox = (urls: string[], index: number, alt = '') => {
  if (!lightboxInstance) lightboxInstance = createLightbox();
  if (!lightboxInstance.host.isConnected) document.body.appendChild(lightboxInstance.host);
  lightboxInstance.open(urls, index, alt);
};

/** 灯箱是否开着。 */
export const isDictLightboxOpen = () => lightboxInstance?.isOpen ?? false;

/** 关灯箱（调用方收尾用；一般不需要——灯箱有自己的 Esc/点空白退出）。 */
export const closeDictLightbox = () => lightboxInstance?.close();

/* ------------------------------ 取材与分流 ------------------------------ */

/** 收集 root 里所有「够大」的图，按文档顺序去重。 */
const collectLargeImages = (root: HTMLElement) => {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const node of root.querySelectorAll<HTMLImageElement>('img')) {
    const box = node.getBoundingClientRect();
    if (box.width < IMAGE_MIN_SIZE && box.height < IMAGE_MIN_SIZE) continue;
    const url = node.currentSrc || node.src;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
};

/** 从被点中的那张图打开幻灯片；点中的图不在表里时退化为单张。 */
const openImageInViewer = (img: HTMLImageElement, root: HTMLElement) => {
  const current = img.currentSrc || img.src;
  const urls = collectLargeImages(root);
  let index = urls.indexOf(current);
  if (index < 0) {
    urls.length = 0;
    urls.push(current);
    index = 0;
  }
  openDictLightbox(urls, index, img.alt || '');
};

/**
 * 给一个词典分组的词条内容容器接上图片交互（在 wireLinks 之后调用：
 * 链接包裹的图由链接逻辑处理，这里不抢）。
 */
export const wireEntryImageInteractions = (root: HTMLElement) => {
  forceInitialVisibility(root);

  root.addEventListener(
    'click',
    (event) => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      // 「收起」按钮自己处理（它不在任何图容器里，但明确跳过最稳）
      if (node.closest('button[data-mydict-collapse]')) return;
      // 链接包裹的图走链接逻辑（wireLinks 已处理），这里不抢
      if (node.closest('a[href]')) return;

      // ---- 第9版：展开态（big_pic）→ 幻灯片；拦掉词典的「缩回去」 ----
      const big9 = node.closest<HTMLElement>('.big_pic');
      if (big9) {
        const img = visibleImageIn(big9);
        if (img) {
          event.preventDefault();
          event.stopPropagation();
          openImageInViewer(img, root);
        }
        return;
      }

      // ---- 第9版：收起态（pic_thumb）→ 原地展开（词典 JS 被剥了，这里自己做） ----
      const thumb9 = node.closest<HTMLElement>('.pic_thumb');
      if (thumb9) {
        const pic = thumb9.closest<HTMLElement>('.pic') ?? thumb9.parentElement;
        const big9b = pic?.querySelector<HTMLElement>('.big_pic');
        if (big9b) {
          event.preventDefault();
          event.stopPropagation();
          expand9(thumb9, big9b);
        }
        return;
      }

      // ---- 第10版：#ox-enlarge / a.topic 容器 ----
      const topic = node.closest<HTMLElement>('a.topic');
      const ox =
        node.closest<HTMLElement>('#ox-enlarge') ??
        (topic && (topic.querySelector('img.thumb') || topic.querySelector('img.fullsize'))
          ? topic
          : null);
      if (ox) {
        const img = visibleImageIn(ox);
        if (!img) return;
        event.preventDefault();
        event.stopPropagation();
        if (img.classList.contains('fullsize')) {
          openImageInViewer(img, root); // 展开态 → 幻灯片，不缩回去
        } else {
          expandTopic(ox); // 收起态 → 原地展开
        }
        return;
      }

      // ---- 通用：无链接包裹、渲染尺寸 ≥160px 的裸 <img> → 幻灯片 ----
      if (node.tagName === 'IMG') {
        const box = node.getBoundingClientRect();
        if (box.width >= IMAGE_MIN_SIZE || box.height >= IMAGE_MIN_SIZE) {
          event.preventDefault();
          event.stopPropagation();
          openImageInViewer(node as HTMLImageElement, root);
        }
      }
    },
    true, // capture：真实点击命中角标/容器时也能按容器分流
  );
};
