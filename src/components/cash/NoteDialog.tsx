import React, { useRef, useState } from 'react';
import { Button, Field, Modal, Textarea } from '../ui';

export interface NoteDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Shown above the note, e.g. the amount being approved. */
  summary?: React.ReactNode;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  confirmIcon?: React.ReactNode;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  /** Resolve true to close the dialog. */
  onConfirm: (note: string) => Promise<boolean>;
}

const MIN_NOTE = 3;

/** Asks for a written reason before an audited action (reopen a day, settle a disputed handover). */
const NoteDialog: React.FC<NoteDialogProps> = ({
  open, onClose, title, description, icon, summary, label, placeholder, confirmLabel, confirmIcon, tone = 'primary', busy = false, onConfirm,
}) => {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = note.trim();
  const error = touched && trimmed.length < MIN_NOTE ? 'A reason is required — it goes into the audit record.' : undefined;

  const submit = async () => {
    setTouched(true);
    if (trimmed.length < MIN_NOTE) {
      noteRef.current?.focus();
      return;
    }
    if (await onConfirm(trimmed)) {
      setNote('');
      setTouched(false);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={title}
      description={description}
      icon={icon}
      initialFocusRef={noteRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} leftIcon={confirmIcon} loading={busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {summary && <div className="mb-3">{summary}</div>}
      <Field label={label} required error={error}>
        {control => (
          <Textarea
            {...control}
            ref={noteRef}
            rows={3}
            value={note}
            onChange={event => setNote(event.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
          />
        )}
      </Field>
    </Modal>
  );
};

export default NoteDialog;
