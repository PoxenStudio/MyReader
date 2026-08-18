import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

// 'info' is the original blue "i" glyph used by every confirm/cancel alert.
// 'error' swaps in a red warning-triangle for dialogs that report a failure
// rather than ask for a decision (see ErrorMessageDialog).
type AlertVariant = 'info' | 'error';

const Alert: React.FC<{
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  // Optional content rendered between the title/message and the actions row
  // (e.g. the delete confirmation's "purge reading data" toggle).
  children?: React.ReactNode;
  confirmLabel?: string;
  confirmButtonClassName?: string;
  variant?: AlertVariant;
  // Hides the Cancel button for alerts that only ever acknowledge (e.g. an
  // error message) rather than offer a real choice.
  hideCancel?: boolean;
}> = ({
  title,
  message,
  onCancel,
  onConfirm,
  children,
  confirmLabel,
  confirmButtonClassName = 'btn-warning',
  variant = 'info',
  hideCancel = false,
}) => {
  const _ = useTranslation();
  const [isProcessing, setIsProcessing] = React.useState(false);
  const divRef = useKeyDownActions({ onCancel, onConfirm });

  return (
    <div className={clsx('z-[130] flex justify-center px-4')}>
      <div
        ref={divRef}
        role='alert'
        // Always stack the title/message block above the actions row. The
        // previous side-by-side layout flex-wrapped at narrow widths and
        // produced the cramped two-column-with-stacked-buttons shape from
        // Image #3. Avoid the daisyUI `alert` class here — it applies a
        // `display: grid` with `justify-items: center` that collapses the
        // actions row to content width and pulls it toward the centre,
        // defeating `justify-end`. We want a plain flex-column surface.
        className={clsx(
          'flex flex-col gap-3',
          'bg-base-300 rounded-lg p-4 shadow-2xl',
          'w-full max-w-[22rem] sm:max-w-[25rem] md:max-w-[28rem]',
        )}
      >
        <div className='labels flex items-start gap-3'>
          {variant === 'error' ? (
            <svg
              xmlns='http://www.w3.org/2000/svg'
              fill='none'
              viewBox='0 0 24 24'
              className='stroke-error mt-0.5 h-6 w-6 shrink-0'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                d='M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z'
              ></path>
            </svg>
          ) : (
            <svg
              xmlns='http://www.w3.org/2000/svg'
              fill='none'
              viewBox='0 0 24 24'
              className='stroke-info mt-0.5 h-6 w-6 shrink-0'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth='2'
                d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
              ></path>
            </svg>
          )}
          <div className='flex min-w-0 flex-col gap-1'>
            <h3 className='text-start text-sm font-medium'>{title}</h3>
            <div className='text-start text-sm whitespace-pre-wrap break-words'>{message}</div>
          </div>
        </div>
        {children}
        <div className='buttons flex items-center justify-end gap-2'>
          {!hideCancel && (
            <button className='btn btn-sm btn-neutral' onClick={onCancel}>
              {_('Cancel')}
            </button>
          )}
          <button
            className={clsx('btn btn-sm', confirmButtonClassName, { 'btn-disabled': isProcessing })}
            onClick={() => {
              setIsProcessing(true);
              onConfirm();
            }}
          >
            {confirmLabel ?? _('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Alert;
