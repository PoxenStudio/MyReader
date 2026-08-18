import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import Alert from './Alert';

/**
 * A single-button "OK" alert for surfacing an error message — e.g. the
 * `msg` a MyBooks server returned for a failed upload. Built on top of
 * `Alert` (its `hideCancel` + `variant='error'` options), so it stays
 * visually consistent with the rest of the app's alerts instead of
 * introducing a second dialog style.
 */
interface ErrorMessageDialogProps {
  title?: string;
  message: string;
  onClose: () => void;
}

const ErrorMessageDialog: React.FC<ErrorMessageDialogProps> = ({ title, message, onClose }) => {
  const _ = useTranslation();

  return (
    <Alert
      title={title ?? _('Error')}
      message={message}
      variant='error'
      hideCancel
      confirmLabel={_('OK')}
      confirmButtonClassName='btn-neutral'
      onCancel={onClose}
      onConfirm={onClose}
    />
  );
};

export default ErrorMessageDialog;
