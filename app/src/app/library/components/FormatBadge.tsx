import clsx from 'clsx';
import { BookFormat } from '@/types/book';

const FORMAT_BADGE_STYLES: Record<BookFormat, string> = {
  EPUB: 'bg-blue-600 text-white',
  AZW3: 'bg-purple-600 text-white',
  AZW: 'bg-purple-500 text-white',
  MOBI: 'bg-amber-500 text-black',
  PDF: 'bg-red-600 text-white',
  TXT: 'bg-slate-500 text-white',
  CBZ: 'bg-teal-600 text-white',
  FB2: 'bg-cyan-600 text-white',
  FBZ: 'bg-cyan-700 text-white',
  MD: 'bg-gray-600 text-white',
};

interface FormatBadgeProps {
  format: BookFormat;
}

const FormatBadge: React.FC<FormatBadgeProps> = ({ format }) => {
  return (
    <div
      className={clsx(
        'eink-bordered absolute right-1 top-1 rounded px-1 text-[0.55em] font-bold leading-tight drop-shadow-sm',
        FORMAT_BADGE_STYLES[format],
      )}
    >
      {format}
    </div>
  );
};

export default FormatBadge;
