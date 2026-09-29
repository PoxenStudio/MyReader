'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdArrowBack,
  MdBookmarkAdd,
  MdBookmarkAdded,
  MdChevronRight,
  MdSettings,
  MdVolumeUp,
} from 'react-icons/md';
import clsx from 'clsx';
import { openUrl } from '@tauri-apps/plugin-opener';

import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import { useThemeStore } from '@/store/themeStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { getEnabledProviders } from '@/services/dictionaries/registry';
import { buildLookupCandidates } from '@/services/dictionaries/lookupCandidates';
import { isTauriAppPlatform } from '@/services/environment';
import { cancelWordPronounce, pronounceWord, warmWordAudio } from '@/services/tts/wordPronouncer';
import {
  getBuiltinWebSearch,
  substituteUrlTemplate,
} from '@/services/dictionaries/webSearchTemplates';
import type {
  DictionaryLookupOutcome,
  DictionaryProvider,
  WebSearchEntry,
} from '@/services/dictionaries/types';

const isTauri = isTauriAppPlatform();

interface CardState {
  state: 'loading' | 'loaded' | 'empty' | 'unsupported' | 'error';
  loadKey: string;
  outcome?: DictionaryLookupOutcome;
  expanded: boolean;
}

export interface UseDictionaryResultsArgs {
  word: string;
  lang?: string;
}

export interface DictionaryResultsState {
  currentWord: string;
  canGoBack: boolean;
  goBack: () => void;
  /**
   * "加入生词本" for the current word, when an enabled provider's server has a
   * wordbook (MyDict family). Absent → the header shows no button.
   */
  vocabAction?: VocabAction;
  visibleDefinitionProviders: DictionaryProvider[];
  /** Labels of enabled providers that report `unsupported` on this platform. */
  unavailableDefinitionLabels: string[];
  webSearchProviders: DictionaryProvider[];
  /** Whether the web-search section renders above the dictionaries one (#5083). */
  webSearchFirst: boolean;
  cards: Record<string, CardState>;
  setContainerRef: (id: string) => (el: HTMLDivElement | null) => void;
  handleContainerClick: (e: React.MouseEvent) => void;
  toggleExpanded: (id: string) => void;
  resolveWebSearchUrl: (id: string) => string | undefined;
  onWebSearchClickTauri: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  noProvidersAtAll: boolean;
  /** Dictionary popup font-size multiplier (#4443); `1` = default sizes. */
  fontScale: number;
  /** Whether the current word is being fetched/spoken by the TTS engine (#4876). */
  isSpeaking: boolean;
  /** Pronounce the current word via Edge TTS (falling back to platform speech). */
  speakWord: () => void;
}

/**
 * State + lookup orchestration shared by the desktop popup and the mobile
 * bottom sheet. Owns:
 *   - the in-component history stack (for in-content link navigation),
 *   - the per-provider lookup fan-out + abort wiring,
 *   - per-card expand/collapse with the ≤ 3-results auto-expand default,
 *   - external-link delegation (Tauri vs web target="_blank"),
 *   - web-search URL resolution.
 *
 * Both wrappers mount this hook and feed its return value into
 * {@link DictionaryResultsHeader} (sticky title + back + manage gear) and
 * {@link DictionaryResultsBody} (card stack + web-search rows).
 */
export function useDictionaryResults({
  word,
  lang,
}: UseDictionaryResultsArgs): DictionaryResultsState {
  const { appService } = useEnv();
  const { dictionaries, settings } = useCustomDictionaryStore();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const themeCode = useThemeStore((s) => s.themeCode);
  const _ = useTranslation();

  const computedProviders = getEnabledProviders({
    settings,
    dictionaries,
    fs: appService ?? undefined,
  });
  const providersSignature = computedProviders.map((p) => p.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const providers = useMemo<DictionaryProvider[]>(() => computedProviders, [providersSignature]);

  const definitionProviders = useMemo(() => providers.filter((p) => p.kind !== 'web'), [providers]);
  const webSearchProviders = useMemo(() => providers.filter((p) => p.kind === 'web'), [providers]);
  // Web entries live in their own section, so `providerOrder` alone can't lift
  // one above the dictionary cards (#5083). Let the top-most enabled provider
  // decide which section leads. Derived from the full enabled list rather than
  // the visible one so the sections don't reshuffle as lookups settle.
  const webSearchFirst = providers[0]?.kind === 'web';

  const [historyStack, setHistoryStack] = useState<string[]>([word.trim()]);
  const currentWord = historyStack[historyStack.length - 1] ?? word.trim();

  // Reset the history when the host reopens with a new word from outside
  // (selection change in the reader). A double-click selection can carry
  // trailing whitespace, so trim before seeding.
  useEffect(() => {
    setHistoryStack([word.trim()]);
  }, [word]);

  const [cards, setCards] = useState<Record<string, CardState>>({});
  // Cards the user has manually toggled. The auto-expand reconciliation
  // (≤ 3 results → default expanded) only writes to cards NOT in this set.
  const [manuallyToggled, setManuallyToggled] = useState<Record<string, boolean>>({});

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setContainerRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) containerRefs.current.set(id, el);
      else containerRefs.current.delete(id);
    },
    [],
  );

  const pushWord = useCallback((next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setHistoryStack((prev) => {
      if (prev[prev.length - 1] === trimmed) return prev;
      return [...prev, trimmed];
    });
  }, []);

  const goBack = useCallback(() => {
    setHistoryStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Pronounce the current headword (#4876). `isSpeaking` covers both the
  // Edge fetch and playback so the header button can show one active state.
  const [isSpeaking, setIsSpeaking] = useState(false);
  const langCode = typeof lang === 'string' ? lang : Array.isArray(lang) ? lang[0] : undefined;
  const speakWord = useCallback(() => {
    // Warm the audio context synchronously inside the click gesture; the
    // synth/play happens after a network await, outside the gesture window.
    warmWordAudio();
    setIsSpeaking(true);
    void pronounceWord(currentWord, langCode, { appService }, (status) => {
      if (status !== 'playing') setIsSpeaking(false);
    });
  }, [currentWord, langCode, appService]);

  // Stop any in-flight pronunciation when the word changes (in-content
  // navigation / reopen) or the popup unmounts.
  useEffect(() => {
    return () => cancelWordPronounce();
  }, []);
  useEffect(() => {
    cancelWordPronounce();
    setIsSpeaking(false);
  }, [currentWord]);

  // "加入生词本": the word goes to the dictionary server's own wordbook (MyDict
  // family only — the server snapshots the entry itself, so we send just the
  // word). Which notebook it lands in is the token's business.
  const [vocabState, setVocabState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const vocabProvider = useMemo(
    () => definitionProviders.find((p) => p.vocab),
    [definitionProviders],
  );
  const vocabCapability = vocabProvider?.vocab;
  // 用词条的真实词头（服务端返回的 word）而不是选区原文：MyDict 查询是前缀/模糊
  // 匹配（查 `ran` 命中 `ranch`），而生词本按 (dictionary_id, word) 精确查找——
  // 发选区原文会得到「该词典下未找到该单词，无法收藏」。词典 id 同理。
  const vocabOutcome = vocabProvider ? cards[vocabProvider.id]?.outcome : undefined;
  const vocabWord = vocabOutcome?.ok ? (vocabOutcome.headword ?? currentWord) : currentWord;
  const vocabDictionaryId = vocabOutcome?.ok ? vocabOutcome.dictionaryId : undefined;
  useEffect(() => {
    setVocabState('idle');
  }, [currentWord, vocabCapability]);
  const addToVocab = useCallback(() => {
    if (!vocabCapability || vocabState === 'saving') return;
    setVocabState('saving');
    void vocabCapability.addWord(vocabWord, { dictionaryId: vocabDictionaryId }).then((result) => {
      if (result.status === 'added') {
        setVocabState('saved');
        eventDispatcher.dispatch('toast', {
          type: 'success',
          timeout: 3000,
          message: `${_('Added to Wordbook')}（${vocabCapability.label}）`,
        });
        return;
      }
      setVocabState('idle');
      const message =
        result.status === 'duplicate'
          ? (result.message ?? _('Already in Wordbook'))
          : result.status === 'unauthorized'
            ? _('Wordbook unavailable — check the MyDict token')
            : result.message;
      eventDispatcher.dispatch('toast', {
        type: result.status === 'error' ? 'error' : 'warning',
        timeout: 4000,
        message,
      });
    });
  }, [vocabCapability, vocabState, vocabWord, vocabDictionaryId, _]);
  const vocabAction = useMemo<VocabAction | undefined>(
    () =>
      vocabCapability
        ? {
            label: vocabCapability.label,
            saved: vocabState === 'saved',
            busy: vocabState === 'saving',
            onAdd: addToVocab,
          }
        : undefined,
    [vocabCapability, vocabState, addToVocab],
  );

  const toggleExpanded = useCallback((id: string) => {
    setCards((prev) => {
      const old = prev[id];
      if (!old) return prev;
      return { ...prev, [id]: { ...old, expanded: !old.expanded } };
    });
    setManuallyToggled((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  // Reset manual-toggle tracking when the looked-up word changes — the
  // auto-expand decision should re-evaluate against the new result count.
  useEffect(() => {
    setManuallyToggled({});
  }, [currentWord]);

  // Auto-expand decision: when ≤ 3 providers have settled with results,
  // default-expand all of them. With > 3, default-collapse. User toggles
  // are sticky (tracked in `manuallyToggled`).
  useEffect(() => {
    const loadedIds = Object.entries(cards)
      .filter(([, c]) => c.state === 'loaded')
      .map(([id]) => id);
    if (loadedIds.length === 0) return;
    const shouldExpand = loadedIds.length <= 3;
    setCards((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of loadedIds) {
        if (manuallyToggled[id]) continue;
        const c = prev[id];
        if (!c) continue;
        if (c.expanded !== shouldExpand) {
          next[id] = { ...c, expanded: shouldExpand };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cards, manuallyToggled]);

  // External-link delegation inside provider-rendered DOM: on Tauri we
  // route http(s) anchors through `openUrl` because target="_blank" doesn't
  // work; on web we let the anchor handle it natively.
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (!isTauri) return;
    if (e.defaultPrevented) return;
    const anchor = (e.target as Element | null)?.closest?.('a');
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href');
    if (!rawHref || !/^https?:\/\//i.test(rawHref)) return;
    e.preventDefault();
    void openUrl(rawHref).catch((err) => {
      console.warn('Failed to open external URL', rawHref, err);
    });
  }, []);

  // Lookup orchestration: fan out across all definition providers in
  // parallel whenever currentWord (or the provider list) changes.
  useEffect(() => {
    if (!definitionProviders.length) return;
    const langCode = typeof lang === 'string' ? lang : Array.isArray(lang) ? lang[0] : undefined;
    const loadKey = `${currentWord}::${langCode || ''}`;

    setCards(() => {
      const next: Record<string, CardState> = {};
      for (const provider of definitionProviders) {
        next[provider.id] = {
          state: 'loading',
          loadKey,
          outcome: undefined,
          expanded: false,
        };
      }
      return next;
    });

    const controllers = new Map<string, AbortController>();
    definitionProviders.forEach((provider) => {
      const controller = new AbortController();
      controllers.set(provider.id, controller);

      const run = async () => {
        let outcome: DictionaryLookupOutcome;
        try {
          if (provider.init) await provider.init();
          const container = containerRefs.current.get(provider.id);
          if (!container) {
            outcome = { ok: false, reason: 'error', message: 'no container' };
          } else {
            // Try normalized query variants (trimmed, case-folded) then
            // language-aware lemma candidates in priority order, keeping the
            // first hit. Case-sensitive formats (mdict) otherwise miss
            // `Hello` / `world ` style selections whose headword is stored
            // lowercased, and dictionaries that store only base headwords
            // (e.g. Oxford Dictionary of English) miss inflected selections
            // like `ran` / `mice` / `analyses`.
            outcome = { ok: false, reason: 'empty' };
            for (const candidate of buildLookupCandidates(currentWord, langCode)) {
              container.replaceChildren();
              outcome = await provider.lookup(candidate, {
                lang: langCode,
                signal: controller.signal,
                container,
                onNavigate: pushWord,
                isDarkMode,
                bg: themeCode.bg,
                fg: themeCode.fg,
                _,
              });
              if (controller.signal.aborted) return;
              if (outcome.ok || outcome.reason !== 'empty') break;
            }
          }
        } catch (err) {
          outcome = {
            ok: false,
            reason: 'error',
            message: err instanceof Error ? err.message : String(err),
          };
        }
        if (controller.signal.aborted) return;
        const state = outcome.ok
          ? 'loaded'
          : outcome.reason === 'empty'
            ? 'empty'
            : outcome.reason === 'unsupported'
              ? 'unsupported'
              : 'error';
        setCards((prev) => {
          const old = prev[provider.id];
          if (!old || old.loadKey !== loadKey) return prev;
          return { ...prev, [provider.id]: { ...old, state, outcome } };
        });
      };
      void run();
    });

    return () => controllers.forEach((c) => c.abort());
  }, [currentWord, definitionProviders, lang, pushWord, isDarkMode, themeCode.bg, themeCode.fg, _]);

  // Visible cards = providers that are still loading or finished with a
  // result. Empty/unsupported/error cards are removed entirely.
  const visibleDefinitionProviders = definitionProviders.filter((p) => {
    const card = cards[p.id];
    if (!card) return true;
    return card.state === 'loading' || card.state === 'loaded';
  });

  // Providers that exist but cannot serve here (the web-only "MyDict (server)"
  // provider on the Android/desktop app, encrypted MDX, …). Their cards are
  // dropped from the list, which used to leave the popup completely blank —
  // say why instead of showing nothing.
  const unavailableDefinitionLabels = definitionProviders
    .filter((p) => cards[p.id]?.state === 'unsupported')
    .map((p) => _(p.label));

  const resolveWebSearchUrl = useCallback(
    (id: string): string | undefined => {
      if (id.startsWith('web:builtin:')) {
        const tpl = getBuiltinWebSearch(id);
        return tpl ? substituteUrlTemplate(tpl.urlTemplate, currentWord) : undefined;
      }
      const list: WebSearchEntry[] = settings.webSearches ?? [];
      const tpl = list.find((t) => t.id === id);
      if (!tpl || tpl.deletedAt) return undefined;
      return substituteUrlTemplate(tpl.urlTemplate, currentWord);
    },
    [currentWord, settings.webSearches],
  );

  const onWebSearchClickTauri = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      if (!isTauri) return;
      e.preventDefault();
      const url = resolveWebSearchUrl(id);
      if (!url) return;
      void openUrl(url).catch((err) => {
        console.warn('Failed to open external URL', url, err);
      });
    },
    [resolveWebSearchUrl],
  );

  const canGoBack = historyStack.length > 1;
  const noProvidersAtAll = providers.length === 0;

  return {
    currentWord,
    canGoBack,
    goBack,
    vocabAction,
    visibleDefinitionProviders,
    unavailableDefinitionLabels,
    webSearchProviders,
    webSearchFirst,
    cards,
    setContainerRef,
    handleContainerClick,
    toggleExpanded,
    resolveWebSearchUrl,
    onWebSearchClickTauri,
    noProvidersAtAll,
    fontScale: settings.fontScale ?? 1,
    isSpeaking,
    speakWord,
  };
}

/** The header's "add to wordbook" action state (see {@link DictionaryResultsState}). */
export interface VocabAction {
  /** Server label, shown in the toast ("已加入生词本（MyDict）"). */
  label: string;
  /** The word is saved (the button stays filled). */
  saved: boolean;
  /** A save is in flight. */
  busy: boolean;
  onAdd: () => void;
}

/**
 * The header's "add to wordbook" action (see {@link DictionaryResultsState}).
 * The wordbook comes from the first enabled provider that has the capability
 * (MyDict family); providers without it — local MDX, Wikipedia, … — don't
 * offer the button.
 */
export interface DictionaryResultsHeaderProps {
  headerClassName?: string;
  currentWord: string;
  canGoBack: boolean;
  goBack: () => void;
  onManage?: () => void;
  /** Pronounce the current word (#4876); omit to hide the speaker button. */
  onSpeak?: () => void;
  /** Whether pronunciation is in progress, for the active button state. */
  speaking?: boolean;
  /** "加入生词本"; omit to hide the button (no provider with a wordbook). */
  vocab?: VocabAction;
}

export const DictionaryResultsHeader: React.FC<DictionaryResultsHeaderProps> = ({
  headerClassName,
  currentWord,
  canGoBack,
  goBack,
  onManage,
  onSpeak,
  speaking,
  vocab,
}) => {
  const _ = useTranslation();
  return (
    <div className={clsx('flex h-8 w-full items-center justify-between px-2', headerClassName)}>
      <div className='flex h-8 w-8 items-center justify-center'>
        {canGoBack ? (
          <button
            type='button'
            aria-label={_('Back')}
            onClick={goBack}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8'
          >
            <MdArrowBack size={20} />
          </button>
        ) : null}
      </div>
      <div className='flex min-w-0 flex-1 items-center justify-center gap-1'>
        {onSpeak ? (
          <button
            type='button'
            aria-label={_('Speak')}
            title={_('Speak')}
            aria-pressed={!!speaking}
            onClick={onSpeak}
            className={clsx(
              'btn btn-ghost btn-square btn-xs shrink-0',
              speaking
                ? 'text-base-content not-eink:animate-pulse'
                : 'text-base-content/60 hover:text-base-content not-eink:hover:bg-base-200/60',
            )}
          >
            <MdVolumeUp size={18} />
          </button>
        ) : null}
        {vocab ? (
          <button
            type='button'
            aria-label={vocab.saved ? _('Added to Wordbook') : _('Add to Wordbook')}
            title={`${vocab.saved ? _('Added to Wordbook') : _('Add to Wordbook')}（${vocab.label}）`}
            aria-pressed={vocab.saved}
            disabled={vocab.busy || vocab.saved}
            onClick={vocab.onAdd}
            className={clsx(
              'btn btn-ghost btn-square btn-xs shrink-0',
              vocab.saved
                ? 'text-primary'
                : 'text-base-content/60 hover:text-base-content not-eink:hover:bg-base-200/60',
              vocab.busy && 'not-eink:animate-pulse',
            )}
          >
            {vocab.saved ? <MdBookmarkAdded size={18} /> : <MdBookmarkAdd size={18} />}
          </button>
        ) : null}
        <span data-testid='dict-title' className='line-clamp-1 min-w-0 font-bold'>
          {currentWord}
        </span>
      </div>
      <div className='flex h-8 w-8 items-center justify-center'>
        {onManage ? (
          <button
            type='button'
            aria-label={_('Manage Dictionaries')}
            title={_('Manage Dictionaries')}
            onClick={onManage}
            className='btn btn-ghost btn-square btn-xs text-base-content/60 hover:text-base-content not-eink:hover:bg-base-200/60'
          >
            <MdSettings size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

interface DictionaryResultsBodyProps extends DictionaryResultsState {}

export const DictionaryResultsBody: React.FC<DictionaryResultsBodyProps> = ({
  visibleDefinitionProviders,
  unavailableDefinitionLabels,
  webSearchProviders,
  webSearchFirst,
  cards,
  setContainerRef,
  handleContainerClick,
  toggleExpanded,
  resolveWebSearchUrl,
  onWebSearchClickTauri,
  noProvidersAtAll,
  fontScale,
}) => {
  const _ = useTranslation();

  // `first:pt-2` keeps the leading section's tighter top padding whichever of
  // the two comes first.
  const sectionClassName = 'px-4 pt-4 first:pt-2';

  // No dictionary could serve here (web-only provider on the app, encrypted
  // MDX, …) — previously the popup rendered nothing at all.
  const unavailableSection = visibleDefinitionProviders.length === 0 &&
    unavailableDefinitionLabels.length > 0 && (
      <section className={sectionClassName}>
        <p className='not-eink:opacity-70 text-sm'>
          {_('Not available on this device:')} {unavailableDefinitionLabels.join('、')}
        </p>
      </section>
    );

  const definitionsSection = visibleDefinitionProviders.length > 0 && (
    <section className={sectionClassName}>
      <h3 className='not-eink:opacity-60 mb-2 text-xs font-medium uppercase tracking-wide'>
        {_('Dictionaries')}
      </h3>
      <ul className='flex flex-col gap-3'>
        {visibleDefinitionProviders.map((p) => {
          const card = cards[p.id];
          const isLoading = !card || card.state === 'loading';
          const expanded = card?.expanded ?? false;
          const sourceLabel =
            card?.outcome?.ok && card.outcome.sourceLabel ? card.outcome.sourceLabel : _(p.label);
          return (
            <li key={p.id}>
              <div
                data-testid='dict-card'
                role='button'
                tabIndex={0}
                aria-expanded={expanded}
                onClick={(e) => {
                  // Clicks inside a provider's shadow-root content (MDict, the
                  // server dictionary, …) arrive retargeted to the shadow host:
                  // they are text selection and link taps inside an entry, not
                  // "fold this card". Folding here clips the card to `max-h-40`,
                  // which reads as the results vanishing mid-read.
                  if ((e.target as Element | null)?.classList?.contains('dict-shadow-host')) {
                    return;
                  }
                  const path = e.nativeEvent.composedPath();
                  for (const node of path) {
                    if (node === e.currentTarget) break;
                    if (node instanceof Element) {
                      const tag = node.tagName;
                      if (tag === 'A' || tag === 'BUTTON' || tag === 'IMG') return;
                    }
                  }
                  toggleExpanded(p.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpanded(p.id);
                  }
                }}
                className={clsx('cursor-pointer rounded-lg')}
              >
                {isLoading && (
                  <div
                    data-testid='dict-card-skeleton'
                    className='bg-base-200/50 h-12 animate-pulse rounded'
                  />
                )}
                <div
                  ref={setContainerRef(p.id)}
                  onClick={handleContainerClick}
                  // `data-dict-content` + `--dict-font-scale` drive the
                  // popup font-size rules in globals.css (#4443): the
                  // light-DOM `font-size` cascade and the MDict shadow
                  // `::part(dict-content)` rule both read this scope.
                  data-dict-content=''
                  style={{ '--dict-font-scale': fontScale } as React.CSSProperties}
                  className={clsx(
                    'font-sans',
                    isLoading && 'hidden',
                    !isLoading &&
                      !expanded &&
                      'line-clamp-4 max-h-40 overflow-hidden [-webkit-box-orient:vertical] [display:-webkit-box]',
                  )}
                />
                {!isLoading && (
                  <div className='border-base-content/10 -me-4 mt-2 border-b pb-2'>
                    <span className='not-eink:opacity-60 text-xs'>{sourceLabel}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const webSearchSection = webSearchProviders.length > 0 && (
    <section className={sectionClassName}>
      <h3 className='not-eink:opacity-60 mb-2 text-xs font-medium uppercase tracking-wide'>
        {_('Search the web')}
      </h3>
      <ul className='flex flex-col'>
        {webSearchProviders.map((p) => {
          const url = resolveWebSearchUrl(p.id);
          return (
            <li key={p.id}>
              <a
                href={url ?? '#'}
                target={isTauri ? undefined : '_blank'}
                rel='noopener noreferrer'
                onClick={(e) => onWebSearchClickTauri(e, p.id)}
                className='hover:bg-base-200/40 flex w-full items-center justify-between rounded-md px-2 py-3 text-left text-sm no-underline'
              >
                <span>{_(p.label)}</span>
                <MdChevronRight className='not-eink:opacity-60' size={18} />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        {noProvidersAtAll ? (
          <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
            <h1 className='text-base font-bold'>{_('No dictionaries enabled')}</h1>
            <p className='not-eink:opacity-70 mt-2 text-sm'>
              {_('Enable a dictionary in Settings → Language → Dictionaries.')}
            </p>
          </div>
        ) : webSearchFirst ? (
          <>
            {webSearchSection}
            {definitionsSection}
            {unavailableSection}
          </>
        ) : (
          <>
            {definitionsSection}
            {unavailableSection}
            {webSearchSection}
          </>
        )}
      </div>
    </div>
  );
};
