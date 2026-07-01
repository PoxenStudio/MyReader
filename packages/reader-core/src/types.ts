export type BookFormat =
  | 'EPUB'
  | 'PDF'
  | 'MOBI'
  | 'AZW'
  | 'AZW3'
  | 'CBZ'
  | 'FB2'
  | 'FBZ'
  | 'TXT'
  | 'MD';

export interface LanguageMap {
  [key: string]: string;
}

export interface Identifier {
  scheme: string;
  value: string;
}

export interface Contributor {
  name: LanguageMap;
}

export interface Collection {
  name: string;
  position?: string;
  total?: string;
}

export type Location = {
  current: number;
  next: number;
  total: number;
};

export interface TOCItem {
  id: number;
  label: string;
  href: string;
  index: number; // Page index for PDF books
  cfi?: string;
  location?: Location;
  subitems?: TOCItem[];
}

export interface SectionFragment {
  id: string;
  href: string;
  cfi: string;
  size: number;
  linear: string;
  location?: Location;
  fragments?: Array<SectionFragment>;
}

export interface SectionItem {
  id: string;
  cfi: string;
  size: number;
  linear: string;
  href?: string;
  location?: Location;
  pageSpread?: 'left' | 'right' | 'center' | '';
  fragments?: Array<SectionFragment>;

  loadText?: () => Promise<string | null>;
  createDocument: () => Promise<Document>;
}

export type BookMetadata = {
  title: string | LanguageMap;
  author: string | Contributor;
  language: string | string[];
  editor?: string;
  publisher?: string;
  published?: string;
  description?: string;
  subject?: string | string[] | Contributor;
  identifier?: string;
  isbn?: string;
  altIdentifier?: string | string[] | Identifier;
  belongsTo?: {
    collection?: Array<Collection> | Collection;
    series?: Array<Collection> | Collection;
  };

  subtitle?: string;
  series?: string;
  seriesIndex?: number;
  seriesTotal?: number;

  coverImageFile?: string;
  coverImageUrl?: string;
  coverImageBlobUrl?: string;
};

export interface BookDoc {
  metadata: BookMetadata;
  rendition: {
    layout?: 'pre-paginated' | 'reflowable';
    spread?: 'auto' | 'none';
    viewport?: { width: number; height: number };
  };
  dir: string;
  toc?: Array<TOCItem>;
  sections: Array<SectionItem>;
  transformTarget?: EventTarget;
  splitTOCHref(href: string): Array<string | number>;
  getCover(): Promise<Blob | null>;
}
