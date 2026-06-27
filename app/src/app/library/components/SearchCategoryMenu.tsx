import clsx from 'clsx';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { useTranslation } from '@/hooks/useTranslation';
import { SEARCH_CATEGORIES, SearchCategory } from '../utils/libraryUtils';

interface SearchCategoryMenuProps {
  setIsDropdownOpen?: (open: boolean) => void;
  currentCategory: SearchCategory;
  onSelectCategory: (category: SearchCategory) => void;
}

const SearchCategoryMenu: React.FC<SearchCategoryMenuProps> = ({
  setIsDropdownOpen,
  currentCategory,
  onSelectCategory,
}) => {
  const _ = useTranslation();

  return (
    <Menu
      className={clsx('dropdown-content bg-base-100 rounded-box !relative z-[1] mt-3 p-2 shadow')}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {SEARCH_CATEGORIES.map((cat) => (
        <MenuItem
          key={cat.value}
          label={_(cat.label)}
          noIcon
          toggled={cat.value === currentCategory}
          onClick={() => {
            onSelectCategory(cat.value);
            setIsDropdownOpen?.(false);
          }}
        />
      ))}
    </Menu>
  );
};

export default SearchCategoryMenu;
