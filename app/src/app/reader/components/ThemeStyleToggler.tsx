import React from 'react';
import { MdOutlineLightMode, MdOutlineDarkMode } from 'react-icons/md';
import { TbSunMoon } from 'react-icons/tb';

import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import Button from '@/components/Button';
import { ThemeMode } from '@/styles/themes';

const THEME_MODE_ORDER: ThemeMode[] = ['auto', 'light', 'dark'];

const THEME_MODE_ICONS: Record<ThemeMode, React.ReactNode> = {
  auto: <TbSunMoon className='text-base-content' />,
  light: <MdOutlineLightMode className='text-base-content' />,
  dark: <MdOutlineDarkMode className='text-base-content' />,
};

const ThemeStyleToggler: React.FC = () => {
  const _ = useTranslation();
  const { themeMode, setThemeMode } = useThemeStore();

  const themeModeLabels: Record<ThemeMode, string> = {
    auto: _('Auto Mode'),
    light: _('Light Mode'),
    dark: _('Dark Mode'),
  };

  const handleToggleThemeStyle = () => {
    const currentIndex = THEME_MODE_ORDER.indexOf(themeMode);
    const nextMode = THEME_MODE_ORDER[(currentIndex + 1) % THEME_MODE_ORDER.length]!;
    setThemeMode(nextMode);
  };

  return (
    <Button
      icon={THEME_MODE_ICONS[themeMode]}
      onClick={handleToggleThemeStyle}
      label={`${_('Switch Theme Style')}: ${themeModeLabels[themeMode]}`}
    />
  );
};

export default ThemeStyleToggler;
