import type { IconType } from 'react-icons';

export const AiCompanionIcon: IconType = ({ size = 16, color, className, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.5}
    strokeLinejoin='round'
    color={color}
    className={className}
    {...rest}
  >
    <circle cx='12' cy='12' r='9.5' />
    <path d='M12 4.8l1.22 4.24 3.87-2.13-2.13 3.87L19.2 12l-4.24 1.22 2.13 3.87-3.87-2.13L12 19.2l-1.22-4.24-3.87 2.13 2.13-3.87L4.8 12l4.24-1.22-2.13-3.87 3.87 2.13z' />
  </svg>
);

export default AiCompanionIcon;
