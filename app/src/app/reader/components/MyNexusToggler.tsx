'use client';

import React, { useEffect, useRef } from 'react';
import { MdOutlineForum } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { useMyNexusAvailability, useMyNexusEnabled, useMyNexusStore } from '@/store/myNexusStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { getUserInfo } from '@/services/mybooksService';
import { hasEmbedReturnUrl } from '@/utils/embedReturn';
import { getBookHash } from '@/utils/book';
import Button from '@/components/Button';

interface MyNexusTogglerProps {
  bookKey: string;
}

const MyNexusToggler: React.FC<MyNexusTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, notebookActiveTab, setNotebookVisible, setNotebookActiveTab } =
    useNotebookStore();
  const iconSize18 = useResponsiveSize(18);

  const bookId = useBookDataStore((state) => state.booksData[getBookHash(bookKey)]?.book?.bookId);
  const sysInfo = useMyBooksStatusStore((state) => state.sysInfo);
  const platformOk = appService?.isDesktopApp === true || hasEmbedReturnUrl(getBookHash(bookKey));
  const mynexusEnabled = useMyNexusEnabled();
  const companionAvailable = useMyNexusAvailability(bookId);
  const visible = platformOk && mynexusEnabled && companionAvailable;

  const fetchInfoRef = useRef(false);
  useEffect(() => {
    if (!platformOk || fetchInfoRef.current || sysInfo) return;
    fetchInfoRef.current = true;
    console.log('[MyNexus] sysInfo missing, fetching user info to resolve mynexus_enabled');
    void getUserInfo();
  }, [platformOk, sysInfo]);

  useEffect(() => {
    if (!visible || !bookId) return;
    void useMyNexusStore.getState().loadAvailability(bookId);
  }, [visible, bookId]);

  console.log(
    `[MyNexus] toggler book=${getBookHash(bookKey)} bookId=${bookId ?? 'none'} platform=${platformOk} enabled=${mynexusEnabled} available=${companionAvailable} show=${visible}`,
  );

  if (!visible) return null;

  const isShowingCompanion =
    sideBarBookKey === bookKey && isNotebookVisible && notebookActiveTab === 'companion';

  const handleClick = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    if (isShowingCompanion) {
      setNotebookVisible(false);
      return;
    }
    setSideBarBookKey(bookKey);
    setNotebookActiveTab('companion');
    setNotebookVisible(true);
  };

  return (
    <Button
      icon={
        <MdOutlineForum
          size={iconSize18}
          className={isShowingCompanion ? 'text-primary' : 'text-base-content'}
        />
      }
      onClick={handleClick}
      label={_('AI Companion')}
    ></Button>
  );
};

export default MyNexusToggler;
