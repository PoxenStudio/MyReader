import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMyDictProvider } from '@/services/dictionaries/providers/myDictProvider';
import type { VocabCapability } from '@/services/dictionaries/types';

/** 生词本能力由 provider 自己创建（每台服务器一份），测试里换成假的。 */
const { vocabMock } = vi.hoisted(() => {
  const vocabMock: {
    label: string;
    listSaved: ReturnType<typeof vi.fn>;
    addEntry: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  } = {
    label: 'MyDict',
    listSaved: vi.fn(async () => new Map<number, number>()),
    addEntry: vi.fn(async () => ({ status: 'ok' as const })),
    removeItem: vi.fn(async () => ({ status: 'ok' as const })),
  };
  return { vocabMock };
});

vi.mock('@/services/dictionaries/mydictVocab', () => ({
  createMyDictVocab: () => vocabMock as unknown as VocabCapability,
  createServerVocab: () => vocabMock as unknown as VocabCapability,
}));

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/services/dictionaries/providers/myDictQuery', () => ({
  queryMyDict: queryMock,
}));

const hit = (dictionary_id: number, word: string, dictionary_name = `D${dictionary_id}`) => ({
  dictionary_id,
  dictionary_name,
  word,
  phonetic: null,
  definition: '<p>x</p>',
});

describe('MyDict provider wordbook stars', () => {
  beforeEach(() => {
    vocabMock.listSaved.mockReset().mockResolvedValue(new Map<number, number>());
    vocabMock.addEntry.mockReset().mockResolvedValue({ status: 'ok' });
    vocabMock.removeItem.mockReset().mockResolvedValue({ status: 'ok' });
    queryMock.mockReset();
  });

  it('renders one star per dictionary group, reflecting the saved set', async () => {
    // 前缀匹配：查 ran 命中 ranch / ran，也要分属两部词典
    queryMock.mockResolvedValue({ results: [hit(4, 'ranch'), hit(7, 'ran')] });
    vocabMock.listSaved.mockResolvedValue(new Map([[4, 42]]));

    const container = document.createElement('div');
    await createMyDictProvider({
      id: 'mydict:1',
      name: 'MyDict',
      url: 'https://d',
      token: 't',
    }).lookup('ran', { signal: new AbortController().signal, container });
    await vi.waitFor(() => expect(vocabMock.listSaved).toHaveBeenCalled());

    const stars = container.querySelectorAll<HTMLButtonElement>('.mydict-vocab-star');
    expect(stars).toHaveLength(2);
    expect(stars[0]!.textContent).toBe('★'); // dict 4 已收藏
    expect(stars[1]!.textContent).toBe('☆');
  });

  it("saves the group's own headword and dictionary id, then un-stars on click again", async () => {
    queryMock.mockResolvedValue({ results: [hit(4, 'ranch')] });
    const container = document.createElement('div');
    await createMyDictProvider({
      id: 'mydict:1',
      name: 'MyDict',
      url: 'https://d',
      token: 't',
    }).lookup('ran', { signal: new AbortController().signal, container });
    await vi.waitFor(() => expect(container.querySelector('.mydict-vocab-star')).toBeTruthy());

    const star = container.querySelector<HTMLButtonElement>('.mydict-vocab-star')!;
    // 收藏成功后服务端就有了这条记录，星标靠增删后的对账点亮
    vocabMock.listSaved.mockResolvedValue(new Map([[4, 42]]));
    star.click();
    await vi.waitFor(() => expect(vocabMock.addEntry).toHaveBeenCalled());
    // 发的是词条词头（ranch），不是读者选中的 ran——服务端按 (词典, 词头) 精确查找
    expect(vocabMock.addEntry).toHaveBeenCalledWith({ dictionaryId: 4, word: 'ranch' });

    await vi.waitFor(() => expect(star.textContent).toBe('★'));
    star.click();
    await vi.waitFor(() => expect(vocabMock.removeItem).toHaveBeenCalledWith(42));
  });

  it('does not render stars when the provider has no wordbook capability', async () => {
    // 内置 MyBooks 词典（另一台服务）没有 vocab 能力，不该出现星标
    const { myBooksDictProvider } = await import(
      '@/services/dictionaries/providers/myBooksDictProvider'
    );
    const container = document.createElement('div');
    expect(myBooksDictProvider.vocab).toBeUndefined();
    expect(container.querySelectorAll('.mydict-vocab-star')).toHaveLength(0);
  });
});
