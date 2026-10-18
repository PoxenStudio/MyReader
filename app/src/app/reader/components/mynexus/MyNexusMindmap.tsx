'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib/no-plugins';
import { Markmap } from 'markmap-view';
import { MdOutlineDownload, MdOutlineFullscreen, MdOutlineRestartAlt } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { makeSafeFilename } from '@/utils/misc';

const MM_OPTIONS = { autoFit: true, fitRatio: 0.85, duration: 300, maxWidth: 320, paddingX: 16 };
const MM_EXPORT_PADDING = 60;
const SVG_NS = 'http://www.w3.org/2000/svg';
const EXPORT_SCALE = 2;
// Exports always use the light palette so the injected white background stays
// readable when the app itself is in dark mode.
const EXPORT_VARS: Record<string, string> = {
  '--markmap-text-color': '#333',
  '--markmap-circle-open-bg': '#fff',
  '--markmap-code-bg': '#f0f0f0',
  '--markmap-code-color': '#555',
};

type MindmapFormat = 'svg' | 'png' | 'md';

const MENU_ITEMS: { format: MindmapFormat; label: string }[] = [
  { format: 'svg', label: 'Download SVG' },
  { format: 'png', label: 'Download PNG' },
  { format: 'md', label: 'Download Markdown' },
];

interface MyNexusMindmapProps {
  markdown: string;
  title?: string;
  height?: number;
  /** Stretch to the parent height instead of a fixed pixel height (dialog use). */
  fill?: boolean;
  /** Hide the title text, keeping the action buttons (dialog supplies the title). */
  hideTitle?: boolean;
  showExpand?: boolean;
  onExpand?: () => void;
}

interface ExportSvg {
  text: string;
  width: number;
  height: number;
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('svg image load failed'));
    image.src = url;
  });

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

const buildExportSvg = (svg: SVGSVGElement): ExportSvg => {
  let x = -600;
  let y = -600;
  let width = 2400;
  let height = 1800;
  const group = svg.querySelector('g');
  if (group) {
    try {
      const box = group.getBBox();
      x = box.x - MM_EXPORT_PADDING;
      y = box.y - MM_EXPORT_PADDING;
      width = box.width + MM_EXPORT_PADDING * 2;
      height = box.height + MM_EXPORT_PADDING * 2;
    } catch (e) {
      console.warn(
        `[MyNexus] mindmap getBBox failed, using defaults: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  clone.setAttribute('width', `${width}`);
  clone.setAttribute('height', `${height}`);
  clone.style.width = '';
  clone.style.height = '';
  for (const [name, value] of Object.entries(EXPORT_VARS)) clone.style.setProperty(name, value);

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('x', `${x}`);
  background.setAttribute('y', `${y}`);
  background.setAttribute('width', `${width}`);
  background.setAttribute('height', `${height}`);
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);

  return { text: new XMLSerializer().serializeToString(clone), width, height };
};

const MyNexusMindmap: React.FC<MyNexusMindmapProps> = ({
  markdown,
  title,
  height = 360,
  fill = false,
  hideTitle = false,
  showExpand = true,
  onExpand,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const transformerRef = useRef<Transformer | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!transformerRef.current) transformerRef.current = new Transformer();

  const root = useMemo(
    () => (markdown ? transformerRef.current!.transform(markdown).root : null),
    [markdown],
  );

  const applyTheme = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Markmap maps its palette onto CSS variables on the root svg; overriding
    // them inline keeps the diagram readable on MyReader's light/dark themes.
    svg.style.setProperty('--markmap-text-color', isDarkMode ? '#e5e5e5' : '#333');
    svg.style.setProperty('--markmap-circle-open-bg', isDarkMode ? '#444' : '#fff');
    svg.style.setProperty('--markmap-code-bg', isDarkMode ? '#1a1b26' : '#f0f0f0');
    svg.style.setProperty('--markmap-code-color', isDarkMode ? '#ddd' : '#555');
  }, [isDarkMode]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    console.log('[MyNexus] mindmap create');
    // React StrictMode runs effects twice in dev; drop any previous instance
    // before creating a new one so two SVGs never stack up.
    mmRef.current?.destroy();
    mmRef.current = Markmap.create(svg, MM_OPTIONS, root);
    applyTheme();
    return () => {
      console.log('[MyNexus] mindmap destroy');
      mmRef.current?.destroy();
      mmRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mm = mmRef.current;
    if (!mm || !root) return;
    void mm.setData(root).then(() => mm.fit());
  }, [root]);

  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // The markmap instance only watches node sizes, so a panel/window resize
    // needs an explicit refit to keep the graph inside its box.
    const observer = new ResizeObserver(() => {
      void mmRef.current?.fit();
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [menuOpen]);

  const download = useCallback(
    async (format: MindmapFormat) => {
      if (!appService) return;
      const filename = makeSafeFilename(title || 'mindmap', '-');
      if (format === 'md') {
        console.log(`[MyNexus] mindmap download ${filename}.md length=${markdown.length}`);
        await appService.saveFile(`${filename}.md`, markdown, { mimeType: 'text/markdown' });
        return;
      }

      const svg = svgRef.current;
      if (!svg) return;
      const exported = buildExportSvg(svg);

      if (format === 'svg') {
        console.log(
          `[MyNexus] mindmap download ${filename}.svg chars=${exported.text.length} box=${exported.width}x${exported.height}`,
        );
        await appService.saveFile(`${filename}.svg`, exported.text, {
          mimeType: 'image/svg+xml',
        });
        return;
      }

      let url: string | null = null;
      try {
        url = URL.createObjectURL(new Blob([exported.text], { type: 'image/svg+xml' }));
        const image = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(exported.width * EXPORT_SCALE);
        canvas.height = Math.round(exported.height * EXPORT_SCALE);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await toBlob(canvas);
        if (!blob) throw new Error('canvas toBlob returned null');
        const buffer = await blob.arrayBuffer();
        console.log(
          `[MyNexus] mindmap download ${filename}.png bytes=${buffer.byteLength} box=${canvas.width}x${canvas.height}`,
        );
        await appService.saveFile(`${filename}.png`, buffer, { mimeType: 'image/png' });
      } catch (e) {
        console.error(
          `[MyNexus] mindmap png export failed ${filename}: ${e instanceof Error ? e.message : e}`,
        );
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    },
    [appService, markdown, title],
  );

  return (
    <div
      className={clsx(
        'border-base-300 bg-base-100/40 mt-2 overflow-hidden rounded-lg border',
        fill && 'flex h-full min-h-0 flex-col',
      )}
    >
      <div className='border-base-300 bg-base-200/50 flex items-center justify-between gap-1 border-b px-2 py-1'>
        {hideTitle ? (
          <span className='text-xs font-semibold' />
        ) : (
          <span className='text-xs font-semibold truncate'>{title || _('Mind Map')}</span>
        )}
        <div className='flex items-center'>
          <button
            type='button'
            className='btn btn-ghost btn-xs h-7 min-h-7 w-7 p-0'
            title={_('Reset View')}
            aria-label={_('Reset View')}
            onClick={() => void mmRef.current?.fit()}
          >
            <MdOutlineRestartAlt size={16} />
          </button>
          {showExpand && (
            <button
              type='button'
              className='btn btn-ghost btn-xs h-7 min-h-7 w-7 p-0'
              title={_('Expand')}
              aria-label={_('Expand')}
              onClick={() => onExpand?.()}
            >
              <MdOutlineFullscreen size={15} />
            </button>
          )}
          <div ref={menuRef} className='dropdown dropdown-end relative'>
            <button
              type='button'
              tabIndex={0}
              className='btn btn-ghost btn-xs h-7 min-h-7 w-7 p-0'
              title={_('Download')}
              aria-label={_('Download')}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MdOutlineDownload size={16} />
            </button>
            {menuOpen && (
              <ul
                tabIndex={0}
                className='dropdown-content menu bg-base-100 rounded-box z-[70] mt-1 w-44 p-1 shadow-2xl'
              >
                {MENU_ITEMS.map((item) => (
                  <li key={item.format}>
                    <button
                      type='button'
                      onClick={() => {
                        setMenuOpen(false);
                        void download(item.format);
                      }}
                    >
                      {_(item.label)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className={fill ? 'min-h-0 flex-1' : ''} style={fill ? undefined : { height }}>
        <svg ref={svgRef} className='h-full w-full' />
      </div>
    </div>
  );
};

export default MyNexusMindmap;
