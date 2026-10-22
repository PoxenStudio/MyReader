import type { IconType } from 'react-icons';

export const AiCompanionIcon: IconType = ({ size = '1.2em', color, className, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinejoin='round'
    color={color}
    className={className}
    {...rest}
  >
    <circle cx='12' cy='12' r='10.5' />
    <path d='M12 4.04l1.35 4.69 4.28-2.36-2.36 4.28 4.69 1.35-4.69 1.35 2.36 4.28-4.28-2.36-1.35 4.69-1.35-4.69-4.28 2.36 2.36-4.28L4.04 12l4.69-1.35-2.36-4.28 4.28 2.36z' />
  </svg>
);

export default AiCompanionIcon;
