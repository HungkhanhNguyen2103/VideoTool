import { useEffect, useRef } from 'react';
import { Button } from '../../../shared/ui/Button';
import styles from './ConfirmDeleteDialog.module.css';

type ConfirmDeleteDialogProps = {
  /** The project pending deletion, or null when the dialog should be closed. */
  pending: { title: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Native <dialog>, matching docs/prototypes/khoi-tao-du-an/index.html#dlg-delete. */
export function ConfirmDeleteDialog({ pending, onConfirm, onCancel }: ConfirmDeleteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="dlg-delete-title"
      onClose={() => {
        if (ref.current?.returnValue === 'ok') onConfirm();
        else onCancel();
        if (ref.current) ref.current.returnValue = '';
      }}
    >
      <form method="dialog">
        <h2 id="dlg-delete-title">Xóa dự án?</h2>
        <p>
          {pending ? `Dự án "${pending.title}" sẽ bị xóa khỏi danh sách. Thao tác này không thể hoàn tác.` : ''}
        </p>
        <div className={styles.actions}>
          <Button type="submit" value="cancel">
            Hủy
          </Button>
          <Button type="submit" value="ok" variant="red">
            Xóa dự án
          </Button>
        </div>
      </form>
    </dialog>
  );
}
