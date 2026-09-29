import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  DictionaryResultsBody,
  type DictionaryResultsState,
} from '@/app/reader/components/annotator/DictionaryResultsView';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const baseProps = {
  visibleDefinitionProviders: [],
  noDefinitionResults: false,
  webSearchProviders: [],
  webSearchFirst: false,
  cards: {},
  setContainerRef: () => () => {},
  handleContainerClick: () => {},
  toggleExpanded: () => {},
  resolveWebSearchUrl: () => undefined,
  onWebSearchClickTauri: () => {},
  noProvidersAtAll: false,
  fontScale: 1,
} as unknown as DictionaryResultsState;

describe('DictionaryResultsBody', () => {
  afterEach(cleanup);

  it('says "No results available" when no dictionary produced a result', () => {
    render(<DictionaryResultsBody {...baseProps} noDefinitionResults />);
    expect(screen.getByText('No results available')).toBeTruthy();
    expect(screen.queryByText(/Not available on this device/)).toBeNull();
  });

  it('stays silent while there is nothing to report', () => {
    render(<DictionaryResultsBody {...baseProps} />);
    expect(screen.queryByText('No results available')).toBeNull();
  });
});
