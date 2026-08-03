import clsx from 'clsx';
import NasConnectionIcon from '@/components/icons/NasConnectionIcon';

interface NasRemoteLoginIconButtonProps {
  onClick: () => void;
  title: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Circular icon-button that opens the NAS remote-login webview. Uses a
 * solid background so the (otherwise dark-line) connection icon stays
 * visible in both themes — see NasConnectionIcon's docstring.
 */
const NasRemoteLoginIconButton: React.FC<NasRemoteLoginIconButtonProps> = ({
  onClick,
  title,
  className,
  disabled,
}) => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className={clsx(
      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
      'bg-primary text-primary-content',
      'hover:bg-primary/90 disabled:opacity-50',
      'transition-colors duration-150',
      'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
      className,
    )}
  >
    <NasConnectionIcon className='h-4 w-4' />
  </button>
);

export default NasRemoteLoginIconButton;
